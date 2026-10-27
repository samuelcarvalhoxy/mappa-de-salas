import assert from "node:assert/strict";
import { before,after,test } from "node:test";
import { registerHooks } from "node:module";
import { existsSync,readFileSync } from "node:fs";
import { neonConfig } from "@neondatabase/serverless";
import type { PGlite } from "@electric-sql/pglite";
import { createUnitFixture,god,person,manager } from "./unit-fixture.ts";
import { CABULA_ID,SAO_BENTO_ID,URUGUAI_ID } from "../lib/unit-schema.ts";
import { unitContext } from "../lib/unit-context.ts";
let db: PGlite;
let handle: typeof import("../lib/action-handlers/unit-users.ts").handleUnitUserAction;
const originalFetch=neonConfig.fetchFunction;
const hooks=registerHooks({
 resolve(specifier,context,next) {
   if (specifier==="next/server") return {url:"mappa-test:next-server",shortCircuit:true};
   if(specifier.startsWith("@/")) return next(new URL(`../${specifier.slice(2)}.ts`,import.meta.url).href,context);
   if((specifier.startsWith("./")||specifier.startsWith("../")) && context.parentURL && !/\.[cm]?[jt]sx?$/.test(specifier)) {
     const url=new URL(`${specifier}.ts`,context.parentURL);
     if(url.protocol==="file:" && existsSync(url)) return next(url.href,context);
   }
   return next(specifier,context);
 },
 load(url,context,next) {
   if(url==="mappa-test:next-server") return {format:"module",shortCircuit:true,source:`export class NextResponse { static json(value,init){return Response.json(value,init)} } export function after(callback){ /* Delivery is deferred; SQL notices are tested before commit. */ }`};
   return next(url,context);
 }
});
before(async()=>{
 db=await createUnitFixture();
 process.env.DATABASE_URL="postgresql://fixture:fixture@localhost/fixture";
 neonConfig.fetchFunction=async(_input: RequestInfo | URL,init?: RequestInit)=>{
   const payload=JSON.parse(String(init?.body));
   const execute=async(tx: {query: PGlite["query"]},query: {query:string;params:unknown[]})=>{
     const value=await tx.query(query.query,query.params);
     return {fields:value.fields,rows:value.rows.map(row=>value.fields.map(field=>{
       const item=(row as Record<string,unknown>)[field.name];
       return item===null ? null : item instanceof Date ? item.toISOString() : typeof item==="object" ? JSON.stringify(item) : String(item);
     })),rowCount:value.affectedRows || value.rows.length,command:"SELECT"};
   };
   if (payload.queries) {
     const results=await db.transaction(async tx=>{const values=[];for(const query of payload.queries)values.push(await execute(tx,query));return values;});
     return Response.json({results});
   }
   return Response.json(await execute(db,payload));
 };
 handle=(await import("../lib/action-handlers/unit-users.ts")).handleUnitUserAction;
});
after(async()=>{neonConfig.fetchFunction=originalFetch;hooks.deregister();await db.close();});
async function save(body: Record<string,unknown>,actor=god,unitId=URUGUAI_ID,permissions?: string[]) {
 if (!permissions) permissions=(await db.query<{permissions:string[]}>(`SELECT r.permissions FROM users u LEFT JOIN unit_memberships m ON m.user_id=u.id AND m.unit_id=$2 JOIN roles r ON r.id=COALESCE(m.role_id,u.role_id) WHERE u.id=$1`,[actor,unitId])).rows[0].permissions;
 return unitContext.run({unitId,unitCode:unitId===URUGUAI_ID ? "uruguai":"cabula",unitName:"Unidade",actorId:actor,isGod:actor===god},()=>handle(String(body.action || "user.save"),body,{id:actor,is_god:actor===god},permissions as never));
}
async function role(unit: string,name="Usuário") {return (await db.query<{id:string}>("SELECT id FROM roles WHERE unit_id=$1 AND name=$2",[unit,name])).rows[0].id;}

