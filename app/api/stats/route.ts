import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { ensureDatabase, getUserWithRole, permissionsOf, sql } from "@/lib/db";
import { z } from "zod";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  mode: z.enum(["user", "room"]),
  id: z.string().uuid(),
});

export async function GET(request: NextRequest) {
  await ensureDatabase();
  const sessionUserId = await getSessionUserId();
  if (!sessionUserId)
    return NextResponse.json(
      { error: "Faça login novamente." },
      { status: 401 },
    );
  const actor = await getUserWithRole(sessionUserId);
  if (!actor || !actor.active)
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  const permissions = permissionsOf(actor);
  if (!actor.is_god && !permissions.includes("stats.view"))
    return NextResponse.json(
      { error: "Seu perfil não pode consultar estatísticas." },
      { status: 403 },
    );

  const parsed = querySchema.safeParse({
    mode: request.nextUrl.searchParams.get("mode"),
    id: request.nextUrl.searchParams.get("id"),
  });
  if (!parsed.success)
    return NextResponse.json(
      { error: "Selecione um usuário ou uma sala válida." },
      { status: 400 },
    );

  const db = sql();
  if (parsed.data.mode === "user") {
    const target = await db.query(
      `SELECT name FROM users WHERE id=$1 AND deleted_at IS NULL LIMIT 1`,
      [parsed.data.id],
    );
    if (!target.length)
      return NextResponse.json(
        { error: "Usuário não encontrado." },
        { status: 404 },
      );
    const rows = await db.query(
      `WITH usage AS (
      SELECT room_id,GREATEST(0,EXTRACT(EPOCH FROM (LEAST(ends_at,now())-starts_at))/60) minutes
      FROM reservations WHERE user_id=$1 AND status='reserved' AND starts_at<now()
    ) SELECT r.id,r.name,count(*)::int use_count,round(sum(u.minutes))::int total_minutes,round(avg(u.minutes))::int average_minutes
      FROM usage u JOIN rooms r ON r.id=u.room_id GROUP BY r.id,r.name ORDER BY use_count DESC,total_minutes DESC,r.name`,
      [parsed.data.id],
    );
    const breakdown = rows.map((row) => ({
      id: row.id,
      name: row.name,
      useCount: Number(row.use_count),
      totalMinutes: Number(row.total_minutes),
      averageMinutes: Number(row.average_minutes),
    }));
    return NextResponse.json({
      mode: "user",
      targetName: target[0].name,
      breakdown,
      totals: summarize(breakdown),
    });
  }

  const target = await db.query(`SELECT name FROM rooms WHERE id=$1 LIMIT 1`, [
    parsed.data.id,
  ]);
  if (!target.length)
    return NextResponse.json(
      { error: "Sala não encontrada." },
      { status: 404 },
    );
  const rows = await db.query(
    `WITH usage AS (
    SELECT user_id,GREATEST(0,EXTRACT(EPOCH FROM (LEAST(ends_at,now())-starts_at))/60) minutes
    FROM reservations WHERE room_id=$1 AND status='reserved' AND starts_at<now()
  ) SELECT u.id,u.name,count(*)::int use_count,round(sum(s.minutes))::int total_minutes,round(avg(s.minutes))::int average_minutes
    FROM usage s JOIN users u ON u.id=s.user_id GROUP BY u.id,u.name ORDER BY use_count DESC,total_minutes DESC,u.name`,
    [parsed.data.id],
  );
  const breakdown = rows.map((row) => ({
    id: row.id,
    name: row.name,
    useCount: Number(row.use_count),
    totalMinutes: Number(row.total_minutes),
    averageMinutes: Number(row.average_minutes),
  }));
  return NextResponse.json({
    mode: "room",
    targetName: target[0].name,
    breakdown,
    totals: summarize(breakdown),
  });
}

function summarize(rows: { useCount: number; totalMinutes: number }[]) {
  const useCount = rows.reduce((sum, row) => sum + row.useCount, 0);
  const totalMinutes = rows.reduce((sum, row) => sum + row.totalMinutes, 0);
  return {
    useCount,
    totalMinutes,
    averageMinutes: useCount ? Math.round(totalMinutes / useCount) : 0,
  };
}
