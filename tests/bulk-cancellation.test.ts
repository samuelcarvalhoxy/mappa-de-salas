import assert from "node:assert/strict";
import test from "node:test";
import {
  bulkCancellationWindow,
  reservationMatchesBulkShifts,
  validBulkShiftIds,
  type BulkCancellationFilters,
} from "../lib/bulk-cancellation.ts";

const filters: BulkCancellationFilters = {
  scope: "day",
  anchorDate: "2026-09-05",
  roomId: null,
  userId: null,
  shiftIds: ["morning", "afternoon", "extra"],
};

test("cobre todos os turnos do dia, inclusive o Extra após a meia-noite", () => {
  const window = bulkCancellationWindow(filters);
  assert.equal(window.start.toISOString(), "2026-09-05T11:00:00.000Z");
  assert.equal(window.end?.toISOString(), "2026-09-06T10:00:00.000Z");
  assert.equal(
    reservationMatchesBulkShifts(
      {
        startsAt: "2026-09-06T01:00:00.000Z",
        endsAt: "2026-09-06T03:00:00.000Z",
      },
      filters,
    ),
    true,
  );
});

test("permite limitar o cancelamento a somente um turno", () => {
  const morningOnly: BulkCancellationFilters = {
    ...filters,
    shiftIds: ["morning"],
  };
  assert.equal(
    reservationMatchesBulkShifts(
      {
        startsAt: "2026-09-05T18:00:00.000Z",
        endsAt: "2026-09-05T20:00:00.000Z",
      },
      morningOnly,
    ),
    false,
  );
});

test("descarta identificadores de turno adulterados", () => {
  assert.deepEqual(
    validBulkShiftIds(["morning", "invalid", "extra", "morning"]),
    ["morning", "extra"],
  );
});
