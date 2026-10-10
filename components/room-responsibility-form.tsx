"use client";

import { useRef, useState } from "react";
import type { AppState, Room } from "@/lib/types";

export function RoomResponsibilityForm({ room, reviewers, onSave, onClose }: {
  room: Room;
  reviewers: AppState["roomReviewerOptions"];
  onSave: (userIds: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(() => (room.approvalResponsibles || []).map((person) => person.id));
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState("");
  const availableIds = new Set(reviewers.map((person) => person.id));
  const unavailable = (room.approvalResponsibles || []).filter((person) => !availableIds.has(person.id));
  const options = [...reviewers, ...unavailable.map((person) => ({ ...person, username: "", roleName: "Acesso indisponível para análise" }))];
  const filtered = options.filter((person) => `${person.name} ${person.username} ${person.roleName}`.toLocaleLowerCase("pt-BR").includes(query.trim().toLocaleLowerCase("pt-BR")));
  return <form className="modal-form room-responsibility-form" onSubmit={async (event) => {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try { await onSave(selected); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível salvar os responsáveis."); }
    finally { saving.current = false; setBusy(false); }
  }}>
    <p className="field-help">Os responsáveis têm o dever de aprovar ou rejeitar os pedidos desta sala. Somente eles recebem o aviso de omissão. Outras pessoas com permissão continuam podendo decidir.</p>
    <label>Buscar responsável<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome, usuário ou perfil" /></label>
    <fieldset className="responsibility-options" disabled={busy}>
      <legend>Selecione um ou mais responsáveis</legend>
      {filtered.map((person) => <label className="check-row" key={person.id}>
        <input type="checkbox" checked={selected.includes(person.id)}
          disabled={!availableIds.has(person.id) && !selected.includes(person.id)}
          onChange={(event) => setSelected((current) => event.target.checked ? [...current, person.id] : current.filter((id) => id !== person.id))} />
        <span><strong>{person.name}</strong><small>{person.username ? `@${person.username} · ` : ""}{person.roleName}</small></span>
      </label>)}
      {!filtered.length && <p className="field-help">Nenhum analista ativo encontrado. O responsável precisa ter permissão para analisar solicitações.</p>}
    </fieldset>
    <p className="field-help">{selected.length ? `${selected.length} responsável(is) selecionado(s).` : "Sem responsáveis: os pedidos ainda expiram, mas ninguém recebe o aviso de omissão desta sala."}</p>
    {unavailable.some((person) => selected.includes(person.id)) && <p className="form-error">Remova as pessoas que perderam o acesso à análise antes de salvar.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions">
      <button className="btn btn-soft" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
      <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Salvando..." : "Salvar responsáveis"}</button>
    </div>
  </form>;
}
