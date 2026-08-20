import { neon, NeonQueryFunction } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import type { Permission } from "./types";
import { SECURITY_FIELDS } from "./security-options";

let client: NeonQueryFunction<false, false> | null = null;
let ready: Promise<void> | null = null;

const PREVIEW_SCHEMA = "mappa_preview";

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL);
}

export function sql() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_NOT_CONFIGURED");
  if (!client) {
    const databaseUrl = new URL(process.env.DATABASE_URL);
    if (process.env.VERCEL_ENV === "preview")
      databaseUrl.searchParams.set("options", `--search_path=${PREVIEW_SCHEMA}`);
    client = neon(databaseUrl.toString());
  }
  return client;
}

export async function ensureDatabase() {
  if (!hasDatabase()) throw new Error("DATABASE_NOT_CONFIGURED");
  if (!ready) ready = initialize();
  return ready;
}

async function initialize() {
  if (process.env.VERCEL_ENV === "preview") {
    const administrativeClient = neon(process.env.DATABASE_URL!);
    await administrativeClient.query(
      `CREATE SCHEMA IF NOT EXISTS ${PREVIEW_SCHEMA}`,
    );
  }
  const db = sql();
  await db.query(`CREATE TABLE IF NOT EXISTS roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE NOT NULL, color text NOT NULL DEFAULT '#64748b',
    permissions jsonb NOT NULL DEFAULT '[]'::jsonb, system boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, username text UNIQUE NOT NULL,
    password_hash text NOT NULL, role_id uuid NOT NULL REFERENCES roles(id), active boolean NOT NULL DEFAULT true,
    is_god boolean NOT NULL DEFAULT false, security_answers jsonb NOT NULL DEFAULT '[]'::jsonb,
    is_owner_god boolean NOT NULL DEFAULT false,
    failed_logins int NOT NULL DEFAULT 0, locked_until timestamptz, deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await db.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz`,
  );
  await db.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_owner_god boolean NOT NULL DEFAULT false`,
  );
  await db.query(`CREATE TABLE IF NOT EXISTS rooms (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, location text NOT NULL DEFAULT '',
    kind text NOT NULL DEFAULT 'physical', capacity int NOT NULL DEFAULT 1, resources text NOT NULL DEFAULT '',
    active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await db.query(
    `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS network_status text NOT NULL DEFAULT 'Não informado'`,
  );
  await db.query(
    `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS chairs int NOT NULL DEFAULT 0`,
  );
  await db.query(
    `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS tables int NOT NULL DEFAULT 0`,
  );
  await db.query(
    `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS workstations int NOT NULL DEFAULT 0`,
  );
  await db.query(`CREATE TABLE IF NOT EXISTS reservations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), room_id uuid NOT NULL REFERENCES rooms(id), user_id uuid NOT NULL REFERENCES users(id),
    reason text NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, shareable boolean NOT NULL DEFAULT false,
    expected_people int NOT NULL DEFAULT 1, status text NOT NULL DEFAULT 'reserved', created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CHECK (ends_at > starts_at)
  )`);
  await db.query(
    `CREATE INDEX IF NOT EXISTS reservations_room_time_idx ON reservations(room_id, starts_at, ends_at)`,
  );
  await db.query(
    `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS series_id uuid`,
  );
  await db.query(
    `CREATE INDEX IF NOT EXISTS reservations_series_idx ON reservations(series_id) WHERE series_id IS NOT NULL`,
  );
  await db.query(`CREATE TABLE IF NOT EXISTS booking_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), requester_id uuid NOT NULL REFERENCES users(id), room_id uuid REFERENCES rooms(id),
    reason text NOT NULL, requested_date date NOT NULL, start_time text NOT NULL, end_time text NOT NULL,
    shareable boolean NOT NULL DEFAULT false, expected_people int NOT NULL DEFAULT 1,
    status text NOT NULL DEFAULT 'pending', review_comment text NOT NULL DEFAULT '', reviewed_by uuid REFERENCES users(id),
    reviewed_at timestamptz, approved_reservation_id uuid REFERENCES reservations(id),
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (end_time > start_time), CHECK (status IN ('pending','approved','rejected','cancelled'))
  )`);
  await db.query(
    `CREATE INDEX IF NOT EXISTS booking_requests_status_date_idx ON booking_requests(status,requested_date)`,
  );
  await db.query(
    `CREATE INDEX IF NOT EXISTS booking_requests_requester_idx ON booking_requests(requester_id,created_at DESC)`,
  );
  await db.query(`CREATE TABLE IF NOT EXISTS shifts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE NOT NULL, start_time text NOT NULL, end_time text NOT NULL
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES users(id), action text NOT NULL,
    details text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS room_issues (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), room_id uuid NOT NULL REFERENCES rooms(id), reporter_id uuid NOT NULL REFERENCES users(id),
    description text NOT NULL, ticket_opened boolean NOT NULL DEFAULT false, ticket_reference text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'open', resolved_by uuid REFERENCES users(id), resolved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(), CHECK (status IN ('open','resolved'))
  )`);
  await db.query(
    `CREATE INDEX IF NOT EXISTS room_issues_room_status_idx ON room_issues(room_id,status,created_at DESC)`,
  );
  await db.query(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), endpoint text UNIQUE NOT NULL,
    p256dh text NOT NULL, auth text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await db.query(
    `CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions(user_id)`,
  );
  await db.query(`CREATE TABLE IF NOT EXISTS app_settings (
    key text PRIMARY KEY, value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS development_team (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE NOT NULL, role text NOT NULL,
    email text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '', profile_url text NOT NULL DEFAULT '',
    display_order int NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS feedback_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text NOT NULL, title text NOT NULL, description text NOT NULL,
    reporter_id uuid REFERENCES users(id), reporter_name text NOT NULL DEFAULT '', reporter_email text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'open', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (type IN ('bug','suggestion')), CHECK (status IN ('open','in_review','resolved'))
  )`);
  await db.query(
    `CREATE INDEX IF NOT EXISTS feedback_reports_status_created_idx ON feedback_reports(status,created_at DESC)`,
  );
  await db.query(`CREATE TABLE IF NOT EXISTS feedback_rate_limits (
    limiter_key text PRIMARY KEY, window_start timestamptz NOT NULL, request_count int NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
    title text NOT NULL, body text NOT NULL, url text NOT NULL DEFAULT '/', read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await db.query(
    `CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications(user_id,created_at DESC)`,
  );

  const roles = [
    {
      name: "God",
      color: "#7c3aed",
      system: true,
      permissions: [
        "booking.create_own",
        "booking.create_all",
        "booking.manage_all",
        "booking.request",
        "booking.review",
        "room.manage",
        "issue.resolve",
        "user.manage",
        "user.delete",
        "security.reset",
        "role.manage",
        "audit.view",
        "stats.view",
      ],
    },
    {
      name: "Gestão",
      color: "#2563eb",
      system: true,
      permissions: [
        "booking.create_own",
        "booking.create_all",
        "booking.manage_all",
        "room.manage",
        "user.manage",
        "audit.view",
      ],
    },
    {
      name: "ADM",
      color: "#d97706",
      system: true,
      permissions: [
        "booking.create_own",
        "booking.create_all",
        "booking.manage_all",
        "room.manage",
        "user.manage",
      ],
    },
    {
      name: "Usuário",
      color: "#34785a",
      system: true,
      permissions: ["booking.request"],
    },
  ];
  for (const role of roles) {
    await db.query(
      `INSERT INTO roles(name,color,permissions,system) VALUES ($1,$2,$3::jsonb,$4) ON CONFLICT(name) DO NOTHING`,
      [role.name, role.color, JSON.stringify(role.permissions), role.system],
    );
  }
  await db.query(
    `UPDATE roles SET permissions=(SELECT jsonb_agg(DISTINCT value) FROM jsonb_array_elements(permissions || '["security.reset","user.delete","stats.view","booking.request","booking.review","issue.resolve"]'::jsonb)) WHERE name='God'`,
  );
  await db.query(
    `UPDATE roles SET permissions=COALESCE((SELECT jsonb_agg(value) FROM jsonb_array_elements(permissions - 'room.occupy' - 'room.release_own' - 'room.manage_all')), '[]'::jsonb)`,
  );
  await db.query(
    `UPDATE roles SET permissions=(SELECT jsonb_agg(DISTINCT value) FROM jsonb_array_elements((permissions - 'booking.create_own') || '["booking.request"]'::jsonb)) WHERE name='Usuário'`,
  );
  await db.query(
    `UPDATE reservations SET status='reserved',updated_at=now() WHERE status IN ('active','completed','no_show')`,
  );
  await db.query(
    `UPDATE reservations older SET status='cancelled',updated_at=now()
     WHERE older.status='reserved' AND EXISTS (
       SELECT 1 FROM reservations newer
       WHERE newer.room_id=older.room_id AND newer.status='reserved'
         AND newer.starts_at<older.ends_at AND newer.ends_at>older.starts_at
         AND (newer.created_at>older.created_at OR (newer.created_at=older.created_at AND newer.id::text>older.id::text))
     )`,
  );
  await db.query(
    `UPDATE roles SET color='#8b5cf6' WHERE name='Gestão' AND color='#2563eb'`,
  );
  await db.query(
    `UPDATE roles SET color='#a78bfa' WHERE name='ADM' AND color='#d97706'`,
  );
  await db.query(
    `INSERT INTO shifts(name,start_time,end_time) VALUES ('Manhã','08:00','14:20'),('Tarde','14:40','21:00'),('Diurno','08:00','17:00'),('Dia todo','08:00','21:00') ON CONFLICT(name) DO NOTHING`,
  );
  await db.query(
    `INSERT INTO development_team(name,role,display_order) VALUES
      ('Samuel L. Carvalho','Eng. de Software | Full Stack',1),
      ('Adryan Augusto','Analista de Projeto | UI | UX',2),
      ('João Romero','Designer Gráfico | Produto',3)
     ON CONFLICT(name) DO NOTHING`,
  );

  const ownerGodCount = await db.query(
    `SELECT count(*)::int count FROM users WHERE is_owner_god=true AND deleted_at IS NULL`,
  );
  if (Number(ownerGodCount[0]?.count) === 0) {
    await db.query(
      `UPDATE users SET is_owner_god=true WHERE id=(SELECT id FROM users WHERE is_god=true AND deleted_at IS NULL ORDER BY created_at LIMIT 1)`,
    );
  }

  const godCount = await db.query(
    `SELECT count(*)::int AS count FROM users WHERE is_god = true`,
  );
  if (Number(godCount[0]?.count) === 0 && process.env.GOD_BOOTSTRAP_PASSWORD) {
    const hash = await bcrypt.hash(process.env.GOD_BOOTSTRAP_PASSWORD, 12);
    const godRole = await db.query(
      `SELECT id FROM roles WHERE name='God' LIMIT 1`,
    );
    await db.query(
      `INSERT INTO users(name,username,password_hash,role_id,is_god,is_owner_god) VALUES ($1,$2,$3,$4,true,true)`,
      [
        process.env.GOD_NAME || "Samuel Lucas Carvalho",
        (process.env.GOD_USERNAME || "samuel").toLowerCase(),
        hash,
        godRole[0].id,
      ],
    );
  }

  if (process.env.VERCEL_ENV === "preview") {
    await ensurePreviewTestData(db);
  }
}

async function ensurePreviewTestData(db: NeonQueryFunction<false, false>) {
  const password = process.env.PREVIEW_TEST_PASSWORD;
  if (!password) return;

  const username = (process.env.PREVIEW_TEST_USERNAME || "mappa.teste")
    .trim()
    .toLowerCase();
  const name = process.env.PREVIEW_TEST_NAME || "Acesso de Teste";
  const godRole = await db.query(`SELECT id FROM roles WHERE name='God' LIMIT 1`);
  const existingUsers = await db.query(
    `SELECT id,password_hash,security_answers FROM users WHERE username=$1 LIMIT 1`,
    [username],
  );
  const existingUser = existingUsers[0];
  const passwordMatches = existingUser
    ? await bcrypt.compare(password, existingUser.password_hash)
    : false;
  const passwordHash = passwordMatches
    ? existingUser.password_hash
    : await bcrypt.hash(password, 12);

  let testUserId: string;
  if (existingUser) {
    await db.query(
      `UPDATE users SET name=$1,password_hash=$2,role_id=$3,is_god=true,active=true,deleted_at=NULL,failed_logins=0,locked_until=NULL,updated_at=now() WHERE id=$4`,
      [name, passwordHash, godRole[0].id, existingUser.id],
    );
    testUserId = existingUser.id;
  } else {
    const inserted = await db.query(
      `INSERT INTO users(name,username,password_hash,role_id,is_god,is_owner_god) VALUES ($1,$2,$3,$4,true,false) RETURNING id`,
      [name, username, passwordHash, godRole[0].id],
    );
    testUserId = inserted[0].id;
  }

  const savedAnswers = Array.isArray(existingUser?.security_answers)
    ? existingUser.security_answers
    : [];
  if (savedAnswers.length < 2) {
    const securityAnswers = await Promise.all(
      SECURITY_FIELDS.map(async (field) => ({
        question: field.question,
        hash: await bcrypt.hash(
          field.options[0].toLocaleLowerCase("pt-BR"),
          12,
        ),
      })),
    );
    await db.query(
      `UPDATE users SET security_answers=$1::jsonb,updated_at=now() WHERE id=$2`,
      [JSON.stringify(securityAnswers), testUserId],
    );
  }

  const roomCount = await db.query(
    `SELECT count(*)::int count FROM rooms WHERE active=true`,
  );
  if (Number(roomCount[0]?.count) > 0) return;

  const rooms = await db.query(
    `INSERT INTO rooms(name,location,kind,capacity,resources,network_status,chairs,tables,workstations) VALUES
      ('Sala de Treinamento 01','Anexo SAC, térreo','physical',24,'Projetor, quadro e videoconferência','Disponível',24,12,18),
      ('Sala de Treinamento 02','Anexo SAC, térreo','physical',18,'TV, quadro e webcam','Disponível',18,9,12),
      ('Sala Híbrida','Edifício principal, 1º andar','physical',12,'Videoconferência, TV e quadro','Disponível',12,6,8),
      ('Laboratório de Informática','Edifício principal, 2º andar','physical',20,'Projetor e computadores','Disponível',20,10,20),
      ('Sala Virtual Teams','Online','virtual',100,'Microsoft Teams','Não se aplica',0,0,0)
     RETURNING id,name`,
  );

  const samples = [
    [0, 0, "08:00", "10:00", "Treinamento de integração"],
    [1, 0, "10:00", "12:00", "Reunião de projeto"],
    [2, 0, "14:20", "17:00", "Oficina de produto"],
    [0, 1, "08:00", "14:20", "Capacitação da equipe"],
    [3, 1, "14:20", "18:00", "Laboratório prático"],
    [4, 2, "09:00", "11:00", "Encontro remoto"],
    [2, 3, "21:00", "23:30", "Manutenção programada"],
    [1, 4, "14:20", "21:00", "Planejamento semanal"],
  ] as const;

  for (const [roomIndex, dayOffset, startTime, endTime, reason] of samples) {
    await db.query(
      `INSERT INTO reservations(room_id,user_id,reason,starts_at,ends_at,shareable,expected_people,status,created_by)
       VALUES (
         $1,$2,$3,
         (((now() AT TIME ZONE 'America/Bahia')::date + $4::int)::text || ' ' || $5)::timestamp AT TIME ZONE 'America/Bahia',
         (((now() AT TIME ZONE 'America/Bahia')::date + $4::int)::text || ' ' || $6)::timestamp AT TIME ZONE 'America/Bahia',
         false,1,'reserved',$2
       )`,
      [
        rooms[roomIndex].id,
        testUserId,
        reason,
        dayOffset,
        startTime,
        endTime,
      ],
    );
  }
}

export async function getUserWithRole(userId: string) {
  await ensureDatabase();
  const rows = await sql().query(
    `SELECT u.id,u.name,u.username,u.active,u.is_god,u.is_owner_god,u.password_hash,u.security_answers,
    r.id role_id,r.name role_name,r.color role_color,r.permissions FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1 AND u.deleted_at IS NULL LIMIT 1`,
    [userId],
  );
  return rows[0] || null;
}

export function permissionsOf(row: Record<string, unknown>): Permission[] {
  return (
    Array.isArray(row.permissions) ? row.permissions : []
  ) as Permission[];
}
