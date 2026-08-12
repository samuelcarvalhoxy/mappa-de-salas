import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidDate,
  isValidTime,
  isValidTimeRange,
} from "../lib/booking-validation.ts";

test("aceita horários reais no formato HH:MM", () => {
  for (const value of ["00:00", "08:00", "14:20", "23:59"])
    assert.equal(isValidTime(value), true, value);
});

test("rejeita horários impossíveis ou fora do formato", () => {
  for (const value of ["7:00", "24:00", "99:99", "12:60", "12:30:00"])
    assert.equal(isValidTime(value), false, value);
});

test("exige que o final do período seja posterior ao início", () => {
  assert.equal(isValidTimeRange("08:00", "14:20"), true);
  assert.equal(isValidTimeRange("14:20", "08:00"), false);
  assert.equal(isValidTimeRange("08:00", "08:00"), false);
  assert.equal(isValidTimeRange("99:99", "10:00"), false);
});

test("valida a existência real da data", () => {
  assert.equal(isValidDate("2028-02-29"), true);
  assert.equal(isValidDate("2026-02-29"), false);
  assert.equal(isValidDate("2026-04-31"), false);
  assert.equal(isValidDate("2026-13-01"), false);
});
