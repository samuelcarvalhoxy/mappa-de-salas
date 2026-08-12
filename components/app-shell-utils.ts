import type { AppState, BookingRequest, Reservation } from "@/lib/types";

export type PaletteChoice = {
  primary: string;
  accent: string;
};

export const DEFAULT_PALETTE: PaletteChoice = {
  primary: "#7C3AED",
  accent: "#A78BFA",
};

export const BLUE_ORANGE_PALETTE: PaletteChoice = {
  primary: "#0A00BF",
  accent: "#FF7900",
};

function isHexColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value);
}

export function normalizedPalette(value: unknown): PaletteChoice | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PaletteChoice>;
  return isHexColor(candidate.primary || "") &&
    isHexColor(candidate.accent || "")
    ? {
        primary: candidate.primary!.toUpperCase(),
        accent: candidate.accent!.toUpperCase(),
      }
    : null;
}

function relativeLuminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function contrastRatio(hex: string, light = true) {
  const luminance = relativeLuminance(hex);
  const other = light ? 1 : 0;
  return (
    (Math.max(luminance, other) + 0.05) / (Math.min(luminance, other) + 0.05)
  );
}

export function time(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Horário indisponível"
    : new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Bahia",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

export function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Data indisponível"
    : new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Bahia",
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(date);
}

export function dateKey(value: string | Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bahia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function addDays(date: string, amount: number) {
  const next = new Date(`${date}T12:00:00-03:00`);
  next.setUTCDate(next.getUTCDate() + amount);
  return dateKey(next);
}

export function statusLabel(status: Reservation["status"]) {
  return status === "cancelled" ? "Cancelada" : "Reservada";
}

export function reservationShift(state: AppState, reservation: Reservation) {
  const start = time(reservation.startsAt);
  return (
    state.shifts.find(
      (shift) => start >= shift.startTime && start <= shift.endTime,
    )?.name || "Fora dos turnos"
  );
}

export function requestStatusLabel(status: BookingRequest["status"]) {
  return status === "approved"
    ? "Aprovada"
    : status === "rejected"
      ? "Rejeitada"
      : status === "cancelled"
        ? "Cancelada"
        : "Pendente";
}

export function requestDateLabel(value: string) {
  const date = new Date(`${value}T12:00:00-03:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Bahia",
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(date);
}

export function durationLabel(minutes: number) {
  const safe = Math.max(0, Math.round(minutes || 0));
  const hours = Math.floor(safe / 60);
  const remainder = safe % 60;
  return hours
    ? `${hours}h ${String(remainder).padStart(2, "0")}min`
    : `${remainder}min`;
}
