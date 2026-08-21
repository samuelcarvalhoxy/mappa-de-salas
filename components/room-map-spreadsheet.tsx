"use client";

import { useMemo } from "react";
import { CalendarRange, Clock3 } from "lucide-react";
import { MAP_SHIFTS, mapShiftBounds, type MapShift } from "@/lib/map-shifts";
import type { Reservation, Room } from "@/lib/types";
import { addDays, time } from "./app-shell-utils";

const SPREADSHEET_DAYS = 5;

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

function buildReservationIndex(
  reservations: Reservation[],
  dates: string[],
) {
  const index = new Map<string, Reservation[]>();
  for (const date of dates) {
    for (const shift of MAP_SHIFTS) {
      const { start, end } = mapShiftBounds(date, shift);
      for (const reservation of reservations) {
        if (
          reservation.status !== "reserved" ||
          new Date(reservation.startsAt) >= end ||
          new Date(reservation.endsAt) <= start
        ) {
          continue;
        }
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

function SpreadsheetCell({
  room,
  date,
  shift,
  cellReservations,
  onInspect,
}: {
  room: Room;
  date: string;
  shift: MapShift;
  cellReservations: Reservation[];
  onInspect: (room: Room) => void;
}) {
  const isFree = cellReservations.length === 0;

  return (
    <td className={isFree ? "spreadsheet-cell-free" : "spreadsheet-cell-booked"}>
      <button
        type="button"
        onClick={() => onInspect(room)}
        aria-label={
          isFree
            ? `${room.name}, livre em ${spreadsheetDateLabel(date)}, turno ${shift.name}`
            : `${room.name}, ${cellReservations.length} reserva${cellReservations.length === 1 ? "" : "s"} em ${spreadsheetDateLabel(date)}, turno ${shift.name}`
        }
      >
        {isFree ? (
          <span className="spreadsheet-free-label">LIVRE</span>
        ) : (
          cellReservations.map((reservation) => (
            <span
              className={`spreadsheet-reservation spreadsheet-tone-${reservationTone(reservation)}`}
              key={reservation.id}
              title={`${reservation.reason} | ${reservation.userName} | ${time(reservation.startsAt)} às ${time(reservation.endsAt)}`}
            >
              <strong>{reservation.reason}</strong>
              <span>{reservation.userName}</span>
              <small>
                {time(reservation.startsAt)} às {time(reservation.endsAt)}
              </small>
            </span>
          ))
        )}
      </button>
    </td>
  );
}

function SpreadsheetShift({
  shift,
  dates,
  rooms,
  reservationIndex,
  onInspect,
}: {
  shift: MapShift;
  dates: string[];
  rooms: Room[];
  reservationIndex: Map<string, Reservation[]>;
  onInspect: (room: Room) => void;
}) {
  return (
    <table className="room-spreadsheet-table">
      <thead>
        <tr className="spreadsheet-date-row">
          <th scope="col">SALAS {shift.name.toLocaleUpperCase("pt-BR")}</th>
          {dates.map((date) => (
            <th scope="col" key={date}>
              {spreadsheetDateLabel(date)}
            </th>
          ))}
        </tr>
        <tr className="spreadsheet-weekday-row">
          <th scope="col">
            {shift.startTime} às {shift.endTime}
          </th>
          {dates.map((date) => (
            <th scope="col" key={date}>
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
                onInspect={onInspect}
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
  onInspect,
}: {
  startDate: string;
  rooms: Room[];
  reservations: Reservation[];
  onInspect: (room: Room) => void;
}) {
  const dates = useMemo(
    () =>
      Array.from({ length: SPREADSHEET_DAYS }, (_, index) =>
        addDays(startDate, index),
      ),
    [startDate],
  );
  const reservationIndex = useMemo(
    () => buildReservationIndex(reservations, dates),
    [dates, reservations],
  );

  return (
    <section className="room-spreadsheet" aria-label="Mapa de salas em planilha">
      <div className="room-spreadsheet-guide">
        <div>
          <CalendarRange size={18} />
          <span>Visão de cinco dias</span>
        </div>
        <div>
          <Clock3 size={18} />
          <span>Manhã, tarde e turno extra</span>
        </div>
        <div className="spreadsheet-legend">
          <span>
            <i className="free" /> Livre
          </span>
          <span>
            <i className="booked" /> Reservada
          </span>
        </div>
      </div>
      <p className="room-spreadsheet-hint">
        Arraste horizontalmente para ver todos os dias. Toque em qualquer célula
        para abrir a agenda e os recursos da sala.
      </p>
      <div className="room-spreadsheet-scroll" tabIndex={0}>
        <div className="room-spreadsheet-tables">
          {MAP_SHIFTS.map((shift) => (
            <SpreadsheetShift
              shift={shift}
              dates={dates}
              rooms={rooms}
              reservationIndex={reservationIndex}
              onInspect={onInspect}
              key={shift.id}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
