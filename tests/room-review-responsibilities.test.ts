import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { parseRoomResponsibilities, ROOM_REVIEW_RESPONSIBILITY_SCHEMA, LOCK_ROOM_RESPONSIBILITIES_SQL,
  SAVE_ROOM_RESPONSIBILITIES_SQL, ROOM_RESPONSIBLE_USERS_SQL, ROOM_REVIEWER_OPTIONS_SQL } from "../lib/room-review-responsibilities.ts";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const god=uid(1), delegate=uid(2), reviewer=uid(3), other=uid(4), room=uid(10);
const db = new PGlite();
before(async () => {
  await db.exec(`CREATE TABLE roles(id int PRIMARY KEY,name text,permissions jsonb);
    CREATE TABLE users(id uuid PRIMARY KEY,name text,username text,role_id int REFERENCES roles(id),active boolean DEFAULT true,deleted_at timestamptz,is_god boolean DEFAULT false);
    CREATE TABLE rooms(id uuid PRIMARY KEY,name text,active boolean DEFAULT true,kind text DEFAULT 'physical');
    CREATE TABLE audit_log(id uuid DEFAULT gen_random_uuid(),actor_id uuid,action text,details text);
    INSERT INTO roles VALUES (1,'God','[]'),(2,'Nomeação','["room.assign_responsibles"]'),(3,'Analista','["booking.review"]'),(4,'Cadastro','["room.manage"]');
    INSERT INTO users(id,name,username,role_id,is_god) VALUES ('${god}','God','god',1,true),('${delegate}','Delegado','delegado',2,false),
      ('${reviewer}','Analista','analista',3,false),('${other}','Cadastro','cadastro',4,false);
    INSERT INTO rooms(id,name) VALUES ('${room}','Sala 01');`);
  await db.exec(ROOM_REVIEW_RESPONSIBILITY_SCHEMA);
  await db.exec(`ALTER TABLE rooms ADD COLUMN location text DEFAULT 'Unidade Uruguai',ADD COLUMN capacity int DEFAULT 30,
    ADD COLUMN resources text DEFAULT '',ADD COLUMN network_status text DEFAULT 'Disponível',
    ADD COLUMN chairs int DEFAULT 30,ADD COLUMN tables int DEFAULT 15,ADD COLUMN workstations int DEFAULT 15;`);
});
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(`TRUNCATE room_review_responsibilities,audit_log;
    UPDATE users SET active=true,deleted_at=NULL;
    UPDATE roles SET permissions='["booking.review"]' WHERE id=3;
    UPDATE rooms SET active=true,kind='physical';`);
});
async function assign(userIds: string[], actorId=god, roomId=room) {
  return db.transaction(async (tx) => {
    await tx.query(LOCK_ROOM_RESPONSIBILITIES_SQL,[roomId]);
    return (await tx.query<{ room_exists: boolean; can_assign: boolean; valid_reviewers: boolean }>(SAVE_ROOM_RESPONSIBILITIES_SQL,[roomId,userIds,actorId])).rows[0];
  });
}
async function assigned() {
  return (await db.query<{ user_id: string }>(`SELECT user_id FROM room_review_responsibilities ORDER BY user_id`)).rows.map((row) => row.user_id);
}

test("valida sala e lista, aceita remoção completa e elimina IDs repetidos", () => {
  assert.deepEqual(parseRoomResponsibilities({roomId:room,userIds:[reviewer,reviewer]}),{roomId:room,userIds:[reviewer]});
  assert.deepEqual(parseRoomResponsibilities({roomId:room,userIds:[]}).userIds,[]);
  assert.throws(() => parseRoomResponsibilities({roomId:"falso",userIds:[]}),/sala válida/);
  assert.throws(() => parseRoomResponsibilities({roomId:room,userIds:[null]}),/responsáveis válidos/);
});

test("God nomeia vários responsáveis e mantém auditoria das substituições e remoções", async () => {
  assert.deepEqual(await assign([reviewer,god]),{room_exists:true,can_assign:true,valid_reviewers:true});
  assert.deepEqual(await assigned(),[god,reviewer]);
  await assign([reviewer]);
  assert.deepEqual(await assigned(),[reviewer]);
  await assign([]);
  assert.deepEqual(await assigned(),[]);
  const audit=(await db.query<{ details: string }>(`SELECT details FROM audit_log WHERE action='room.assign_responsibles'`)).rows;
  assert.equal(audit.length,3);
  assert.ok(audit.some((row) => row.details.includes(god) && row.details.includes(reviewer)));
});

