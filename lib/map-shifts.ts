export const MAP_SHIFTS = [
  { id: "morning", name: "Manhã", startTime: "08:00", endTime: "14:20" },
  {
    id: "afternoon",
    name: "Tarde",
    startTime: "14:20",
    endTime: "21:00",
  },
  { id: "extra", name: "Extra", startTime: "21:00", endTime: "07:00" },
] as const;

export type MapShift = (typeof MAP_SHIFTS)[number];

export function mapShiftBounds(date: string, shift: MapShift) {
  const crossesMidnight = shift.endTime <= shift.startTime;
  const start = new Date(`${date}T${shift.startTime}:00-03:00`);
  const endDate = crossesMidnight ? nextDate(date) : date;
  const end = new Date(`${endDate}T${shift.endTime}:00-03:00`);

  return { start, end, endDate };
}

function nextDate(date: string) {
  const value = new Date(`${date}T12:00:00-03:00`);
  value.setUTCDate(value.getUTCDate() + 1);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bahia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

export function mapShiftForNow(value: string) {
  const localTime = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Bahia",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
  if (localTime >= "08:00" && localTime < "14:20") return "morning";
  if (localTime >= "14:20" && localTime < "21:00") return "afternoon";
  return "extra";
}
