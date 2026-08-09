import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth";
import { ensureDatabase, getUserWithRole, sql } from "@/lib/db";

export const dynamic = "force-dynamic";

const querySchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine(({ from, to }) => from <= to, {
    message: "A data final deve ser igual ou posterior à data inicial.",
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

  const parsed = querySchema.safeParse({
    from: request.nextUrl.searchParams.get("from"),
    to: request.nextUrl.searchParams.get("to"),
  });
  if (!parsed.success)
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ||
          "Informe um intervalo de datas válido.",
      },
      { status: 400 },
    );

  const rows = await sql().query(
    `SELECT rs.id,rs.room_id,r.name room_name,rs.user_id,u.name user_name,rs.reason,rs.starts_at,rs.ends_at,
      rs.shareable,rs.expected_people,rs.status,rs.created_by,c.name creator_name,rs.series_id
    FROM reservations rs
    JOIN rooms r ON r.id=rs.room_id
    JOIN users u ON u.id=rs.user_id
    JOIN users c ON c.id=rs.created_by
    WHERE rs.starts_at < (($2::date + 1)::timestamp AT TIME ZONE 'America/Bahia')
      AND rs.ends_at >= ($1::date::timestamp AT TIME ZONE 'America/Bahia')
    ORDER BY rs.starts_at,rs.ends_at`,
    [parsed.data.from, parsed.data.to],
  );

  return NextResponse.json({
    reservations: rows.map((row) => ({
      id: row.id,
      roomId: row.room_id,
      roomName: row.room_name,
      userId: row.user_id,
      userName: row.user_name,
      reason: row.reason,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      shareable: row.shareable,
      expectedPeople: Number(row.expected_people),
      status: row.status,
      createdBy: row.created_by,
      creatorName: row.creator_name,
      seriesId: row.series_id,
    })),
  });
}