test("cadastro usa a unidade aberta como padrão e mantém conta única com vínculo local",async()=>{
 const response=await save({name:"Novo Cabula",username:"novo.cabula",password:"SenhaTeste123!",roleId:await role(CABULA_ID)},god,CABULA_ID);
 assert.equal(response?.status,200);
 const rows=await db.query<{primary_unit_id:string;unit_id:string}>("SELECT u.primary_unit_id,m.unit_id FROM users u JOIN unit_memberships m ON m.user_id=u.id WHERE username='novo.cabula'");
 assert.equal(rows.rows.length,1);assert.equal(rows.rows[0].primary_unit_id,CABULA_ID);assert.equal(rows.rows[0].unit_id,CABULA_ID);
});

test("gestor local não cadastra em outra unidade nem promove para GOD",async()=>{
 const foreign=await save({name:"Inválido",username:"invalido",password:"SenhaTeste123!",primaryUnitId:CABULA_ID,roleId:await role(CABULA_ID)},manager);
 assert.equal(foreign?.status,403);
 const elevated=await save({name:"Inválido",username:"invalido",password:"SenhaTeste123!",roleId:await role(URUGUAI_ID,"God")},manager);
 assert.equal(elevated?.status,403);
 assert.equal((await db.query("SELECT * FROM users WHERE username='invalido'")).rows.length,0);
});

test("GOD transfere conta existente sem trocar a senha nem mover suas reservas",async()=>{
 const response=await save({id:person,name:"Pessoa",username:"pessoa",roleId:await role(CABULA_ID),primaryUnitId:CABULA_ID,expectedPrimaryUnitId:URUGUAI_ID,active:true});
 assert.equal(response?.status,200);
 const user=(await db.query<{primary_unit_id:string;password_hash:string}>("SELECT primary_unit_id,password_hash FROM users WHERE id=$1",[person])).rows[0];
 assert.equal(user.primary_unit_id,CABULA_ID);assert.equal(user.password_hash,"hash");
 assert.equal((await db.query<{unit_id:string}>("SELECT unit_id FROM reservations WHERE user_id=$1",[person])).rows[0].unit_id,URUGUAI_ID);
 assert.equal((await db.query<{active:boolean}>("SELECT active FROM unit_memberships WHERE user_id=$1 AND unit_id=$2",[person,URUGUAI_ID])).rows[0].active,false);
 assert.equal((await db.query("SELECT * FROM unit_handovers WHERE user_id=$1",[person])).rows.length,1);
});

test("retirada local preserva identidade e não bloqueia outras unidades",async()=>{
 const response=await save({action:"user.delete",id:person},god,CABULA_ID);
 assert.equal(response?.status,200);
 const user=(await db.query<{active:boolean;deleted_at:string|null}>("SELECT active,deleted_at FROM users WHERE id=$1",[person])).rows[0];
 assert.equal(user.active,true);assert.equal(user.deleted_at,null);
 assert.equal((await db.query<{active:boolean}>("SELECT active FROM unit_memberships WHERE user_id=$1 AND unit_id=$2",[person,CABULA_ID])).rows[0].active,false);
});

test("alteração concorrente de unidade e edição do GOD proprietário por outro usuário são bloqueadas",async()=>{
 const changed=await save({id:person,name:"Pessoa",username:"pessoa",roleId:await role(SAO_BENTO_ID),primaryUnitId:SAO_BENTO_ID,expectedPrimaryUnitId:URUGUAI_ID});assert.equal(changed?.status,409);
 const protectedAccount=await save({id:god,name:"Outro nome",username:"god",roleId:await role(URUGUAI_ID,"God")},manager);assert.equal(protectedAccount?.status,403);
});

test("gestor habilitado cria usuário local e perfil de outra unidade é recusado",async()=>{
 const created=await save({name:"Local",username:"local",password:"SenhaTeste123!",roleId:await role(URUGUAI_ID)},manager);
 assert.equal(created?.status,200);
 const foreignRole=await save({name:"Outra",username:"outra",password:"SenhaTeste123!",primaryUnitId:CABULA_ID,roleId:await role(URUGUAI_ID)});assert.equal(foreignRole?.status,400);
});

