import { AsyncLocalStorage } from "node:async_hooks";
export type UnitContext = { unitId: string; unitCode: string; unitName: string; actorId: string; isGod: boolean };
export const unitContext = new AsyncLocalStorage<UnitContext>();
