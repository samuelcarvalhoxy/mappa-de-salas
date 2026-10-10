import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { ROOM_REVIEW_RESPONSIBILITY_SCHEMA } from "../lib/room-review-responsibilities.ts";
import { ACKNOWLEDGE_EXPIRY_ALERT_SQL, EXPIRE_BOOKING_REQUESTS_SQL, REQUEST_DECISION_STATS_SQL,
  REQUEST_END_SQL, REQUEST_EXPIRATION_SCHEMA } from "../lib/request-expiration-sql.ts";

const db = new PGlite();
const requester = "00000000-0000-4000-8000-000000000001";
const staff = "00000000-0000-4000-8000-000000000002";
const god = "00000000-0000-4000-8000-000000000003";
const room = "00000000-0000-4000-8000-000000000004";
const request = "00000000-0000-4000-8000-000000000005";

before(async () => {
  await db.exec(`CREATE TABLE roles(id int PRIMARY KEY,permissions jsonb);
    CREATE TABLE users(id uuid PRIMARY KEY,name text,role_id int REFERENCES roles(id),active boolean DEFAULT true,
      deleted_at timestamptz,is_god boolean DEFAULT false);
    CREATE TABLE rooms(id uuid PRIMARY KEY,name text,active boolean DEFAULT true,kind text DEFAULT 'physical');
    CREATE TABLE reservations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),room_id uuid REFERENCES rooms(id),
      user_id uuid REFERENCES users(id),reason text,starts_at timestamptz,ends_at timestamptz,shareable boolean,
      expected_people int,status text,created_by uuid,updated_at timestamptz);
    CREATE TABLE booking_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),requester_id uuid REFERENCES users(id),
      room_id uuid REFERENCES rooms(id),requested_date date,start_time text,end_time text,reason text,
      shareable boolean,expected_people int,status text DEFAULT 'pending',review_comment text DEFAULT '',
      reviewed_by uuid,reviewed_at timestamptz,updated_at timestamptz,created_at timestamptz DEFAULT now(),
      urgent_acknowledged_at timestamptz,urgent_acknowledged_by uuid,
      approved_reservation_id uuid REFERENCES reservations(id));
    CREATE TABLE notifications(id uuid DEFAULT gen_random_uuid(),user_id uuid,title text,body text,url text,read_at timestamptz);
    CREATE TABLE audit_log(id uuid DEFAULT gen_random_uuid(),actor_id uuid,action text,details text);
    INSERT INTO roles VALUES (1,'["booking.request"]'),(2,'["booking.review"]'),(3,'[]');
    INSERT INTO users(id,name,role_id,is_god) VALUES ('${requester}','Instrutor X',1,false),
      ('${staff}','Analista',2,false),('${god}','God',3,true);
    INSERT INTO rooms(id,name) VALUES ('${room}','Sala 12');`);
  await db.exec(ROOM_REVIEW_RESPONSIBILITY_SCHEMA);
  await db.transaction(async (transaction) => {
    for (const statement of REQUEST_EXPIRATION_SCHEMA.split("\n-- next\n")) await transaction.query(statement);
  });
});
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(`TRUNCATE booking_requests,reservations,request_decision_totals,request_expiry_alerts,notifications,audit_log,room_review_responsibilities CASCADE;
    UPDATE users SET active=true,deleted_at=NULL;
    UPDATE roles SET permissions='["booking.review"]' WHERE id=2;
    INSERT INTO room_review_responsibilities(room_id,user_id,assigned_by) VALUES ('${room}','${staff}','${god}'),('${room}','${god}','${god}');`);
});

async function pending(dateExpression = "(now() AT TIME ZONE 'America/Bahia')::date-1", start = "14:20", end = "20:00", id = request) {
  await db.query(`INSERT INTO booking_requests(id,requester_id,room_id,requested_date,start_time,end_time,reason)
    VALUES ($1,$2,$3,${dateExpression},$4,$5,'Treinamento')`, [id,requester,room,start,end]);
}
async function expire() { return (await db.query<{ expired_count: number }>(EXPIRE_BOOKING_REQUESTS_SQL)).rows[0].expired_count; }