test("permissão delegada nomeia sem conceder cadastro de salas ou análise de pedidos", async () => {
  assert.equal((await assign([reviewer],delegate)).can_assign,true);
  assert.deepEqual(await assigned(),[reviewer]);
  // The delegate may appoint reviewers, but cannot appoint themself without review access.
  assert.equal((await assign([delegate],delegate)).valid_reviewers,false);
  assert.deepEqual(await assigned(),[reviewer]);
});

test("analisar pedidos ou cadastrar salas não permite alterar responsáveis", async () => {
  await assign([god]);
  for (const actorId of [reviewer,other]) assert.equal((await assign([reviewer],actorId)).can_assign,false);
  assert.deepEqual(await assigned(),[god]);
  assert.equal((await db.query(`SELECT * FROM audit_log`)).rows.length,1);
});

test("seleção com usuário inativo, excluído, sem análise ou inexistente preserva todas as atribuições", async () => {
  await assign([god]);
  for (const invalid of [other,uid(99)]) {
    assert.equal((await assign([reviewer,invalid])).valid_reviewers,false);
    assert.deepEqual(await assigned(),[god]);
  }
  for (const field of ["active=false","deleted_at=now()"]) {
    await db.exec("BEGIN");
    try {
      await db.query(`UPDATE users SET ${field} WHERE id=$1`,[reviewer]);
      const result=(await db.query<{ valid_reviewers: boolean }>(SAVE_ROOM_RESPONSIBILITIES_SQL,[room,[reviewer],god])).rows[0];
      assert.equal(result.valid_reviewers,false);
      assert.deepEqual(await assigned(),[god]);
    } finally { await db.exec("ROLLBACK"); }
  }
  assert.equal((await db.query(`SELECT * FROM audit_log`)).rows.length,1);
});

test("sala inativa, virtual ou inexistente não pode receber responsáveis", async () => {
  for (const update of ["active=false","kind='virtual'"]) {
    await db.exec("BEGIN");
    try {
      await db.query(`UPDATE rooms SET ${update} WHERE id=$1`,[room]);
      assert.equal((await db.query<{ room_exists: boolean }>(SAVE_ROOM_RESPONSIBILITIES_SQL,[room,[reviewer],god])).rows[0].room_exists,false);
      assert.deepEqual(await assigned(),[]);
    } finally { await db.exec("ROLLBACK"); }
  }
  assert.equal((await assign([reviewer],god,uid(99))).room_exists,false);
  assert.equal((await db.query(`SELECT * FROM audit_log`)).rows.length,0);
});

test("lista de candidatos contém somente analistas ativos e indica atribuição que perdeu acesso", async () => {
  await assign([reviewer]);
  await db.query(`UPDATE roles SET permissions='[]' WHERE id=3`);
  const options=(await db.query<{ id: string }>(ROOM_REVIEWER_OPTIONS_SQL)).rows.map((row) => row.id);
  assert.deepEqual(options,[god]);
  const assignments=(await db.query<{ id: string; eligible: boolean }>(ROOM_RESPONSIBLE_USERS_SQL)).rows;
  assert.equal(assignments[0].id,reviewer);
  assert.equal(assignments[0].eligible,false);
});

test("substituições concorrentes não acumulam seleções de responsáveis", async () => {
  await Promise.all([assign([reviewer]),assign([god])]);
  assert.equal((await assigned()).length,1);
  assert.equal((await db.query(`SELECT * FROM audit_log`)).rows.length,2);
});

test("consulta real da API inclui os responsáveis na sala e mantém sua elegibilidade", async () => {
  await assign([reviewer,god]);
  await db.query(`UPDATE users SET active=false WHERE id=$1`,[reviewer]);
  const source=readFileSync(new URL('../app/api/state/route.ts',import.meta.url),'utf8');
  const query=source.match(/`(SELECT id,name,location,[\s\S]*?FROM rooms room[\s\S]*?)`,/)![1].replaceAll('${ROOM_RESPONSIBLE_USERS_SQL}',ROOM_RESPONSIBLE_USERS_SQL);
  const result=(await db.query<{ id: string; approval_responsibles: { id: string; eligible: boolean }[] }>(query)).rows[0];
  assert.equal(result.id,room);
  assert.equal(result.approval_responsibles.length,2);
  assert.equal(result.approval_responsibles.find((person) => person.id===reviewer)?.eligible,false);
  assert.equal(result.approval_responsibles.find((person) => person.id===god)?.eligible,true);
});
