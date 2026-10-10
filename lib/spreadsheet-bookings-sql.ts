// Run after taking the table lock in a READ COMMITTED transaction. Existing
// booking writers take RowExclusive locks, so conflict checks see their commits.
export const SHEET_TRANSFER_LOCK_SQL = "LOCK TABLE reservations IN SHARE ROW EXCLUSIVE MODE";

export const SHEET_CANCEL_SELECTION_SQL = `WITH input AS MATERIALIZED (
  SELECT * FROM jsonb_to_recordset($1::jsonb) AS item(
    "reservationId" uuid,"expectedRoomId" uuid,"expectedStartsAt" timestamptz,"expectedEndsAt" timestamptz,
    "expectedUserId" uuid,"expectedReason" text,"expectedShareable" boolean,"expectedPeople" int)
), eligibility AS MATERIALIZED (
  SELECT i."reservationId",rs.user_id,
    (rs.status='reserved' AND rs.ends_at>now() AND rs.room_id=i."expectedRoomId"
      AND rs.starts_at=i."expectedStartsAt" AND rs.ends_at=i."expectedEndsAt"
      AND rs.user_id=i."expectedUserId" AND rs.reason=i."expectedReason"
      AND rs.shareable=i."expectedShareable" AND rs.expected_people=i."expectedPeople"
      AND ($3::boolean OR rs.user_id=$2::uuid)) IS TRUE permitted
  FROM input i LEFT JOIN reservations rs ON rs.id=i."reservationId"
), gate AS MATERIALIZED (
  SELECT count(*) FILTER (WHERE NOT permitted)::int invalid_count,
    count(*)=count(DISTINCT "reservationId") unique_sources FROM eligibility
), cancelled AS (
  UPDATE reservations rs SET status='cancelled',updated_at=now()
  FROM eligibility e CROSS JOIN gate g WHERE rs.id=e."reservationId" AND g.invalid_count=0 AND g.unique_sources
  RETURNING rs.id,rs.user_id
), logged AS (
  INSERT INTO audit_log(actor_id,action,details)
  SELECT $2::uuid,'booking.sheet_cancel','Exclusão rápida pela planilha: ' ||
    (SELECT count(*) FROM cancelled) || ' reserva(s); seleção=' || $1::text
  WHERE EXISTS (SELECT 1 FROM cancelled) RETURNING id
), recipients AS (SELECT DISTINCT user_id FROM cancelled), notified AS (
  INSERT INTO notifications(user_id,title,body,url)
  SELECT user_id,'Reservas canceladas','Reservas foram excluídas do mapa pela seleção da planilha. Consulte o histórico na Agenda.',
    '/?tab=calendar' FROM recipients RETURNING id
)
SELECT g.*, (SELECT count(*)::int FROM cancelled) cancelled_count,
  COALESCE((SELECT array_agg(user_id::text) FROM recipients),'{}'::text[]) user_ids FROM gate g`;

