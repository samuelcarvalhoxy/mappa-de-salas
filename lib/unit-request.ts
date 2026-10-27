import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "./auth";
import { ensureDatabase, getUserWithRole, hasDatabase, rawSql } from "./db";
import { unitContext, type UnitContext } from "./unit-context";
import { URUGUAI_ID } from "./unit-schema";

export async function accessibleUnits(userId: string, isGod: boolean) {
  return rawSql().query(`SELECT u.id,u.code,u.name FROM units u WHERE u.active AND ($2::boolean OR EXISTS(SELECT 1 FROM unit_memberships m WHERE m.unit_id=u.id AND m.user_id=$1 AND m.active)) ORDER BY u.display_order`,[userId,isGod]);
}

export function withUnitRequest(handler: (request: NextRequest) => Promise<Response>, allowAnonymous = false) {
  return async (request: NextRequest) => {
    if (!hasDatabase() && allowAnonymous) return handler(request);
    try {
      await ensureDatabase();
      const actorId = await getSessionUserId();
      const actor = actorId ? await getUserWithRole(actorId) : null;
      if ((!actor || !actor.active) && !allowAnonymous) return NextResponse.json({error:"Faça login novamente."},{status:401});
      const allowed = actor?.active ? await accessibleUnits(String(actor.id),Boolean(actor.is_god)) : [];
      const desired = request.headers.get("x-mappa-unit") || request.nextUrl.searchParams.get("unit");
      const unit = actor?.active
        ? desired ? allowed.find(u=>u.id===desired || u.code===desired) : allowed.find(u=>u.id===actor.primary_unit_id) || allowed[0]
        : {id:URUGUAI_ID,code:"uruguai",name:"URUGUAI"};
      if (!unit) return NextResponse.json({error:"Você não tem acesso a esta unidade."},{status:403});
      const scope: UnitContext = {unitId:String(unit.id),unitCode:String(unit.code),unitName:String(unit.name),actorId:actor?.active ? String(actor.id) : "",isGod:Boolean(actor?.is_god)};
      return await unitContext.run(scope,()=>handler(request));
    } catch (error) {
      console.error("unit.request.failed",error instanceof Error ? error.message : "unknown");
      return NextResponse.json({error:"Não foi possível carregar a unidade. Tente novamente."},{status:500});
    }
  };
}