test("GOD desativa globalmente uma conta sem apagar o histórico",async()=>{
 const changed=await save({id:person,name:"Pessoa",username:"pessoa",roleId:await role(CABULA_ID),primaryUnitId:CABULA_ID,active:true,globalActive:false});assert.equal(changed?.status,200);
 assert.equal((await db.query<{active:boolean}>("SELECT active FROM users WHERE id=$1",[person])).rows[0].active,false);
 assert.equal((await db.query("SELECT * FROM unit_memberships WHERE user_id=$1 AND active",[person])).rows.length,0);
 assert.equal((await db.query("SELECT * FROM reservations WHERE user_id=$1",[person])).rows.length,1);
});

async function multiUser() {
 const result=await db.query<{id:string}>(`INSERT INTO users(name,username,password_hash,role_id,primary_unit_id)
   SELECT 'Conta multiunidade','multi.'||gen_random_uuid()::text,'senha-preservada',id,$1 FROM roles WHERE unit_id=$1 AND name='Usuário' RETURNING id`,[URUGUAI_ID]);
 const id=result.rows[0].id;
 await db.query(`INSERT INTO unit_memberships(user_id,unit_id,role_id) VALUES($1,$2,$3)`,[id,URUGUAI_ID,await role(URUGUAI_ID)]);
 return (await db.query<{id:string;name:string;username:string}>("SELECT id,name,username FROM users WHERE id=$1",[id])).rows[0];
}
async function activeUnits(id: string) {return (await db.query<{unit_id:string}>("SELECT unit_id FROM unit_memberships WHERE user_id=$1 AND active ORDER BY unit_id",[id])).rows.map(m=>m.unit_id);}

test("GOD seleciona as três unidades com perfis independentes sem transferir identidade",async()=>{
 const user=await multiUser();
 const accesses=[{unitId:URUGUAI_ID,roleId:await role(URUGUAI_ID)},{unitId:CABULA_ID,roleId:await role(CABULA_ID,"Gestão")},{unitId:SAO_BENTO_ID,roleId:await role(SAO_BENTO_ID,"ADM")}];
 const response=await save({...user,primaryUnitId:URUGUAI_ID,roleId:await role(URUGUAI_ID),unitAccesses:accesses});
 assert.equal(response?.status,200);assert.deepEqual(await activeUnits(user.id),[URUGUAI_ID,CABULA_ID,SAO_BENTO_ID]);
 const memberships=(await db.query<{unit_id:string;role_id:string}>("SELECT unit_id,role_id FROM unit_memberships WHERE user_id=$1",[user.id])).rows;
 for(const access of accesses) assert.equal(memberships.find(m=>m.unit_id===access.unitId)?.role_id,access.roleId);
 const identity=(await db.query<{primary_unit_id:string;password_hash:string;is_god:boolean}>("SELECT * FROM users WHERE id=$1",[user.id])).rows[0];
 assert.equal(identity.primary_unit_id,URUGUAI_ID);assert.equal(identity.password_hash,'senha-preservada');assert.equal(identity.is_god,false);
 assert.equal((await db.query("SELECT * FROM unit_handovers WHERE user_id=$1",[user.id])).rows.length,0);
});

