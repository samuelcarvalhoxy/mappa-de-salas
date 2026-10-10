const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseRoomResponsibilities(body: Record<string, unknown>) {
  if (typeof body.roomId !== "string" || !UUID.test(body.roomId))
    throw new Error("Selecione uma sala válida.");
  if (!Array.isArray(body.userIds) || body.userIds.length > 1000 ||
    body.userIds.some((id) => typeof id !== "string" || !UUID.test(id)))
    throw new Error("Selecione responsáveis válidos.");
  return { roomId: body.roomId, userIds: [...new Set(body.userIds.map((id) => String(id).toLowerCase()))] };
}

export const ROOM_REVIEW_RESPONSIBILITY_SCHEMA = `CREATE TABLE IF NOT EXISTS room_review_responsibilities (
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(room_id,user_id)
);
-- next
CREATE INDEX IF NOT EXISTS room_review_responsibilities_user_idx ON room_review_responsibilities(user_id);`;

// Lock the room in a preceding transaction statement so competing replacements
// run with a fresh snapshot after the previous assignment has committed.
export const LOCK_ROOM_RESPONSIBILITIES_SQL = `SELECT id FROM rooms WHERE id=$1 FOR UPDATE`;

export const SAVE_ROOM_RESPONSIBILITIES_SQL = `WITH wanted AS MATERIALIZED (
  SELECT DISTINCT unnest($2::uuid[]) user_id
), gate AS MATERIALIZED (
  SELECT EXISTS (SELECT 1 FROM rooms WHERE id=$1 AND active=true AND kind<>'virtual') room_exists,
    EXISTS (SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id
      WHERE u.id=$3 AND u.active=true AND u.deleted_at IS NULL
        AND (u.is_god=true OR r.permissions ? 'room.assign_responsibles')) can_assign,
    NOT EXISTS (SELECT 1 FROM wanted w LEFT JOIN users u ON u.id=w.user_id LEFT JOIN roles r ON r.id=u.role_id
      WHERE (u.active=true AND u.deleted_at IS NULL AND (u.is_god=true OR r.permissions ? 'booking.review')) IS NOT TRUE) valid_reviewers
), previous AS MATERIALIZED (
  SELECT COALESCE(array_agg(user_id::text ORDER BY user_id),'{}'::text[]) ids
  FROM room_review_responsibilities WHERE room_id=$1
), removed AS (
  DELETE FROM room_review_responsibilities rr USING gate g
  WHERE rr.room_id=$1 AND g.room_exists AND g.can_assign AND g.valid_reviewers
    AND rr.user_id NOT IN (SELECT user_id FROM wanted) RETURNING user_id
), added AS (
  INSERT INTO room_review_responsibilities(room_id,user_id,assigned_by)
  SELECT $1,w.user_id,$3 FROM wanted w CROSS JOIN gate g
  WHERE g.room_exists AND g.can_assign AND g.valid_reviewers
  ON CONFLICT(room_id,user_id) DO NOTHING RETURNING user_id
), logged AS (
  INSERT INTO audit_log(actor_id,action,details)
  SELECT $3,'room.assign_responsibles','Sala=' || $1::text || '; responsáveis anteriores=' || p.ids::text ||
    '; novos responsáveis=' || $2::text FROM gate g CROSS JOIN previous p
  WHERE g.room_exists AND g.can_assign AND g.valid_reviewers RETURNING id
)
SELECT * FROM gate`;

export const ROOM_RESPONSIBLE_USERS_SQL = `SELECT rr.room_id,u.id,u.name,
  (u.active=true AND u.deleted_at IS NULL AND (u.is_god=true OR r.permissions ? 'booking.review')) eligible
  FROM room_review_responsibilities rr JOIN users u ON u.id=rr.user_id JOIN roles r ON r.id=u.role_id`;

export const ROOM_REVIEWER_OPTIONS_SQL = `SELECT u.id,u.name,u.username,r.name role_name
  FROM users u JOIN roles r ON r.id=u.role_id
  WHERE u.active=true AND u.deleted_at IS NULL AND (u.is_god=true OR r.permissions ? 'booking.review')
  ORDER BY u.name,u.username`;
