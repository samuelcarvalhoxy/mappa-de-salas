import {
  addCalendarDays,
  bahiaDateKey,
  inclusiveDateRange,
  monthStart,
  nextMonthStart,
  startOfWeekMonday,
} from "./calendar-utils.ts";
import { MAP_SHIFTS, mapShiftBounds, type MapShift } from "./map-shifts.ts";

export type BulkCancellationScope = "day" | "week" | "month" | "future";

export type BulkCancellationFilters = {
  scope: BulkCancellationScope;
  anchorDate: string;
  roomId: string | null;
  userId: string | null;
  shiftIds: MapShift["id"][];
};

export type BulkCancellationPreview = {
  count: number;
  from: string;
  to: string | null;
  roomNames: string[];
  userNames: string[];
  firstStartsAt: string | null;
  lastEndsAt: string | null;
};

export type BulkReservationCandidate = {
  startsAt: string | Date;
  endsAt: string | Date;
};

function scopeDates(filters: BulkCancellationFilters) {
  if (filters.scope === "day") return [filters.anchorDate];
  if (filters.scope === "week") {
    const start = startOfWeekMonday(filters.anchorDate);
    return inclusiveDateRange(start, addCalendarDays(start, 6), 7);
  }
  if (filters.scope === "month") {
    const start = monthStart(filters.anchorDate);
    return inclusiveDateRange(
      start,
      addCalendarDays(nextMonthStart(filters.anchorDate), -1),
      31,
    );
  }
  return [];
}

function selectedShifts(filters: BulkCancellationFilters) {
  const selected = new Set(filters.shiftIds);
  return MAP_SHIFTS.filter((shift) => selected.has(shift.id));
}

export function bulkCancellationWindow(
  filters: BulkCancellationFilters,
  now = new Date(),
) {
  if (filters.scope === "future") {
    return { start: now, end: null as Date | null };
  }
  const intervals = scopeDates(filters).flatMap((date) =>
    selectedShifts(filters).map((shift) => mapShiftBounds(date, shift)),
  );
  if (!intervals.length) return { start: now, end: now };
  return {
    start: new Date(
      Math.min(...intervals.map((interval) => interval.start.getTime())),
    ),
    end: new Date(
      Math.max(...intervals.map((interval) => interval.end.getTime())),
    ),
  };
}

export function reservationMatchesBulkShifts(
  reservation: BulkReservationCandidate,
  filters: BulkCancellationFilters,
) {
  const start = new Date(reservation.startsAt);
  const end = new Date(reservation.endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;

  const dates =
    filters.scope === "future"
      ? inclusiveDateRange(
          addCalendarDays(bahiaDateKey(start), -1),
          bahiaDateKey(end),
          40,
        )
      : scopeDates(filters);
  return dates.some((date) =>
    selectedShifts(filters).some((shift) => {
      const interval = mapShiftBounds(date, shift);
      return start < interval.end && end > interval.start;
    }),
  );
}

export function isBulkScope(value: string): value is BulkCancellationScope {
  return ["day", "week", "month", "future"].includes(value);
}

export function validBulkShiftIds(values: unknown[]) {
  const valid = new Set(MAP_SHIFTS.map((shift) => shift.id));
  return Array.from(
    new Set(
      values
        .map(String)
        .filter((value): value is MapShift["id"] =>
          valid.has(value as MapShift["id"]),
        ),
    ),
  );
}
