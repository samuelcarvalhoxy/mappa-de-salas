import assert from "node:assert/strict";
import { before,after,test } from "node:test";
import { neon,neonConfig } from "@neondatabase/serverless";
import { scopedDatabase } from "../lib/scoped-database.ts";
import { unitContext } from "../lib/unit-context.ts";
import { PGlite } from "@electric-sql/pglite";
import { UNIT_MIGRATION_SQL,URUGUAI_ID,CABULA_ID,SAO_BENTO_ID } from "../lib/unit-schema.ts";
import { EXPIRE_BOOKING_REQUESTS_SQL } from "../lib/request-expiration-sql.ts";
import { createUnitFixture,god,person,manager,room } from "./unit-fixture.ts";
import { HANDOVER_SQL } from "../lib/unit-users-sql.ts";
let db: PGlite;
async function scoped<T>(unit: string,actor: string,query: string,params: unknown[]=[]) {
 return db.transaction(async tx=>{await tx.exec("SET LOCAL ROLE mappa_runtime");await tx.query("SELECT set_config('mappa.unit_id',$1,true),set_config('mappa.actor_id',$2,true)",[unit,actor]);return (await tx.query<T>(query,params)).rows;});
}
before(async()=>{db=await createUnitFixture();});
after(async()=>{await db.close();});

test("migração preserva URUGUAI e snapshot e cria CABULA/SÃO BENTO sem usuários comuns ou salas",async()=>{
 assert.equal((await db.query("SELECT id FROM units")).rows.length,3);
 assert.equal((await db.query("SELECT id FROM public_units_backup_20261027.reservations")).rows.length,1);
 assert.equal((await scoped(URUGUAI_ID,god,"SELECT id FROM reservations")).length,1);
 assert.equal((await scoped(CABULA_ID,god,"SELECT id FROM rooms")).length,0);
 assert.equal((await scoped(SAO_BENTO_ID,god,"SELECT id FROM rooms")).length,0);
 assert.equal((await db.query("SELECT * FROM unit_memberships WHERE unit_id<>$1",[URUGUAI_ID])).rows.length,0);
 await db.exec(UNIT_MIGRATION_SQL);
 assert.equal((await db.query("SELECT * FROM unit_memberships")).rows.length,2);
});

test("perfis locais têm identidades independentes e GOD permanece conta global única",async()=>{
 const roles=await db.query<{id:string}>("SELECT id FROM roles WHERE name='Gestão'");assert.equal(new Set(roles.rows.map(r=>r.id)).size,3);
 assert.equal((await db.query("SELECT id FROM users WHERE is_god")).rows.length,1);
 const users=await scoped<{id:string}>(CABULA_ID,god,"SELECT id FROM users WHERE mappa_user_in_unit(id,true)");assert.deepEqual(users.map(u=>u.id),[god]);
 assert.equal((await scoped(CABULA_ID,person,"SELECT * FROM roles")).length,0);
 await assert.rejects(scoped(CABULA_ID,god,"SELECT * FROM public_units_backup_20261027.users"),/permission denied/);
});

test("banco rejeita consulta e gravação entre unidades, inclusive payload com unit_id adulterado",async()=>{
 const cabulaRoom=(await scoped<{id:string}>(CABULA_ID,god,"INSERT INTO rooms(name) VALUES('Sala 01') RETURNING id"))[0].id;
 assert.equal((await scoped<{unit_id:string}>(CABULA_ID,god,"SELECT unit_id FROM rooms"))[0].unit_id,CABULA_ID);
 assert.equal((await scoped(CABULA_ID,god,"UPDATE rooms SET name='Invadida' WHERE id=$1 RETURNING id",[room])).length,0);
 await assert.rejects(scoped(CABULA_ID,god,"INSERT INTO rooms(name,unit_id) VALUES('Invadida',$1)",[URUGUAI_ID]),/row.level security/);
 await assert.rejects(scoped(CABULA_ID,god,"INSERT INTO reservations(room_id,user_id,reason,starts_at,ends_at,created_by) VALUES($1,$2,'FI','2099-10-05T12:00Z','2099-10-05T13:00Z',$2)",[room,god]),/foreign key/);
 await assert.rejects(scoped(CABULA_ID,god,"INSERT INTO reservations(room_id,user_id,reason,starts_at,ends_at,created_by) VALUES($1,$2,'FI','2099-10-05T12:00Z','2099-10-05T13:00Z',$3)",[cabulaRoom,person,god]),/USER_OUTSIDE_UNIT/);
 await assert.rejects(scoped(CABULA_ID,person,"INSERT INTO rooms(name) VALUES('Invadida')"),/row.level security/);
});

test("pedido de qualquer sala e totais de decisões ficam restritos à unidade",async()=>{
 await db.exec(`INSERT INTO room_review_responsibilities(room_id,user_id,assigned_by,unit_id) VALUES('${room}','${god}','${god}','${URUGUAI_ID}')`);
 await scoped(CABULA_ID,god,"INSERT INTO booking_requests(requester_id,reason,requested_date,start_time,end_time) VALUES($1,'Qualquer sala','2020-01-06','08:00','10:00')",[god]);
 const result=await scoped<{expired_count:number;staff_ids:string[]}>(CABULA_ID,god,EXPIRE_BOOKING_REQUESTS_SQL);
 assert.equal(result[0].expired_count,1);assert.deepEqual(result[0].staff_ids,[]);
 assert.equal((await scoped(CABULA_ID,god,"SELECT * FROM request_decision_totals")).length,1);
 assert.equal((await scoped(URUGUAI_ID,god,"SELECT * FROM request_decision_totals")).length,0);
});

