import type { NeonQueryFunction, NeonQueryFunctionInTransaction, NeonQueryInTransaction, NeonQueryPromise, HTTPTransactionOptions } from "@neondatabase/serverless";
import { unitContext } from "./unit-context.ts";

type Query = NeonQueryPromise<false,false>;
type Tx = NeonQueryFunctionInTransaction<false,false>;
export function scopedDatabase(raw: NeonQueryFunction<false,false>): NeonQueryFunction<false,false> {
  const context = unitContext.getStore();
  if (!context) throw new Error("UNIT_CONTEXT_REQUIRED");
  const prefix = (tx: Tx) => [tx.query("SET LOCAL ROLE mappa_runtime"),tx.query("SELECT set_config('mappa.unit_id',$1,true),set_config('mappa.actor_id',$2,true)",[context.unitId,context.actorId])];
  const query = (text: string,params?: unknown[]) => {
    const result = raw.query(text,params);
    const execute = () => raw.transaction(tx=>[...prefix(tx),result]).then(values=>values[2]);
    // Neon reads queryData/opts when batching; individual awaits use the same scoped transaction.
    return new Proxy(result, {get(target,key) {
      if (key === "then") return (resolve: (value: unknown) => unknown,reject: (error: unknown) => unknown) => execute().then(resolve,reject);
      if (key === "catch") return (reject: (error: unknown) => unknown) => execute().catch(reject);
      return Reflect.get(target,key);
    }});
  };
  const transaction = (queries: Query[] | ((tx: Tx)=>NeonQueryInTransaction[]),options?: HTTPTransactionOptions<false,false>) =>
    raw.transaction(tx=>[...prefix(tx),...(typeof queries === "function" ? queries(tx) : queries)],options).then(results=>results.slice(2));
  return new Proxy(raw,{apply(){throw new Error("Use sql().query() for scoped queries");},get(target,key){if(key==="query")return query;if(key==="transaction")return transaction;return Reflect.get(target,key);}});
}
