import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const COOKIE_NAME = "mappa_session";
const SECURITY_SETUP_COOKIE = "mappa_security_setup";

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32)
    throw new Error("AUTH_SECRET_NOT_CONFIGURED");
  return new TextEncoder().encode(value);
}

export async function setSession(userId: string) {
  const token = await new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret());
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export async function clearSession() {
  const jar = await cookies();
  jar.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function setSecuritySetupSession(userId: string) {
  const token = await new SignJWT({ userId, purpose: "security_setup" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secret());
  const jar = await cookies();
  jar.set(SECURITY_SETUP_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });
}

export async function getSecuritySetupUserId() {
  try {
    const token = (await cookies()).get(SECURITY_SETUP_COOKIE)?.value;
    if (!token) return null;
    const verified = await jwtVerify(token, secret());
    if (verified.payload.purpose !== "security_setup") return null;
    return typeof verified.payload.userId === "string"
      ? verified.payload.userId
      : null;
  } catch {
    return null;
  }
}

export async function clearSecuritySetupSession() {
  const jar = await cookies();
  jar.set(SECURITY_SETUP_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function getSessionUserId() {
  try {
    const token = (await cookies()).get(COOKIE_NAME)?.value;
    if (!token) return null;
    const verified = await jwtVerify(token, secret());
    return typeof verified.payload.userId === "string"
      ? verified.payload.userId
      : null;
  } catch {
    return null;
  }
}
