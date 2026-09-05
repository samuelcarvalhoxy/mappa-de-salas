import assert from "node:assert/strict";
import test from "node:test";
import {
  isBookableBusinessDate,
  isBookingStartInPast,
  isValidDate,
  isValidTime,
  isValidTimeRange,
  reservationTimestampStrings,
} from "../lib/booking-validation.ts";

test("aceita horários reais no formato HH:MM", () => {
  for (const value of ["00:00", "08:00", "14:20", "23:59"])
    assert.equal(isValidTime(value), true, value);
});

test("rejeita horários impossíveis ou fora do formato", () => {
  for (const value of ["7:00", "24:00", "99:99", "12:60", "12:30:00"])
    assert.equal(isValidTime(value), false, value);
});

test("aceita períodos no mesmo dia e turnos que atravessam a meia-noite", () => {
  assert.equal(isValidTimeRange("08:00", "14:20"), true);
  assert.equal(isValidTimeRange("21:00", "07:00"), true);
  assert.equal(isValidTimeRange("08:00", "08:00"), false);
  assert.equal(isValidTimeRange("99:99", "10:00"), false);
});

test("valida a existência real da data", () => {
  assert.equal(isValidDate("2028-02-29"), true);
  assert.equal(isValidDate("2026-02-29"), false);
  assert.equal(isValidDate("2026-04-31"), false);
  assert.equal(isValidDate("2026-13-01"), false);
});

test("monta o término no dia seguinte para o turno Extra", () => {
  assert.deepEqual(reservationTimestampStrings("2026-09-05", "21:00", "07:00"), {
    startsAt: "2026-09-05T21:00:00-03:00",
    endsAt: "2026-09-06T07:00:00-03:00",
  });
});

test("rejeita domingos e horários que já passaram", () => {
  assert.equal(isBookableBusinessDate("2026-09-06"), false);
  assert.equal(isBookableBusinessDate("2026-09-07"), true);
  assert.equal(
    isBookingStartInPast(
      "2026-09-05",
      "08:00",
      new Date("2026-09-05T12:00:00.000Z"),
    ),
    true,
  );
  assert.equal(
    isBookingStartInPast(
      "2026-09-05",
      "10:00",
      new Date("2026-09-05T12:00:00.000Z"),
    ),
    false,
  );
});
