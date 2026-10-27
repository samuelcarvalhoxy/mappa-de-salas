import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { rawSql } from "@/lib/db";
import { unitContext } from "@/lib/unit-context";
import { canManagePermissionChanges } from "@/lib/permission-policy";
import { SECURITY_FIELDS } from "@/lib/security-options";
import type { Permission } from "@/lib/types";
import { HANDOVER_SQL } from "@/lib/unit-users-sql";
import { pushToUsers } from "@/lib/push";
import { after } from "next/server";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (error: string,status=400) => NextResponse.json({error},{status});
export async function handleUnitUserAction(action: string,body: Record<string,unknown>,actor: Record<string,unknown>,permissions: Permission[]) {
  if (action !== "user.save" && action !== "user.delete") return null;
  const scope = unitContext.getStore()!;
  const god = Boolean(actor.is_god);
  if (!god && !permissions.includes(action === "user.save" ? "user.manage" : "user.delete")) return fail("Sem permissão para administrar este acesso.",403);
  const db=rawSql();
  const managesUnits=action==="user.save" && body.unitAccesses!==undefined;
  if (managesUnits && !god) return fail("Somente um GOD pode alterar os acessos às unidades.",403);
  const id=body.id ? String(body.id) : randomUUID();
  if (!uuid.test(id)) return fail("Usuário inválido.");
  const existingRows=body.id ? await db.query(`SELECT u.*,u.updated_at::text expected_updated_at,r.permissions role_permissions,(SELECT count(*)::int FROM unit_memberships m WHERE m.user_id=u.id AND m.active) membership_count FROM users u JOIN roles r ON r.id=COALESCE((SELECT role_id FROM unit_memberships m WHERE m.user_id=u.id AND m.unit_id=$2),u.role_id) WHERE u.id=$1 AND u.deleted_at IS NULL`,[id,scope.unitId]) : [];
  const existing=existingRows[0];
  if (body.id && !existing) return fail("Usuário não encontrado.",404);
  if (existing?.is_owner_god && String(actor.id)!==id) return fail("O GOD proprietário é protegido.",403);
  if (existing?.is_god && !god) return fail("Somente um GOD pode alterar outro GOD.",403);
  if (existing && !god) {
    const membership=await db.query(`SELECT 1 FROM unit_memberships WHERE user_id=$1 AND unit_id=$2`,[id,scope.unitId]);
    if (!membership.length) return fail("Usuário não pertence a esta unidade.",403);
  }
  if (action === "user.delete" && existing?.is_god) return fail("Contas GOD devem ser administradas pelo GOD proprietário; não podem ser removidas pela unidade.",403);
  if (action === "user.delete" && id===String(actor.id)) return fail("Você não pode remover o próprio acesso.",403);
  const destination=action === "user.delete" ? scope.unitId : String(body.primaryUnitId || existing?.primary_unit_id || scope.unitId);
  if (!uuid.test(destination) || (!god && action==="user.save" && destination!==String(existing?.primary_unit_id || scope.unitId))) return fail("Você não pode atribuir esta unidade.",403);
  const roleUnit=god ? destination : scope.unitId;
  const unitRows=await db.query(`SELECT * FROM units WHERE id=$1 AND active`,[destination]);
  if (!unitRows.length) return fail("Unidade inválida.");
  if (action==="user.save" && !uuid.test(String(body.roleId || ""))) return fail("Selecione um perfil válido.");
  const roles=action === "user.save" ? await db.query(`SELECT * FROM roles WHERE id=$1 AND unit_id=$2`,[String(body.roleId || ""),roleUnit]) : [];
  const role=roles[0];
  if (action === "user.save" && !role) return fail("Selecione um perfil da unidade escolhida.");
  if (role?.name === "God" && !god) return fail("Somente um GOD pode promover outro GOD.",403);
  if (existing?.is_owner_god && role?.name!=="God") return fail("O GOD proprietário não pode perder seu acesso.",403);
  if (role && !canManagePermissionChanges({actorPermissions:permissions,actorIsGod:god,currentPermissions:(existing?.role_permissions || []) as Permission[],nextPermissions:role.permissions as Permission[]})) return fail("Você só pode atribuir permissões que possui.",403);
  const name=String(body.name || "").trim(),username=String(body.username || "").trim().toLowerCase(),password=String(body.password || "");
  if (action==="user.save" && (name.length<2 || username.length<2 || username.length>60 || (!existing && password.length<8) || (password && password.length<8))) return fail("Revise nome, usuário e senha de pelo menos 8 caracteres.");
  if (action==="user.save" && existing && !god && Number(existing.membership_count)>1 && (name!==existing.name || username!==existing.username || password)) return fail("Somente um GOD pode alterar os dados globais de uma conta com várias unidades.",403);
  const answers=Array.isArray(body.securityAnswers) ? body.securityAnswers.filter((a: {answer?: string})=>a.answer) as {question:string;answer:string}[] : [];
  if (existing && answers.length) return fail("Use a ação específica para redefinir a recuperação de acesso.");
  if (answers.length && (answers.length!==SECURITY_FIELDS.length || answers.some((a,i)=>a.question!==SECURITY_FIELDS[i].question || !(SECURITY_FIELDS[i].options as readonly string[]).includes(a.answer)))) return fail("Selecione respostas de segurança válidas.");
  const hashes=await Promise.all(answers.map(async a=>({question:a.question,hash:await bcrypt.hash(a.answer.trim().toLocaleLowerCase("pt-BR"),12)})));
  const passwordHash=password ? await bcrypt.hash(password,12) : "";
  const oldUnit=String(existing?.primary_unit_id || destination);
  if (existing && body.expectedPrimaryUnitId && body.expectedPrimaryUnitId!==oldUnit) return fail("O cadastro mudou. Atualize antes de salvar.",409);
  if (existing && body.expectedAccessVersion && body.expectedAccessVersion!==existing.expected_updated_at) return fail("Os acessos deste usuário mudaram. Atualize antes de salvar.",409);
  const willBeGod=action==="user.save" && role.name==="God";
  const accesses: {unitId:string;roleId:string}[]=[];
  if (managesUnits && !willBeGod) {
    if (!Array.isArray(body.unitAccesses) || body.unitAccesses.length>100) return fail("Revise a seleção de unidades.");
    for (const value of body.unitAccesses) {
      if (!value || typeof value!=="object" || !uuid.test(String(value.unitId || "")) || !uuid.test(String(value.roleId || "")) || accesses.some(a=>a.unitId===value.unitId)) return fail("Revise a seleção de unidades e perfis.");
      accesses.push({unitId:String(value.unitId),roleId:String(value.roleId)});
    }
    if (accesses.some(a=>a.unitId===destination && a.roleId!==role.id)) return fail("O perfil da unidade principal deve corresponder ao perfil informado.");
    const validRoles=await db.query(`SELECT r.id,r.unit_id FROM roles r JOIN units u ON u.id=r.unit_id WHERE u.active AND r.name<>'God' AND r.id=ANY($1::uuid[])`,[accesses.map(a=>a.roleId)]);
    if (accesses.some(a=>!validRoles.some(r=>r.id===a.roleId && r.unit_id===a.unitId))) return fail("Selecione um perfil válido para cada unidade.");
  }
  const memberships=existing ? await db.query(`SELECT unit_id,role_id,active FROM unit_memberships WHERE user_id=$1`,[id]) : [];
  const enabled=body.active!==false;
  const losingAccess=Boolean(existing && !existing.is_god && (action==="user.delete" || (god && destination!==oldUnit) || !enabled));
  const globallyDisabled=existing && ((god && body.globalActive===false && !existing.is_owner_god) || (willBeGod && !enabled && !existing.is_owner_god));
  const retainedUnits=managesUnits ? accesses.map(a=>a.unitId) : [destination];
  const oldUnits=(existing?.is_god && (!willBeGod || globallyDisabled))
    ? await db.query(`SELECT id FROM units WHERE ($2::boolean OR NOT(id=ANY($1::uuid[])))`,[retainedUnits,Boolean(globallyDisabled)])
    : globallyDisabled ? memberships.filter(m=>m.active).map(m=>({id:m.unit_id}))
    : managesUnits && !willBeGod ? memberships.filter(m=>m.active && !retainedUnits.includes(String(m.unit_id))).map(m=>({id:m.unit_id}))
    : losingAccess ? [{id:action==="user.delete" || !god ? scope.unitId : oldUnit}] : [];
  const queries=[db.query(`SELECT id FROM users WHERE id=$1 FOR UPDATE`,[id]),
    db.query(`SELECT mappa_assert(EXISTS(SELECT 1 FROM users WHERE id=$1 AND active AND deleted_at IS NULL AND (is_god OR EXISTS(SELECT 1 FROM unit_memberships m JOIN roles r ON r.id=m.role_id WHERE m.user_id=$1 AND m.unit_id=$2 AND m.active AND r.permissions ? $3))),'ACTOR_ACCESS_CHANGED')`,[actor.id,scope.unitId,action==="user.save" ? "user.manage" : "user.delete"])];
  if (god) queries.push(db.query(`SELECT mappa_assert(EXISTS(SELECT 1 FROM users WHERE id=$1 AND is_god AND active AND deleted_at IS NULL),'ACTOR_ACCESS_CHANGED')`,[actor.id]));
  else queries.push(db.query(`SELECT mappa_assert(EXISTS(SELECT 1 FROM unit_memberships m JOIN roles r ON r.id=m.role_id WHERE m.user_id=$1 AND m.unit_id=$2 AND m.active AND r.permissions=$3::jsonb),'PERMISSIONS_CHANGED')`,[actor.id,scope.unitId,JSON.stringify(permissions)]));
  if (existing) queries.push(db.query(`SELECT mappa_assert(EXISTS(SELECT 1 FROM users WHERE id=$1 AND primary_unit_id=$2 AND updated_at=$3::timestamptz),'USER_CHANGED')`,[id,existing.primary_unit_id,existing.expected_updated_at]));
  if (action==="user.save") {
    if (!existing) queries.push(db.query(`INSERT INTO users(id,name,username,password_hash,role_id,primary_unit_id,security_answers,is_god) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,[id,name,username,passwordHash,role.id,destination,JSON.stringify(hashes),willBeGod]));
    else queries.push(db.query(`UPDATE users SET name=$2,username=$3,password_hash=CASE WHEN $4='' THEN password_hash ELSE $4 END,role_id=CASE WHEN $11::boolean THEN $5 ELSE role_id END,primary_unit_id=$6,is_god=$7,active=CASE WHEN $7 THEN $8 WHEN $9::boolean THEN $10::boolean ELSE active END,updated_at=now() WHERE id=$1`,[id,name,username,passwordHash,role.id,destination,willBeGod,existing.is_owner_god ? true : enabled,god && typeof body.globalActive==="boolean",body.globalActive!==false,god || destination===scope.unitId]));
    if (!willBeGod) {
      const selected=managesUnits ? accesses : [{unitId:roleUnit,roleId:String(role.id)}];
      for (const access of selected) queries.push(db.query(`INSERT INTO unit_memberships(user_id,unit_id,role_id,active) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,unit_id) DO UPDATE SET role_id=EXCLUDED.role_id,active=EXCLUDED.active,updated_at=now()`,[id,access.unitId,access.roleId,(managesUnits || enabled) && !globallyDisabled]));
    }
  }
  const handoverIndexes: number[]=[];
  for (const source of oldUnits) {
    queries.push(db.query("SELECT set_config('mappa.unit_id',$1,true),set_config('mappa.actor_id',$2,true)",[source.id,actor.id]));
    handoverIndexes.push(queries.length);
    queries.push(db.query(HANDOVER_SQL,[id,source.id,destination,actor.id]));
    queries.push(db.query(`UPDATE unit_memberships SET active=false,updated_at=now() WHERE user_id=$1 AND unit_id=$2`,[id,source.id]));
  }
  // Local removal never deletes an identity or reattributes historical reservations.
  if (action==="user.delete" && !losingAccess) queries.push(db.query(`UPDATE unit_memberships SET active=false,updated_at=now() WHERE user_id=$1 AND unit_id=$2`,[id,scope.unitId]));
  if (action==="user.delete") queries.push(db.query(`UPDATE users SET updated_at=now() WHERE id=$1`,[id]));
  queries.push(db.query(`INSERT INTO audit_log(unit_id,actor_id,action,details) VALUES($1,$2,$3,$4)`,[scope.unitId,actor.id,action,`${action==="user.delete" ? "Acesso local removido" : "Usuário salvo"}: ${existing?.username || username}; unidade de origem=${oldUnit}; destino=${destination}${managesUnits ? `; acessos=${willBeGod ? "GOD global" : JSON.stringify(accesses)}; removidos=${oldUnits.map(u=>u.id).join(",")}` : ""}`]));
  const result=await db.transaction(queries);
  for (const i of handoverIndexes) {
    const data=result[i][0];
    if (data?.recipients?.length) after(async()=>{await unitContext.run({...scope,unitId:String(data.unit_id),unitCode:String(data.unit_code),unitName:String(data.unit_name)},()=>pushToUsers(data.recipients,{title:`[${data.unit_name}] Pendências após transferência`,body:String(data.summary),url:`/?unit=${data.unit_code}&tab=users`,tag:`handover-${id}-${data.unit_code}`}));});
  }
  return NextResponse.json({ok:true,transferred:oldUnits.length>0});
}
