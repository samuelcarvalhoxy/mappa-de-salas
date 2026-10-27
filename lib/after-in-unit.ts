import { after } from "next/server";
import { unitContext } from "./unit-context";

// Preserve the unit even when a deferred task runs after a different request/cron iteration.
export function afterInUnit(callback: ()=>Promise<void>) {
  const context=unitContext.getStore();
  after(()=>context ? unitContext.run(context,callback) : callback());
}
