import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { ensureDatabase, getUserWithRole, permissionsOf, sql } from "@/lib/db";
import {
  isAllowedSecurityAnswer,
  SECURITY_QUESTIONS,
} from "@/lib/security-options";
import { PERMISSIONS, type Permission } from "@/lib/types";
import {
  isValidDate,
  isValidTimeRange,
} from "@/lib/booking-validation";
import {
  notifyAnyRoomRequesters,
  notifyPermission,
  notifyUsers,
} from "@/lib/push";
import { handleFacilityAction } from "@/lib/action-handlers/facilities";

function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

function replacementConfirmationRequired(conflictCount: number) {
  return NextResponse.json(
    {
      error: `${conflictCount} reserva(s) existente(s) coincidem com o período. Confirme explicitamente se realmente deseja substituí-las.`,
      code: "RESERVATION_REPLACEMENT_CONFIRMATION_REQUIRED",
      conflictCount,
    },
    { status: 409 },
  );
}

function todayInBahia() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bahia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function requestFields(body: Record<string, unknown>) {
  return {
    roomId: body.roomId ? String(body.roomId) : null,
    reason: String(body.reason || "").trim(),
    requestedDate: String(body.requestedDate || ""),
    startTime: String(body.startTime || "08:00"),
    endTime: String(body.endTime || "14:20"),
    shareable: Boolean(body.shareable),
    expectedPeople: Math.max(
      1,
      Math.min(10000, Number(body.expectedPeople) || 1),
    ),
  };
}

function validRequestFields(fields: ReturnType<typeof requestFields>) {
  return (
    isValidDate(fields.requestedDate) &&
    isValidTimeRange(fields.startTime, fields.endTime) &&
    fields.requestedDate >= todayInBahia() &&
    fields.reason.length >= 3
  );
}