export const SHEET_TRANSFER_SQL = `WITH input AS MATERIALIZED (
  SELECT * FROM jsonb_to_recordset($1::jsonb) AS item(
    "reservationId" uuid, "expectedRoomId" uuid, "expectedStartsAt" timestamptz,
    "expectedEndsAt" timestamptz, "expectedUserId" uuid, "expectedReason" text,
    "expectedShareable" boolean, "expectedPeople" int, "roomId" uuid,
    "startsAt" timestamptz, "endsAt" timestamptz)
), prepared AS MATERIALIZED (
  SELECT i.*, s.user_id source_user_id, s.reason, s.shareable, s.expected_people,
    CASE WHEN $2='copy' AND NOT $4::boolean THEN $3::uuid ELSE s.user_id END target_user_id,
    (s.id IS NOT NULL AND s.status='reserved' AND s.room_id=i."expectedRoomId"
      AND s.starts_at=i."expectedStartsAt" AND s.ends_at=i."expectedEndsAt"
      AND s.user_id=i."expectedUserId" AND s.reason=i."expectedReason"
      AND s.shareable=i."expectedShareable" AND s.expected_people=i."expectedPeople"
      AND r.active AND u.active AND u.deleted_at IS NULL
      AND i."startsAt">now() AND i."endsAt">i."startsAt"
      AND i."endsAt"-i."startsAt"=s.ends_at-s.starts_at
      AND extract(dow FROM i."startsAt" AT TIME ZONE 'America/Bahia')<>0
      AND CASE WHEN $2='copy' THEN ($4::boolean OR $5::boolean)
        ELSE (s.ends_at>now() AND ($6::boolean OR ($7::boolean AND s.user_id=$3::uuid))) END
    ) IS TRUE eligible
  FROM input i LEFT JOIN reservations s ON s.id=i."reservationId"
  LEFT JOIN rooms r ON r.id=i."roomId"
  LEFT JOIN users u ON u.id=CASE WHEN $2='copy' AND NOT $4::boolean THEN $3::uuid ELSE s.user_id END
), internal_conflicts AS (
  SELECT 1 FROM prepared a JOIN prepared b ON a."reservationId"<b."reservationId"
    AND a."roomId"=b."roomId" AND a."startsAt"<b."endsAt" AND a."endsAt">b."startsAt"
), conflicts AS MATERIALIZED (
  SELECT DISTINCT rs.id,rs.user_id FROM reservations rs JOIN prepared p
    ON rs.room_id=p."roomId" AND rs.starts_at<p."endsAt" AND rs.ends_at>p."startsAt"
  WHERE rs.status='reserved' AND ($2='copy' OR rs.id NOT IN (SELECT "reservationId" FROM input))
), gate AS MATERIALIZED (
  SELECT (SELECT count(*) FROM prepared WHERE NOT eligible)::int invalid_count,
    (SELECT count(*) FROM internal_conflicts)::int internal_count,
    (SELECT count(*) FROM conflicts)::int conflict_count,
    (SELECT count(*) FROM input)=(SELECT count(DISTINCT "reservationId") FROM input) unique_sources
), allowed AS MATERIALIZED (
  SELECT p.* FROM prepared p CROSS JOIN gate g
  WHERE g.invalid_count=0 AND g.internal_count=0 AND g.unique_sources
    AND (g.conflict_count=0 OR $8::boolean)
), moved AS (
  UPDATE reservations rs SET room_id=p."roomId",starts_at=p."startsAt",ends_at=p."endsAt",updated_at=now()
  FROM allowed p WHERE $2='move' AND rs.id=p."reservationId" RETURNING rs.id,rs.user_id
), copied AS (
  INSERT INTO reservations(room_id,user_id,reason,starts_at,ends_at,shareable,expected_people,status,created_by,series_id)
  SELECT p."roomId",p.target_user_id,p.reason,p."startsAt",p."endsAt",p.shareable,p.expected_people,'reserved',$3::uuid,gen_random_uuid()
  FROM allowed p WHERE $2='copy' RETURNING id,user_id
), displaced AS (
  UPDATE reservations SET status='cancelled',updated_at=now()
  WHERE id IN (SELECT id FROM conflicts) AND $8::boolean AND EXISTS (SELECT 1 FROM allowed)
  RETURNING id,user_id
), completed AS MATERIALIZED (
  SELECT * FROM moved UNION ALL SELECT * FROM copied
), logged AS (
  INSERT INTO audit_log(actor_id,action,details)
  SELECT $3::uuid,'booking.sheet_transfer',
    CASE WHEN $2='move' THEN 'Movimentação' ELSE 'Cópia' END || ' pela planilha: ' ||
    (SELECT count(*) FROM completed) || ' reserva(s); substituídas=' || (SELECT count(*) FROM displaced) ||
    '; destinos=' || $1::text
  WHERE EXISTS (SELECT 1 FROM completed) RETURNING id
), recipients AS (
  SELECT user_id FROM completed UNION SELECT user_id FROM displaced
), notified AS (
  INSERT INTO notifications(user_id,title,body,url)
  SELECT user_id,'Agendamentos atualizados',
    'Agendamentos foram copiados, movidos ou substituídos pela planilha. Consulte a Agenda para conferir os horários.',
    '/?tab=calendar' FROM recipients RETURNING id
)
SELECT g.*, (SELECT count(*)::int FROM completed) applied_count,
  (SELECT count(*)::int FROM displaced) displaced_count,
  COALESCE((SELECT array_agg(user_id::text) FROM recipients),'{}'::text[]) user_ids
FROM gate g`;
