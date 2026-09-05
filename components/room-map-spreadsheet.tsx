"use client";

import { useMemo, useState } from "react";
import {
  CalendarPlus,
  CalendarRange,
  Clock3,
  Download,
  Pencil,
  X,
} from "lucide-react";
import { MAP_SHIFTS, mapShiftBounds, type MapShift } from "@/lib/map-shifts";
import { isSundayDate, startOfWeekMonday } from "@/lib/calendar-utils";
import type { Reservation, Room } from "@/lib/types";
import { addDays, time } from "./app-shell-utils";

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
  for (const shift of MAP_SHIFTS) {
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
  if (sunday)
    return (
      <td className="spreadsheet-cell-sunday">
        <span aria-label={`${room.name}, domingo indisponível`}>DOMINGO</span>
      </td>
    );

  if (isFree)
    return (
      <td className="spreadsheet-cell-free">
        <button
          type="button"
          onClick={() =>
            canSchedule ? onSchedule(room, date, shift) : onInspect(room)
          }
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
  return (
    <td className="spreadsheet-cell-booked">
      <div className="spreadsheet-reservation-row">
        <button
          type="button"
          className={`spreadsheet-reservation spreadsheet-tone-${reservationTone(reservation)}`}
          title={`${reservation.reason} | ${reservation.userName} | ${time(reservation.startsAt)} às ${time(reservation.endsAt)}${cellReservations.length > 1 ? ` | mais ${cellReservations.length - 1} reserva(s)` : ""}`}
          aria-label={`${canManage && future ? "Editar" : "Ver"} reserva de ${reservation.userName}, ${reservation.reason}, das ${time(reservation.startsAt)} às ${time(reservation.endsAt)}${cellReservations.length > 1 ? `, mais ${cellReservations.length - 1} reserva(s) no turno` : ""}`}
          onClick={() =>
            canManage && future ? onEdit(reservation) : onInspect(room)
          }
        >
          <strong>{reservation.reason}</strong>
          <span>{reservation.userName}</span>
          <small>
            {time(reservation.startsAt)} às {time(reservation.endsAt)}
          </small>
          {cellReservations.length > 1 && (
            <em>+{cellReservations.length - 1}</em>
          )}
          {canManage && future && (
            <Pencil className="spreadsheet-cell-action" size={10} />
          )}
        </button>
        {canManage && future && (
          <button
            type="button"
            className="spreadsheet-cancel"
            title="Cancelar reserva"
            aria-label={`Cancelar reserva de ${reservation.userName}`}
            onClick={() => onCancel(reservation)}
          >
            <X size={12} />
          </button>
        )}
      </div>
    </td>
  );
}

function SpreadsheetShift({
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
    <table className="room-spreadsheet-table">
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
        {rooms.map((room) => (
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
            {dates.map((date) => (
              <SpreadsheetCell
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

  const runExport = async () => {
    setExporting(true);
    try {
      await exportSpreadsheetMap(dates, rooms, reservationIndex);
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="room-spreadsheet" aria-label="Mapa de salas em planilha">
      <div className="room-spreadsheet-guide">
        <div>
          <CalendarRange size={18} />
          <span>Semana completa, de segunda a domingo</span>
        </div>
        <div>
          <Clock3 size={18} />
          <span>Manhã, tarde e turno extra</span>
        </div>
        <div className="spreadsheet-legend">
          <span><i className="free" /> Livre</span>
          <span><i className="booked" /> Reservada</span>
          <span><i className="sunday" /> Domingo</span>
        </div>
        <div className="spreadsheet-actions">
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
      <p className="room-spreadsheet-hint">
        Arraste horizontalmente para ver a semana. Toque em LIVRE para agendar,
        em uma reserva para editar e no X para cancelar.
      </p>
      <div className="room-spreadsheet-scroll" tabIndex={0}>
        <div className="room-spreadsheet-tables">
          {MAP_SHIFTS.map((shift) => (
            <SpreadsheetShift
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
    </section>
  );
}
