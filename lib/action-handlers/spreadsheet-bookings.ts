import type { NeonQueryFunction } from "@neondatabase/serverless";
import { after, NextResponse } from "next/server";
import type { Permission } from "@/lib/types";
import { parseSheetTransfer } from "@/lib/spreadsheet-bookings";
import { SHEET_TRANSFER_LOCK_SQL, SHEET_TRANSFER_SQL } from "@/lib/spreadsheet-bookings-sql";
import { pushToUsers } from "@/lib/push";

export async function handleSpreadsheetBookingAction({ action, body, db, actor, requirePermission }: {
  action: string; body: Record<string, unknown>; db: NeonQueryFunction<false, false>;
  actor: Record<string, unknown>; requirePermission: (permission: Permission) => boolean;
}) {
  if (action !== "booking.sheet_transfer") return null;
  const canCopyAll = requirePermission("booking.create_all");
  const canCopyOwn = requirePermission("booking.create_own");
  const canMoveAll = requirePermission("booking.manage_all");
  if (body.mode === "copy" ? !canCopyAll && !canCopyOwn : !canMoveAll && !canCopyOwn)
    return NextResponse.json({ error: "Seu perfil não tem permissão para esta operação." }, { status: 403 });
  let transfer;
  try { transfer = parseSheetTransfer(body); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Seleção inválida." }, { status: 400 }); }
  const results = await db.transaction((tx) => [
    tx.query("SET LOCAL lock_timeout = '5s'"),
    tx.query(SHEET_TRANSFER_LOCK_SQL),
    tx.query(SHEET_TRANSFER_SQL, [JSON.stringify(transfer.entries),transfer.mode,actor.id,
      canCopyAll,canCopyOwn,canMoveAll,canCopyOwn,transfer.confirmReplacement]),
  ], { isolationLevel: "ReadCommitted" });
  const row = results[2][0];
  if (Number(row.invalid_count) || !row.unique_sources)
    return NextResponse.json({ error: "Uma reserva mudou, expirou ou não pode ser alterada pelo seu perfil. Atualize a planilha e copie novamente." }, { status: 409 });
  if (Number(row.internal_count))
    return NextResponse.json({ error: "Os agendamentos da seleção se sobrepõem no destino. Ajuste as salas ou os horários." }, { status: 409 });
  if (Number(row.conflict_count) && !transfer.confirmReplacement)
    return NextResponse.json({ error: "Há reservas no destino. Confira e confirme a substituição na prévia.",
      code: "RESERVATION_REPLACEMENT_CONFIRMATION_REQUIRED", conflictCount: Number(row.conflict_count) }, { status: 409 });
  if (Number(row.applied_count) !== transfer.entries.length)
    return NextResponse.json({ error: "Nenhuma alteração foi aplicada. Atualize a seleção." }, { status: 409 });
  const recipients = Array.isArray(row.user_ids) ? row.user_ids.map(String) : [];
  after(async () => { await pushToUsers(recipients, { title: "Agendamentos atualizados",
    body: "Confira na Agenda os agendamentos copiados, movidos ou substituídos pela planilha.", url: "/?tab=calendar", tag: "sheet-transfer" }); });
  return NextResponse.json({ ok: true, appliedCount: Number(row.applied_count) });
}
