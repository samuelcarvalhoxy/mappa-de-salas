import assert from "node:assert/strict";
import { before,after,test } from "node:test";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
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
