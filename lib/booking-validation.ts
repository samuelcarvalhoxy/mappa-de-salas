import { addCalendarDays, isSundayDate } from "./calendar-utils.ts";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function isValidDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isValidTime(value: string) {
  return TIME_PATTERN.test(value);
}

export function isValidTimeRange(startTime: string, endTime: string) {
  return (
    isValidTime(startTime) &&
    isValidTime(endTime) &&
    endTime !== startTime
  );
}

export function reservationTimestampStrings(
  date: string,
  startTime: string,
  endTime: string,
) {
  const endDate = endTime <= startTime ? addCalendarDays(date, 1) : date;
  return {
    startsAt: `${date}T${startTime}:00-03:00`,
    endsAt: `${endDate}T${endTime}:00-03:00`,
  };
}

export function isBookingStartInPast(
  date: string,
  startTime: string,
  now = new Date(),
) {
  if (!isValidDate(date) || !isValidTime(startTime)) return false;
  return new Date(`${date}T${startTime}:00-03:00`).getTime() <= now.getTime();
}

export function isBookableBusinessDate(date: string) {
  return isValidDate(date) && !isSundayDate(date);
}
