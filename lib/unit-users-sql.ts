// Called only after validating user-management rights; executes inside the account transaction.
export const HANDOVER_SQL = `WITH pending AS MATERIALIZED (
  SELECT (SELECT count(*) FROM reservations WHERE unit_id=$2 AND user_id=$1 AND status='reserved' AND ends_at>now()) bookings,
    (SELECT count(*) FROM booking_requests WHERE unit_id=$2 AND requester_id=$1 AND status='pending') requests,
    (SELECT count(*) FROM room_review_responsibilities WHERE unit_id=$2 AND user_id=$1) rooms
), managers AS MATERIALIZED (
  SELECT u.id,r.permissions FROM unit_memberships m JOIN users u ON u.id=m.user_id JOIN roles r ON r.id=m.role_id
  WHERE m.unit_id=$2 AND m.active AND u.active AND u.deleted_at IS NULL AND u.id<>$1 AND (r.permissions ? 'user.manage' OR r.permissions ? 'booking.review')
), recipients AS MATERIALIZED (
  SELECT id FROM managers UNION SELECT id FROM users WHERE is_god AND active AND deleted_at IS NULL AND (NOT EXISTS(SELECT 1 FROM managers) OR ((SELECT rooms+requests FROM pending)>0 AND NOT EXISTS(SELECT 1 FROM managers WHERE permissions ? 'booking.review')))
), old_rooms AS MATERIALIZED (SELECT room_id FROM room_review_responsibilities WHERE user_id=$1 AND unit_id=$2),
removed AS (DELETE FROM room_review_responsibilities WHERE user_id=$1 AND unit_id=$2 RETURNING room_id),
assigned AS (INSERT INTO room_review_responsibilities(room_id,user_id,assigned_by,unit_id)
  SELECT room_id,m.id,$4,$2 FROM old_rooms CROSS JOIN managers m WHERE m.permissions ? 'booking.review'
  ON CONFLICT(room_id,user_id) DO NOTHING RETURNING room_id),
message AS (SELECT p.*,u.name unit_name,u.code unit_code,
  'Transferência de '||(SELECT name FROM users WHERE id=$1)||': '||bookings||' reserva(s) preservada(s), '||requests||' solicitação(ões) pendente(s), '||rooms||' sala(s) para revisão. A gestão da unidade anterior deve conferir as pendências.' summary
  FROM pending p JOIN units u ON u.id=$2),
handover AS (INSERT INTO unit_handovers(unit_id,user_id,destination_unit_id,created_by,summary)
  SELECT $2,$1,$3,$4,summary FROM message WHERE bookings+requests+rooms>0 RETURNING id),
notice AS (INSERT INTO notifications(unit_id,user_id,title,body,url)
  SELECT $2,r.id,'['||m.unit_name||'] Pendências após transferência',m.summary,'/?unit='||m.unit_code||'&tab=users'
  FROM recipients r CROSS JOIN message m WHERE EXISTS(SELECT 1 FROM handover) RETURNING id)
SELECT m.*,$2::uuid unit_id,CASE WHEN EXISTS(SELECT 1 FROM handover) THEN ARRAY(SELECT id::text FROM recipients) ELSE ARRAY[]::text[] END recipients FROM message m`;
