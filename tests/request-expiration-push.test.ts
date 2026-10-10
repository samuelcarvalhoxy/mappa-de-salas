import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

test("push de rejeição automática notifica e avisa as abas abertas", async () => {
  const listeners: Record<string, (event: unknown) => void> = {};
  const messages: unknown[] = [];
  const notifications: unknown[] = [];
  runInNewContext(readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'), {
    self: {
      addEventListener: (name: string, handler: (event: unknown) => void) => { listeners[name]=handler; },
      registration: { showNotification: async (title: string) => { notifications.push(title); } },
      clients: { matchAll: async () => [{ postMessage: (message: unknown) => { messages.push(JSON.stringify(message)); } }] },
    },
  });
  let finished: Promise<unknown> | undefined;
  listeners.push({data:{json:() => ({title:'Rejeição automática por omissão do Staff.',tag:'request-auto-rejection'})},waitUntil:(value: Promise<unknown>) => { finished=value; }});
  await finished;
  assert.deepEqual(notifications,['Rejeição automática por omissão do Staff.']);
  assert.deepEqual(messages,[JSON.stringify({type:'request-auto-rejection'})]);
  messages.length=0;
  listeners.push({data:{json:() => ({title:'Solicitação rejeitada automaticamente',tag:'request-auto-result'})},waitUntil:(value: Promise<unknown>) => { finished=value; }});
  await finished;
  assert.deepEqual(messages,[JSON.stringify({type:'request-auto-rejection'})]);
  assert.equal(notifications.at(-1),'Solicitação rejeitada automaticamente');
  messages.length=0;
  listeners.push({data:{json:() => ({title:'Lembrete',tag:'pending-request-reminder'})},waitUntil:(value: Promise<unknown>) => { finished=value; }});
  await finished;
  assert.deepEqual(messages,[]);
});
