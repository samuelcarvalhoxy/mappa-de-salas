import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { UNIT_MIGRATION_SQL } from "../lib/unit-schema.ts";
import { REQUEST_EXPIRATION_SCHEMA } from "../lib/request-expiration-sql.ts";
import { ROOM_REVIEW_RESPONSIBILITY_SCHEMA } from "../lib/room-review-responsibilities.ts";
export const god="20000000-0000-4000-8000-000000000001",person="20000000-0000-4000-8000-000000000002",manager="20000000-0000-4000-8000-000000000003";
export const room="30000000-0000-4000-8000-000000000001";
export async function createUnitFixture() {
 const db=new PGlite();
 const source=readFileSync(new URL("../lib/db.ts",import.meta.url),"utf8");
 // Bootstrap from the actual legacy DDL, not a second copy of the production schema.
 for (const match of source.matchAll(/db\.query\(\s*`([\s\S]*?)`/g)) {
  const sql=match[1];
  if (/^(CREATE TABLE IF NOT EXISTS|CREATE INDEX IF NOT EXISTS|ALTER TABLE)/.test(sql) && !sql.includes("${")) await db.exec(sql);
 }
 await db.exec(ROOM_REVIEW_RESPONSIBILITY_SCHEMA.replaceAll("-- next",""));
 await db.exec(REQUEST_EXPIRATION_SCHEMA.replaceAll("-- next",""));
 await db.exec(`INSERT INTO roles(name,permissions,system) VALUES('God','["user.manage","booking.review"]',true),('Gestão','["user.manage","booking.review","booking.request"]',true),('ADM','["room.manage"]',true),('Usuário','["booking.request"]',true);
 INSERT INTO users(id,name,username,password_hash,role_id,is_god,is_owner_god) SELECT '${god}','God','god','hash',id,true,true FROM roles WHERE name='God';
 INSERT INTO users(id,name,username,password_hash,role_id) SELECT '${person}','Pessoa','pessoa','hash',id FROM roles WHERE name='Usuário';
 INSERT INTO users(id,name,username,password_hash,role_id) SELECT '${manager}','Gestor','gestor','hash',id FROM roles WHERE name='Gestão';
 INSERT INTO rooms(id,name) VALUES('${room}','Sala de Treinamento 01');
 INSERT INTO reservations(room_id,user_id,reason,starts_at,ends_at,created_by) VALUES('${room}','${person}','FI','2099-10-05T12:00Z','2099-10-05T13:00Z','${god}');`);
 await db.exec(UNIT_MIGRATION_SQL);
 return db;
}
