import assert from "node:assert/strict";
import test from "node:test";
import {
  MAP_SHIFTS,
  mapShiftBounds,
  mapShiftForNow,
} from "../lib/map-shifts.ts";

test("define o turno da manhã entre 08:00 e 14:20", () => {
  const morning = MAP_SHIFTS.find((shift) => shift.id === "morning");

  assert.deepEqual(morning, {
    id: "morning",
    name: "Manhã",
    startTime: "08:00",
    endTime: "14:20",
  });
});

test("não classifica horários anteriores às 08:00 como manhã", () => {
  assert.notEqual(mapShiftForNow("2026-08-17T10:59:00.000Z"), "morning");
  assert.equal(mapShiftForNow("2026-08-17T11:00:00.000Z"), "morning");
});

test("encerra a manhã exatamente às 14:20", () => {
  assert.equal(mapShiftForNow("2026-08-17T17:19:00.000Z"), "morning");
  assert.equal(mapShiftForNow("2026-08-17T17:20:00.000Z"), "afternoon");
});

test("calcula os limites dos turnos usados pela planilha", () => {
  const morning = MAP_SHIFTS.find((shift) => shift.id === "morning")!;
  const extra = MAP_SHIFTS.find((shift) => shift.id === "extra")!;

  assert.equal(
    mapShiftBounds("2026-08-20", morning).start.toISOString(),
    "2026-08-20T11:00:00.000Z",
  );
  assert.equal(
    mapShiftBounds("2026-08-20", extra).end.toISOString(),
    "2026-08-21T10:00:00.000Z",
  );
});
