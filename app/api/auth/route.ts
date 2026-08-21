import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import {
  clearSecuritySetupSession,
  clearSession,
  getSecuritySetupUserId,
  setSecuritySetupSession,
  setSession,
} from "@/lib/auth";
import { ensureDatabase, hasDatabase, sql } from "@/lib/db";
import {
  isAllowedSecurityAnswer,
  SECURITY_QUESTIONS,
} from "@/lib/security-options";
import { z } from "zod";

const loginSchema = z.object({
  action: z.literal("login"),
  username: z.string().min(2).max(60),
  password: z.string().min(1).max(200),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (body.action === "logout") {
    await Promise.all([clearSession(), clearSecuritySetupSession()]);
    return NextResponse.json({ ok: true });
  }
  if (!hasDatabase())
    return NextResponse.json(
      { error: "O banco ainda não foi conectado ao projeto." },
      { status: 503 },
    );
  await ensureDatabase();
  if (body.action === "login") {
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json(
        { error: "Preencha usuário e senha." },
        { status: 400 },
      );
    const username = parsed.data.username.trim().toLowerCase();
    const rows = await sql().query(
      `SELECT id,password_hash,active,locked_until,security_answers FROM users WHERE username=$1 AND deleted_at IS NULL LIMIT 1`,
      [username],
    );
    const user = rows[0];
    if (
      !user ||
      !user.active ||
      (user.locked_until && new Date(user.locked_until) > new Date())
    )
      return NextResponse.json(
        { error: "Acesso inválido ou temporariamente bloqueado." },
        { status: 401 },
      );
    const valid = await bcrypt.compare(
      parsed.data.password,
      user.password_hash,
    );
    if (!valid) {
      await sql().query(
        `UPDATE users SET failed_logins=failed_logins+1,locked_until=CASE WHEN failed_logins+1>=5 THEN now()+interval '15 minutes' ELSE locked_until END WHERE id=$1`,
        [user.id],
      );
      return NextResponse.json(
        { error: "Usuário ou senha incorretos." },
        { status: 401 },
      );
    }
    await sql().query(
      `UPDATE users SET failed_logins=0,locked_until=NULL,last_login_at=now(),last_seen_at=now(),login_count=login_count+1 WHERE id=$1`,
      [user.id],
    );
    const securityAnswers = Array.isArray(user.security_answers)
      ? user.security_answers
      : [];
    if (securityAnswers.length < 2) {
      await clearSession();
      await setSecuritySetupSession(user.id);
      return NextResponse.json({
        ok: false,
        requiresSecuritySetup: true,
        questions: SECURITY_QUESTIONS,
      });
    }
    await clearSecuritySetupSession();
    await setSession(user.id);
    return NextResponse.json({ ok: true });
  }
  if (body.action === "setup_security") {
    const pendingUserId = await getSecuritySetupUserId();
    if (!pendingUserId)
      return NextResponse.json(
        { error: "A configuração expirou. Entre novamente." },
        { status: 401 },
      );
    const provided = Array.isArray(body.answers)
      ? body.answers.map((value: unknown) => String(value || "").trim())
      : [];
    if (
      provided.length !== SECURITY_QUESTIONS.length ||
      provided.some(
        (value: string, index: number) =>
          !isAllowedSecurityAnswer(SECURITY_QUESTIONS[index], value),
      )
    ) {
      return NextResponse.json(
        {
          error: "Selecione uma opção válida para cada pergunta de segurança.",
        },
        { status: 400 },
      );
    }
    const securityAnswers = await Promise.all(
      SECURITY_QUESTIONS.map(async (question, index) => ({
        question,
        hash: await bcrypt.hash(provided[index].toLocaleLowerCase("pt-BR"), 12),
      })),
    );
    const updated = await sql().query(
      `UPDATE users SET security_answers=$1::jsonb,updated_at=now() WHERE id=$2 AND active=true AND deleted_at IS NULL RETURNING id`,
      [JSON.stringify(securityAnswers), pendingUserId],
    );
    if (!updated.length)
      return NextResponse.json(
        { error: "Este acesso não está mais disponível." },
        { status: 403 },
      );
    await clearSecuritySetupSession();
    await setSession(pendingUserId);
    return NextResponse.json({ ok: true });
  }
  if (body.action === "security_questions") {
    const username = String(body.username || "")
      .trim()
      .toLowerCase();
    const rows = await sql().query(
      `SELECT security_answers FROM users WHERE username=$1 AND active=true AND deleted_at IS NULL LIMIT 1`,
      [username],
    );
    const answers = Array.isArray(rows[0]?.security_answers)
      ? rows[0].security_answers
      : [];
    return NextResponse.json({
      questions: answers.map((a: { question: string }) => a.question),
    });
  }
  if (body.action === "reset") {
    const username = String(body.username || "")
      .trim()
      .toLowerCase();
    const newPassword = String(body.newPassword || "");
    if (newPassword.length < 8)
      return NextResponse.json(
        { error: "A nova senha precisa ter pelo menos 8 caracteres." },
        { status: 400 },
      );
    const rows = await sql().query(
      `SELECT id,security_answers,locked_until FROM users WHERE username=$1 AND active=true AND deleted_at IS NULL LIMIT 1`,
      [username],
    );
    const saved = Array.isArray(rows[0]?.security_answers)
      ? rows[0].security_answers
      : [];
    const provided = Array.isArray(body.answers) ? body.answers : [];
    if (rows[0]?.locked_until && new Date(rows[0].locked_until) > new Date())
      return NextResponse.json(
        {
          error:
            "Recuperação temporariamente bloqueada. Tente novamente mais tarde.",
        },
        { status: 429 },
      );
    if (saved.length < 2 || provided.length !== saved.length)
      return NextResponse.json(
        { error: "Recuperação não configurada para este usuário." },
        { status: 400 },
      );
    const checks = await Promise.all(
      saved.map((item: { hash: string }, index: number) =>
        bcrypt.compare(
          String(provided[index] || "")
            .trim()
            .toLocaleLowerCase("pt-BR"),
          item.hash,
        ),
      ),
    );
    if (checks.filter(Boolean).length < 2) {
      if (rows[0]?.id)
        await sql().query(
          `UPDATE users SET failed_logins=failed_logins+1,locked_until=CASE WHEN failed_logins+1>=5 THEN now()+interval '15 minutes' ELSE locked_until END WHERE id=$1`,
          [rows[0].id],
        );
      return NextResponse.json(
        { error: "As respostas não conferem." },
        { status: 401 },
      );
    }
    const hash = await bcrypt.hash(newPassword, 12);
    await sql().query(
      `UPDATE users SET password_hash=$1,failed_logins=0,locked_until=NULL WHERE id=$2`,
      [hash, rows[0].id],
    );
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
}
