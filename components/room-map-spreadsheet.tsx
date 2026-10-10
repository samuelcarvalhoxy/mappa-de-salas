"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarPlus,
  CalendarRange,
  Clock3,
  Download,
  Copy,
  Scissors,
  ClipboardPaste,
  GripVertical,
  Trash2,
  Pencil,
  X,
} from "lucide-react";
import { MAP_SHIFTS, mapShiftBounds, type MapShift } from "@/lib/map-shifts";
import { isSundayDate, startOfWeekMonday } from "@/lib/calendar-utils";
import type { Reservation, Room } from "@/lib/types";
import { addDays, time } from "./app-shell-utils";
import { sheetBounds, type SheetCancellationEntry, type SheetPosition, type SheetTransfer } from "@/lib/spreadsheet-bookings";
import { useSpreadsheetEditing, type SpreadsheetEditing } from "./use-spreadsheet-editing";
import { SheetTransferDialog } from "./sheet-transfer-dialog";

const SPREADSHEET_DAYS = 7;

function spreadsheetDateLabel(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Bahia",
    day: "2-digit",
    month: "short",
  })
    .format(new Date(`${value}T12:00:00-03:00`))
    .replace(".", "")
    .replace(" de ", "/");
}

function spreadsheetWeekdayLabel(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Bahia",
    weekday: "long",
  })
    .format(new Date(`${value}T12:00:00-03:00`))
    .toLocaleUpperCase("pt-BR");
}

function reservationTone(reservation: Reservation) {
  const source = `${reservation.userId}:${reservation.reason}`;
  const value = Array.from(source).reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  );
  return value % 5;
}

function spreadsheetCellKey(roomId: string, date: string, shiftId: string) {
  return `${roomId}:${date}:${shiftId}`;
}

function buildReservationIndex(reservations: Reservation[], dates: string[]) {
  const index = new Map<string, Reservation[]>();
  for (const date of dates) {
    for (const shift of MAP_SHIFTS) {
      const { start, end } = mapShiftBounds(date, shift);
      for (const reservation of reservations) {
        if (
          reservation.status !== "reserved" ||
          new Date(reservation.startsAt) >= end ||
          new Date(reservation.endsAt) <= start
        )
          continue;
        const key = spreadsheetCellKey(reservation.roomId, date, shift.id);
        const current = index.get(key) || [];
        current.push(reservation);
        index.set(key, current);
      }
    }
  }
  for (const cellReservations of index.values()) {
    cellReservations.sort(
      (left, right) =>
        new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime(),
    );
  }
  return index;
}

