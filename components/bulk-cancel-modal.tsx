"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarX2, Search, X } from "lucide-react";
import type { AppState } from "@/lib/types";
import type {
  BulkCancellationFilters,
  BulkCancellationPreview,
  BulkCancellationScope,
} from "@/lib/bulk-cancellation";
import { bahiaDateKey } from "@/lib/calendar-utils";
import { MAP_SHIFTS } from "@/lib/map-shifts";
import { requestDateLabel } from "./app-shell-utils";

const SCOPE_LABELS: Record<BulkCancellationScope, string> = {
  future: "Todas as futuras",
  day: "Um dia",
  week: "Uma semana",
  month: "Um mês",
};

export function BulkCancelModal({
  state,
  onClose,
  onPreview,
  onConfirm,
}: {
  state: AppState;
  onClose: () => void;
  onPreview: (filters: BulkCancellationFilters) => Promise<BulkCancellationPreview>;
  onConfirm: (
    filters: BulkCancellationFilters,
    expectedCount: number,
  ) => Promise<void>;
}) {
  const today = bahiaDateKey(state.now);
  const [scope, setScope] = useState<BulkCancellationScope>("day");
  const [anchorDate, setAnchorDate] = useState(today);
  const [roomId, setRoomId] = useState("");
  const [userId, setUserId] = useState("");
  const [shiftIds, setShiftIds] = useState<BulkCancellationFilters["shiftIds"]>(
    MAP_SHIFTS.map((shift) => shift.id),
  );
  const [userQuery, setUserQuery] = useState("");
  const [preview, setPreview] = useState<BulkCancellationPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  const visibleUsers = useMemo(() => {
    const query = userQuery.trim().toLocaleLowerCase("pt-BR");
    return state.users.filter(
      (user) =>
        !query ||
          `${user.name} ${user.username}`
            .toLocaleLowerCase("pt-BR")
            .includes(query),
    );
  }, [state.users, userQuery]);

  const filters: BulkCancellationFilters = {
    scope,
    anchorDate,
    roomId: roomId || null,
    userId: userId || null,
    shiftIds,
  };
  const invalidate = () => {
    setPreview(null);
    setError("");
  };
  const toggleShift = (shiftId: BulkCancellationFilters["shiftIds"][number]) => {
    invalidate();
    setShiftIds((current) =>
      current.includes(shiftId)
        ? current.filter((id) => id !== shiftId)
        : [...current, shiftId],
    );
  };
  const runPreview = async () => {
    if (!shiftIds.length) {
      setError("Selecione pelo menos um turno.");
      return;
    }
    if (scope === "future" && !roomId && !userId) {
      setError(
        "Para cancelar todas as reservas futuras, selecione uma sala ou um instrutor.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      setPreview(await onPreview(filters));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao calcular a prévia.");
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!preview?.count) return;
    if (
      !window.confirm(
        `Cancelar ${preview.count} reserva(s)? Elas permanecerão no histórico como canceladas.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await onConfirm(filters, preview.count);
    } catch (reason) {
      setPreview(null);
      setError(
        reason instanceof Error ? reason.message : "Não foi possível cancelar as reservas.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="modal bulk-cancel-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-cancel-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2 id="bulk-cancel-title">Cancelamento em massa</h2>
            <p>Filtre, confira a prévia e cancele sem apagar o histórico.</p>
          </div>
          <button className="icon-btn" type="button" aria-label="Fechar" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <form className="modal-form" onSubmit={(event) => { event.preventDefault(); void runPreview(); }}>
          <div className="form-grid">
            <label>
              Período
              <select
                value={scope}
                onChange={(event) => {
                  invalidate();
                  setScope(event.target.value as BulkCancellationScope);
                }}
              >
                {(Object.keys(SCOPE_LABELS) as BulkCancellationScope[]).map((value) => (
                  <option value={value} key={value}>{SCOPE_LABELS[value]}</option>
                ))}
              </select>
            </label>
            {scope !== "future" && (
              <label>
                Data de referência
                <input
                  type="date"
                  min={today}
                  value={anchorDate}
                  onChange={(event) => { invalidate(); setAnchorDate(event.target.value); }}
                />
              </label>
            )}
          </div>
          <div className="form-grid">
            <label>
              Sala
              <select value={roomId} onChange={(event) => { invalidate(); setRoomId(event.target.value); }}>
                <option value="">Todas as salas</option>
                {state.rooms.map((room) => <option value={room.id} key={room.id}>{room.name}</option>)}
              </select>
            </label>
            <label className="bulk-user-field">
              Instrutor ou usuário
              <span className="search compact-search">
                <Search size={15} />
                <input
                  value={userQuery}
                  onChange={(event) => setUserQuery(event.target.value)}
                  placeholder="Buscar pessoa"
                />
              </span>
              <select value={userId} onChange={(event) => { invalidate(); setUserId(event.target.value); }}>
                <option value="">Todos os usuários</option>
                {visibleUsers.map((user) => (
                  <option value={user.id} key={user.id}>{user.name} (@{user.username}){user.active ? "" : " · inativo"}</option>
                ))}
              </select>
            </label>
          </div>
          <fieldset>
            <legend>Turnos afetados</legend>
            <div className="bulk-shift-options">
              {MAP_SHIFTS.map((shift) => (
                <label className="check-row compact" key={shift.id}>
                  <input
                    type="checkbox"
                    checked={shiftIds.includes(shift.id)}
                    onChange={() => toggleShift(shift.id)}
                  />
                  <span><strong>{shift.name}</strong><small>{shift.startTime} às {shift.endTime}</small></span>
                </label>
              ))}
            </div>
          </fieldset>
          {error && <p className="form-error error-shake" role="alert">{error}</p>}
          {preview && (
            <div className={`bulk-preview ${preview.count ? "has-results" : "empty-results"}`}>
              <CalendarX2 size={22} />
              <div>
                <strong>{preview.count} reserva(s) encontrada(s)</strong>
                <span>
                  {preview.to
                    ? `${requestDateLabel(preview.from)} a ${requestDateLabel(preview.to)}`
                    : `A partir de ${requestDateLabel(preview.from)}`}
                </span>
                {preview.roomNames.length > 0 && <small>Salas: {preview.roomNames.join(", ")}</small>}
                {preview.userNames.length > 0 && <small>Pessoas: {preview.userNames.join(", ")}</small>}
              </div>
            </div>
          )}
          <div className="bulk-cancel-warning">
            <AlertTriangle size={17} />
            <span>Somente reservas atuais e futuras são afetadas. O histórico e a auditoria são preservados.</span>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-soft" onClick={onClose}>Fechar</button>
            <button type="submit" className="btn btn-soft" disabled={busy}>{busy ? "Calculando..." : "Pré-visualizar"}</button>
            {preview && preview.count > 0 && (
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void confirm()}>
                Cancelar {preview.count} reserva(s)
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
