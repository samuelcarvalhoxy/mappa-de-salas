"use client";

import { BellRing, ClipboardList, RefreshCw } from "lucide-react";
import type { RefObject } from "react";
import type { PendingDutySnapshot } from "@/lib/pending-request-attention";

export function PendingRequestBanner({ snapshot, offline, onOpen }: {
  snapshot: PendingDutySnapshot; offline: boolean; onOpen: () => void;
}) {
  return <aside className="pending-request-banner" aria-label="Solicitações sob sua responsabilidade" role="status">
    <BellRing size={20} aria-hidden="true" />
    <div><strong>{snapshot.requests.length} solicitação(ões) aguardando sua resposta</strong>
      <p>{offline ? "Sem conexão. Pendências da última sincronização; as decisões serão conferidas ao reconectar." : "Você é responsável por aprovar ou rejeitar esses pedidos. O destaque permanece até serem respondidos."}</p>
    </div>
    <button className="btn" type="button" onClick={onOpen}>Ver solicitações</button>
  </aside>;
}

export function PendingRequestEffects({ rippleRef, reminderVisible, count }: {
  rippleRef: RefObject<HTMLDivElement | null>; reminderVisible: boolean; count: number;
}) {
  return <>
    <div ref={rippleRef} className="pending-request-waves" aria-hidden="true"><i /><i /></div>
    {reminderVisible && <div className="pending-request-reminder" role="status"><BellRing size={19} />{count} pedido(s) sob sua responsabilidade aguardam resposta.</div>}
  </>;
}

export function OfflinePendingRequests({ snapshot, rootRef, buttonRef, rippleRef, reminderVisible, onReconnect, onClear }: {
  snapshot: PendingDutySnapshot; rootRef: RefObject<HTMLDivElement | null>;
  buttonRef: RefObject<HTMLButtonElement | null>; rippleRef: RefObject<HTMLDivElement | null>;
  reminderVisible: boolean; onReconnect: () => void; onClear: () => void;
}) {
  return <div ref={rootRef} className="app-layout pending-duty offline-duty">
    <aside id="app-sidebar" className="sidebar"><div className="sidebar-head"><strong>Mappa</strong></div>
      <nav><button ref={buttonRef} className="active responsible-pending" type="button" onClick={() => document.getElementById("offline-duty-list")?.scrollIntoView()} aria-label={`Solicitações (${snapshot.requests.length})`}>
        <ClipboardList size={19} /><span>Solicitações ({snapshot.requests.length})</span>
      </button></nav><div className="sidebar-foot"><p>{snapshot.userName}</p><button type="button" onClick={onClear}>Apagar pendências deste dispositivo</button></div>
    </aside>
    <main><header className="topbar"><div><h1>Solicitações recebidas</h1><p>Consulta offline, sem acesso à conta</p></div>
      <button className="btn btn-soft" type="button" onClick={onReconnect}><RefreshCw size={16} /> Reconectar</button>
    </header><div className="content">
      <PendingRequestBanner snapshot={snapshot} offline onOpen={() => document.getElementById("offline-duty-list")?.scrollIntoView()} />
      <p className="field-help">Última confirmação: {new Date(snapshot.confirmedAt).toLocaleString("pt-BR",{timeZone:"America/Bahia"})}. Novos pedidos e decisões exigem conexão. Para analisar, reconecte e valide sua sessão.</p>
      <div id="offline-duty-list" className="request-list">{snapshot.requests.map((request) => <article className="request-card" key={request.id}>
        <div className="request-main"><strong>{request.requesterName}</strong><p>{request.roomName || "Qualquer sala disponível"}</p>
          <p>{request.requestedDate.split("-").reverse().join("/")}, das {request.startTime} às {request.endTime}{request.endTime <= request.startTime ? " do dia seguinte" : ""}</p>
          <span className="mini-status pending">Aguardava resposta na última sincronização</span>
        </div>
      </article>)}</div>
    </div></main>
    <PendingRequestEffects rippleRef={rippleRef} reminderVisible={reminderVisible} count={snapshot.requests.length} />
  </div>;
}