test("trocar principal mantém unidades selecionadas; desmarcar revoga apenas a unidade e encaminha responsabilidades",async()=>{
 const user=await multiUser();
 const cabulaRole=await role(CABULA_ID,"Gestão"),uruguaiRole=await role(URUGUAI_ID);
 const all=[{unitId:URUGUAI_ID,roleId:uruguaiRole},{unitId:CABULA_ID,roleId:cabulaRole}];
 assert.equal((await save({...user,primaryUnitId:CABULA_ID,roleId:cabulaRole,unitAccesses:all}))?.status,200);
 assert.deepEqual(await activeUnits(user.id),[URUGUAI_ID,CABULA_ID]);
 const room=(await db.query<{id:string}>("INSERT INTO rooms(name,unit_id) VALUES('Sala teste Cabula',$1) RETURNING id",[CABULA_ID])).rows[0].id;
 await db.transaction(async tx=>{
   await tx.query("SELECT set_config('mappa.unit_id',$1,true)",[CABULA_ID]);
   await tx.query("INSERT INTO room_review_responsibilities(room_id,user_id,assigned_by,unit_id) VALUES($1,$2,$3,$4)",[room,user.id,god,CABULA_ID]);
   await tx.query("INSERT INTO reservations(room_id,user_id,reason,starts_at,ends_at,created_by,unit_id) VALUES($1,$2,'Teste','2099-10-05T12:00Z','2099-10-05T13:00Z',$3,$4)",[room,user.id,god,CABULA_ID]);
 });
 const remove={...user,primaryUnitId:URUGUAI_ID,roleId:uruguaiRole,unitAccesses:[all[0]]};
 assert.equal((await save(remove))?.status,200);assert.deepEqual(await activeUnits(user.id),[URUGUAI_ID]);
 assert.equal((await db.query("SELECT * FROM reservations WHERE user_id=$1 AND unit_id=$2",[user.id,CABULA_ID])).rows.length,1);
 assert.equal((await db.query("SELECT * FROM room_review_responsibilities WHERE user_id=$1",[user.id])).rows.length,0);
 assert.equal((await db.query("SELECT * FROM unit_handovers WHERE user_id=$1 AND unit_id=$2",[user.id,CABULA_ID])).rows.length,1);
 assert.equal((await save(remove))?.status,200);
 assert.equal((await db.query("SELECT * FROM unit_handovers WHERE user_id=$1",[user.id])).rows.length,1);
 await db.transaction(async tx=>{
   await tx.exec("SET LOCAL ROLE mappa_runtime");await tx.query("SELECT set_config('mappa.unit_id',$1,true),set_config('mappa.actor_id',$2,true)",[CABULA_ID,user.id]);
   assert.equal((await tx.query("SELECT * FROM rooms")).rows.length,0);
 });
});

test("seleção exige unidades únicas e perfil pertencente a cada unidade, sem GOD adicional",async()=>{
 const user=await multiUser(),base={...user,primaryUnitId:URUGUAI_ID,roleId:await role(URUGUAI_ID)};
 const primary={unitId:URUGUAI_ID,roleId:base.roleId};
 for(const unitAccesses of [[{unitId:URUGUAI_ID,roleId:await role(URUGUAI_ID,"Gestão")}],[primary,primary],[primary,{unitId:CABULA_ID,roleId:base.roleId}],[primary,{unitId:CABULA_ID,roleId:await role(CABULA_ID,"God")}],[primary,{unitId:'inválido',roleId:base.roleId}]]) {
   assert.equal((await save({...base,unitAccesses}))?.status,400);
   assert.deepEqual(await activeUnits(user.id),[URUGUAI_ID]);
 }
 assert.equal((await save({...base,unitAccesses:[primary]},manager))?.status,403);
});

test("gestor de unidade adicional edita apenas o perfil local e não troca unidade principal nem dados globais",async()=>{
 const user=await multiUser(),primaryRole=await role(URUGUAI_ID),localRole=await role(CABULA_ID);
 await db.query("INSERT INTO unit_memberships(user_id,unit_id,role_id) VALUES($1,$2,$3),($4,$2,$5) ON CONFLICT(user_id,unit_id) DO UPDATE SET active=true",[user.id,CABULA_ID,localRole,manager,await role(CABULA_ID,"Gestão")]);
 const base={...user,primaryUnitId:URUGUAI_ID,roleId:localRole};
 assert.equal((await save(base,manager,CABULA_ID))?.status,200);
 const actual=(await db.query<{primary_unit_id:string;role_id:string}>("SELECT primary_unit_id,role_id FROM users WHERE id=$1",[user.id])).rows[0];
 assert.equal(actual.primary_unit_id,URUGUAI_ID);assert.equal(actual.role_id,primaryRole);
 assert.equal((await save({...base,primaryUnitId:CABULA_ID},manager,CABULA_ID))?.status,403);
 assert.equal((await save({...base,name:'Nome global alterado'},manager,CABULA_ID))?.status,403);
 assert.equal((await save({...base,active:false},manager,CABULA_ID))?.status,200);
 assert.deepEqual(await activeUnits(user.id),[URUGUAI_ID]);
});

