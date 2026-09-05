import type { NeonQueryFunction } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import {
  bulkCancellationWindow,
  isBulkScope,
  reservationMatchesBulkShifts,
  validBulkShiftIds,
  type BulkCancellationFilters,
  type BulkCancellationPreview,
} from "@/lib/bulk-cancellation";
import {
  addCalendarDays,
  bahiaDateKey,
  monthStart,
  nextMonthStart,
  startOfWeekMonday,
} from "@/lib/calendar-utils";
import { isValidDate } from "@/lib/booking-validation";
import type { Permission } from "@/lib/types";
import { notifyUsers } from "@/lib/push";

type BulkBookingActionContext = {
  action: string;
  body: Record<string, unknown>;
  db: NeonQueryFunction<false, false>;
  actor: Record<string, unknown>;
  requirePermission: (permission: Permission) => boolean;
  audit: (details: string) => Promise<unknown>;
};

type CandidateRow = {
  id: string;
  user_id: string;
  user_name: string;
  room_name: string;
  starts_at: string;
  ends_at: string;
};

function fail(error: string, status = 400, code?: string) {
  return NextResponse.json({ error, ...(code ? { code } : {}) }, { status });
}

function displayRange(filters: BulkCancellationFilters, now: Date) {
  if (filters.scope === "future")
    return { from: bahiaDateKey(now), to: null };
  if (filters.scope === "day")
    return { from: filters.anchorDate, to: filters.anchorDate };
  if (filters.scope === "week") {
    const from = startOfWeekMonday(filters.anchorDate);
    return { from, to: addCalendarDays(from, 6) };
  }
  const from = monthStart(filters.anchorDate);
  return { from, to: addCalendarDays(nextMonthStart(from), -1) };
}

function parseFilters(body: Record<string, unknown>) {
  const scopeValue = String(body.scope || "");
  if (!isBulkScope(scopeValue)) return null;
  const anchorDate = String(body.anchorDate || "");
  if (!isValidDate(anchorDate)) return null;
  const shiftIds = validBulkShiftIds(
    Array.isArray(body.shiftIds) ? body.shiftIds : [],
  );
  if (!shiftIds.length) return null;
  const filters: BulkCancellationFilters = {
    scope: scopeValue,
    anchorDate,
    roomId: body.roomId ? String(body.roomId) : null,
    userId: body.userId ? String(body.userId) : null,
    shiftIds,
  };
  if (filters.scope === "future" && !filters.roomId && !filters.userId)
    return null;
  return filters;
}

async function candidatesFor(
  db: NeonQueryFunction<false, false>,
  filters: BulkCancellationFilters,
  now: Date,
) {
  const window = bulkCancellationWindow(filters, now);
  const rows = (await db.query(
    `SELECT rs.id,rs.user_id,u.name user_name,r.name room_name,rs.starts_at,rs.ends_at
     FROM reservations rs
     JOIN users u ON u.id=rs.user_id
     JOIN rooms r ON r.id=rs.room_id
     WHERE rs.status='reserved' AND rs.ends_at>now()
       AND ($1::uuid IS NULL OR rs.room_id=$1::uuid)
       AND ($2::uuid IS NULL OR rs.user_id=$2::uuid)
       AND rs.ends_at>$3::timestamptz
       AND ($4::timestamptz IS NULL OR rs.starts_at<$4::timestamptz)
     ORDER BY rs.starts_at,rs.id`,
    [
      filters.roomId,
      filters.userId,
      window.start.toISOString(),
      window.end?.toISOString() || null,
    ],
  )) as CandidateRow[];
  return rows.filter((row) =>
    reservationMatchesBulkShifts(
      { startsAt: row.starts_at, endsAt: row.ends_at },
      filters,
    ),
  );
}

