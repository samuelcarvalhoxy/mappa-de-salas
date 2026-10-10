"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type HTMLAttributes, type KeyboardEvent } from "react";
import { captureSheetSelection, prepareSheetTransfer, sheetBounds, type SheetClipboard, type SheetPosition, type SheetSelection, type SheetTransfer } from "@/lib/spreadsheet-bookings";
import type { Reservation, Room } from "@/lib/types";
import type { MapShift } from "@/lib/map-shifts";

export function useSpreadsheetEditing({ rooms, dates, shifts, index, canCopy, canMove }: {
  rooms: Room[]; dates: string[]; index: Map<string, Reservation[]>;
  shifts: readonly MapShift[];
  canCopy: boolean; canMove: (reservation: Reservation) => boolean;
}) {
  const viewKey = `${dates[0]}:${rooms.map((room) => room.id).join(",")}:${shifts.map((shift) => shift.id).join(",")}`;
  const [storedSelection, setStoredSelection] = useState<(SheetSelection & { viewKey: string }) | null>(null);
  const selection = storedSelection?.viewKey === viewKey ? storedSelection : null;
  const [clipboard, setClipboard] = useState<SheetClipboard | null>(null);
  const [pending, setPending] = useState<{ transfer: SheetTransfer; clipboard: SheetClipboard } | null>(null);
  const [message, setMessage] = useState("");
  const selecting = useRef(false);
  const dragging = useRef<SheetClipboard | null>(null);
  const [dropTarget, setDropTarget] = useState<SheetPosition | null>(null);
  const touch = useRef(false);
  useEffect(() => {
    const release = () => { selecting.current = false; };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", release);
    return () => { window.removeEventListener("pointerup", release); window.removeEventListener("pointercancel", release); window.removeEventListener("blur", release); };
  }, []);

  function isSelected(position: SheetPosition) {
    if (!selection) return false;
    const bounds = sheetBounds(selection);
    return position.row >= bounds.top && position.row <= bounds.bottom && position.column >= bounds.left && position.column <= bounds.right;
  }
  function select(position: SheetPosition, extend = false) {
    setStoredSelection({ anchor: extend && selection ? selection.anchor : position, focus: position, viewKey });
  }
  function capture(mode: SheetClipboard["mode"], range = selection) {
    if (!range) throw new Error("Selecione uma célula ou um intervalo primeiro.");
    const snapshot = captureSheetSelection(range, rooms, dates, index, mode, shifts);
    if (mode === "move" && (!snapshot.items.length || snapshot.items.some((item) => !canMove(item.reservation))))
      throw new Error("Você só pode recortar reservas atuais ou futuras que tem permissão para editar.");
    return snapshot;
  }
  function copy(mode: SheetClipboard["mode"], event?: ClipboardEvent) {
    try {
      const snapshot = capture(mode);
      setClipboard(snapshot);
      if (event) { event.preventDefault(); event.clipboardData.setData("text/plain", snapshot.text); }
      else void navigator.clipboard?.writeText(snapshot.text).catch(() => { /* Internal clipboard remains available. */ });
      setMessage(mode === "move" ? `${snapshot.items.length} agendamento(s) recortado(s). A origem será alterada somente ao confirmar a colagem.` : `${snapshot.items.length} agendamento(s) copiado(s). Selecione o destino e cole.`);
    } catch (error) { event?.preventDefault(); setMessage(error instanceof Error ? error.message : "Não foi possível copiar."); }
  }
  function paste(snapshot = clipboard, target = selection?.focus) {
    try {
      if (!canCopy && snapshot?.mode === "copy") throw new Error("Seu perfil pode copiar o texto, mas não criar agendamentos diretamente.");
      if (!snapshot || !target) throw new Error("Copie ou recorte agendamentos e selecione uma célula de destino.");
      const transfer = prepareSheetTransfer(snapshot, target, rooms, dates, shifts);
      setPending({ transfer, clipboard: snapshot });
      setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Destino inválido."); }
  }
  function onClipboard(event: ClipboardEvent, mode: SheetClipboard["mode"] | "paste") {
    if (!(event.target instanceof HTMLElement) || !event.target.closest(".room-spreadsheet-scroll")) return;
    if (mode !== "paste") { copy(mode, event); return; }
    if (!selection) return;
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain").replace(/\r\n/g, "\n");
    if (!clipboard || text !== clipboard.text) { setMessage("Para criar agendamentos, copie ou recorte células desta planilha primeiro."); return; }
    paste();
  }
  function onKeyDown(event: KeyboardEvent) {
    if (!(event.target instanceof HTMLElement) || !event.target.closest(".room-spreadsheet-scroll")) return;
    if (event.key === "Escape") { setClipboard(null); setStoredSelection(null); setMessage(""); return; }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const cell = event.target.closest<HTMLElement>("[data-sheet-row]");
    if (!cell || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const row = Number(cell.dataset.sheetRow) + (event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0);
    const column = Number(cell.dataset.sheetColumn) + (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0);
    const next = { row: Math.max(0, Math.min(rooms.length * shifts.length - 1, row)), column: Math.max(0, Math.min(dates.length - 1, column)) };
    select(next, event.shiftKey);
    cell.closest(".room-spreadsheet-scroll")?.querySelector<HTMLElement>(`[data-sheet-row="${next.row}"][data-sheet-column="${next.column}"]`)?.focus();
  }
  function startDrag(event: DragEvent, position: SheetPosition) {
    try {
      selecting.current = false;
      const snapshot = capture("move", isSelected(position) && selection ? selection : { anchor: position, focus: position, viewKey });
      dragging.current = snapshot;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-mappa-sheet", "move");
      setMessage(`Arraste ${snapshot.items.length} agendamento(s) até uma célula de destino.`);
    } catch (error) { event.preventDefault(); setMessage(error instanceof Error ? error.message : "Não foi possível arrastar."); }
  }
  function endDrag() { dragging.current = null; setDropTarget(null); }

  function cellProps(position: SheetPosition): HTMLAttributes<HTMLTableCellElement> & { "data-sheet-row": number; "data-sheet-column": number } {
    const selected = isSelected(position);
    return {
      "data-sheet-row": position.row, "data-sheet-column": position.column,
      tabIndex: selection ? (selection.focus.row === position.row && selection.focus.column === position.column ? 0 : -1) : (position.row === 0 && position.column === 0 ? 0 : -1),
      "aria-selected": selected,
      onPointerDown: (event) => {
        touch.current = event.pointerType === "touch";
        if (event.button !== 0 || (event.target instanceof Element && event.target.closest("[data-sheet-action]"))) return;
        select(position, event.shiftKey);
        if (!touch.current) { event.preventDefault(); event.currentTarget.focus(); selecting.current = true; }
      },
      onPointerEnter: (event) => {
        if (selecting.current && event.buttons === 1) setStoredSelection((current) => current?.viewKey === viewKey ? { ...current, focus: position } : current);
      },
      onDragOver: (event) => { if (dragging.current) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTarget(position); } },
      onDrop: (event) => { if (dragging.current) { event.preventDefault(); paste(dragging.current, position); endDrag(); } },
    };
  }
  return { selection, clipboard, pending, message, setMessage, setPending, setClipboard,
    dropTarget, isSelected, cellProps, copy, paste, onClipboard, onKeyDown, startDrag, endDrag, touch };
}

export type SpreadsheetEditing = ReturnType<typeof useSpreadsheetEditing>;
