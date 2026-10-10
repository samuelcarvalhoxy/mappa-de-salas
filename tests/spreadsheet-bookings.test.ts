import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Reservation, Room } from "../lib/types.ts";
import { captureSheetSelection, prepareSheetTransfer, parseSheetTransfer, changeSheetEntryStart } from "../lib/spreadsheet-bookings.ts";
import { SHEET_TRANSFER_LOCK_SQL, SHEET_TRANSFER_SQL } from "../lib/spreadsheet-bookings-sql.ts";

const actor = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const roomA = "00000000-0000-4000-8000-000000000003";
const roomB = "00000000-0000-4000-8000-000000000004";
const idA = "00000000-0000-4000-8000-000000000005";
const idB = "00000000-0000-4000-8000-000000000006";
const idC = "00000000-0000-4000-8000-000000000007";
const rooms = [{ id: roomA, name: "Sala A" }, { id: roomB, name: "Sala B" }] as Room[];
// Monday and Tuesday; dates far in the future keep the server-time tests stable.
const dates = ["2099-10-05", "2099-10-06", "2099-10-07", "2099-10-08", "2099-10-09", "2099-10-10", "2099-10-11"];
const reservation = { id: idA, roomId: roomA, userId: other, userName: "Instrutor", reason: "Treinamento",
  startsAt: "2099-10-05T09:20:00-03:00", endsAt: "2099-10-05T10:20:00-03:00",
  status: "reserved", shareable: false, expectedPeople: 10 } as Reservation;

function clipboard(mode: "copy" | "move" = "copy", source = reservation) {
  return captureSheetSelection({ anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } },
    rooms, dates, new Map([[`${roomA}:${dates[0]}:morning`, [source]]]), mode);
}
function transfer(mode: "copy" | "move" = "copy", source = reservation) {
  return prepareSheetTransfer(clipboard(mode, source), { row: 3, column: 1 }, rooms, dates);
}

test("copia uma célula para outra sala, dia e turno preservando duração e minutos", () => {
  const result = transfer();
  assert.equal(result.entries[0].roomId, roomB);
  assert.equal(result.entries[0].startsAt, "2099-10-06T18:40:00.000Z"); // 15:40 in Bahia
  assert.equal(result.entries[0].endsAt, "2099-10-06T19:40:00.000Z");
  assert.equal(parseSheetTransfer(result).entries.length, 1);
});
test("seleção retangular preserva offsets, células vazias e todas as reservas da célula", () => {
  const second = { ...reservation, id: idB, startsAt: "2099-10-05T11:00:00-03:00", endsAt: "2099-10-05T12:00:00-03:00" };
  const selection = captureSheetSelection({ anchor: { row: 1, column: 1 }, focus: { row: 0, column: 0 } }, rooms, dates,
    new Map([[`${roomA}:${dates[0]}:morning`, [reservation, second]]]), "copy");
  assert.equal(selection.items.length, 2);
  assert.equal(selection.rows, 2);
  assert.equal(selection.columns, 2);
  assert.equal(selection.text.split("\n").length, 2);
  assert.equal(prepareSheetTransfer(selection, { row: 2, column: 2 }, rooms, dates).entries.length, 2);
});
test("uma reserva que cruza turnos é movida uma única vez", () => {
  const spanning = { ...reservation, endsAt: "2099-10-05T16:00:00-03:00" };
  const selection = captureSheetSelection({ anchor: { row: 0, column: 0 }, focus: { row: 2, column: 0 } }, rooms, dates,
    new Map([[`${roomA}:${dates[0]}:morning`, [spanning]], [`${roomA}:${dates[0]}:afternoon`, [spanning]]]), "move");
  assert.equal(selection.items.length, 1);
});
test("turno Extra e ajustes da prévia preservam a duração após meia-noite", () => {
  const source = { ...reservation, startsAt: "2099-10-05T22:00:00-03:00", endsAt: "2099-10-06T03:00:00-03:00" };
  const selection = captureSheetSelection({ anchor: { row: 4, column: 0 }, focus: { row: 4, column: 0 } }, rooms, dates,
    new Map([[`${roomA}:${dates[0]}:extra`, [source]]]), "move");
  const entry = prepareSheetTransfer(selection, { row: 5, column: 1 }, rooms, dates).entries[0];
  assert.equal(entry.endsAt, "2099-10-07T06:00:00.000Z");
  assert.equal(changeSheetEntryStart(entry, "2099-10-07", "23:30").endsAt, "2099-10-08T07:30:00.000Z");
});
test("rejeita domingo, intervalo fora da grade, passado e payload adulterado", () => {
  assert.throws(() => prepareSheetTransfer(clipboard(), { row: 0, column: 6 }, rooms, dates), /Domingos/);
  assert.throws(() => prepareSheetTransfer(clipboard(), { row: 6, column: 0 }, rooms, dates), /ultrapassa/);
  const result = transfer();
  assert.throws(() => parseSheetTransfer({ ...result, entries: [result.entries[0], result.entries[0]] }), /repetidos/);
  assert.throws(() => parseSheetTransfer({ ...result, entries: [{ ...result.entries[0], endsAt: "2099-10-06T20:00:00Z" }] }), /duração/);
  assert.throws(() => parseSheetTransfer(result, new Date("2100-01-01")), /futuros/);
});

