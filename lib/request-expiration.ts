import { sql } from "./db";
import { pushToUsers } from "./push";
import { EXPIRE_BOOKING_REQUESTS_SQL } from "./request-expiration-sql";
import { after } from "next/server";

export async function expireBookingRequests() {
  const rows = await sql().query(EXPIRE_BOOKING_REQUESTS_SQL);
  const expired = Number(rows[0]?.expired_count) || 0;
  if (expired) {
    const ids = (value: unknown): string[] => Array.isArray(value) ? value.map(String) : [];
    // The persistent in-app alert is delivered without waiting for the push provider.
    after(async () => {
      await pushToUsers([...new Set([...ids(rows[0].staff_ids), ...ids(rows[0].requester_ids)])], {
        title: "Rejeição automática por omissão do Staff.",
        body: `${expired} pedido(s) passaram do horário final sem resposta. Abra o Mappa para visualizar os detalhes.`,
        url: "/?tab=requests", tag: "request-auto-rejection",
      });
    });
  }
  return { expired };
}
