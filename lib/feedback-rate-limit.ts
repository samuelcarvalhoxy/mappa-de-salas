import { createHmac } from "node:crypto";
import type { NextRequest } from "next/server";
import { sql } from "./db";

type Limit = {
  name: string;
  interval: string;
  maximum: number;
  retryAfter: number;
};

const IDENTITY_LIMITS: Limit[] = [
  { name: "short", interval: "10 minutes", maximum: 5, retryAfter: 600 },
  { name: "daily", interval: "24 hours", maximum: 20, retryAfter: 86400 },
];

// The broader network ceiling protects the public endpoint while leaving room
// for several legitimate people behind the same company network.
const NETWORK_LIMITS: Limit[] = [
  { name: "short", interval: "10 minutes", maximum: 30, retryAfter: 600 },
  { name: "daily", interval: "24 hours", maximum: 100, retryAfter: 86400 },
];

function requestIp(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function protectedIdentifier(value: string) {
  const secret =
    process.env.FEEDBACK_RATE_LIMIT_SECRET || process.env.AUTH_SECRET || "";
  if (secret.length < 32) throw new Error("RATE_LIMIT_SECRET_NOT_CONFIGURED");
  return createHmac("sha256", secret).update(value).digest("hex");
}

async function consume(key: string, limit: Limit) {
  const rows = await sql().query(
    `INSERT INTO feedback_rate_limits(limiter_key,window_start,request_count,updated_at)
     VALUES ($1,now(),1,now())
     ON CONFLICT(limiter_key) DO UPDATE SET
       window_start=CASE WHEN feedback_rate_limits.window_start<=now()-$2::interval THEN now() ELSE feedback_rate_limits.window_start END,
       request_count=CASE WHEN feedback_rate_limits.window_start<=now()-$2::interval THEN 1 ELSE feedback_rate_limits.request_count+1 END,
       updated_at=now()
     WHERE feedback_rate_limits.window_start<=now()-$2::interval OR feedback_rate_limits.request_count<$3
     RETURNING request_count`,
    [key, limit.interval, limit.maximum],
  );
  return rows.length > 0;
}

export async function checkFeedbackRateLimit(
  request: NextRequest,
  sessionUserId: string | null,
) {
  const ip = requestIp(request);
  const userAgent = request.headers.get("user-agent") || "unknown";
  const identity = sessionUserId
    ? `user:${sessionUserId}`
    : `visitor:${ip}:${userAgent}`;
  const identityFingerprint = protectedIdentifier(identity);
  const networkFingerprint = protectedIdentifier(`network:${ip}`);

  for (const limit of IDENTITY_LIMITS) {
    if (
      !(await consume(
        `feedback:identity:${limit.name}:${identityFingerprint}`,
        limit,
      ))
    )
      return { allowed: false, retryAfter: limit.retryAfter };
  }

  for (const limit of NETWORK_LIMITS) {
    if (
      !(await consume(
        `feedback:network:${limit.name}:${networkFingerprint}`,
        limit,
      ))
    )
      return { allowed: false, retryAfter: limit.retryAfter };
  }

  return { allowed: true, retryAfter: 0 };
}