export async function POST(request: NextRequest) {
  await ensureDatabase().catch(() => null);
  const userId = await getSessionUserId();
  if (!userId) return fail("Faça login novamente.", 401);
  const actor = await getUserWithRole(userId);
  if (!actor || !actor.active) return fail("Acesso negado.", 403);
  const permissions = permissionsOf(actor);
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");
  const db = sql();
  const requirePermission = (permission: Permission) =>
    actor.is_god || permissions.includes(permission);
  const audit = async (details: string) =>
    db.query(
      `INSERT INTO audit_log(actor_id,action,details) VALUES ($1,$2,$3)`,
      [actor.id, action, details],
    );

  try {
    const facilityResponse = await handleFacilityAction({
      action,
      body,
      db,
      actor,
      requirePermission,
      audit,
    });
    if (facilityResponse) return facilityResponse;

    if (action === "request.create") {
      if (!requirePermission("booking.request"))
        return fail("Seu perfil não pode solicitar salas.", 403);
      const fields = requestFields(body);
      if (!validRequestFields(fields))
        return fail("Revise a data, os horários e o motivo da solicitação.");
      if (fields.roomId) {
        const room = await db.query(
          `SELECT id FROM rooms WHERE id=$1 AND active=true LIMIT 1`,
          [fields.roomId],
        );
        if (!room.length) return fail("Sala não encontrada ou inativa.", 404);
      }
      await db.query(
        `INSERT INTO booking_requests(requester_id,room_id,reason,requested_date,start_time,end_time,shareable,expected_people)
        VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8)`,
        [
          actor.id,
          fields.roomId,
          fields.reason,
          fields.requestedDate,
          fields.startTime,
          fields.endTime,
          fields.shareable,
          fields.expectedPeople,
        ],
      );
      await audit(`Solicitação de sala criada para ${fields.requestedDate}`);
      await notifyPermission("booking.review", {
        title: "Nova solicitação de sala",
        body: `${actor.name} solicitou ${fields.roomId ? "uma sala específica" : "qualquer sala disponível"} para ${fields.requestedDate}.`,
        url: "/",
        tag: "booking-request",
      });
      if (!fields.roomId) {
        const available = await db.query(
          `SELECT r.name FROM rooms r WHERE r.active=true AND NOT EXISTS (
          SELECT 1 FROM reservations rs WHERE rs.room_id=r.id AND rs.status='reserved'
          AND rs.starts_at<$2::timestamptz AND rs.ends_at>$1::timestamptz) ORDER BY r.name LIMIT 1`,
          [
            `${fields.requestedDate}T${fields.startTime}:00-03:00`,
            `${fields.requestedDate}T${fields.endTime}:00-03:00`,
          ],
        );
        if (available.length)
          await notifyUsers([String(actor.id)], {
            title: "Há sala disponível",
            body: `${available[0].name} está livre no período solicitado. A análise ainda é necessária.`,
            url: "/",
            tag: "available-room",
          });
      }
    } else if (action === "request.update") {
      if (!requirePermission("booking.review"))
        return fail("Sem permissão para editar solicitações.", 403);
      const requestId = String(body.id || "");
      const fields = requestFields(body);
      if (!requestId || !validRequestFields(fields))
        return fail("Revise a sala, a data, os horários e o motivo.");
      if (fields.roomId) {
        const room = await db.query(
          `SELECT id FROM rooms WHERE id=$1 AND active=true LIMIT 1`,
          [fields.roomId],
        );
        if (!room.length) return fail("Sala não encontrada ou inativa.", 404);
      }
      const updated = await db.query(
        `UPDATE booking_requests SET room_id=$1,reason=$2,requested_date=$3::date,start_time=$4,end_time=$5,
        shareable=$6,expected_people=$7,updated_at=now() WHERE id=$8 AND status='pending' RETURNING requester_id`,
        [
          fields.roomId,
          fields.reason,
          fields.requestedDate,
          fields.startTime,
          fields.endTime,
          fields.shareable,
          fields.expectedPeople,
          requestId,
        ],
      );
      if (!updated.length)
        return fail("A solicitação não está mais pendente.", 409);
      await audit(`Solicitação de sala editada para ${fields.requestedDate}`);
      await notifyUsers([String(updated[0].requester_id)], {
        title: "Solicitação atualizada",
        body: `Sua solicitação de ${fields.requestedDate}, das ${fields.startTime} às ${fields.endTime}, foi atualizada pela equipe responsável.`,
        url: "/",
        tag: `request-updated-${requestId}`,
      });
    } else if (action === "request.review") {
      if (!requirePermission("booking.review"))
        return fail("Sem permissão para analisar solicitações.", 403);
      const requestId = String(body.id || "");
      const decision = String(body.decision || "");
      const comment = String(body.comment || "")
        .trim()
        .slice(0, 2000);
      const fields = requestFields(body);
      if (
        !requestId ||
        !["approved", "rejected"].includes(decision) ||
        !validRequestFields(fields)
      )
        return fail("Revise os dados e informe uma decisão válida.");
      const pending = await db.query(
        `SELECT requester_id FROM booking_requests WHERE id=$1 AND status='pending' LIMIT 1`,
        [requestId],
      );
      if (!pending.length)
        return fail("A solicitação não está mais pendente.", 409);
      if (decision === "rejected") {
        const rejected = await db.query(
          `UPDATE booking_requests SET room_id=$1,reason=$2,requested_date=$3::date,start_time=$4,end_time=$5,
          shareable=$6,expected_people=$7,status='rejected',review_comment=$8,reviewed_by=$9,reviewed_at=now(),updated_at=now()
          WHERE id=$10 AND status='pending' RETURNING id`,
          [
            fields.roomId,
            fields.reason,
            fields.requestedDate,
            fields.startTime,
            fields.endTime,
            fields.shareable,
            fields.expectedPeople,
            comment,
            actor.id,
            requestId,
          ],
        );
        if (!rejected.length)
          return fail("A solicitação não está mais pendente.", 409);
        await audit(`Solicitação de ${fields.requestedDate} rejeitada`);
        await notifyUsers([String(pending[0].requester_id)], {
          title: "Solicitação analisada",
          body: `Sua solicitação de ${fields.requestedDate} foi rejeitada${comment ? `: ${comment}` : "."}`,
          url: "/",
          tag: `request-${requestId}`,
        });
      } else {
        if (!fields.roomId)
          return fail("Selecione uma sala específica antes de aprovar.");
        const room = await db.query(
          `SELECT id FROM rooms WHERE id=$1 AND active=true LIMIT 1`,
          [fields.roomId],
        );
        if (!room.length) return fail("Sala não encontrada ou inativa.", 404);
        const startsAt = `${fields.requestedDate}T${fields.startTime}:00-03:00`;
        const endsAt = `${fields.requestedDate}T${fields.endTime}:00-03:00`;
        const confirmReplacement = body.confirmReplacement === true;
        const approved = await db.query(
          `WITH conflicts AS (
            SELECT id,user_id FROM reservations
            WHERE room_id=$1 AND status='reserved' AND starts_at<$12::timestamptz AND ends_at>$11::timestamptz
          ), approved_request AS (
            UPDATE booking_requests SET room_id=$1,reason=$2,requested_date=$3::date,start_time=$4,end_time=$5,shareable=$6,
              expected_people=$7,status='approved',review_comment=$8,reviewed_by=$9,reviewed_at=now(),updated_at=now()
            WHERE id=$10 AND status='pending' AND ($13::boolean OR NOT EXISTS (SELECT 1 FROM conflicts)) RETURNING requester_id
          ), displaced AS (
            UPDATE reservations SET status='cancelled',updated_at=now()
            WHERE id IN (SELECT id FROM conflicts) AND EXISTS (SELECT 1 FROM approved_request)
            RETURNING id,user_id
          ), created_reservation AS (
            INSERT INTO reservations(room_id,user_id,reason,starts_at,ends_at,shareable,expected_people,status,created_by)
            SELECT $1,requester_id,$2,$11::timestamptz,$12::timestamptz,$6,$7,'reserved',$9 FROM approved_request RETURNING id
          ), linked_request AS (
            UPDATE booking_requests SET approved_reservation_id=(SELECT id FROM created_reservation)
            WHERE id=$10 AND EXISTS (SELECT 1 FROM created_reservation) RETURNING id
          ) SELECT (SELECT count(*)::int FROM conflicts) conflict_count,
            (SELECT count(*)::int FROM linked_request) approved_count,
            (SELECT count(*)::int FROM displaced) displaced_count,
            COALESCE((SELECT array_agg(DISTINCT user_id::text) FROM displaced),'{}'::text[]) displaced_user_ids`,
          [
            fields.roomId,
            fields.reason,
            fields.requestedDate,
            fields.startTime,
            fields.endTime,
            fields.shareable,
            fields.expectedPeople,
            comment,
            actor.id,
            requestId,
            startsAt,
            endsAt,
            confirmReplacement,
          ],
        );
        const conflictCount = Number(approved[0]?.conflict_count) || 0;
        if (conflictCount && !confirmReplacement)
          return replacementConfirmationRequired(conflictCount);
        if (!Number(approved[0]?.approved_count))
          return fail("A solicitação não está mais pendente.", 409);
        await audit(
          `Solicitação de ${fields.requestedDate} aprovada e convertida em reserva. ${Number(approved[0].displaced_count) || 0} reserva(s) anterior(es) substituída(s)`,
        );
        await notifyUsers([String(pending[0].requester_id)], {
          title: "Solicitação aprovada",
          body: `Sua sala foi reservada para ${fields.requestedDate}, das ${fields.startTime} às ${fields.endTime}${comment ? `. ${comment}` : "."}`,
          url: "/",
          tag: `request-${requestId}`,
        });
        const displacedUserIds = Array.isArray(approved[0].displaced_user_ids)
          ? approved[0].displaced_user_ids
              .map(String)
              .filter((id: string) => id !== String(pending[0].requester_id))
          : [];
        await notifyUsers(displacedUserIds, {
          title: "Reserva substituída",
          body: `Uma reserva anterior de ${fields.requestedDate}, das ${fields.startTime} às ${fields.endTime}, foi substituída por uma aprovação mais recente.`,
          url: "/",
          tag: `reservation-replaced-${requestId}`,
        });
      }
    } else if (action === "request.cancel") {
      const requestId = String(body.id || "");
      const cancelled = await db.query(
        `UPDATE booking_requests SET status='cancelled',updated_at=now()
        WHERE id=$1 AND status='pending' AND (requester_id=$2 OR $3::boolean) RETURNING requester_id`,
        [requestId, actor.id, requirePermission("booking.review")],
      );
      if (!cancelled.length)
        return fail(
          "Você não pode cancelar esta solicitação ou ela não está mais pendente.",
          403,
        );
      await audit("Solicitação de sala cancelada");
      await notifyUsers([String(cancelled[0].requester_id)], {
        title: "Solicitação cancelada",
        body: "Sua solicitação de sala foi cancelada.",
        url: "/",
        tag: `request-cancelled-${requestId}`,
      });
    } else if (action === "booking.create") {
      const canAll = requirePermission("booking.create_all");
      if (!canAll && !requirePermission("booking.create_own"))
        return fail("Seu perfil não pode criar reservas.", 403);
      const dates: string[] = Array.isArray(body.dates)
        ? Array.from(
            new Set<string>(
              (body.dates as unknown[]).map((value) => String(value)),
            ),
          )
        : [];
      const roomId = String(body.roomId || "");
      const targetUser = canAll && body.userId ? String(body.userId) : actor.id;
      const startTime = String(body.startTime || "08:00");
      const endTime = String(body.endTime || "14:20");
      const reason = String(body.reason || "").trim();
      const confirmReplacement = body.confirmReplacement === true;
      if (
        !dates.length ||
        dates.length > 30 ||
        !roomId ||
        reason.length < 3 ||
        !isValidTimeRange(startTime, endTime) ||
        dates.some(
          (date) => !isValidDate(date) || date < todayInBahia(),
        )
      )
        return fail(
          "Revise datas, sala, horários e motivo. O período máximo é de 30 dias.",
        );
      const [room, target] = await Promise.all([
        db.query(`SELECT id,name FROM rooms WHERE id=$1 AND active=true LIMIT 1`, [
          roomId,
        ]),
        db.query(
          `SELECT id,name FROM users WHERE id=$1 AND active=true AND deleted_at IS NULL LIMIT 1`,
          [targetUser],
        ),
      ]);
      if (!room.length) return fail("Sala não encontrada ou inativa.", 404);
      if (!target.length) return fail("Usuário não encontrado ou inativo.", 404);
      const created = await db.query(
        `WITH requested AS (
          SELECT value::date booking_date FROM unnest($1::text[]) AS requested_dates(value)
        ), periods AS (
          SELECT (booking_date::text||'T'||$4||':00-03:00')::timestamptz starts_at,
                 (booking_date::text||'T'||$5||':00-03:00')::timestamptz ends_at FROM requested
        ), conflicts AS (
          SELECT DISTINCT rs.id,rs.user_id FROM reservations rs JOIN periods p
            ON rs.starts_at<p.ends_at AND rs.ends_at>p.starts_at
          WHERE rs.room_id=$2 AND rs.status='reserved'
        ), permitted_periods AS (
          SELECT p.* FROM periods p
          WHERE $10::boolean OR NOT EXISTS (SELECT 1 FROM conflicts)
        ), displaced AS (
          UPDATE reservations rs SET status='cancelled',updated_at=now()
          WHERE rs.id IN (SELECT id FROM conflicts) AND $10::boolean
            AND EXISTS (SELECT 1 FROM permitted_periods)
          RETURNING rs.id,rs.user_id
        ), series AS (
          SELECT gen_random_uuid() id
        ), inserted AS (
          INSERT INTO reservations(room_id,user_id,reason,starts_at,ends_at,shareable,expected_people,status,created_by,series_id)
          SELECT $2,$3,$6,p.starts_at,p.ends_at,$7,$8,'reserved',$9,s.id FROM permitted_periods p CROSS JOIN series s
          RETURNING id
        ) SELECT (SELECT count(*)::int FROM conflicts) conflict_count,
          (SELECT count(*)::int FROM inserted) created_count,(SELECT count(*)::int FROM displaced) displaced_count,
          COALESCE((SELECT array_agg(DISTINCT user_id::text) FROM displaced),'{}'::text[]) displaced_user_ids`,
        [
          dates,
          roomId,
          targetUser,
          startTime,
          endTime,
          reason,
          Boolean(body.shareable),
          Math.max(1, Number(body.expectedPeople) || 1),
          actor.id,
          confirmReplacement,
        ],
      );
      const conflictCount = Number(created[0]?.conflict_count) || 0;
      if (conflictCount && !confirmReplacement)
        return replacementConfirmationRequired(conflictCount);
      if (!Number(created[0]?.created_count))
        return fail("Nenhuma reserva foi criada.", 409);
      await audit(
        `${Number(created[0]?.created_count) || dates.length} reserva(s) criada(s). ${Number(created[0]?.displaced_count) || 0} reserva(s) anterior(es) substituída(s)`,
      );
      const displacedUserIds = Array.isArray(created[0]?.displaced_user_ids)
        ? created[0].displaced_user_ids
            .map(String)
            .filter((id: string) => id !== String(targetUser))
        : [];
      await notifyUsers(displacedUserIds, {
        title: "Reserva substituída",
        body: "Uma reserva anterior foi substituída por uma reserva mais recente no mesmo período.",
        url: "/",
        tag: "reservation-replaced",
      });
      await notifyUsers([String(targetUser)], {
        title: "Reserva criada",
        body: `${dates.length > 1 ? `${dates.length} reservas foram criadas` : "Uma reserva foi criada"} para você em ${room[0].name}, das ${startTime} às ${endTime}.`,
        url: "/",
        tag: `reservation-created-${roomId}-${dates[0]}`,
      });
    } else if (action === "booking.update") {
      const id = String(body.id || "");
      const roomId = String(body.roomId || "");
      const requestedDate = String(body.requestedDate || "");
      const startTime = String(body.startTime || "08:00");
      const endTime = String(body.endTime || "14:20");
      const reason = String(body.reason || "").trim();
      const confirmReplacement = body.confirmReplacement === true;
      if (
        !id ||
        !roomId ||
        reason.length < 3 ||
        !isValidDate(requestedDate) ||
        requestedDate < todayInBahia() ||
        !isValidTimeRange(startTime, endTime)
      )
        return fail("Revise a data, sala, horários e motivo da reserva.");
      const existing = await db.query(
        `SELECT user_id,series_id FROM reservations WHERE id=$1 AND status='reserved' LIMIT 1`,
        [id],
      );
      if (!existing.length) return fail("Reserva não encontrada.", 404);
      const canManage = requirePermission("booking.manage_all");
      const canEditOwn =
        String(existing[0].user_id) === String(actor.id) &&
        requirePermission("booking.create_own");
      if (!canManage && !canEditOwn)
        return fail("Seu perfil não pode editar esta reserva.", 403);
      const targetUser =
        canManage && body.userId ? String(body.userId) : String(existing[0].user_id);
      const [room, target] = await Promise.all([
        db.query(`SELECT id,name FROM rooms WHERE id=$1 AND active=true LIMIT 1`, [
          roomId,
        ]),
        db.query(
          `SELECT id FROM users WHERE id=$1 AND active=true AND deleted_at IS NULL LIMIT 1`,
          [targetUser],
        ),
      ]);
      if (!room.length) return fail("Sala não encontrada ou inativa.", 404);
      if (!target.length) return fail("Usuário não encontrado ou inativo.", 404);
      const startsAt = `${requestedDate}T${startTime}:00-03:00`;
      const endsAt = `${requestedDate}T${endTime}:00-03:00`;
      const updated = await db.query(
        `WITH conflicts AS (
          SELECT id,user_id FROM reservations rs
          WHERE rs.id<>$1 AND rs.room_id=$2 AND rs.status='reserved'
            AND rs.starts_at<$6::timestamptz AND rs.ends_at>$5::timestamptz
        ), edited AS (
          UPDATE reservations SET room_id=$2,user_id=$3,reason=$4,starts_at=$5::timestamptz,ends_at=$6::timestamptz,
            shareable=$7,expected_people=$8,updated_at=now()
          WHERE id=$1 AND status='reserved' AND ($9::boolean OR NOT EXISTS (SELECT 1 FROM conflicts)) RETURNING id
        ), displaced AS (
          UPDATE reservations rs SET status='cancelled',updated_at=now()
          WHERE rs.id IN (SELECT id FROM conflicts) AND EXISTS (SELECT 1 FROM edited)
          RETURNING rs.user_id
        ) SELECT (SELECT count(*)::int FROM conflicts) conflict_count,
          (SELECT count(*)::int FROM edited) edited_count,(SELECT count(*)::int FROM displaced) displaced_count,
          COALESCE((SELECT array_agg(DISTINCT user_id::text) FROM displaced),'{}'::text[]) displaced_user_ids`,
        [
          id,
          roomId,
          targetUser,
          reason,
          startsAt,
          endsAt,
          Boolean(body.shareable),
          Math.max(1, Number(body.expectedPeople) || 1),
          confirmReplacement,
        ],
      );
      const conflictCount = Number(updated[0]?.conflict_count) || 0;
      if (conflictCount && !confirmReplacement)
        return replacementConfirmationRequired(conflictCount);
      if (!Number(updated[0]?.edited_count))
        return fail("A reserva não está mais disponível para edição.", 409);
      await audit(
        `Reserva editada para ${requestedDate}, das ${startTime} às ${endTime}. ${Number(updated[0]?.displaced_count) || 0} reserva(s) anterior(es) substituída(s)`,
      );
      const displacedUserIds = Array.isArray(updated[0]?.displaced_user_ids)
        ? updated[0].displaced_user_ids
            .map(String)
            .filter((userId: string) => userId !== targetUser)
        : [];
      await notifyUsers(displacedUserIds, {
        title: "Reserva substituída",
        body: "Uma reserva anterior foi substituída por uma edição mais recente no mesmo período.",
        url: "/",
        tag: `reservation-replaced-${id}`,
      });
      await notifyUsers([targetUser], {
        title: "Reserva atualizada",
        body: `Sua reserva em ${room[0].name}, de ${requestedDate}, das ${startTime} às ${endTime}, foi atualizada.`,
        url: "/",
        tag: `reservation-updated-${id}`,
      });
      if (String(existing[0].user_id) !== targetUser)
        await notifyUsers([String(existing[0].user_id)], {
          title: "Reserva transferida",
          body: `A reserva de ${requestedDate}, das ${startTime} às ${endTime}, foi transferida para outra pessoa.`,
          url: "/",
          tag: `reservation-transferred-${id}`,
        });
    } else if (action === "booking.update_series") {
      const seriesId = String(body.seriesId || "");
      const dates: string[] = Array.isArray(body.dates)
        ? Array.from(
            new Set<string>(
              (body.dates as unknown[]).map((value) => String(value)),
            ),
          )
        : [];
      const roomId = String(body.roomId || "");
      const startTime = String(body.startTime || "08:00");
      const endTime = String(body.endTime || "14:20");
      const reason = String(body.reason || "").trim();
      const confirmReplacement = body.confirmReplacement === true;
      if (
        !seriesId ||
        !dates.length ||
        dates.length > 30 ||
        !roomId ||
        reason.length < 3 ||
        !isValidTimeRange(startTime, endTime) ||
        dates.some(
          (date) => !isValidDate(date) || date < todayInBahia(),
        )
      )
        return fail(
          "Revise datas, sala, horários e motivo. O período máximo é de 30 dias.",
        );
      const existing = await db.query(
        `SELECT user_id FROM reservations WHERE series_id=$1 AND status='reserved' AND ends_at>now() ORDER BY starts_at LIMIT 1`,
        [seriesId],
      );
      if (!existing.length)
        return fail("Não há reservas atuais ou futuras nesse período.", 404);
      const canManage = requirePermission("booking.manage_all");
      const canEditOwn =
        String(existing[0].user_id) === String(actor.id) &&
        requirePermission("booking.create_own");
      if (!canManage && !canEditOwn)
        return fail("Seu perfil não pode editar este período.", 403);
      const targetUser =
        canManage && body.userId ? String(body.userId) : String(existing[0].user_id);
      const [room, target] = await Promise.all([
        db.query(`SELECT id,name FROM rooms WHERE id=$1 AND active=true LIMIT 1`, [
          roomId,
        ]),
        db.query(
          `SELECT id FROM users WHERE id=$1 AND active=true AND deleted_at IS NULL LIMIT 1`,
          [targetUser],
        ),
      ]);
      if (!room.length) return fail("Sala não encontrada ou inativa.", 404);
      if (!target.length) return fail("Usuário não encontrado ou inativo.", 404);
      const edited = await db.query(
        `WITH requested AS (
          SELECT value::date booking_date FROM unnest($1::text[]) AS requested_dates(value)
        ), periods AS (
          SELECT (booking_date::text||'T'||$5||':00-03:00')::timestamptz starts_at,
                 (booking_date::text||'T'||$6||':00-03:00')::timestamptz ends_at FROM requested
        ), conflicts AS (
          SELECT DISTINCT rs.id,rs.user_id FROM reservations rs JOIN periods p
            ON rs.starts_at<p.ends_at AND rs.ends_at>p.starts_at
          WHERE rs.room_id=$3 AND rs.status='reserved' AND rs.series_id IS DISTINCT FROM $2::uuid
        ), eligible AS (
          SELECT true allowed WHERE $11::boolean OR NOT EXISTS (SELECT 1 FROM conflicts)
        ), cancelled_series AS (
          UPDATE reservations SET status='cancelled',updated_at=now()
          WHERE series_id=$2 AND status='reserved' AND ends_at>now()
            AND EXISTS (SELECT 1 FROM eligible) RETURNING id
        ), displaced AS (
          UPDATE reservations rs SET status='cancelled',updated_at=now()
          WHERE rs.id IN (SELECT id FROM conflicts) AND EXISTS (SELECT 1 FROM cancelled_series)
          RETURNING rs.user_id
        ), inserted AS (
          INSERT INTO reservations(room_id,user_id,reason,starts_at,ends_at,shareable,expected_people,status,created_by,series_id)
          SELECT $3,$4,$7,p.starts_at,p.ends_at,$8,$9,'reserved',$10,$2::uuid FROM periods p
          WHERE EXISTS (SELECT 1 FROM cancelled_series)
          RETURNING id
        ) SELECT (SELECT count(*)::int FROM conflicts) conflict_count,
          (SELECT count(*)::int FROM inserted) created_count,(SELECT count(*)::int FROM cancelled_series) replaced_series_count,
          (SELECT count(*)::int FROM displaced) displaced_count,
          COALESCE((SELECT array_agg(DISTINCT user_id::text) FROM displaced),'{}'::text[]) displaced_user_ids`,
        [
          dates,
          seriesId,
          roomId,
          targetUser,
          startTime,
          endTime,
          reason,
          Boolean(body.shareable),
          Math.max(1, Number(body.expectedPeople) || 1),
          actor.id,
          confirmReplacement,
        ],
      );
      const conflictCount = Number(edited[0]?.conflict_count) || 0;
      if (conflictCount && !confirmReplacement)
        return replacementConfirmationRequired(conflictCount);
      if (!Number(edited[0]?.created_count))
        return fail("O período não está mais disponível para edição.", 409);
      await audit(
        `Período editado com ${Number(edited[0]?.created_count) || dates.length} reserva(s). ${Number(edited[0]?.displaced_count) || 0} reserva(s) anterior(es) substituída(s)`,
      );
      const displacedUserIds = Array.isArray(edited[0]?.displaced_user_ids)
        ? edited[0].displaced_user_ids
            .map(String)
            .filter((userId: string) => userId !== targetUser)
        : [];
      await notifyUsers(displacedUserIds, {
        title: "Reserva substituída",
        body: "Uma reserva anterior foi substituída pela edição de um período mais recente.",
        url: "/",
        tag: `reservation-series-replaced-${seriesId}`,
      });
      await notifyUsers([targetUser], {
        title: "Período de reservas atualizado",
        body: `Seu período em ${room[0].name} foi atualizado para ${dates.length} dia(s), das ${startTime} às ${endTime}.`,
        url: "/",
        tag: `reservation-series-updated-${seriesId}`,
      });
      if (String(existing[0].user_id) !== targetUser)
        await notifyUsers([String(existing[0].user_id)], {
          title: "Período de reservas transferido",
          body: "Seu período de reservas foi transferido para outra pessoa.",
          url: "/",
          tag: `reservation-series-transferred-${seriesId}`,
        });
    } else if (action === "booking.cancel") {
      const id = String(body.id || "");
      const rows = await db.query(
        `SELECT rs.user_id,r.name room_name,rs.starts_at::date::text reservation_date FROM reservations rs
         JOIN rooms r ON r.id=rs.room_id WHERE rs.id=$1 AND rs.status='reserved' LIMIT 1`,
        [id],
      );
      if (!rows.length) return fail("Reserva não encontrada.", 404);
      if (
        rows[0].user_id !== actor.id &&
        !requirePermission("booking.manage_all")
      )
        return fail("Você não pode cancelar esta reserva.", 403);
      await db.query(
        `UPDATE reservations SET status='cancelled',updated_at=now() WHERE id=$1`,
        [id],
      );
      await audit("Reserva cancelada");
      await notifyUsers([String(rows[0].user_id)], {
        title: "Reserva cancelada",
        body: `Sua reserva em ${rows[0].room_name}, de ${rows[0].reservation_date}, foi cancelada.`,
        url: "/",
        tag: `reservation-cancelled-${id}`,
      });
      const cancelled = await db.query(
        `SELECT room_id,starts_at::date::text date FROM reservations WHERE id=$1`,
        [id],
      );
      if (cancelled.length)
        await notifyAnyRoomRequesters(String(cancelled[0].date), {
          title: "Nova disponibilidade",
          body: "Uma reserva foi cancelada e pode haver sala livre no período que você solicitou.",
          url: "/",
          tag: "room-free",
        });
    } else if (action === "booking.cancel_series") {
      const seriesId = String(body.seriesId || "");
      if (!seriesId) return fail("Período de reserva inválido.");
      const owned = await db.query(
        `SELECT rs.user_id,r.name room_name,count(*)::int reservation_count
         FROM reservations rs JOIN rooms r ON r.id=rs.room_id
         WHERE rs.series_id=$1 AND rs.status='reserved' AND rs.ends_at>now()
         GROUP BY rs.user_id,r.name LIMIT 1`,
        [seriesId],
      );
      if (!owned.length)
        return fail("Não há reservas futuras nesse período.", 404);
      if (
        owned[0].user_id !== actor.id &&
        !requirePermission("booking.manage_all")
      )
        return fail("Você não pode cancelar esse período.", 403);
      const updated = await db.query(
        `UPDATE reservations SET status='cancelled',updated_at=now() WHERE series_id=$1 AND status='reserved' AND ends_at>now() RETURNING id`,
        [seriesId],
      );
      await audit(`${updated.length} reserva(s) do período cancelada(s)`);
      await notifyUsers([String(owned[0].user_id)], {
        title: "Período de reservas cancelado",
        body: `${updated.length} reserva(s) do seu período em ${owned[0].room_name} foram canceladas.`,
        url: "/",
        tag: `reservation-series-cancelled-${seriesId}`,
      });
    } else if (action === "notification.read_all") {
      await db.query(
        `UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE user_id=$1`,
        [actor.id],
      );
    } else if (action === "notification.read") {
      await db.query(
        `UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND user_id=$2`,
        [String(body.id || ""), actor.id],
      );
    } else if (action === "user.password.change") {
      const currentPassword = String(body.currentPassword || "");
      const newPassword = String(body.newPassword || "");
      if (newPassword.length < 8)
        return fail("A nova senha precisa ter pelo menos 8 caracteres.");
      if (!(await bcrypt.compare(currentPassword, String(actor.password_hash))))
        return fail("A senha atual está incorreta.", 403);
      if (await bcrypt.compare(newPassword, String(actor.password_hash)))
        return fail("A nova senha deve ser diferente da atual.");
      await db.query(
        `UPDATE users SET password_hash=$1,failed_logins=0,locked_until=NULL,updated_at=now() WHERE id=$2`,
        [await bcrypt.hash(newPassword, 12), actor.id],
      );
      await audit("Senha própria alterada");
    } else if (action === "user.save") {
      if (!requirePermission("user.manage"))
        return fail("Sem permissão para administrar usuários.", 403);
      const id = body.id ? String(body.id) : null;
      const name = String(body.name || "").trim();
      const username = String(body.username || "")
        .trim()
        .toLowerCase();
      const password = String(body.password || "");
      const requestedRoleId = String(body.roleId || "");
      if (name.length < 2 || username.length < 2 || !requestedRoleId)
        return fail("Preencha nome, usuário e perfil.");
      const existing = id
        ? await db.query(
            `SELECT id,username,role_id,is_god,is_owner_god FROM users WHERE id=$1 AND deleted_at IS NULL`,
            [id],
          )
        : [];
      if (id && !existing.length) return fail("Usuário não encontrado.", 404);
      if (existing[0]?.is_god && !actor.is_god)
        return fail("Somente um God pode alterar esse acesso.", 403);
      if (
        existing[0]?.is_owner_god &&
        String(existing[0].id) !== String(actor.id)
      )
        return fail(
          "O God proprietário é protegido e não pode ser alterado por outro usuário.",
          403,
        );
      const requestedRole = await db.query(
        `SELECT id,name FROM roles WHERE id=$1 LIMIT 1`,
        [requestedRoleId],
      );
      if (!requestedRole.length)
        return fail("Perfil de acesso não encontrado.", 404);
      if (requestedRole[0].name === "God" && !actor.is_god)
        return fail("Somente um God pode criar ou promover outro God.", 403);
      const roleId = existing[0]?.is_owner_god
        ? existing[0].role_id
        : requestedRoleId;
      const willBeGod = requestedRole[0].name === "God";
      const rawAnswers = Array.isArray(body.securityAnswers)
        ? body.securityAnswers.filter(
            (a: { question?: string; answer?: string }) =>
              a.question && a.answer,
          )
        : [];
      if (id && rawAnswers.length && !requirePermission("security.reset"))
        return fail("Seu perfil não pode alterar respostas de segurança.", 403);
      if (rawAnswers.length > 0 && rawAnswers.length < 3)
        return fail(
          "Preencha as três respostas de segurança ou deixe todas vazias.",
        );
      if (
        rawAnswers.some(
          (item: { question: string; answer: string }, index: number) =>
            item.question !== SECURITY_QUESTIONS[index] ||
            !isAllowedSecurityAnswer(item.question, item.answer),
        )
      )
        return fail("Selecione opções válidas para as respostas de segurança.");
      const securityAnswers = await Promise.all(
        rawAnswers
          .slice(0, 3)
          .map(async (item: { question: string; answer: string }) => ({
            question: item.question,
            hash: await bcrypt.hash(
              item.answer.trim().toLocaleLowerCase("pt-BR"),
              12,
            ),
          })),
      );
      if (!id) {
        if (password.length < 8)
          return fail("A senha inicial precisa ter pelo menos 8 caracteres.");
        const hash = await bcrypt.hash(password, 12);
        await db.query(
          `INSERT INTO users(name,username,password_hash,role_id,security_answers,is_god) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
          [
            name,
            username,
            hash,
            roleId,
            JSON.stringify(securityAnswers),
            willBeGod,
          ],
        );
      } else {
        await db.query(
          `UPDATE users SET name=$1,username=$2,role_id=$3,active=CASE WHEN is_owner_god THEN true ELSE $4 END,security_answers=CASE WHEN $5::jsonb='[]'::jsonb THEN security_answers ELSE $5::jsonb END,is_god=CASE WHEN is_owner_god THEN true ELSE $6 END,updated_at=now() WHERE id=$7 AND deleted_at IS NULL`,
          [
            name,
            username,
            roleId,
            body.active !== false,
            JSON.stringify(securityAnswers),
            willBeGod,
            id,
          ],
        );
        if (password) {
          if (password.length < 8)
            return fail("A senha precisa ter pelo menos 8 caracteres.");
          await db.query(`UPDATE users SET password_hash=$1 WHERE id=$2`, [
            await bcrypt.hash(password, 12),
            id,
          ]);
        }
      }
      await audit(`Usuário ${username} salvo`);
    } else if (action === "user.security.reset") {
      if (!requirePermission("security.reset"))
        return fail("Sem permissão para resetar respostas de segurança.", 403);
      const targetId = String(body.id || "");
      const target = await db.query(
        `SELECT username,is_god,is_owner_god FROM users WHERE id=$1 AND deleted_at IS NULL LIMIT 1`,
        [targetId],
      );
      if (!target.length) return fail("Usuário não encontrado.", 404);
      if (target[0].is_god && !actor.is_god)
        return fail("Somente o God pode resetar esse acesso.", 403);
      if (target[0].is_owner_god && String(targetId) !== String(actor.id))
        return fail(
          "O God proprietário é protegido e não pode ser alterado por outro usuário.",
          403,
        );
      await db.query(
        `UPDATE users SET security_answers='[]'::jsonb,updated_at=now() WHERE id=$1`,
        [targetId],
      );
      await audit(`Respostas de segurança de ${target[0].username} resetadas`);
    } else if (action === "user.delete") {
      if (!requirePermission("user.delete"))
        return fail("Sem permissão para excluir usuários.", 403);
      const targetId = String(body.id || "");
      const target = await db.query(
        `SELECT username,is_god,is_owner_god FROM users WHERE id=$1 AND deleted_at IS NULL LIMIT 1`,
        [targetId],
      );
      if (!target.length) return fail("Usuário não encontrado.", 404);
      if (target[0].is_owner_god)
        return fail("O God proprietário nunca pode ser excluído.", 403);
      if (target[0].is_god && !actor.is_god)
        return fail("Somente um God pode excluir outro God.", 403);
      if (targetId === actor.id)
        return fail("Você não pode excluir o próprio acesso.", 403);
      const scheduled = await db.query(
        `SELECT count(*)::int count FROM reservations WHERE user_id=$1 AND status='reserved' AND ends_at>now()`,
        [targetId],
      );
      if (Number(scheduled[0]?.count) > 0)
        return fail(
          "Este usuário possui reserva atual ou futura. Cancele ou transfira essas agendas antes de excluir.",
          409,
        );
      const pendingRequests = await db.query(
        `SELECT count(*)::int count FROM booking_requests WHERE requester_id=$1 AND status='pending'`,
        [targetId],
      );
      if (Number(pendingRequests[0]?.count) > 0)
        return fail(
          "Este usuário possui solicitações pendentes. Analise ou cancele essas solicitações antes de excluir.",
          409,
        );
      const baseRole = await db.query(
        `SELECT id FROM roles WHERE name='Usuário' LIMIT 1`,
      );
      const replacementRoleId = baseRole[0]?.id || actor.role_id;
      await db.query(
        `UPDATE users SET active=false,deleted_at=now(),role_id=$1,security_answers='[]'::jsonb,username=username||'__excluido__'||substr(id::text,1,8),updated_at=now() WHERE id=$2`,
        [replacementRoleId, targetId],
      );
      await audit(`Usuário ${target[0].username} excluído`);
    } else if (action === "role.save") {
      if (!actor.is_god && !requirePermission("role.manage"))
        return fail("Sem permissão para criar perfis.", 403);
      const id = body.id ? String(body.id) : null;
      const name = String(body.name || "").trim();
      const allowed = Array.isArray(body.permissions)
        ? body.permissions.filter(
            (permission: unknown): permission is Permission =>
              PERMISSIONS.includes(permission as Permission),
          )
        : [];
      if (name.length < 2) return fail("Informe o nome do perfil.");
      if (id) {
        const target = await db.query(`SELECT name FROM roles WHERE id=$1`, [
          id,
        ]);
        if (target[0]?.name === "God")
          return fail("O perfil God é protegido.", 403);
        await db.query(
          `UPDATE roles SET name=$1,color=$2,permissions=$3::jsonb WHERE id=$4`,
          [name, String(body.color || "#64748b"), JSON.stringify(allowed), id],
        );
      } else
        await db.query(
          `INSERT INTO roles(name,color,permissions) VALUES ($1,$2,$3::jsonb)`,
          [name, String(body.color || "#64748b"), JSON.stringify(allowed)],
        );
      await audit(`Perfil ${name} salvo`);
    } else if (action === "role.delete") {
      if (!actor.is_god)
        return fail("Somente o perfil God pode excluir perfis.", 403);
      const id = String(body.id || "");
      const target = await db.query(
        `SELECT name FROM roles WHERE id=$1 LIMIT 1`,
        [id],
      );
      if (!target.length) return fail("Perfil não encontrado.", 404);
      if (target[0].name === "God")
        return fail("O perfil God é protegido.", 403);
      const assigned = await db.query(
        `SELECT count(*)::int count FROM users WHERE role_id=$1 AND deleted_at IS NULL`,
        [id],
      );
      if (Number(assigned[0]?.count) > 0)
        return fail(
          `Este perfil está atribuído a ${assigned[0].count} usuário(s). Realoque-os antes de excluir.`,
          409,
        );
      await db.query(`DELETE FROM roles WHERE id=$1`, [id]);
      await audit(`Perfil ${target[0].name} excluído`);
    } else return fail("Ação desconhecida.");
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    const message =
      error instanceof Error && error.message.includes("unique")
        ? "Já existe um cadastro com esses dados."
        : "Não foi possível concluir a operação.";
    return fail(message, 500);
  }
}
