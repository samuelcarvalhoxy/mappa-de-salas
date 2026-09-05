import assert from "node:assert/strict";
import test from "node:test";
import {
  addCalendarDays,
  businessDatesBetween,
  inclusiveDateRange,
  isSundayDate,
  nextBusinessDate,
  nextMonthStart,
  startOfWeekMonday,
} from "../lib/calendar-utils.ts";

test("organiza a semana de segunda a domingo", () => {
  assert.equal(startOfWeekMonday("2026-09-05"), "2026-08-31");
  assert.equal(startOfWeekMonday("2026-09-06"), "2026-08-31");
  assert.deepEqual(
    inclusiveDateRange("2026-08-31", "2026-09-06"),
    [
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
    ],
  );
});

test("retira domingos das datas úteis de um período", () => {
  assert.equal(isSundayDate("2026-09-06"), true);
  assert.equal(nextBusinessDate("2026-09-06"), "2026-09-07");
  assert.deepEqual(businessDatesBetween("2026-09-04", "2026-09-08"), [
    "2026-09-04",
    "2026-09-05",
    "2026-09-07",
    "2026-09-08",
  ]);
});

test("avança datas e meses sem depender do fuso do servidor", () => {
  assert.equal(addCalendarDays("2028-02-28", 1), "2028-02-29");
  assert.equal(nextMonthStart("2028-02-20"), "2028-03-01");
});
