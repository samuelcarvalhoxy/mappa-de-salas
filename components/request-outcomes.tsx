"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { AppState, RequestDecisionStats } from "@/lib/types";

export function RequestExpiryDialog({ alerts, onAcknowledge }: {
  alerts: AppState["requestExpiryAlerts"];
  onAcknowledge: (id: string) => Promise<void>;
}) {
  const alert = alerts[0];
  const alertId = alert?.id;
  const titleId = useId();
  const descriptionId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!alertId) return;
    const previous = document.activeElement as HTMLElement | null;
    button.current?.focus();
    return () => { previous?.focus(); };
  }, [alertId]);
  if (!alert) return null;
  const acknowledge = async () => {
    setBusy(true);
    setError("");
    try { await onAcknowledge(alert.id); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível confirmar. Tente novamente."); }
    finally { setBusy(false); }
  };
  return (
    <div className="modal-backdrop request-expiry-backdrop" onKeyDown={(event) => {
      // Neither Escape nor a click outside acknowledges a staff omission.
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); }
      if (event.key === "Tab") { event.preventDefault(); button.current?.focus(); }
    }}>
      <section className="modal" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
        <div className="modal-head"><div>
          <h2 id={titleId}>Rejeição automática por omissão do Staff.</h2>
          <p>Aviso {alerts.length > 1 ? `pendente (${alerts.length} avisos aguardando OK)` : "pendente"}</p>
        </div></div>
        <div className="modal-form">
          <p id={descriptionId}>{alert.message}</p>
          <p className="field-help">Este aviso permanece até você clicar em OK. Cada analista confirma sua própria ciência.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button ref={button} type="button" className="btn btn-primary" aria-disabled={busy} onClick={() => { if (!busy) void acknowledge(); }}>
              {busy ? "Confirmando..." : "OK"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export function RequestOutcomeSummary({ data, title }: { data: RequestDecisionStats; title: string }) {
  return <div className="panel request-outcomes">
    <div className="panel-head"><div><h2>{title}</h2>
      <p>Decisões registradas, separadas por tipo. Os totais acumulados são preservados após a retenção dos detalhes.</p>
    </div></div>
    <div className="stats-table-wrap"><table className="stats-table">
      <thead><tr><th>Decisão</th><th>Últimos 90 dias</th><th>Acumulado</th></tr></thead>
      <tbody>{([
        ["approved", "Aprovações"], ["manualRejected", "Rejeições manuais"],
        ["automaticRejected", "Rejeições automáticas por omissão do Staff"],
      ] as const).map(([key, label]) => <tr key={key}>
        <td data-label="Decisão">{label}</td>
        <td data-label="Últimos 90 dias">{data.recent90Days[key]}</td>
        <td data-label="Acumulado">{data.accumulated[key]}</td>
      </tr>)}</tbody>
    </table></div>
    <p className="field-help">O acumulado inclui as decisões disponíveis na implantação desta função e as seguintes. Pedidos cancelados ou pendentes não contam como decisões.</p>
  </div>;
}

export function RequestOutcomesPanel({ refreshedAt }: { refreshedAt: string }) {
  const [data, setData] = useState<RequestDecisionStats | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/stats?mode=requests", { cache: "no-store" }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível carregar as decisões.");
      if (!cancelled) { setData(result.requestOutcomes); setError(""); }
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Falha de conexão."); });
    return () => { cancelled = true; };
  }, [refreshedAt]);
  if (error) return <div className="alert" role="alert">{error}</div>;
  return data ? <RequestOutcomeSummary data={data} title="Decisões de solicitações, todas as salas" />
    : <div className="panel stats-loading">Carregando decisões de solicitações...</div>;
}
