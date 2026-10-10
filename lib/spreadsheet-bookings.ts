import type { Reservation, Room } from "./types.ts";
import { MAP_SHIFTS, mapShiftBounds, type MapShift } from "./map-shifts.ts";
import { bahiaDateKey, isSundayDate } from "./calendar-utils.ts";

export type SheetPosition = { row: number; column: number };
export type SheetSelection = { anchor: SheetPosition; focus: SheetPosition };
export type SheetClipboard = {
  mode: "copy" | "move";
  text: string;
  items: { reservation: Reservation; sourceDate: string; sourceShiftId: string; rowOffset: number; columnOffset: number }[];
  rows: number;
  columns: number;
};
export type SheetTransferEntry = {
  reservationId: string;
  expectedRoomId: string;
  expectedStartsAt: string;
  expectedEndsAt: string;
  expectedUserId: string;
  expectedReason: string;
  expectedShareable: boolean;
  expectedPeople: number;
  roomId: string;
  startsAt: string;
  endsAt: string;
};
export type SheetTransfer = { mode: "copy" | "move"; entries: SheetTransferEntry[]; confirmReplacement?: boolean };
export type SheetCancellationEntry = Omit<SheetTransferEntry, "roomId" | "startsAt" | "endsAt">;

export function sheetCancellationEntries(clipboard: SheetClipboard): SheetCancellationEntry[] {
  return clipboard.items.map(({ reservation }) => ({
    reservationId: reservation.id, expectedRoomId: reservation.roomId,
    expectedStartsAt: reservation.startsAt, expectedEndsAt: reservation.endsAt,
    expectedUserId: reservation.userId, expectedReason: reservation.reason,
    expectedShareable: reservation.shareable, expectedPeople: reservation.expectedPeople,
  }));
}

export function parseSheetCancellation(body: Record<string, unknown>): SheetCancellationEntry[] {
  if (body.confirmed !== true || !Array.isArray(body.entries) || !body.entries.length || body.entries.length > 1000)
    throw new Error("Confirme uma seleção de até 1.000 agendamentos para excluir.");
  const seen = new Set<string>();
  return body.entries.map((value: unknown) => {
    if (!value || typeof value !== "object") throw new Error("Seleção inválida.");
    const entry = value as SheetCancellationEntry;
    if (![entry.reservationId, entry.expectedRoomId, entry.expectedUserId].every((id) => typeof id === "string" && UUID.test(id)) || seen.has(entry.reservationId))
      throw new Error("A seleção contém identificadores inválidos ou repetidos.");
    seen.add(entry.reservationId);
    if (![entry.expectedStartsAt, entry.expectedEndsAt].every((stamp) => typeof stamp === "string" && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(stamp) && Number.isFinite(Date.parse(stamp))) ||
      typeof entry.expectedReason !== "string" || typeof entry.expectedShareable !== "boolean" || !Number.isInteger(entry.expectedPeople))
      throw new Error("A seleção mudou. Selecione as células novamente.");
    return entry;
  });
}

export function sheetBounds(selection: SheetSelection) {
  return {
    top: Math.min(selection.anchor.row, selection.focus.row),
    bottom: Math.max(selection.anchor.row, selection.focus.row),
    left: Math.min(selection.anchor.column, selection.focus.column),
    right: Math.max(selection.anchor.column, selection.focus.column),
  };
}

export function sheetCell(position: SheetPosition, rooms: Room[], dates: string[], shifts: readonly MapShift[] = MAP_SHIFTS) {
  if (position.row < 0 || position.column < 0 || !rooms.length) return null;
  const room = rooms[position.row % rooms.length];
  const shift = shifts[Math.floor(position.row / rooms.length)];
  const date = dates[position.column];
  return room && shift && date ? { room, shift, date } : null;
}

export function captureSheetSelection(
  selection: SheetSelection, rooms: Room[], dates: string[],
  index: Map<string, Reservation[]>, mode: SheetClipboard["mode"],
  shifts: readonly MapShift[] = MAP_SHIFTS,
): SheetClipboard {
  const bounds = sheetBounds(selection);
  const seen = new Set<string>();
  const items: SheetClipboard["items"] = [];
  const lines: string[] = [];
  for (let row = bounds.top; row <= bounds.bottom; row++) {
    const cells: string[] = [];
    for (let column = bounds.left; column <= bounds.right; column++) {
      const cell = sheetCell({ row, column }, rooms, dates, shifts);
      if (!cell) throw new Error("A seleção não está mais disponível. Selecione as células novamente.");
      const reservations = index.get(`${cell.room.id}:${cell.date}:${cell.shift.id}`) || [];
      cells.push(reservations.map((reservation) =>
        `${reservation.reason} · ${reservation.userName} · ${sheetTime(reservation.startsAt)} às ${sheetTime(reservation.endsAt)}`,
      ).join(" | ").replace(/[\t\r\n]+/g, " "));
      for (const reservation of reservations) {
        if (seen.has(reservation.id)) continue;
        seen.add(reservation.id);
        items.push({ reservation: { ...reservation }, sourceDate: cell.date, sourceShiftId: cell.shift.id,
          rowOffset: row - bounds.top, columnOffset: column - bounds.left });
      }
    }
    lines.push(cells.join("\t"));
  }
  return { mode, items, text: lines.join("\n"), rows: bounds.bottom - bounds.top + 1, columns: bounds.right - bounds.left + 1 };
}