test("formulário antigo não sobrescreve concessões recentes de acesso",async()=>{
 const user=await multiUser(),primary={unitId:URUGUAI_ID,roleId:await role(URUGUAI_ID)};
 const version=(await db.query<{version:string}>("SELECT updated_at::text version FROM users WHERE id=$1",[user.id])).rows[0].version;
 const base={...user,primaryUnitId:URUGUAI_ID,roleId:primary.roleId,expectedAccessVersion:version};
 assert.equal((await save({...base,unitAccesses:[primary,{unitId:CABULA_ID,roleId:await role(CABULA_ID)}]}))?.status,200);
 assert.equal((await save({...base,unitAccesses:[primary]}))?.status,409);
 assert.deepEqual(await activeUnits(user.id),[URUGUAI_ID,CABULA_ID]);
});

test("desativação global encerra os acessos múltiplos selecionados preservando a conta",async()=>{
 const user=await multiUser(),unitAccesses=[{unitId:URUGUAI_ID,roleId:await role(URUGUAI_ID)},{unitId:CABULA_ID,roleId:await role(CABULA_ID)}];
 const base={...user,primaryUnitId:URUGUAI_ID,roleId:unitAccesses[0].roleId,unitAccesses};
 assert.equal((await save(base))?.status,200);
 assert.equal((await save({...base,globalActive:false}))?.status,200);
 assert.deepEqual(await activeUnits(user.id),[]);
 assert.equal((await db.query<{active:boolean}>("SELECT active FROM users WHERE id=$1",[user.id])).rows[0].active,false);
});


test("edição preserva unidade principal sem acesso e permite retirar todos os acessos sem apagar conta",async()=>{
 const user=await multiUser(),base={...user,primaryUnitId:URUGUAI_ID,roleId:await role(URUGUAI_ID)};
 assert.equal((await save({...base,unitAccesses:[{unitId:CABULA_ID,roleId:await role(CABULA_ID)}]}))?.status,200);
 assert.deepEqual(await activeUnits(user.id),[CABULA_ID]);
 assert.equal((await save({...base,unitAccesses:[]}))?.status,200);assert.deepEqual(await activeUnits(user.id),[]);
 assert.equal((await db.query<{active:boolean}>("SELECT active FROM users WHERE id=$1",[user.id])).rows[0].active,true);
});

test("consulta real do cadastro retorna vínculos e versão somente na administração autorizada",async()=>{
 const user=await multiUser(),source=readFileSync(new URL('../app/api/state/route.ts',import.meta.url),'utf8');
 const query=source.match(/`(SELECT u.updated_at::text access_version[\s\S]*?ORDER BY u.name)`/)![1];
 await db.transaction(async tx=>{
   await tx.exec("SET LOCAL ROLE mappa_runtime");await tx.query("SELECT set_config('mappa.unit_id',$1,true),set_config('mappa.actor_id',$2,true)",[URUGUAI_ID,god]);
   const godRows=(await tx.query<{id:string;access_version:string;unit_accesses:{unitId:string;roleId:string;active:boolean}[]}>(query,[false,true])).rows;
   const row=godRows.find(row=>row.id===user.id)!;assert.ok(row.access_version);assert.equal(row.unit_accesses[0].unitId,URUGUAI_ID);assert.equal(row.unit_accesses[0].active,true);
   const managerRows=(await tx.query<{id:string;unit_accesses:null}>(query,[false,false])).rows;
   assert.equal(managerRows.find(row=>row.id===user.id)!.unit_accesses,null);
 });
});


test("gestor pode retirar acesso secundário sem alterar a unidade principal",async()=>{
 const user=await multiUser();
 await db.query("INSERT INTO unit_memberships(user_id,unit_id,role_id) VALUES($1,$2,$3)",[user.id,CABULA_ID,await role(CABULA_ID)]);
 assert.equal((await save({action:"user.delete",id:user.id},manager,CABULA_ID))?.status,403);
 await db.query(`UPDATE roles SET permissions=permissions || '["user.delete"]'::jsonb WHERE unit_id=$1 AND name='Gestão'`,[CABULA_ID]);
 assert.equal((await save({action:"user.delete",id:user.id},manager,CABULA_ID))?.status,200);
 assert.deepEqual(await activeUnits(user.id),[URUGUAI_ID]);
});
