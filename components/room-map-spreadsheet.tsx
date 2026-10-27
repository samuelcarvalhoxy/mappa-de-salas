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
  Maximize,
  Minimize,
  ZoomIn,
  ZoomOut,
  Scan,
} from "lucide-react";
import { MAP_SHIFTS, mapShiftBounds, type MapShift } from "@/lib/map-shifts";
import { isSundayDate, startOfWeekMonday } from "@/lib/calendar-utils";
import type { Reservation, Room } from "@/lib/types";
import { addDays, time } from "./app-shell-utils";
import { sheetBounds, type SheetLayout, type SheetCancellationEntry, type SheetPosition, type SheetTransfer } from "@/lib/spreadsheet-bookings";
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
  const sheet = workbook.addWorksheet(dates.length === 1 ? "Mapa diário" : "Mapa semanal", {
    views: [{ state: "frozen", xSplit: 1 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });
  sheet.getColumn(1).width = 28;
  for (let column = 2; column <= dates.length + 1; column += 1)
    sheet.getColumn(column).width = 24;

  let rowNumber = 1;
  for (const shift of shifts) {
    const title = sheet.getRow(rowNumber);
    title.getCell(1).value = `SALAS ${shift.name.toLocaleUpperCase("pt-BR")} · ${shift.startTime} às ${shift.endTime}`;
    sheet.mergeCells(rowNumber, 1, rowNumber, dates.length + 1);
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
  link.download = `mapa-de-salas-${dates.length === 1 ? "dia" : "semana"}-${dates[0]}.xlsx`;
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
  dayShifts,
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
  dayShifts?: readonly MapShift[];
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
  const columns = dayShifts
    ? dayShifts.map((columnShift) => ({ date: dates[0], shift: columnShift }))
    : dates.map((date) => ({ date, shift }));
  return (
    <table className="room-spreadsheet-table" role="grid" aria-label={dayShifts ? "Planilha diária de salas" : `Planilha do turno ${shift.name}`}>
      <thead>
        <tr className="spreadsheet-date-row">
          <th scope="col">{dayShifts ? "SALAS" : `SALAS ${shift.name.toLocaleUpperCase("pt-BR")}`}</th>
          {columns.map(({ date, shift: columnShift }) => (
            <th
              scope="col"
              className={isSundayDate(date) ? "sunday" : ""}
              key={`${date}:${columnShift.id}`}
            >
              {dayShifts ? columnShift.name : spreadsheetDateLabel(date)}
            </th>
          ))}
        </tr>
        <tr className="spreadsheet-weekday-row">
          <th scope="col">{dayShifts ? spreadsheetDateLabel(dates[0]) : `${shift.startTime} às ${shift.endTime}`}</th>
          {columns.map(({ date, shift: columnShift }) => (
            <th
              scope="col"
              className={isSundayDate(date) ? "sunday" : ""}
              key={`${date}:${columnShift.id}`}
            >
              {dayShifts ? `${columnShift.startTime} às ${columnShift.endTime}` : spreadsheetWeekdayLabel(date)}
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
            {columns.map(({ date, shift: columnShift }, dateIndex) => (
              <SpreadsheetCell
                editing={editing}
                position={{ row: dayShifts ? roomIndex : shiftIndex * rooms.length + roomIndex, column: dateIndex }}
                canMove={canMove}
                room={room}
                date={date}
                shift={columnShift}
                cellReservations={
                  reservationIndex.get(
                    spreadsheetCellKey(room.id, date, columnShift.id),
                  ) || []
                }
                now={now}
                canManage={canManage}
                canSchedule={canSchedule}
                onInspect={onInspect}
                onEdit={onEdit}
                onCancel={onCancel}
                onSchedule={onSchedule}
                key={`${room.id}:${date}:${columnShift.id}`}
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
  layout = "week",
  onLayoutChange,
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
  layout?: SheetLayout;
  onLayoutChange?: (layout: SheetLayout) => void;
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
  const [fitToScreen, setFitToScreen] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [fullscreen, setFullscreen] = useState(false);
  const weekStart = startOfWeekMonday(startDate);
  const dates = useMemo(
    () =>
      layout === "day" ? [startDate] : Array.from({ length: SPREADSHEET_DAYS }, (_, index) =>
        addDays(weekStart, index),
      ),
    [weekStart, startDate, layout],
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
  const editing = useSpreadsheetEditing({ rooms, dates, shifts: visibleShifts, layout, index: reservationIndex, canCopy, canMove, canCancel, onDelete, surfaceRef: sheetElement });
  const roomCount = rooms.length;
  useEffect(() => {
    const syncFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);
  useEffect(() => {
    const element = sheetElement.current;
    if (!element) return;
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const scroll = element.querySelector<HTMLElement>(".room-spreadsheet-scroll");
        const tables = Array.from(element.querySelectorAll<HTMLTableElement>(".room-spreadsheet-table"));
        if (!scroll || !tables.length) return;
        const desktop = window.matchMedia("(min-width: 781px)").matches;
        const available = Math.max(160, Math.floor(window.innerHeight - scroll.getBoundingClientRect().top - 16));
        const fittedTables = layout === "day" ? tables : tables.slice(0, 2);
        const headers = fittedTables.reduce((sum, table) => sum + (table.tHead?.getBoundingClientRect().height || 0) + 4, 0);
        const minimum = layout === "day" ? 44 : 28;
        const automatic = Math.max(minimum, Math.min(layout === "day" ? 110 : 80,
          Math.floor((available - headers) / Math.max(1, roomCount * fittedTables.length))));
        const height = fitToScreen && desktop ? automatic : Math.round((layout === "day" ? 64 : 40) * zoom / 100);
        element.style.setProperty("--sheet-row-height", `${height}px`);
        element.style.setProperty("--sheet-scale", `${fitToScreen ? 1 : zoom / 100}`);
        scroll.style.maxHeight = desktop ? `${available}px` : "none";
      });
    };
    const observer = new ResizeObserver(fit);
    const main = element.closest("main");
    if (main) observer.observe(main);
    observer.observe(element);
    window.addEventListener("resize", fit);
    document.addEventListener("fullscreenchange", fit);
    fit();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener("resize", fit);
      document.removeEventListener("fullscreenchange", fit);
    };
  }, [roomCount, visibleShifts, layout, fitToScreen, zoom]);
  const changeZoom = (value: number) => {
    setZoom(Math.max(75, Math.min(200, value)));
    setFitToScreen(false);
  };
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else editing.setMessage("Tela cheia indisponível neste navegador. Use Ajustar à tela ou o zoom da planilha.");
    } catch {
      editing.setMessage("O navegador não permitiu abrir a tela cheia. Use Ajustar à tela ou o zoom da planilha.");
    }
  };
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
    <section ref={sheetElement} className={`room-spreadsheet sheet-fit sheet-readable sheet-${layout} ${fitToScreen ? "sheet-auto" : "sheet-manual"}`} aria-label="Mapa de salas em planilha"
      onCopy={(event) => editing.onClipboard(event, "copy")}
      onCut={(event) => editing.onClipboard(event, "move")}
      onPaste={(event) => editing.onClipboard(event, "paste")}
      onKeyDown={editing.onKeyDown}>
      <div className="room-spreadsheet-guide">
        <div>
          <CalendarRange size={18} />
          <span>{layout === "day" ? `Dia ${spreadsheetDateLabel(startDate)}` : "Semana completa, de segunda a domingo"}</span>
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
      <div className="sheet-view-toolbar" aria-label="Visualização da planilha">
        {onLayoutChange && <div className="mode-toggle" role="group" aria-label="Período da planilha">
          <button type="button" aria-pressed={layout === "day"} className={layout === "day" ? "active" : ""} onClick={() => onLayoutChange("day")}>Dia</button>
          <button type="button" aria-pressed={layout === "week"} className={layout === "week" ? "active" : ""} onClick={() => onLayoutChange("week")}>Semana</button>
        </div>}
        <button type="button" className="btn btn-soft" aria-pressed={fitToScreen} onClick={() => setFitToScreen(true)}><Scan size={16} /> Ajustar à tela</button>
        <div className="sheet-zoom-controls" role="group" aria-label="Zoom da planilha">
          <button type="button" className="icon-btn" aria-label="Diminuir zoom da planilha" disabled={!fitToScreen && zoom <= 75} onClick={() => changeZoom(zoom - 25)}><ZoomOut size={16} /></button>
          <label>Zoom <input type="range" aria-label="Zoom da planilha em porcentagem" min="75" max="200" step="25" value={zoom} onChange={(event) => changeZoom(Number(event.target.value))} /></label>
          <output aria-live="polite">{fitToScreen ? "Automático" : `${zoom}%`}</output>
          <button type="button" className="icon-btn" aria-label="Aumentar zoom da planilha" disabled={!fitToScreen && zoom >= 200} onClick={() => changeZoom(zoom + 25)}><ZoomIn size={16} /></button>
        </div>
        <button type="button" className="btn btn-soft sheet-fullscreen" aria-pressed={fullscreen} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}{fullscreen ? "Sair da tela cheia" : "Tela cheia"}</button>
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
          {(layout === "day" ? visibleShifts.slice(0, 1) : visibleShifts).map((shift, shiftIndex) => (
            <SpreadsheetShift
              dayShifts={layout === "day" ? visibleShifts : undefined}
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
