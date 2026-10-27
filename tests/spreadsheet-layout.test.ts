import assert from "node:assert/strict";
import { test } from "node:test";
import { MAP_SHIFTS } from "../lib/map-shifts.ts";
import { captureSheetSelection, prepareSheetTransfer, sheetCell } from "../lib/spreadsheet-bookings.ts";
import type { Reservation, Room } from "../lib/types.ts";

const rooms = [{ id: "a", name: "Sala A" }, { id: "b", name: "Sala B" }, { id: "c", name: "Sala C" }] as Room[];
const dates = ["2099-10-05"];
const morning = { id: "one", roomId: "a", userId: "u", reason: "FI", userName: "Instrutor", startsAt: "2099-10-05T09:00:00-03:00", endsAt: "2099-10-05T10:00:00-03:00", status: "reserved" } as Reservation;
const afternoon = { ...morning, id: "two", roomId: "b", startsAt: "2099-10-05T15:00:00-03:00", endsAt: "2099-10-05T16:00:00-03:00" };
const index = new Map([["a:2099-10-05:morning", [morning]], ["b:2099-10-05:afternoon", [afternoon]]]);

test("modo diário seleciona somente as salas e turnos do retângulo visual", () => {
  const selected = captureSheetSelection({ anchor: { row: 0, column: 0 }, focus: { row: 1, column: 1 } }, rooms, dates, index, "copy", MAP_SHIFTS, "day");
  assert.deepEqual(selected.items.map((item) => [item.reservation.id, item.rowOffset, item.columnOffset]), [["one", 0, 0], ["two", 1, 1]]);
  assert.equal(selected.text.split("\n").length, 2);
  assert.equal(selected.text.split("\n")[0].split("\t").length, 2);
  const moved = prepareSheetTransfer(selected, { row: 1, column: 0 }, rooms, dates, MAP_SHIFTS, "day");
  assert.deepEqual(moved.entries.map((entry) => entry.roomId), ["b", "c"]);
  assert.deepEqual(moved.entries.map((entry) => entry.startsAt), ["2099-10-05T12:00:00.000Z", "2099-10-05T18:00:00.000Z"]);
});

test("modo diário preserva duração ao mover da manhã para tarde em outro dia", () => {
  const selected = captureSheetSelection({ anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } }, rooms, dates, index, "move", MAP_SHIFTS, "day");
  const moved = prepareSheetTransfer(selected, { row: 2, column: 1 }, rooms, ["2099-10-06"], MAP_SHIFTS, "day");
  assert.equal(moved.entries[0].roomId, "c");
  assert.equal(moved.entries[0].startsAt, "2099-10-06T18:20:00.000Z");
  assert.equal(moved.entries[0].endsAt, "2099-10-06T19:20:00.000Z");
  assert.throws(() => prepareSheetTransfer(selected, { row: 3, column: 0 }, rooms, dates, MAP_SHIFTS, "day"), /ultrapassa/);
  assert.throws(() => prepareSheetTransfer(selected, { row: 0, column: 0 }, rooms, dates, MAP_SHIFTS, "week"), /novamente/);
  assert.equal(sheetCell({ row: 0, column: 3 }, rooms, dates, MAP_SHIFTS, "day"), null);
});

test("reservas que cruzam turnos são capturadas uma vez no modo diário", () => {
  const spanning = { ...morning, endsAt: "2099-10-05T16:00:00-03:00" };
  const selected = captureSheetSelection({ anchor: { row: 0, column: 0 }, focus: { row: 0, column: 1 } }, rooms, dates,
    new Map([["a:2099-10-05:morning", [spanning]], ["a:2099-10-05:afternoon", [spanning]]]), "move", MAP_SHIFTS, "day");
  assert.equal(selected.items.length, 1);
  assert.equal(selected.items[0].sourceShiftId, "morning");
});