test("expira somente pedidos pendentes encerrados e mantém motivo, alertas e auditoria", async () => {
  await pending();
  assert.equal(await expire(),1);
  const row = (await db.query<{ status: string; review_comment: string; reviewed_by: null; decision_kind: string }>(`SELECT * FROM booking_requests`)).rows[0];
  assert.equal(row.status,'rejected');
  assert.equal(row.decision_kind,'automatic_rejected');
  assert.equal(row.reviewed_by,null);
  assert.equal(row.review_comment,'Rejeição automática por omissão do Staff.');
  const alerts = (await db.query<{ user_id: string; message: string }>(`SELECT * FROM request_expiry_alerts`)).rows;
  assert.deepEqual(alerts.map((a) => a.user_id).sort(),[staff,god].sort());
  assert.match(alerts[0].message,/Instrutor X solicitou Sala 12/);
  assert.match(alerts[0].message,/14:20 às 20:00/);
  assert.equal((await db.query(`SELECT * FROM notifications`)).rows.length,1);
  assert.equal((await db.query(`SELECT * FROM audit_log WHERE action='request.auto_reject'`)).rows.length,1);
});

test("execuções repetidas não duplicam decisões, avisos ou contadores", async () => {
  await pending();
  assert.equal(await expire(),1);
  assert.equal(await expire(),0);
  await db.exec(REQUEST_EXPIRATION_SCHEMA);
  assert.equal((await db.query<{ decision_count: number }>(`SELECT decision_count::int FROM request_decision_totals`)).rows[0].decision_count,1);
  assert.equal((await db.query(`SELECT * FROM request_expiry_alerts`)).rows.length,2);
});

test("duas verificações concorrentes produzem somente uma rejeição", async () => {
  await pending();
  const counts = await Promise.all([expire(),expire()]);
  assert.equal(counts.reduce((sum,value) => sum+value,0),1);
  assert.equal((await db.query<{ decision_count: number }>(`SELECT decision_count::int FROM request_decision_totals`)).rows[0].decision_count,1);
});

test("não expira pedidos futuros nem pedidos já decididos ou cancelados", async () => {
  await pending("(now() AT TIME ZONE 'America/Bahia')::date+1");
  assert.equal(await expire(),0);
  await db.query(`UPDATE booking_requests SET requested_date=requested_date-2,status='approved',reviewed_at=now() WHERE id=$1`,[request]);
  assert.equal(await expire(),0);
  await pending(undefined,"08:00","09:00","00000000-0000-4000-8000-000000000006");
  await db.query(`UPDATE booking_requests SET status='cancelled' WHERE status='pending'`);
  assert.equal(await expire(),0);
  const totals = (await db.query<{ outcome: string }>(`SELECT outcome FROM request_decision_totals`)).rows;
  assert.deepEqual(totals.map((row) => row.outcome),['approved']);
});

test("turno Extra usa a manhã seguinte e o fim exato expira sem antecipar o início", async () => {
  // Transaction time is fixed, making exact boundary assertions deterministic.
  await db.exec('BEGIN');
  try {
    await db.query(`INSERT INTO booking_requests(id,requester_id,room_id,requested_date,start_time,end_time)
      VALUES ($1,$2,$3,(now() AT TIME ZONE 'America/Bahia')::date-1,'23:59:59.999999',
        to_char(now() AT TIME ZONE 'America/Bahia','HH24:MI:SS.US'))`,[request,requester,room]);
    const end = (await db.query<{ equal: boolean }>(`SELECT (${REQUEST_END_SQL})=now() equal FROM booking_requests`)).rows[0];
    assert.equal(end.equal,true);
    assert.equal(await expire(),1);
    assert.match((await db.query<{ message: string }>(`SELECT message FROM request_expiry_alerts LIMIT 1`)).rows[0].message,/dia seguinte/);
  } finally { await db.exec('ROLLBACK'); }
  // A request whose start is past but whose end is future stays pending.
  await pending("(now() AT TIME ZONE 'America/Bahia')::date", "00:00", "23:59:59.999999");
  assert.equal(await expire(),0);
});