async function exportSpreadsheetMap(
  dates: string[],
  rooms: Room[],
  reservationIndex: Map<string, Reservation[]>,
  shifts: readonly MapShift[],
) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Mappa de Salas";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Mapa semanal", {
    views: [{ state: "frozen", xSplit: 1 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });
  sheet.getColumn(1).width = 28;
  for (let column = 2; column <= 8; column += 1)
    sheet.getColumn(column).width = 24;

  let rowNumber = 1;
  for (const shift of shifts) {
    const title = sheet.getRow(rowNumber);
    title.getCell(1).value = `SALAS ${shift.name.toLocaleUpperCase("pt-BR")} · ${shift.startTime} às ${shift.endTime}`;
    sheet.mergeCells(rowNumber, 1, rowNumber, 8);
    title.height = 24;
    title.font = { bold: true, color: { argb: "FFFFFFFF" } };
    title.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4C1D95" },
    };
    title.alignment = { vertical: "middle", horizontal: "left" };
    rowNumber += 1;

    const dateRow = sheet.getRow(rowNumber);
    dateRow.values = ["Sala", ...dates.map(spreadsheetDateLabel)];
    dateRow.height = 21;
    dateRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    dateRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF6D28D9" },
    };
    dateRow.alignment = { horizontal: "center", vertical: "middle" };
    rowNumber += 1;

    const weekdayRow = sheet.getRow(rowNumber);
    weekdayRow.values = ["", ...dates.map(spreadsheetWeekdayLabel)];
    weekdayRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
    weekdayRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF35105F" },
    };
    weekdayRow.alignment = { horizontal: "center", vertical: "middle" };
    rowNumber += 1;

    for (const room of rooms) {
      const row = sheet.getRow(rowNumber);
      row.getCell(1).value = room.name;
      row.getCell(1).font = { bold: true, size: 9 };
      dates.forEach((date, index) => {
        const cell = row.getCell(index + 2);
        const cellReservations =
          reservationIndex.get(
            spreadsheetCellKey(room.id, date, shift.id),
          ) || [];
        if (isSundayDate(date)) {
          cell.value = "DOMINGO";
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFE5E7EB" },
          };
          cell.font = { bold: true, color: { argb: "FF6B7280" }, size: 8 };
        } else if (!cellReservations.length) {
          cell.value = "LIVRE";
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFC9F3DD" },
          };
          cell.font = { bold: true, color: { argb: "FF075B37" }, size: 8 };
        } else {
          cell.value = cellReservations
            .map(
              (reservation) =>
                `${time(reservation.startsAt)} às ${time(reservation.endsAt)} · ${reservation.userName} · ${reservation.reason}`,
            )
            .join("\n");
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFD7C4FF" },
          };
          cell.font = { color: { argb: "FF1E1830" }, size: 8 };
        }
        cell.alignment = {
          horizontal: "center",
          vertical: "middle",
          wrapText: true,
        };
      });
      row.height = 27;
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin", color: { argb: "FFD1D5DB" } },
          left: { style: "thin", color: { argb: "FFD1D5DB" } },
          bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
          right: { style: "thin", color: { argb: "FFD1D5DB" } },
        };
      });
      rowNumber += 1;
    }
    rowNumber += 1;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = new Uint8Array(buffer as unknown as ArrayBuffer);
  const url = URL.createObjectURL(
    new Blob([bytes.buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `mapa-de-salas-semana-${dates[0]}.xlsx`;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SpreadsheetCell({
  editing,
  position,
  canMove,
  room,
  date,
  shift,
  cellReservations,
  now,
  canManage,
  canSchedule,
  onInspect,
  onEdit,
  onCancel,
  onSchedule,
}: {
  editing: SpreadsheetEditing;
  position: SheetPosition;
  canMove: (reservation: Reservation) => boolean;
  room: Room;
  date: string;
  shift: MapShift;
  cellReservations: Reservation[];
  now: string;
  canManage: boolean;
  canSchedule: boolean;
  onInspect: (room: Room) => void;
  onEdit: (reservation: Reservation) => void;
  onCancel: (reservation: Reservation) => void;
  onSchedule: (room: Room, date: string, shift: MapShift) => void;
}) {
  const sunday = isSundayDate(date);
  const isFree = cellReservations.length === 0;
  const selected = editing.isSelected(position);
  const drop = editing.dropTarget?.row === position.row && editing.dropTarget?.column === position.column;
  const cut = editing.clipboard?.mode === "move" && cellReservations.some((reservation) => editing.clipboard?.items.some((item) => item.reservation.id === reservation.id));
  const classes = `${selected ? " sheet-cell-selected" : ""}${drop ? " sheet-cell-drop" : ""}${cut ? " sheet-cell-cut" : ""}`;
  const openCell = () => {
    if (sunday) return;
    if (isFree) { if (canSchedule) onSchedule(room, date, shift); else onInspect(room); }
    else if (canMove(cellReservations[0])) onEdit(cellReservations[0]);
    else onInspect(room);
  };
  const interaction = {
    ...editing.cellProps(position),
    role: "gridcell",
    onDoubleClick: openCell,
    onKeyDown: (event: React.KeyboardEvent<HTMLTableCellElement>) => {
      if (event.key === "Enter" && event.target === event.currentTarget) { event.preventDefault(); openCell(); }
    },
    "aria-label": `${room.name}, ${spreadsheetDateLabel(date)}, ${shift.name}, ${cellReservations.length} reserva(s)`,
  };
  if (sunday)
    return (
      <td {...interaction} className={`spreadsheet-cell-sunday${classes}`}>
        <span aria-label={`${room.name}, domingo indisponível`}>DOMINGO</span>
      </td>
    );

  if (isFree)
    return (
      <td {...interaction} className={`spreadsheet-cell-free${classes}`}>
        <button
          type="button"
          tabIndex={-1}
          onClick={(event) => { if (editing.touch.current || event.detail === 0) openCell(); }}
          aria-label={`${room.name}, livre em ${spreadsheetDateLabel(date)}, turno ${shift.name}${canSchedule ? ", agendar" : ""}`}
        >
          <span className="spreadsheet-free-label">LIVRE</span>
          {canSchedule && (
            <CalendarPlus className="spreadsheet-cell-action" size={12} />
          )}
        </button>
      </td>
    );

  const reservation = cellReservations[0];
  const future = new Date(reservation.endsAt) > new Date(now);
  const movable = canMove(reservation);
  return (
    <td {...interaction} className={`spreadsheet-cell-booked${classes}`}>
      <div className="spreadsheet-reservation-row">
        <button
          type="button"
          className={`spreadsheet-reservation spreadsheet-tone-${reservationTone(reservation)}`}
          title={`${reservation.reason} | ${reservation.userName} | ${time(reservation.startsAt)} às ${time(reservation.endsAt)}${cellReservations.length > 1 ? ` | mais ${cellReservations.length - 1} reserva(s)` : ""}`}
          aria-label={`${movable ? "Editar" : "Ver"} reserva de ${reservation.userName}, ${reservation.reason}, das ${time(reservation.startsAt)} às ${time(reservation.endsAt)}${cellReservations.length > 1 ? `, mais ${cellReservations.length - 1} reserva(s) no turno` : ""}`}
          tabIndex={-1}
          draggable={selected && movable}
          data-sheet-action={selected && movable ? true : undefined}
          onDragStart={(event) => editing.startDrag(event, position)}
          onDragEnd={editing.endDrag}
          onClick={(event) => { if (editing.touch.current || event.detail === 0) openCell(); }}
        >
          <strong>{reservation.reason}</strong>
          <span>{reservation.userName}</span>
          <small>
            {time(reservation.startsAt)} às {time(reservation.endsAt)}
          </small>
          {cellReservations.length > 1 && (
            <em>+{cellReservations.length - 1}</em>
          )}
          {movable && (
            <Pencil className="spreadsheet-cell-action" size={10} />
          )}
        </button>
        {movable && (
          <button type="button" className="sheet-drag-handle" data-sheet-action draggable
            title="Arrastar agendamento ou seleção para outra célula" aria-label="Arrastar agendamento ou seleção"
            onDragStart={(event) => editing.startDrag(event, position)} onDragEnd={editing.endDrag}
            onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
            <GripVertical size={12} />
          </button>
        )}
        {canManage && future && (
          <button
            type="button"
            className="spreadsheet-cancel"
            data-sheet-action
            title="Cancelar reserva"
            aria-label={`Cancelar reserva de ${reservation.userName}`}
            onClick={(event) => { event.stopPropagation(); onCancel(reservation); }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <X size={12} />
          </button>
        )}
      </div>
    </td>
  );
}

function SpreadsheetShift({
  editing,
  shiftIndex,
  canMove,
  shift,
  dates,
  rooms,
  reservationIndex,
  now,
  canManage,
  canSchedule,
  onInspect,
  onEdit,
  onCancel,
  onSchedule,
}: {
  editing: SpreadsheetEditing;
  shiftIndex: number;
  canMove: (reservation: Reservation) => boolean;
  shift: MapShift;
  dates: string[];
  rooms: Room[];
  reservationIndex: Map<string, Reservation[]>;
  now: string;
  canManage: boolean;
  canSchedule: boolean;
  onInspect: (room: Room) => void;
  onEdit: (reservation: Reservation) => void;
  onCancel: (reservation: Reservation) => void;
  onSchedule: (room: Room, date: string, shift: MapShift) => void;
}) {
  return (
    <table className="room-spreadsheet-table" role="grid" aria-label={`Planilha do turno ${shift.name}`}>
      <thead>
        <tr className="spreadsheet-date-row">
          <th scope="col">SALAS {shift.name.toLocaleUpperCase("pt-BR")}</th>
          {dates.map((date) => (
            <th
              scope="col"
              className={isSundayDate(date) ? "sunday" : ""}
              key={date}
            >
              {spreadsheetDateLabel(date)}
            </th>
          ))}
        </tr>
        <tr className="spreadsheet-weekday-row">
          <th scope="col">{shift.startTime} às {shift.endTime}</th>
          {dates.map((date) => (
            <th
              scope="col"
              className={isSundayDate(date) ? "sunday" : ""}
              key={date}
            >
              {spreadsheetWeekdayLabel(date)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rooms.map((room, roomIndex) => (
          <tr key={`${shift.id}:${room.id}`}>
            <th scope="row">
              <button
                type="button"
                title={`${room.name} | ${room.location || "Local não informado"}`}
                onClick={() => onInspect(room)}
              >
                <strong>{room.name}</strong>
                <small>{room.location || "Local não informado"}</small>
              </button>
            </th>
            {dates.map((date, dateIndex) => (
              <SpreadsheetCell
                editing={editing}
                position={{ row: shiftIndex * rooms.length + roomIndex, column: dateIndex }}
                canMove={canMove}
                room={room}
                date={date}
                shift={shift}
                cellReservations={
                  reservationIndex.get(
                    spreadsheetCellKey(room.id, date, shift.id),
                  ) || []
                }
                now={now}
                canManage={canManage}
                canSchedule={canSchedule}
                onInspect={onInspect}
                onEdit={onEdit}
                onCancel={onCancel}
                onSchedule={onSchedule}
                key={`${room.id}:${date}:${shift.id}`}
              />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function RoomMapSpreadsheet({
  onDelete,
  currentUserId,
  canCopy,
  canCopyAll,
  canMoveOwn,
  onTransfer,
  startDate,
  rooms,
  reservations,
  now,
  canManage,
  canSchedule,
  onInspect,
  onEdit,
  onCancel,
  onSchedule,
  onBulkCancel,
}: {
  onDelete: (entries: SheetCancellationEntry[]) => Promise<void>;
  currentUserId: string;
  canCopy: boolean;
  canCopyAll: boolean;
  canMoveOwn: boolean;
  onTransfer: (transfer: SheetTransfer) => Promise<void>;
  startDate: string;
  rooms: Room[];
  reservations: Reservation[];
  now: string;
  canManage: boolean;
  canSchedule: boolean;
  onInspect: (room: Room) => void;
  onEdit: (reservation: Reservation) => void;
  onCancel: (reservation: Reservation) => void;
  onSchedule: (room: Room, date: string, shift: MapShift) => void;
  onBulkCancel: () => void;
}) {
  const [exporting, setExporting] = useState(false);
  const weekStart = startOfWeekMonday(startDate);
  const dates = useMemo(
    () =>
      Array.from({ length: SPREADSHEET_DAYS }, (_, index) =>
        addDays(weekStart, index),
      ),
    [weekStart],
  );
  const reservationIndex = useMemo(
    () => buildReservationIndex(reservations, dates),
    [dates, reservations],
  );
  const visibleShifts = useMemo(() => MAP_SHIFTS.filter((shift) => shift.id !== "extra" ||
    rooms.some((room) => dates.some((date) => !isSundayDate(date) &&
      (reservationIndex.get(spreadsheetCellKey(room.id, date, shift.id))?.length || 0) > 0))),
  [rooms, dates, reservationIndex]);
  const canMove = (reservation: Reservation) => reservation.status === "reserved" && new Date(reservation.endsAt) > new Date(now)
    && (canManage || (canMoveOwn && reservation.userId === currentUserId));
  const canCancel = (reservation: Reservation) => reservation.status === "reserved" && new Date(reservation.endsAt) > new Date(now)
    && (canManage || reservation.userId === currentUserId);
  const sheetElement = useRef<HTMLElement>(null);
  const editing = useSpreadsheetEditing({ rooms, dates, shifts: visibleShifts, index: reservationIndex, canCopy, canMove, canCancel, onDelete, surfaceRef: sheetElement });
  const roomCount = rooms.length;
  useEffect(() => {
    const element = sheetElement.current;
    if (!element) return;
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!window.matchMedia("(min-width: 781px)").matches || !roomCount) {
          element.style.removeProperty("--sheet-row-height");
          return;
        }
        const tables = Array.from(element.querySelectorAll<HTMLTableElement>(".room-spreadsheet-table")).slice(0, 2);
        const first = tables[0];
        if (!first) return;
        const headers = tables.reduce((sum, table) => sum + (table.tHead?.getBoundingClientRect().height || 0), 0);
        const height = Math.max(14, Math.min(40, Math.floor((window.innerHeight - first.getBoundingClientRect().top - headers - 20) / (roomCount * tables.length))));
        element.style.setProperty("--sheet-row-height", `${height}px`);
      });
    };
    const observer = new ResizeObserver(fit);
    // Observe controls that move the sheet without resizing the viewport.
    const main = element.closest("main");
    if (main) observer.observe(main);
    observer.observe(element);
    window.addEventListener("resize", fit);
    fit();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("resize", fit); };
  }, [sheetElement, roomCount, visibleShifts]);
  const bounds = editing.selection ? sheetBounds(editing.selection) : null;
  const selectedCount = bounds ? (bounds.bottom - bounds.top + 1) * (bounds.right - bounds.left + 1) : 0;

  const runExport = async () => {
    setExporting(true);
    try {
      await exportSpreadsheetMap(dates, rooms, reservationIndex, visibleShifts);
    } finally {
      setExporting(false);
    }
  };

  return (
    <section ref={sheetElement} className="room-spreadsheet sheet-fit" aria-label="Mapa de salas em planilha"
      onCopy={(event) => editing.onClipboard(event, "copy")}
      onCut={(event) => editing.onClipboard(event, "move")}
      onPaste={(event) => editing.onClipboard(event, "paste")}
      onKeyDown={editing.onKeyDown}>
      <div className="room-spreadsheet-guide">
        <div>
          <CalendarRange size={18} />
          <span>Semana completa, de segunda a domingo</span>
        </div>
        <div>
          <Clock3 size={18} />
          <span>{visibleShifts.some((shift) => shift.id === "extra") ? "Manhã, tarde e turno extra" : "Manhã e tarde"}</span>
        </div>
        <div className="spreadsheet-legend">
          <span><i className="free" /> Livre</span>
          <span><i className="booked" /> Reservada</span>
          <span><i className="sunday" /> Domingo</span>
        </div>
      </div>
      <div className="sheet-edit-toolbar" aria-label="Ações da seleção">
        <span>{selectedCount ? `${selectedCount} célula(s) selecionada(s)` : "Selecione uma célula"}</span>
        <button className="btn btn-soft" type="button" disabled={!editing.selection || editing.deleteBusy} onClick={() => editing.copy("copy")} title="Copiar (Ctrl+C)"><Copy size={15} /> Copiar</button>
        {(canManage || canMoveOwn) && <button className="btn btn-soft" type="button" disabled={!editing.selection || editing.deleteBusy} onClick={() => editing.copy("move")} title="Recortar (Ctrl+X)"><Scissors size={15} /> Recortar</button>}
        {(canCopy || canManage || canMoveOwn) && <button className="btn btn-soft" type="button" disabled={!editing.selection || !editing.clipboard?.items.length || editing.deleteBusy} onClick={() => editing.paste()} title="Colar (Ctrl+V)"><ClipboardPaste size={15} /> Colar</button>}
        <button className="btn btn-danger" type="button" disabled={!editing.selection || editing.deleteBusy} onClick={() => void editing.deleteSelected()} title="Excluir reservas selecionadas (DEL)"><Trash2 size={15} /> {editing.deleteBusy ? "Excluindo..." : "Excluir (DEL)"}</button>
        <details className="sheet-help"><summary>Ajuda</summary><p>Clique ou arraste pelas células para selecionar. Ctrl+C copia, Ctrl+X recorta e Ctrl+V cola. DEL exclui após confirmação. ESC ou clique fora da planilha desseleciona. Arraste a reserva ou sua alça para mover. Duplo clique ou Enter abre a célula. No celular, toque para abrir.</p></details>
        <div className="spreadsheet-actions sheet-export-actions">
          <button
            className="btn btn-soft"
            type="button"
            disabled={exporting}
            onClick={() => void runExport()}
          >
            <Download size={15} /> {exporting ? "Gerando..." : "Exportar XLSX"}
          </button>
          {canManage && (
            <button className="btn btn-danger" type="button" onClick={onBulkCancel}>
              <CalendarRange size={15} /> Cancelar em massa
            </button>
          )}
        </div>
      </div>
      {editing.message && <p className="sheet-status" role="status">{editing.message}</p>}
      <div className="room-spreadsheet-scroll" tabIndex={0}>
        <div className="room-spreadsheet-tables">
          {visibleShifts.map((shift, shiftIndex) => (
            <SpreadsheetShift
              editing={editing}
              shiftIndex={shiftIndex}
              canMove={canMove}
              shift={shift}
              dates={dates}
              rooms={rooms}
              reservationIndex={reservationIndex}
              now={now}
              canManage={canManage}
              canSchedule={canSchedule}
              onInspect={onInspect}
              onEdit={onEdit}
              onCancel={onCancel}
              onSchedule={onSchedule}
              key={shift.id}
            />
          ))}
        </div>
      </div>
      {editing.pending && <SheetTransferDialog transfer={editing.pending.transfer} clipboard={editing.pending.clipboard}
        rooms={rooms} ownCopies={!canCopyAll}
        onClose={() => editing.setPending(null)}
        onConfirm={async (transfer) => {
          await onTransfer(transfer);
          editing.setPending(null);
          if (transfer.mode === "move") editing.setClipboard(null);
          editing.setMessage(`${transfer.entries.length} agendamento(s) ${transfer.mode === "move" ? "movido(s)" : "copiado(s)"} com sucesso.`);
        }} />}
    </section>
  );
}