const db = new PGlite();
before(async () => {
  await db.exec(`CREATE TABLE rooms(id uuid PRIMARY KEY,name text,active boolean DEFAULT true);
    CREATE TABLE users(id uuid PRIMARY KEY,active boolean DEFAULT true,deleted_at timestamptz);
    CREATE TABLE reservations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),room_id uuid REFERENCES rooms(id),
      user_id uuid REFERENCES users(id),reason text,starts_at timestamptz,ends_at timestamptz,shareable boolean DEFAULT false,
      expected_people int DEFAULT 10,status text DEFAULT 'reserved',created_by uuid,series_id uuid,updated_at timestamptz DEFAULT now());
    CREATE TABLE audit_log(id uuid DEFAULT gen_random_uuid(),actor_id uuid,action text,details text);
    CREATE TABLE notifications(id uuid DEFAULT gen_random_uuid(),user_id uuid,title text,body text,url text);
    INSERT INTO rooms VALUES ('${roomA}','Sala A',true),('${roomB}','Sala B',true);
    INSERT INTO users(id) VALUES ('${actor}'),('${other}');`);
});
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec("TRUNCATE reservations,audit_log,notifications;");
  await db.query(`INSERT INTO reservations(id,room_id,user_id,reason,starts_at,ends_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [reservation.id,roomA,other,reservation.reason,reservation.startsAt,reservation.endsAt]);
});
async function apply(value = transfer(), permissions = [true, true, true, true], replace = false) {
  return db.transaction(async (tx) => {
    await tx.query(SHEET_TRANSFER_LOCK_SQL);
    return (await tx.query<{ applied_count: number; invalid_count: number; conflict_count: number; internal_count: number; displaced_count: number }>(SHEET_TRANSFER_SQL,
      [JSON.stringify(value.entries), value.mode, actor, ...permissions, replace])).rows[0];
  });
}
async function counts() {
  return (await db.query<{ reservations: number; audits: number; notifications: number }>(`SELECT
    (SELECT count(*)::int FROM reservations) reservations,(SELECT count(*)::int FROM audit_log) audits,
    (SELECT count(*)::int FROM notifications) notifications`)).rows[0];
}

test("cópia cria reserva nova, mantém a origem e registra auditoria e notificação", async () => {
  assert.equal((await apply()).applied_count, 1);
  assert.deepEqual(await counts(), { reservations: 2, audits: 1, notifications: 1 });
  assert.equal((await db.query<{ room_id: string }>(`SELECT room_id FROM reservations WHERE id=$1`, [idA])).rows[0].room_id, roomA);
});
test("recorte mantém o ID e move somente a ocorrência selecionada", async () => {
  const result = await apply(transfer("move"));
  assert.equal(result.applied_count, 1);
  assert.deepEqual(await counts(), { reservations: 1, audits: 1, notifications: 1 });
  assert.equal((await db.query<{ room_id: string }>(`SELECT room_id FROM reservations WHERE id=$1`, [idA])).rows[0].room_id, roomB);
});
test("permissão própria não move reserva de outra pessoa e copia em nome do ator", async () => {
  const restricted = [false, true, false, true];
  assert.equal((await apply(transfer("move"), restricted)).applied_count, 0);
  assert.equal((await counts()).audits, 0);
  assert.equal((await apply(transfer("copy"), restricted)).applied_count, 1);
  assert.equal((await db.query<{ user_id: string }>(`SELECT user_id FROM reservations WHERE id<>$1`, [idA])).rows[0].user_id, actor);
});
test("conflito cancela toda aplicação até confirmação explícita de substituição", async () => {
  const value = transfer();
  await db.query(`INSERT INTO reservations(id,room_id,user_id,reason,starts_at,ends_at) VALUES ($1,$2,$3,'Conflito',$4,$5)`,
    [idC, roomB,actor,value.entries[0].startsAt,value.entries[0].endsAt]);
  const blocked = await apply(value);
  assert.equal(blocked.conflict_count, 1);
  assert.equal(blocked.applied_count, 0);
  assert.equal((await counts()).audits, 0);
  const confirmed = await apply(value, undefined, true);
  assert.equal(confirmed.applied_count, 1);
  assert.equal(confirmed.displaced_count, 1);
  assert.equal((await db.query<{ status: string }>(`SELECT status FROM reservations WHERE id=$1`, [idC])).rows[0].status, "cancelled");
});
test("versão desatualizada bloqueia o lote inteiro sem mover outras reservas", async () => {
  const sourceB = { ...reservation, id: idB, startsAt: "2099-10-05T11:00:00-03:00", endsAt: "2099-10-05T12:00:00-03:00" };
  await db.query(`INSERT INTO reservations(id,room_id,user_id,reason,starts_at,ends_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [idB,roomA,other,sourceB.reason,sourceB.startsAt,sourceB.endsAt]);
  const value = transfer("move");
  value.entries.push(transfer("move", sourceB).entries[0]);
  await db.query(`UPDATE reservations SET reason='Alterado por outro analista' WHERE id=$1`, [idB]);
  const blocked = await apply(value);
  assert.equal(blocked.invalid_count, 1);
  assert.equal(blocked.applied_count, 0);
  assert.equal((await counts()).audits, 0);
  assert.equal((await db.query<{ room_id: string }>(`SELECT room_id FROM reservations WHERE id=$1`, [idA])).rows[0].room_id, roomA);
});
test("sobreposição entre destinos da própria seleção é recusada mesmo com substituição", async () => {
  const sourceB = { ...reservation, id: idB, startsAt: "2099-10-05T11:00:00-03:00", endsAt: "2099-10-05T12:00:00-03:00" };
  await db.query(`INSERT INTO reservations(id,room_id,user_id,reason,starts_at,ends_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [idB,roomA,other,sourceB.reason,sourceB.startsAt,sourceB.endsAt]);
  const value = transfer();
  value.entries.push({ ...transfer("copy", sourceB).entries[0], startsAt: value.entries[0].startsAt, endsAt: value.entries[0].endsAt });
  const result = await apply(value, undefined, true);
  assert.equal(result.internal_count, 1);
  assert.equal(result.applied_count, 0);
  assert.deepEqual(await counts(), { reservations: 2, audits: 0, notifications: 0 });
});
test("servidor bloqueia sala inativa, domingo e destino passado", async () => {
  await db.query(`UPDATE rooms SET active=false WHERE id=$1`, [roomB]);
  assert.equal((await apply()).invalid_count, 1);
  await db.query(`UPDATE rooms SET active=true WHERE id=$1`, [roomB]);
  const value = transfer();
  value.entries[0] = changeSheetEntryStart(value.entries[0], "2099-10-11", "15:00");
  assert.equal((await apply(value)).applied_count, 0);
  value.entries[0] = changeSheetEntryStart(value.entries[0], "2000-01-01", "15:00");
  assert.equal((await apply(value)).applied_count, 0);
});
test("move duas reservas trocando salas sem cancelar as reservas da própria seleção", async () => {
  const sourceB = { ...reservation, id: idB, roomId: roomB };
  await db.query(`INSERT INTO reservations(id,room_id,user_id,reason,starts_at,ends_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [idB,roomB,other,sourceB.reason,sourceB.startsAt,sourceB.endsAt]);
  const first = transfer("move").entries[0];
  const second = { ...first, reservationId: idB, expectedRoomId: roomB, roomId: roomA };
  first.startsAt = reservation.startsAt; first.endsAt = reservation.endsAt;
  second.startsAt = reservation.startsAt; second.endsAt = reservation.endsAt;
  const result = await apply({ mode: "move", entries: [first,second] });
  assert.equal(result.applied_count,2);
  assert.equal(result.conflict_count,0);
  assert.equal(result.displaced_count,0);
  const rows = (await db.query<{ id: string; room_id: string }>(`SELECT id,room_id FROM reservations ORDER BY id`)).rows;
  assert.deepEqual(rows,[{id:idA,room_id:roomB},{id:idB,room_id:roomA}]);
});