test("OK é individual, idempotente e não permite confirmar o aviso de outro usuário", async () => {
  await pending(); await expire();
  const alerts = (await db.query<{ id: string; user_id: string }>(`SELECT id,user_id FROM request_expiry_alerts`)).rows;
  const own = alerts.find((alert) => alert.user_id===staff)!;
  assert.equal((await db.query(ACKNOWLEDGE_EXPIRY_ALERT_SQL,[own.id,requester])).rows.length,0);
  assert.equal((await db.query(ACKNOWLEDGE_EXPIRY_ALERT_SQL,[own.id,staff])).rows.length,1);
  assert.equal((await db.query(ACKNOWLEDGE_EXPIRY_ALERT_SQL,[own.id,staff])).rows.length,1);
  assert.deepEqual((await db.query<{ user_id: string }>(`SELECT user_id FROM request_expiry_alerts WHERE acknowledged_at IS NULL`)).rows.map((r) => r.user_id),[god]);
  await db.exec(`UPDATE notifications SET read_at=now()`);
  assert.equal((await db.query(`SELECT * FROM request_expiry_alerts WHERE acknowledged_at IS NULL`)).rows.length,1);
});

test("estatísticas separam decisões e sobrevivem à exclusão dos detalhes", async () => {
  await pending(); await expire();
  await pending(undefined,"08:00","09:00","00000000-0000-4000-8000-000000000006");
  await db.query(`UPDATE booking_requests SET status='rejected',reviewed_by=$1,reviewed_at=now() WHERE status='pending'`,[staff]);
  await pending(undefined,"08:00","09:00","00000000-0000-4000-8000-000000000007");
  await db.query(`UPDATE booking_requests SET status='approved',reviewed_by=$1,reviewed_at=now()-interval '100 days' WHERE status='pending'`,[staff]);
  const rows = (await db.query<{ outcome: string; total: number; recent: number }>(REQUEST_DECISION_STATS_SQL,[null,null])).rows;
  assert.equal(rows.find((r) => r.outcome==='automatic_rejected')?.total,1);
  assert.equal(rows.find((r) => r.outcome==='manual_rejected')?.total,1);
  assert.equal(rows.find((r) => r.outcome==='approved')?.recent,0);
  assert.equal((await db.query(REQUEST_DECISION_STATS_SQL,[god,null])).rows.length,0);
  const before = rows.sort((a,b) => a.outcome.localeCompare(b.outcome));
  await db.exec('DELETE FROM booking_requests');
  const after = (await db.query<{ outcome: string; total: number; recent: number }>(REQUEST_DECISION_STATS_SQL,[requester,room])).rows.sort((a,b) => a.outcome.localeCompare(b.outcome));
  assert.deepEqual(after,before);
  assert.equal((await db.query(`SELECT * FROM request_expiry_alerts WHERE acknowledged_at IS NULL`)).rows.length,2);
});

test("aprovação real da API cria e vincula a reserva e conta somente uma vez", async () => {
  await pending("(now() AT TIME ZONE 'America/Bahia')::date+1");
  const source = readFileSync(new URL('../app/api/action/route.ts',import.meta.url),'utf8');
  const query = source.match(/`(WITH reservation_id AS[\s\S]*?)`,/)![1].replaceAll('${REQUEST_END_SQL}',REQUEST_END_SQL);
  const date = (await db.query<{ date: string }>(`SELECT requested_date::text date FROM booking_requests`)).rows[0].date;
  const values = [room,'Treinamento',date,'14:20','20:00',false,1,'',staff,request,
    `${date}T14:20:00-03:00`,`${date}T20:00:00-03:00`,false];
  assert.equal((await db.query<{ approved_count: number }>(query,values)).rows[0].approved_count,1);
  assert.equal((await db.query<{ approved_count: number }>(query,values)).rows[0].approved_count,0);
  assert.equal((await db.query(`SELECT br.id FROM booking_requests br JOIN reservations r ON r.id=br.approved_reservation_id`)).rows.length,1);
  assert.equal((await db.query<{ decision_count: number }>(`SELECT decision_count::int FROM request_decision_totals WHERE outcome='approved'`)).rows[0].decision_count,1);
  assert.equal(await expire(),0);
});

test("aprovação atrasada não reabre pedido que a expiração já rejeitou", async () => {
  await pending(); await expire();
  const source = readFileSync(new URL('../app/api/action/route.ts',import.meta.url),'utf8');
  const query = source.match(/`(WITH reservation_id AS[\s\S]*?)`,/)![1].replaceAll('${REQUEST_END_SQL}',REQUEST_END_SQL);
  const date = (await db.query<{ date: string }>(`SELECT ((now() AT TIME ZONE 'America/Bahia')::date+1)::text date`)).rows[0].date;
  assert.equal((await db.query<{ approved_count: number }>(query,[room,'Treinamento',date,'14:20','20:00',false,1,'',staff,request,`${date}T14:20:00-03:00`,`${date}T20:00:00-03:00`,false])).rows[0].approved_count,0);
  assert.equal((await db.query(`SELECT * FROM reservations`)).rows.length,0);
});

