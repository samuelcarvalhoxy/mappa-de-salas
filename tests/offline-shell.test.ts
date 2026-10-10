import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

function worker() {
  const listeners: Record<string,(event: unknown)=>void>={};
  const batches: string[][]=[];
  const shell=new Response('<script src="/_next/static/a.js"></script><link href="/_next/static/b.css?v=1"><script src="/_next/static/a.js"></script>');
  const cache={addAll:async (urls:string[])=>{batches.push(Array.from(urls));},match:async()=>shell,put:async()=>{}};
  let fetches=0;
  runInNewContext(readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),{
    self:{location:{origin:"https://mappa.test"},addEventListener:(name:string,fn:(e:unknown)=>void)=>{listeners[name]=fn;},skipWaiting:async()=>{}},
    caches:{open:async()=>cache,match:async(request: Request|string)=>typeof request==="string" ? shell : request.url.includes("cached.js") ? new Response("cached JS") : undefined},
    fetch:async()=>{fetches++;throw new Error("offline");},URL,Response,
  });
  return {listeners,batches,getFetches:()=>fetches};
}

test("instalação guarda HTML e arquivos estáticos para recarregar offline",async()=>{
  const w=worker();let done:Promise<unknown>|undefined;
  w.listeners.install({waitUntil:(promise:Promise<unknown>)=>{done=promise;}});await done;
  assert.deepEqual(w.batches,[["/","/manifest.webmanifest","/icon.svg"],["/_next/static/a.js","/_next/static/b.css?v=1"]]);
});

test("offline usa JS em cache e HTML só para navegações; API e outras origens não são interceptadas",async()=>{
  const w=worker();
  async function get(path:string,mode="cors") {
    let result:Promise<Response>|undefined;
    w.listeners.fetch({request:{url:path.startsWith("http")?path:`https://mappa.test${path}`,method:"GET",mode},respondWith:(r:Promise<Response>)=>{result=r;}});
    return result;
  }
  assert.equal(await (await get("/_next/static/cached.js"))!.text(),"cached JS");
  assert.equal(w.getFetches(),0);
  assert.match(await (await get("/rooms","navigate"))!.text(),/script/);
  assert.equal((await get("/missing.svg"))!.type,"error");
  assert.equal(await get("/api/state"),undefined);
  assert.equal(await get("https://other.test/foo"),undefined);
});
