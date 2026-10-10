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
      await Promise.all([
        pushToUsers(ids(rows[0].staff_ids), {
          title: "Rejeição automática por omissão do Staff.",
          body: "Solicitações sob sua responsabilidade passaram do horário final sem resposta. Abra o Mappa para visualizar os detalhes.",
          url: "/?tab=requests", tag: "request-auto-rejection",
        }),
        pushToUsers(ids(rows[0].requester_ids), {
          title: "Solicitação rejeitada automaticamente",
          body: "O período de utilização solicitado terminou sem uma decisão. Consulte os detalhes da sua solicitação.",
          url: "/?tab=requests", tag: "request-auto-result",
        }),
      ]);
    });
  }
  return { expired };
}
