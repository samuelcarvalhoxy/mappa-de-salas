import type { AppState } from "./types.ts";

export const PENDING_DUTY_CACHE_KEY = "mappa-pending-duty-v1";
export const DUTY_REMINDER_INTERVAL_MS = 3 * 60 * 1000;
export type PendingDutyRequest = {
  id: string; requesterName: string; roomName: string | null;
  requestedDate: string; startTime: string; endTime: string; urgent: boolean;
};
export type PendingDutySnapshot = {
  version: 1; userId: string; userName: string; confirmedAt: string;
  requests: PendingDutyRequest[];
};

export function pendingDutySnapshot(state: AppState): PendingDutySnapshot | null {
  const user = state.currentUser;
  if (!user || (!user.isGod && !user.permissions.includes("booking.review"))) return null;
  const roomIds = new Set(state.rooms.filter((room) => room.active && room.approvalResponsibles?.some((person) => person.id === user.id && person.eligible)).map((room) => room.id));
  if (!roomIds.size) return null;
  const unique = new Map(state.requests.filter((request) => request.status === "pending" &&
    (request.roomId ? roomIds.has(request.roomId) : roomIds.size > 0)).map((request) => [request.id, request]));
  if (!unique.size) return null;
  return { version: 1, userId: user.id, userName: user.name, confirmedAt: state.now,
    requests: [...unique.values()].map((request) => ({ id: request.id, requesterName: request.requesterName,
      roomName: request.roomName, requestedDate: request.requestedDate, startTime: request.startTime,
      endTime: request.endTime, urgent: request.urgent })) };
}

// Cache only the duty summary. Never store credentials, permissions or management data.
export function parsePendingDutyCache(raw: string | null): PendingDutySnapshot | null {
  if (!raw || raw.length > 2_000_000) return null;
  try {
    const value = JSON.parse(raw);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const text = (item: unknown): item is string => typeof item === "string" && item.length <= 500;
    if (!value || value.version !== 1 || !uuid.test(value.userId) || !text(value.userName) ||
      typeof value.confirmedAt !== "string" || !Number.isFinite(Date.parse(value.confirmedAt)) ||
      !Array.isArray(value.requests) || !value.requests.length || value.requests.length > 5000) return null;
    const ids = new Set<string>();
    const requests: PendingDutyRequest[] = [];
    for (const request of value.requests) {
      if (!request || typeof request.id !== "string" || !uuid.test(request.id) || ids.has(request.id) ||
        !text(request.requesterName) || !(request.roomName === null || text(request.roomName)) ||
        typeof request.requestedDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(request.requestedDate) ||
        !Number.isFinite(Date.parse(`${request.requestedDate}T12:00:00-03:00`)) ||
        ![request.startTime,request.endTime].every((stamp) => typeof stamp === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(stamp)) ||
        typeof request.urgent !== "boolean") return null;
      ids.add(request.id);
      requests.push({ id: request.id, requesterName: request.requesterName, roomName: request.roomName,
        requestedDate: request.requestedDate, startTime: request.startTime, endTime: request.endTime, urgent: request.urgent });
    }
    return { version: 1, userId: value.userId, userName: value.userName, confirmedAt: value.confirmedAt, requests };
  } catch { return null; }
}