test("apenas os responsáveis da sala recebem o aviso, sem privilégio implícito para God", async () => {
  await db.query(`DELETE FROM room_review_responsibilities WHERE user_id=$1`,[god]);
  const another = "00000000-0000-4000-8000-000000000009";
  await db.query(`INSERT INTO rooms(id,name) VALUES ($1,'Outra sala') ON CONFLICT DO NOTHING`,[another]);
  await db.query(`INSERT INTO room_review_responsibilities(room_id,user_id,assigned_by) VALUES ($1,$2,$2)`,[another,god]);
  await pending();
  const result = (await db.query<{ staff_ids: string[]; requester_ids: string[] }>(EXPIRE_BOOKING_REQUESTS_SQL)).rows[0];
  assert.deepEqual(result.staff_ids,[staff]);
  assert.deepEqual(result.requester_ids,[requester]);
  assert.deepEqual((await db.query<{ user_id: string }>(`SELECT user_id FROM request_expiry_alerts`)).rows.map((row) => row.user_id),[staff]);
});

test("sala sem responsáveis continua expirando e contabilizando sem avisar todos os analistas", async () => {
  await db.exec(`DELETE FROM room_review_responsibilities`);
  await pending();
  const result = (await db.query<{ expired_count: number; staff_ids: string[] }>(EXPIRE_BOOKING_REQUESTS_SQL)).rows[0];
  assert.equal(result.expired_count,1);
  assert.deepEqual(result.staff_ids,[]);
  assert.equal((await db.query(`SELECT * FROM request_expiry_alerts`)).rows.length,0);
  assert.equal((await db.query(`SELECT * FROM notifications WHERE user_id=$1`,[requester])).rows.length,1);
  assert.equal((await db.query<{ decision_count: number }>(`SELECT decision_count::int FROM request_decision_totals`)).rows[0].decision_count,1);
});

test("pedidos sem sala avisam responsáveis das salas ativas uma única vez por pessoa", async () => {
  const another = "00000000-0000-4000-8000-000000000008";
  await db.query(`INSERT INTO rooms(id,name) VALUES ($1,'Sala 13') ON CONFLICT DO NOTHING`,[another]);
  await db.query(`INSERT INTO room_review_responsibilities(room_id,user_id,assigned_by) VALUES ($1,$2,$3)`,[another,staff,god]);
  await pending();
  await db.exec(`UPDATE booking_requests SET room_id=NULL`);
  await expire();
  const alerts = (await db.query<{ user_id: string }>(`SELECT user_id FROM request_expiry_alerts`)).rows;
  assert.deepEqual(alerts.map((alert) => alert.user_id).sort(),[staff,god].sort());
  await db.exec(`DELETE FROM request_expiry_alerts; DELETE FROM booking_requests;
    UPDATE rooms SET active=false WHERE id<>'${room}';
    DELETE FROM room_review_responsibilities WHERE room_id='${room}' AND user_id='${staff}';`);
  await pending();
  await db.exec(`UPDATE booking_requests SET room_id=NULL`);
  await expire();
  assert.deepEqual((await db.query<{ user_id: string }>(`SELECT user_id FROM request_expiry_alerts`)).rows.map((alert) => alert.user_id),[god]);
  await db.exec(`UPDATE rooms SET active=true`);
});

test("responsáveis inativos, excluídos ou sem permissão de análise não recebem novos avisos", async () => {
  for (const change of ["UPDATE users SET active=false WHERE name='Analista'", "UPDATE users SET deleted_at=now() WHERE name='Analista'", "UPDATE roles SET permissions='[]' WHERE id=2"]) {
    await db.exec("BEGIN");
    try {
      await db.exec(change);
      await pending(); await expire();
      assert.deepEqual((await db.query<{ user_id: string }>(`SELECT user_id FROM request_expiry_alerts`)).rows.map((row) => row.user_id),[god]);
    } finally { await db.exec("ROLLBACK"); }
  }
});
