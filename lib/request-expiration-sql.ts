// Kept independent from the server client so the real SQL can be tested locally.
export const REQUEST_END_SQL = `(requested_date + end_time::time +
  CASE WHEN end_time<=start_time THEN interval '1 day' ELSE interval '0 days' END)
  AT TIME ZONE 'America/Bahia'`;

export const REQUEST_EXPIRATION_SCHEMA = `
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS decision_kind text;
-- next
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS decision_counted boolean NOT NULL DEFAULT false;
-- next
CREATE INDEX IF NOT EXISTS booking_requests_pending_expiration_idx
  ON booking_requests(requested_date) WHERE status='pending';
-- next
CREATE INDEX IF NOT EXISTS booking_requests_uncounted_idx
  ON booking_requests(id) WHERE status IN ('approved','rejected') AND NOT decision_counted;
-- next
CREATE TABLE IF NOT EXISTS request_decision_totals (
  decided_on date NOT NULL, requester_key text NOT NULL, room_key text NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('approved','manual_rejected','automatic_rejected')),
  decision_count bigint NOT NULL DEFAULT 0,
  PRIMARY KEY(decided_on,requester_key,room_key,outcome)
);
-- next
CREATE TABLE IF NOT EXISTS request_expiry_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id), message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), acknowledged_at timestamptz,
  UNIQUE(request_id,user_id)
);
-- next
CREATE INDEX IF NOT EXISTS request_expiry_alerts_pending_idx
  ON request_expiry_alerts(user_id,created_at) WHERE acknowledged_at IS NULL;
-- next
CREATE OR REPLACE FUNCTION count_booking_request_decision() RETURNS trigger AS $function$
BEGIN
  IF NEW.status IN ('approved','rejected') AND NOT NEW.decision_counted THEN
    NEW.decision_kind := CASE WHEN NEW.status='approved' THEN 'approved'
      WHEN NEW.decision_kind='automatic_rejected' THEN 'automatic_rejected' ELSE 'manual_rejected' END;
    INSERT INTO request_decision_totals(decided_on,requester_key,room_key,outcome,decision_count)
      VALUES ((COALESCE(NEW.reviewed_at,now()) AT TIME ZONE 'America/Bahia')::date,
        NEW.requester_id::text,COALESCE(NEW.room_id::text,'any'),NEW.decision_kind,1)
      ON CONFLICT(decided_on,requester_key,room_key,outcome) DO UPDATE
        SET decision_count=request_decision_totals.decision_count+1;
    NEW.decision_counted := true;
  END IF;
  RETURN NEW;
END $function$ LANGUAGE plpgsql;
-- next
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='booking_requests'::regclass
    AND tgname='booking_request_decision_counter') THEN
    CREATE TRIGGER booking_request_decision_counter BEFORE INSERT OR UPDATE ON booking_requests
      FOR EACH ROW EXECUTE FUNCTION count_booking_request_decision();
  END IF;
END $migration$;
-- next
-- The trigger backfills only the decisions still available, once per request.
UPDATE booking_requests SET decision_kind=CASE WHEN status='approved' THEN 'approved' ELSE 'manual_rejected' END
  WHERE status IN ('approved','rejected') AND NOT decision_counted;
`;

export const EXPIRE_BOOKING_REQUESTS_SQL = `
WITH expired AS (
  UPDATE booking_requests SET status='rejected',decision_kind='automatic_rejected',
    review_comment='Rejeição automática por omissão do Staff.',reviewed_by=NULL,
    reviewed_at=(${REQUEST_END_SQL}),updated_at=now()
  WHERE status='pending' AND requested_date<=(now() AT TIME ZONE 'America/Bahia')::date
    AND (${REQUEST_END_SQL})<=now()
  RETURNING id,requester_id,room_id,requested_date,start_time,end_time
), messages AS (
  SELECT e.*,u.name || ' solicitou ' || COALESCE(r.name,'qualquer sala disponível') ||
    ' em ' || to_char(e.requested_date,'DD/MM/YYYY') || ', das ' || e.start_time || ' às ' || e.end_time ||
    CASE WHEN e.end_time<=e.start_time THEN ' do dia seguinte' ELSE '' END ||
    ', e não obteve resposta. Pedido rejeitado. Motivo: Rejeição automática por omissão do Staff.' message
  FROM expired e JOIN users u ON u.id=e.requester_id LEFT JOIN rooms r ON r.id=e.room_id
), staff AS (
  SELECT DISTINCT m.id request_id,u.id user_id,m.message
  FROM messages m JOIN room_review_responsibilities rr ON (m.room_id=rr.room_id OR m.room_id IS NULL)
  JOIN rooms room ON room.id=rr.room_id AND room.active=true AND room.kind<>'virtual'
  JOIN users u ON u.id=rr.user_id JOIN roles r ON r.id=u.role_id
  WHERE u.active=true AND u.deleted_at IS NULL AND (u.is_god=true OR r.permissions ? 'booking.review')
), alerts AS (
  INSERT INTO request_expiry_alerts(request_id,user_id,message,created_at)
    SELECT request_id,user_id,message,now() FROM staff
    ON CONFLICT(request_id,user_id) DO NOTHING RETURNING user_id
), notices AS (
  INSERT INTO notifications(user_id,title,body,url)
    SELECT requester_id,'Solicitação rejeitada automaticamente',message,'/?tab=requests' FROM messages
    RETURNING user_id
), audit AS (
  INSERT INTO audit_log(actor_id,action,details)
    SELECT NULL,'request.auto_reject',message FROM messages RETURNING id
)
SELECT (SELECT count(*)::int FROM expired) expired_count,
  COALESCE((SELECT array_agg(DISTINCT user_id::text) FROM alerts),'{}'::text[]) staff_ids,
  COALESCE((SELECT array_agg(DISTINCT user_id::text) FROM notices),'{}'::text[]) requester_ids
`;

export const ACKNOWLEDGE_EXPIRY_ALERT_SQL = `UPDATE request_expiry_alerts
  SET acknowledged_at=COALESCE(acknowledged_at,now()) WHERE id=$1 AND user_id=$2 RETURNING id`;

export const REQUEST_DECISION_STATS_SQL = `SELECT
  outcome,sum(decision_count)::int total,
  COALESCE(sum(decision_count) FILTER (WHERE decided_on>=(now() AT TIME ZONE 'America/Bahia')::date-89),0)::int recent
  FROM request_decision_totals
  WHERE ($1::text IS NULL OR requester_key=$1) AND ($2::text IS NULL OR room_key=$2)
  GROUP BY outcome`;
