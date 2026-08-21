import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth";
import { ensureDatabase, getUserWithRole, sql } from "@/lib/db";
import { notifyUsers } from "@/lib/push";
import { checkFeedbackRateLimit } from "@/lib/feedback-rate-limit";

const feedbackSchema = z.object({
  type: z.enum(["bug", "suggestion"]),
  category: z
    .enum(["Geral", "Interface", "Reservas", "Notificações", "Acesso", "Salas", "Outro"])
    .optional()
    .default("Geral"),
  title: z.string().trim().min(3).max(140),
  description: z.string().trim().min(10).max(5000),
  reporterName: z.string().trim().max(120).optional().default(""),
  reporterEmail: z
    .union([z.string().trim().email().max(180), z.literal("")])
    .optional()
    .default(""),
  website: z.string().max(0).optional().default(""),
});

export async function POST(request: NextRequest) {
  await ensureDatabase();
  const parsed = feedbackSchema.safeParse(
    await request.json().catch(() => ({})),
  );
  if (!parsed.success)
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ||
          "Revise o título e a descrição do relato.",
      },
      { status: 400 },
    );
  if (parsed.data.website)
    return NextResponse.json({ ok: true }, { status: 202 });

  const sessionUserId = await getSessionUserId();
  const sessionUser = sessionUserId
    ? await getUserWithRole(sessionUserId)
    : null;
  const reporterName = sessionUser?.name || parsed.data.reporterName;
  if (!sessionUser && reporterName.length < 2)
    return NextResponse.json(
      { error: "Informe seu nome para enviar o relato." },
      { status: 400 },
    );

  const rateLimit = await checkFeedbackRateLimit(request, sessionUserId);
  if (!rateLimit.allowed)
    return NextResponse.json(
      {
        error:
          "Você enviou vários relatos em pouco tempo. Aguarde antes de tentar novamente.",
      },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfter) },
      },
    );

  const db = sql();
  const duplicate = await db.query(
    `SELECT id FROM feedback_reports
     WHERE created_at>now()-interval '1 minute' AND title=$1
       AND (($2::uuid IS NOT NULL AND reporter_id=$2::uuid)
         OR ($2::uuid IS NULL AND reporter_email=$3))
     LIMIT 1`,
    [parsed.data.title, sessionUser?.id || null, parsed.data.reporterEmail],
  );
  if (duplicate.length)
    return NextResponse.json(
      { error: "Este relato acabou de ser enviado." },
      { status: 409 },
    );

  await db.query(
    `INSERT INTO feedback_reports(type,category,title,description,reporter_id,reporter_name,reporter_email)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      parsed.data.type,
      parsed.data.category,
      parsed.data.title,
      parsed.data.description,
      sessionUser?.id || null,
      reporterName,
      parsed.data.reporterEmail,
    ],
  );
  if (sessionUser?.id)
    await db.query(
      `INSERT INTO audit_log(actor_id,action,details) VALUES ($1,$2,$3)`,
      [
        sessionUser.id,
        parsed.data.type === "bug" ? "feedback.bug" : "feedback.suggestion",
        parsed.data.title,
      ],
    );
  const gods = await db.query(
    `SELECT id FROM users WHERE is_god=true AND active=true AND deleted_at IS NULL`,
  );
  await notifyUsers(
    gods.map((god) => String(god.id)),
    {
      title:
        parsed.data.type === "bug"
          ? "Novo bug reportado"
          : "Nova sugestão de melhoria",
      body: `${reporterName}: ${parsed.data.title}`,
      url: "/",
      tag: `feedback-${parsed.data.type}`,
    },
  );
  return NextResponse.json({ ok: true });
}
