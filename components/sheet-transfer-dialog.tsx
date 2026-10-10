"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { bahiaDateKey } from "@/lib/calendar-utils";
import { changeSheetEntryStart, sheetTime, type SheetTransfer, type SheetClipboard } from "@/lib/spreadsheet-bookings";
import type { Room } from "@/lib/types";

export function SheetTransferDialog({ transfer, clipboard, rooms, ownCopies, onConfirm, onClose }: {
  transfer: SheetTransfer; clipboard: SheetClipboard; rooms: Room[]; ownCopies: boolean;
  onConfirm: (transfer: SheetTransfer) => Promise<void>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [entries, setEntries] = useState(transfer.entries);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflicts, setConflicts] = useState(0);
  const [replace, setReplace] = useState(false);
  const submitting = useRef(false);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  async function submit() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try { await onConfirm({ mode: transfer.mode, entries, confirmReplacement: conflicts > 0 && replace }); }
    catch (reason) {
      const details = reason as { code?: string; payload?: { conflictCount?: number }; message?: string };
      if (details.code === "RESERVATION_REPLACEMENT_CONFIRMATION_REQUIRED") {
        setConflicts(Number(details.payload?.conflictCount) || 1);
        setReplace(false);
      }
      setError(reason instanceof Error ? reason.message : "Não foi possível aplicar a seleção.");
    } finally { submitting.current = false; setBusy(false); }
  }

  return (
    <dialog ref={dialog} className="modal sheet-transfer-dialog" aria-labelledby="sheet-transfer-title"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <div className="modal-head">
        <div>
          <h2 id="sheet-transfer-title">{transfer.mode === "move" ? "Mover" : "Copiar"} agendamentos</h2>
          <p>Confira {entries.length} agendamento(s) antes de confirmar.</p>
        </div>
        <button type="button" className="icon-btn" aria-label="Fechar prévia" disabled={busy} onClick={onClose}><X size={19} /></button>
      </div>
      <form className="modal-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <p>Os horários foram deslocados conforme o turno de destino. A duração original será mantida. Você pode ajustar o início abaixo.</p>
        {ownCopies && transfer.mode === "copy" && <p>As cópias serão agendadas em seu nome, conforme sua permissão.</p>}
        <div className="sheet-transfer-list">
          {entries.map((entry, index) => {
            const source = clipboard.items.find((item) => item.reservation.id === entry.reservationId)?.reservation;
            const update = (next: typeof entry) => {
              setEntries((current) => current.map((value, position) => position === index ? next : value));
              setConflicts(0); setReplace(false); setError("");
            };
            return (
              <fieldset key={entry.reservationId} disabled={busy}>
                <legend>{source?.reason || entry.expectedReason} · {source?.userName}</legend>
                <p>Origem: {rooms.find((room) => room.id === entry.expectedRoomId)?.name || "Sala original"}, {bahiaDateKey(entry.expectedStartsAt).split("-").reverse().join("/")} das {sheetTime(entry.expectedStartsAt)} às {sheetTime(entry.expectedEndsAt)}.</p>
                <div className="form-grid">
                  <label>Sala de destino<select value={entry.roomId} onChange={(event) => update({ ...entry, roomId: event.target.value })}>
                    {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
                  </select></label>
                  <label>Data de início<input type="date" required value={bahiaDateKey(entry.startsAt)} onChange={(event) => update(changeSheetEntryStart(entry, event.target.value, sheetTime(entry.startsAt)))} /></label>
                  <label>Horário de início<input type="time" required value={sheetTime(entry.startsAt)} onChange={(event) => update(changeSheetEntryStart(entry, bahiaDateKey(entry.startsAt), event.target.value))} /></label>
                  <label>Término<output>{bahiaDateKey(entry.endsAt).split("-").reverse().join("/")} às {sheetTime(entry.endsAt)}</output></label>
                </div>
              </fieldset>
            );
          })}
        </div>
        {error && <p role="alert" className="sheet-error">{error}</p>}
        {conflicts > 0 && <label className="sheet-replacement-confirmation"><input type="checkbox" checked={replace} disabled={busy} onChange={(event) => setReplace(event.target.checked)} />Confirmo substituir {conflicts} reserva(s) existente(s) no destino.</label>}
        <div className="modal-actions">
          <button type="button" className="btn btn-soft" disabled={busy} onClick={onClose}>Voltar</button>
          <button type="submit" className="btn btn-primary" disabled={busy || (conflicts > 0 && !replace)}>{busy ? "Aplicando..." : transfer.mode === "move" ? "Confirmar movimentação" : "Confirmar cópia"}</button>
        </div>
      </form>
    </dialog>
  );
}