test("transferência preserva reservas e histórico, encerra vínculo anterior e encaminha pendências",async()=>{
 await scoped(URUGUAI_ID,god,"INSERT INTO room_review_responsibilities(room_id,user_id,assigned_by) VALUES($1,$2,$3)",[room,person,god]);
 await db.transaction(async tx=>{
   await tx.query("SELECT set_config('mappa.unit_id',$1,true)",[URUGUAI_ID]);
   const result=await tx.query<{recipients:string[]}>(HANDOVER_SQL,[person,URUGUAI_ID,CABULA_ID,god]);assert.deepEqual(result.rows[0].recipients,[manager]);
   await tx.query("UPDATE unit_memberships SET active=false WHERE user_id=$1 AND unit_id=$2",[person,URUGUAI_ID]);
   await tx.query("INSERT INTO unit_memberships(user_id,unit_id,role_id) SELECT $1,$2,id FROM roles WHERE unit_id=$2 AND name='Usuário'",[person,CABULA_ID]);
   await tx.query("UPDATE users SET primary_unit_id=$2,role_id=(SELECT role_id FROM unit_memberships WHERE user_id=$1 AND unit_id=$2) WHERE id=$1",[person,CABULA_ID]);
 });
 assert.equal((await scoped(URUGUAI_ID,person,"SELECT * FROM reservations")).length,0);
 assert.equal((await scoped(URUGUAI_ID,god,"SELECT * FROM reservations WHERE user_id=$1",[person])).length,1);
 assert.equal((await scoped(CABULA_ID,person,"SELECT * FROM reservations WHERE user_id=$1",[person])).length,0);
 assert.equal((await scoped(URUGUAI_ID,manager,"SELECT * FROM unit_handovers WHERE reviewed_at IS NULL")).length,1);
 const responsibilities=await scoped<{user_id:string}>(URUGUAI_ID,manager,"SELECT user_id FROM room_review_responsibilities WHERE room_id=$1",[room]);
 assert.ok(responsibilities.some(r=>r.user_id===manager));assert.ok(!responsibilities.some(r=>r.user_id===person));
 const notices=await scoped<{title:string;url:string}>(URUGUAI_ID,manager,"SELECT title,url FROM notifications WHERE user_id=$1",[manager]);assert.ok(notices.some(n=>n.title.includes('URUGUAI') && n.url.includes('unit=uruguai')));
});

test("transporte Neon mantém contexto por transação em consultas individuais, lotes e chamadas simultâneas",async()=>{
 const original=neonConfig.fetchFunction;
 let calls=0;
 neonConfig.fetchFunction=async(_input: RequestInfo | URL,init?: RequestInit)=>{
   calls++;
   const body=JSON.parse(String(init?.body));
   assert.ok(Array.isArray(body.queries),"Nenhuma consulta operacional pode sair sem transação");
   assert.equal(body.queries[0].query,"SET LOCAL ROLE mappa_runtime");
   const results=await db.transaction(async tx=>{
     const result=[];
     for(const query of body.queries) {
       const data=await tx.query(query.query,query.params);
       result.push({fields:data.fields,rows:data.rows.map(row=>data.fields.map(field=>{
         const value=(row as Record<string,unknown>)[field.name];
         return value===null ? null : typeof value==="object" ? JSON.stringify(value) : String(value);
       })),rowCount:data.affectedRows || data.rows.length,command:"SELECT"});
     }
     return result;
   });
   return new Response(JSON.stringify({results}),{status:200,headers:{"Content-Type":"application/json"}});
 };
 try {
   const raw=neon("postgresql://fixture:fixture@localhost/fixture");
   const scope=(id:string)=>({unitId:id,unitCode:id===URUGUAI_ID ? "uruguai":"cabula",unitName:"Teste",actorId:god,isGod:true});
   const results=await Promise.all([URUGUAI_ID,CABULA_ID].map(id=>unitContext.run(scope(id),async()=>{
     const sql=scopedDatabase(raw);
     const pending=sql.query("SELECT unit_id FROM rooms");
     const rows=await pending;
     assert.ok(rows.every(row=>row.unit_id===id));
     const batch=await sql.transaction(tx=>[tx.query("SELECT unit_id FROM rooms"),tx.query("SELECT unit_id FROM roles")]);
     assert.equal(batch.length,2);assert.ok(batch.flat().every(row=>row.unit_id===id));
     const list=await sql.transaction([sql.query("SELECT unit_id FROM rooms")]);assert.equal(list.length,1);
     return rows.length;
   })));
   assert.deepEqual(results,[1,1]);assert.equal(calls,6);
   assert.throws(()=>scopedDatabase(raw),/UNIT_CONTEXT_REQUIRED/);
 } finally {neonConfig.fetchFunction=original;}
});


test("pendência sem gestor habilitado para análise sinaliza GOD sem nomeação automática",async()=>{
 await db.query(`UPDATE roles SET permissions='["user.manage"]' WHERE unit_id=$1 AND name='Gestão'`,[URUGUAI_ID]);
 await db.transaction(async tx=>{
   await tx.query("SELECT set_config('mappa.unit_id',$1,true)",[URUGUAI_ID]);
   const result=await tx.query<{recipients:string[]}>(HANDOVER_SQL,[god,URUGUAI_ID,CABULA_ID,god]);
   assert.ok(result.rows[0].recipients.includes(god));assert.ok(result.rows[0].recipients.includes(manager));
 });
 assert.equal((await db.query("SELECT * FROM room_review_responsibilities WHERE user_id=$1",[god])).rows.length,0);
});