export function prepareSheetTransfer(clipboard: SheetClipboard, target: SheetPosition, rooms: Room[], dates: string[], shifts: readonly MapShift[] = MAP_SHIFTS): SheetTransfer {
  if (!clipboard.items.length) throw new Error("A seleção não contém agendamentos.");
  if (clipboard.items.length > 100) throw new Error("Selecione no máximo 100 agendamentos por operação.");
  if (!sheetCell({ row: target.row + clipboard.rows - 1, column: target.column + clipboard.columns - 1 }, rooms, dates, shifts))
    throw new Error("A seleção ultrapassa as salas ou os dias visíveis. Escolha outra célula de destino.");
  return { mode: clipboard.mode, entries: clipboard.items.map((item) => {
    const destination = sheetCell({ row: target.row + item.rowOffset, column: target.column + item.columnOffset }, rooms, dates, shifts);
    const sourceShift = MAP_SHIFTS.find((shift) => shift.id === item.sourceShiftId);
    if (!destination || !sourceShift) throw new Error("Destino indisponível.");
    if (isSundayDate(destination.date)) throw new Error("Domingos não são dias disponíveis para agendamento.");
    const offset = mapShiftBounds(destination.date, destination.shift).start.getTime() - mapShiftBounds(item.sourceDate, sourceShift).start.getTime();
    const reservation = item.reservation;
    return {
      reservationId: reservation.id, expectedRoomId: reservation.roomId,
      expectedStartsAt: reservation.startsAt, expectedEndsAt: reservation.endsAt,
      expectedUserId: reservation.userId, expectedReason: reservation.reason,
      expectedShareable: reservation.shareable, expectedPeople: reservation.expectedPeople,
      roomId: destination.room.id,
      startsAt: new Date(new Date(reservation.startsAt).getTime() + offset).toISOString(),
      endsAt: new Date(new Date(reservation.endsAt).getTime() + offset).toISOString(),
    };
  }) };
}

export function sheetTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Bahia", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

export function changeSheetEntryStart(entry: SheetTransferEntry, date: string, time: string) {
  const start = new Date(`${date}T${time}:00-03:00`);
  if (!Number.isFinite(start.getTime())) return entry;
  const duration = new Date(entry.expectedEndsAt).getTime() - new Date(entry.expectedStartsAt).getTime();
  return { ...entry, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + duration).toISOString() };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseSheetTransfer(body: Record<string, unknown>, now = new Date()): SheetTransfer {
  if (body.mode !== "copy" && body.mode !== "move") throw new Error("Operação de planilha inválida.");
  if (!Array.isArray(body.entries) || !body.entries.length || body.entries.length > 100)
    throw new Error("Selecione entre 1 e 100 agendamentos.");
  const seen = new Set<string>();
  const entries = body.entries.map((value: unknown): SheetTransferEntry => {
    if (!value || typeof value !== "object") throw new Error("Agendamento inválido.");
    const entry = value as SheetTransferEntry;
    if (![entry.reservationId, entry.expectedRoomId, entry.expectedUserId, entry.roomId].every((id) => typeof id === "string" && UUID.test(id)) || seen.has(entry.reservationId))
      throw new Error("A seleção contém identificadores inválidos ou repetidos.");
    seen.add(entry.reservationId);
    const timestamps = [entry.expectedStartsAt, entry.expectedEndsAt, entry.startsAt, entry.endsAt];
    if (!timestamps.every((stamp) => typeof stamp === "string" && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(stamp) && Number.isFinite(Date.parse(stamp))))
      throw new Error("Revise as datas e os horários.");
    const duration = Date.parse(entry.endsAt) - Date.parse(entry.startsAt);
    if (duration <= 0 || duration >= 86_400_000 || duration !== Date.parse(entry.expectedEndsAt) - Date.parse(entry.expectedStartsAt))
      throw new Error("A duração original do agendamento deve ser preservada.");
    if (Date.parse(entry.startsAt) <= now.getTime()) throw new Error("Escolha uma data e um horário futuros para o destino.");
    if (isSundayDate(bahiaDateKey(entry.startsAt))) throw new Error("Domingos não são dias disponíveis para agendamento.");
    if (typeof entry.expectedReason !== "string" || typeof entry.expectedShareable !== "boolean" || !Number.isInteger(entry.expectedPeople))
      throw new Error("Os dados da reserva estão incompletos. Copie a seleção novamente.");
    return entry;
  });
  return { mode: body.mode, entries, confirmReplacement: body.confirmReplacement === true };
}
