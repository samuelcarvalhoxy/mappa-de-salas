const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function dateAtNoon(value: string) {
  return new Date(`${value}T12:00:00-03:00`);
}

export function bahiaDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bahia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function addCalendarDays(value: string, amount: number) {
  const date = dateAtNoon(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return bahiaDateKey(date);
}

export function weekdayIndex(value: string) {
  if (!DATE_PATTERN.test(value)) return -1;
  return dateAtNoon(value).getUTCDay();
}

export function isSundayDate(value: string) {
  return weekdayIndex(value) === 0;
}

export function nextBusinessDate(value: string) {
  return isSundayDate(value) ? addCalendarDays(value, 1) : value;
}

export function startOfWeekMonday(value: string) {
  const weekday = weekdayIndex(value);
  if (weekday < 0) return value;
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1;
  return addCalendarDays(value, -daysSinceMonday);
}

export function inclusiveDateRange(
  start: string,
  end: string,
  maximum = 370,
) {
  const dates: string[] = [];
  let cursor = start;
  while (cursor <= end && dates.length < maximum) {
    dates.push(cursor);
    cursor = addCalendarDays(cursor, 1);
  }
  return dates;
}

export function businessDatesBetween(start: string, end: string) {
  return inclusiveDateRange(start, end, 31).filter(
    (date) => !isSundayDate(date),
  );
}

export function monthStart(value: string) {
  return `${value.slice(0, 7)}-01`;
}

export function nextMonthStart(value: string) {
  const start = dateAtNoon(monthStart(value));
  start.setUTCMonth(start.getUTCMonth() + 1);
  return bahiaDateKey(start);
}
