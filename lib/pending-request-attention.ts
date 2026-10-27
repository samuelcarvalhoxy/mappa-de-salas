import type { AppState } from "./types.ts";

export const PENDING_DUTY_CACHE_KEY = "mappa-pending-duty-v2";
export const DUTY_REMINDER_INTERVAL_MS = 3 * 60 * 1000;
export type PendingDutyRequest = {
  unitId: string; unitCode: string; unitName: string; id: string; requesterName: string; roomName: string | null;
  requestedDate: string; startTime: string; endTime: string; urgent: boolean;
};
export type PendingDutySnapshot = {
  version: 2; unitId: string; unitCode: string; userId: string; userName: string; confirmedAt: string;
  requests: PendingDutyRequest[];
};

export function pendingDutySnapshot(state: AppState): PendingDutySnapshot | null {
  const user = state.currentUser;
  if (!user || (!user.isGod && !user.permissions.includes("booking.review") && !state.additionalDutyRequests?.length)) return null;
  const roomIds = new Set(state.rooms.filter((room) => room.active && room.approvalResponsibles?.some((person) => person.id === user.id && person.eligible)).map((room) => room.id));
  if (!state.activeUnit) return null;
  const unique = new Map(state.requests.filter((request) => request.status === "pending" &&
    (request.roomId ? roomIds.has(request.roomId) : roomIds.size > 0)).map((request) => [request.id, request]));
  if (!unique.size && !state.additionalDutyRequests?.length) return null;
  const requests: PendingDutyRequest[]=[...unique.values()].map(request=>({unitId:state.activeUnit!.id,unitCode:state.activeUnit!.code,unitName:state.activeUnit!.name,id:request.id,requesterName:request.requesterName,roomName:request.roomName,requestedDate:request.requestedDate,startTime:request.startTime,endTime:request.endTime,urgent:request.urgent}));
  for (const request of state.additionalDutyRequests || []) if (!requests.some(item=>item.id===request.id)) requests.push({unitId:request.unitId,unitCode:request.unitCode,unitName:request.unitName,id:request.id,requesterName:request.requesterName,roomName:request.roomName,requestedDate:request.requestedDate,startTime:request.startTime,endTime:request.endTime,urgent:request.urgent});
  if (!requests.length) return null;
  return {version:2,unitId:state.activeUnit.id,unitCode:state.activeUnit.code,userId:user.id,userName:user.name,confirmedAt:state.now,requests};
}

// Cache only the duty summary. Never store credentials, permissions or management data.
export function parsePendingDutyCache(raw: string | null): PendingDutySnapshot | null {
  if (!raw || raw.length > 2_000_000) return null;
  try {
    const value = JSON.parse(raw);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const text = (item: unknown): item is string => typeof item === "string" && item.length <= 500;
    if (!value || value.version !== 2 || !uuid.test(value.unitId) || !text(value.unitCode) || !uuid.test(value.userId) || !text(value.userName) ||
      typeof value.confirmedAt !== "string" || !Number.isFinite(Date.parse(value.confirmedAt)) ||
      !Array.isArray(value.requests) || !value.requests.length || value.requests.length > 5000) return null;
    const ids = new Set<string>();
    const requests: PendingDutyRequest[] = [];
    for (const request of value.requests) {
      if (!request || !uuid.test(request.unitId) || !text(request.unitCode) || !text(request.unitName) || typeof request.id !== "string" || !uuid.test(request.id) || ids.has(request.id) ||
        !text(request.requesterName) || !(request.roomName === null || text(request.roomName)) ||
        typeof request.requestedDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(request.requestedDate) ||
        !Number.isFinite(Date.parse(`${request.requestedDate}T12:00:00-03:00`)) ||
        ![request.startTime,request.endTime].every((stamp) => typeof stamp === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(stamp)) ||
        typeof request.urgent !== "boolean") return null;
      ids.add(request.id);
      requests.push({ unitId:request.unitId,unitCode:request.unitCode,unitName:request.unitName,id: request.id, requesterName: request.requesterName, roomName: request.roomName,
        requestedDate: request.requestedDate, startTime: request.startTime, endTime: request.endTime, urgent: request.urgent });
    }
    return { version: 2, unitId:value.unitId,unitCode:value.unitCode,userId: value.userId, userName: value.userName, confirmedAt: value.confirmedAt, requests };
  } catch { return null; }
}

export function writePendingDutyCache(snapshot: PendingDutySnapshot | null,identity?: {userId:string;unitId:string;unitCode:string}) {
  if (!snapshot) {
    if(identity) {
      const key=`${PENDING_DUTY_CACHE_KEY}:${identity.userId}:${identity.unitId}`;
      localStorage.removeItem(key);localStorage.removeItem(`${PENDING_DUTY_CACHE_KEY}:unit:${identity.unitId}`);localStorage.removeItem(`${PENDING_DUTY_CACHE_KEY}:unit:${identity.unitCode}`);
      if(localStorage.getItem(PENDING_DUTY_CACHE_KEY)===key)localStorage.removeItem(PENDING_DUTY_CACHE_KEY);
    }
    return;
  }
  const key=`${PENDING_DUTY_CACHE_KEY}:${snapshot.userId}:${snapshot.unitId}`;
  localStorage.setItem(key,JSON.stringify(snapshot));localStorage.setItem(`${PENDING_DUTY_CACHE_KEY}:unit:${snapshot.unitCode}`,key);localStorage.setItem(`${PENDING_DUTY_CACHE_KEY}:unit:${snapshot.unitId}`,key);localStorage.setItem(PENDING_DUTY_CACHE_KEY,key);
}
export function clearPendingDutyCache() {
  const keys=[];
  for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith(PENDING_DUTY_CACHE_KEY))keys.push(key);}
  for(const key of keys)localStorage.removeItem(key);
  localStorage.removeItem("mappa-pending-duty-v1");
}
export function readPendingDutyCache() {
  const requested=typeof window!=="undefined" ? new URLSearchParams(window.location.search).get("unit") : null;
  const key=localStorage.getItem(requested ? `${PENDING_DUTY_CACHE_KEY}:unit:${requested}` : PENDING_DUTY_CACHE_KEY);
  if (!key?.startsWith(`${PENDING_DUTY_CACHE_KEY}:`)) return null;
  const snapshot=parsePendingDutyCache(localStorage.getItem(key));
  return snapshot && (!requested || requested===snapshot.unitCode || requested===snapshot.unitId) ? snapshot : null;
}
