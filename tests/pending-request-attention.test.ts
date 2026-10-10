import assert from "node:assert/strict";
import test from "node:test";
import { pendingDutySnapshot, parsePendingDutyCache } from "../lib/pending-request-attention.ts";
import type { AppState, BookingRequest, Room } from "../lib/types.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function fixture(): AppState {
  const room = (n: number, assigned: boolean) => ({ id:id(n),name:`Sala ${n}`,active:true,
    approvalResponsibles:assigned ? [{id:id(1),name:"Ana",eligible:true}] : [] } as Room);
  const request = (n: number, roomId: string | null) => ({ id:id(n),roomId,roomName:roomId ? "Sala" : null,
    requesterName:"Instrutor",status:"pending",requestedDate:"2026-10-10",startTime:"14:20",endTime:"20:00",
    urgent:false,reason:"Dado que não deve ser persistido",requesterId:id(9) } as BookingRequest);
  return { currentUser:{id:id(1),name:"Ana",permissions:["booking.review"],isGod:false},
    now:"2026-10-10T20:00:00Z",rooms:[room(10,true),room(11,false),room(12,true)],
    requests:[request(20,id(10)),request(21,id(11)),request(22,null),request(23,id(12))] } as AppState;
}

test("destaca apenas salas atribuídas e pedidos de qualquer sala, sem duplicação", () => {
  const state=fixture();
  state.requests.push(state.requests[2]);
  assert.deepEqual(pendingDutySnapshot(state)?.requests.map(r=>r.id),[id(20),id(22),id(23)]);
  state.requests[0].status="approved";
  state.requests[2].status="rejected";
  assert.deepEqual(pendingDutySnapshot(state)?.requests.map(r=>r.id),[id(23)]);
});

test("God não recebe destaque sem atribuição; perda de análise, atribuição ou elegibilidade encerra o destaque", () => {
  for (const change of [
    (s: AppState) => { s.currentUser!.permissions=[]; },
    (s: AppState) => { s.rooms.forEach(r=>{r.active=false;}); },
    (s: AppState) => { s.rooms.forEach(r=>r.approvalResponsibles?.forEach(p=>{p.eligible=false;})); },
    (s: AppState) => { s.currentUser!.isGod=true;s.rooms.forEach(r=>{r.approvalResponsibles=[];}); },
    (s: AppState) => { s.currentUser=null; },
  ]) { const state=fixture();change(state);assert.equal(pendingDutySnapshot(state),null); }
});

test("resumo offline preserva só dados necessários e não expira decisões sem confirmação do servidor", () => {
  const snapshot=pendingDutySnapshot(fixture())!;
  const raw=JSON.stringify({...snapshot,permissions:["user.manage"],token:"secreto",requests:snapshot.requests.map(r=>({...r,reason:"secreto"}))});
  const parsed=parsePendingDutyCache(raw)!;
  assert.deepEqual(parsed,snapshot);
  assert.ok(!JSON.stringify(parsed).includes("secreto"));
  assert.equal(parsed.requests.length,3);
});

test("cache inválido, vazio, excessivo ou com pedidos duplicados não restaura o resumo", () => {
  const snapshot=pendingDutySnapshot(fixture())!;
  for (const raw of [null,"{", "x".repeat(2_000_001),JSON.stringify({...snapshot,userId:"falso"}),
    JSON.stringify({...snapshot,requests:[]}),JSON.stringify({...snapshot,version:2}),
    JSON.stringify({...snapshot,requests:[snapshot.requests[0],snapshot.requests[0]]}),
    JSON.stringify({...snapshot,requests:[{...snapshot.requests[0],startTime:"25:00"}]}),
  ]) assert.equal(parsePendingDutyCache(raw),null);
});