function previewFor(
  candidates: CandidateRow[],
  filters: BulkCancellationFilters,
  now: Date,
): BulkCancellationPreview {
  const range = displayRange(filters, now);
  return {
    count: candidates.length,
    ...range,
    roomNames: Array.from(new Set(candidates.map((row) => row.room_name))).sort(
      (left, right) => left.localeCompare(right, "pt-BR"),
    ),
    userNames: Array.from(new Set(candidates.map((row) => row.user_name))).sort(
      (left, right) => left.localeCompare(right, "pt-BR"),
    ),
    firstStartsAt: candidates[0]?.starts_at || null,
    lastEndsAt: candidates.at(-1)?.ends_at || null,
  };
}

export async function handleBulkBookingAction({
  action,
  body,
  db,
  requirePermission,
  audit,
}: BulkBookingActionContext) {
  if (
    action !== "booking.bulk_cancel.preview" &&
    action !== "booking.bulk_cancel"
  )
    return null;
  if (!requirePermission("booking.manage_all"))
    return fail("Sem permissão para cancelar reservas em massa.", 403);

  const filters = parseFilters(body);
  if (!filters)
    return fail(
      "Revise o período, a data e os turnos. Para todas as reservas futuras, selecione uma sala ou um instrutor.",
    );

  const now = new Date();
  const candidates = await candidatesFor(db, filters, now);
  const preview = previewFor(candidates, filters, now);
  if (action === "booking.bulk_cancel.preview")
    return NextResponse.json({ ok: true, preview });

  const expectedCount = Number(body.expectedCount);
  if (body.confirmed !== true || expectedCount !== candidates.length)
    return fail(
      "A lista de reservas mudou. Gere uma nova prévia antes de confirmar.",
      409,
      "BULK_CANCELLATION_PREVIEW_CHANGED",
    );
  if (!candidates.length)
    return fail("Nenhuma reserva atual ou futura corresponde aos filtros.", 404);

  const ids = candidates.map((row) => row.id);
  const result = await db.query(
    `WITH current AS MATERIALIZED (
       SELECT id,user_id FROM reservations
       WHERE id=ANY($1::uuid[]) AND status='reserved' AND ends_at>now()
       FOR UPDATE
     ), eligibility AS (
       SELECT count(*)::int current_count FROM current
     ), updated AS (
       UPDATE reservations SET status='cancelled',updated_at=now()
       WHERE id IN (SELECT id FROM current)
         AND EXISTS (SELECT 1 FROM eligibility WHERE current_count=$2::int)
       RETURNING id,user_id
     )
     SELECT eligibility.current_count,count(updated.id)::int cancelled_count,
       COALESCE(array_agg(DISTINCT updated.user_id::text) FILTER (WHERE updated.user_id IS NOT NULL),'{}'::text[]) user_ids
     FROM eligibility LEFT JOIN updated ON true
     GROUP BY eligibility.current_count`,
    [ids, expectedCount],
  );
  const cancelledCount = Number(result[0]?.cancelled_count) || 0;
  if (
    Number(result[0]?.current_count) !== expectedCount ||
    cancelledCount !== expectedCount
  )
    return fail(
      "Algumas reservas foram alteradas por outra pessoa. Gere uma nova prévia.",
      409,
      "BULK_CANCELLATION_PREVIEW_CHANGED",
    );

  const affectedUsers = Array.isArray(result[0]?.user_ids)
    ? result[0].user_ids.map(String)
    : [];
  await Promise.all([
    audit(
      `${cancelledCount} reserva(s) cancelada(s) em massa; período=${filters.scope}; sala=${filters.roomId || "todas"}; usuário=${filters.userId || "todos"}; turnos=${filters.shiftIds.join(",")}`,
    ),
    notifyUsers(affectedUsers, {
      title: "Reservas canceladas",
      body: `${cancelledCount} reserva(s) foram canceladas pela equipe responsável. Consulte a Agenda para conferir o histórico.`,
      url: "/?tab=calendar",
      tag: "bulk-reservation-cancelled",
    }),
  ]);
  return NextResponse.json({ ok: true, cancelledCount });
}
