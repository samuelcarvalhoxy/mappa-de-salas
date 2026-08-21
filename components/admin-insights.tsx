"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Bell,
  Check,
  Clock3,
  Download,
  FileText,
  Search,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import type { AppState } from "@/lib/types";

type ActionHandler = (
  body: Record<string, unknown>,
  success: string,
) => Promise<void>;

type RankingData = {
  periodDays: number;
  rankings: {
    id: string;
    label: string;
    rows: { userId: string; userName: string; count: number }[];
  }[];
};

function formatDate(value: string | null) {
  if (!value) return "Nunca";
  return new Date(value).toLocaleString("pt-BR", {
    timeZone: "America/Bahia",
    dateStyle: "short",
    timeStyle: "short",
  });
}

export async function downloadWorkbook(
  filename: string,
  sheetName: string,
  columns: { header: string; key: string; width: number }[],
  rows: Record<string, unknown>[],
) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Mappa de Salas";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = columns;
  sheet.addRows(rows);
  sheet.autoFilter = {
    from: "A1",
    to: `${String.fromCharCode(64 + columns.length)}${Math.max(1, rows.length + 1)}`,
  };
  const header = sheet.getRow(1);
  header.height = 26;
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF5B21B6" },
  };
  sheet.eachRow((row, rowNumber) => {
    row.alignment = { vertical: "middle", wrapText: rowNumber > 1 };
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = new Uint8Array(buffer as unknown as ArrayBuffer);
  const url = URL.createObjectURL(
    new Blob([bytes.buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function NotificationManagement({
  state,
  onAction,
}: {
  state: AppState;
  onAction: ActionHandler;
}) {
  const [audienceType, setAudienceType] = useState<"all" | "role" | "user">(
    "user",
  );
  const [audienceId, setAudienceId] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const filteredUsers = state.users.filter((user) =>
    `${user.name} ${user.username}`
      .toLocaleLowerCase("pt-BR")
      .includes(userQuery.trim().toLocaleLowerCase("pt-BR")),
  );
  const reviewerRoleIds = new Set(
    state.roles
      .filter((role) => role.permissions.includes("booking.review"))
      .map((role) => role.id),
  );
  const reviewers = state.users.filter(
    (user) => !user.isGod && reviewerRoleIds.has(user.roleId),
  );

  const selectTemplate = (id: string) => {
    const template = state.notificationTemplates.find((item) => item.id === id);
    if (!template) return;
    setTemplateName(template.name);
    setTitle(template.title);
    setMessage(template.body);
  };

  return (
    <div className="insights-stack">
      <section className="panel panel-contrast">
        <div className="panel-head">
          <div>
            <h2>Enviar notificação</h2>
            <p>Envie para uma pessoa, um perfil ou todos os usuários ativos.</p>
          </div>
          <Bell size={24} />
        </div>
        <div className="notification-compose">
          <label>
            Público
            <select
              value={audienceType}
              onChange={(event) => {
                setAudienceType(event.target.value as typeof audienceType);
                setAudienceId("");
              }}
            >
              <option value="user">Usuário específico</option>
              <option value="role">Perfil de acesso</option>
              <option value="all">Todos os usuários</option>
            </select>
          </label>
          {audienceType === "user" && (
            <>
              <label>
                Buscar usuário
                <input
                  value={userQuery}
                  onChange={(event) => setUserQuery(event.target.value)}
                  placeholder="Nome ou nome de usuário"
                />
              </label>
              <label>
                Usuário
                <select
                  value={audienceId}
                  onChange={(event) => setAudienceId(event.target.value)}
                >
                  <option value="">Selecione</option>
                  {filteredUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name} (@{user.username})
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {audienceType === "role" && (
            <label>
              Perfil
              <select
                value={audienceId}
                onChange={(event) => setAudienceId(event.target.value)}
              >
                <option value="">Selecione</option>
                {state.roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Modelo salvo
            <select defaultValue="" onChange={(event) => selectTemplate(event.target.value)}>
              <option value="">Mensagem personalizada</option>
              {state.notificationTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          <label className="wide-field">
            Título
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} />
          </label>
          <label className="wide-field">
            Mensagem
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={1200} />
          </label>
        </div>
        <div className="panel-actions-row">
          <button
            className="btn btn-primary"
            onClick={() =>
              onAction(
                { action: "notification.send", audienceType, audienceId, title, body: message },
                "Notificação enviada.",
              )
            }
            disabled={!title.trim() || !message.trim() || (audienceType !== "all" && !audienceId)}
          >
            <Send size={16} /> Enviar agora
          </button>
          <div className="template-save-row">
            <input
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              placeholder="Nome do modelo"
            />
            <button
              className="btn btn-soft"
              disabled={!templateName.trim() || !title.trim() || !message.trim()}
              onClick={() =>
                onAction(
                  { action: "notification.template_save", name: templateName, title, body: message },
                  "Modelo de notificação salvo.",
                )
              }
            >
              <FileText size={16} /> Salvar modelo
            </button>
          </div>
        </div>
        {state.notificationTemplates.length > 0 && (
          <div className="template-list">
            {state.notificationTemplates.map((template) => (
              <span key={template.id}>
                {template.name}
                <button
                  className="icon-btn danger"
                  title={`Excluir ${template.name}`}
                  onClick={() =>
                    onAction(
                      { action: "notification.template_delete", id: template.id },
                      "Modelo excluído.",
                    )
                  }
                >
                  <Trash2 size={14} />
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      {state.currentUser?.isGod && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Lembretes aos analistas</h2>
              <p>
                Repetidos a cada 30 minutos somente entre 08h00 e 20h59. Usuários God são isentos.
              </p>
            </div>
          </div>
          <div className="reminder-grid">
            {reviewers.map((user) => (
              <label key={user.id} className="reminder-user">
                <span>
                  <strong>{user.name}</strong>
                  <small>@{user.username} · {user.roleName}</small>
                </span>
                <input
                  type="checkbox"
                  checked={user.requestRemindersEnabled}
                  onChange={(event) =>
                    onAction(
                      {
                        action: "notification.reminder_preference",
                        userId: user.id,
                        enabled: event.target.checked,
                      },
                      "Preferência de lembrete atualizada.",
                    )
                  }
                />
              </label>
            ))}
            {!reviewers.length && <p className="muted">Nenhum analista não God cadastrado.</p>}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Histórico de envios</h2>
            <p>Responsável, horário, público e destinatários registrados.</p>
          </div>
          <button className="btn btn-soft" onClick={() => setShowHistory((value) => !value)}>
            {showHistory ? "Ocultar" : "Visualizar"}
          </button>
        </div>
        {showHistory && (
          <div className="broadcast-list">
            {state.notificationBroadcasts.map((item) => (
              <article key={item.id}>
                <Bell size={18} />
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                  <small>
                    {item.senderName} · {formatDate(item.createdAt)} · {item.audienceLabel}
                  </small>
                  <details>
                    <summary>{item.recipients.length} destinatário(s)</summary>
                    <p>{item.recipients.join(", ")}</p>
                  </details>
                </div>
              </article>
            ))}
            {!state.notificationBroadcasts.length && <p className="muted">Nenhum envio registrado.</p>}
          </div>
        )}
      </section>
    </div>
  );
}

export function AccessReportView({ state }: { state: AppState }) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");
  const filtered = useMemo(
    () =>
      state.users.filter(
        (user) =>
          (role === "all" || user.roleId === role) &&
          `${user.name} ${user.username}`
            .toLocaleLowerCase("pt-BR")
            .includes(query.trim().toLocaleLowerCase("pt-BR")),
      ),
    [query, role, state.users],
  );
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Relatório de acesso</h2>
          <p>Último login, última atividade e quantidade de entradas.</p>
        </div>
        <button
          className="btn btn-soft"
          disabled={!filtered.length}
          onClick={() =>
            downloadWorkbook(
              "relatorio-de-acessos.xlsx",
              "Acessos",
              [
                { header: "Nome", key: "name", width: 30 },
                { header: "Usuário", key: "username", width: 24 },
                { header: "Perfil", key: "role", width: 20 },
                { header: "Status", key: "status", width: 14 },
                { header: "Último login", key: "lastLogin", width: 22 },
                { header: "Última atividade", key: "lastSeen", width: 22 },
                { header: "Logins", key: "loginCount", width: 12 },
              ],
              filtered.map((user) => ({
                name: user.name,
                username: user.username,
                role: user.roleName,
                status: user.active ? "Ativo" : "Inativo",
                lastLogin: formatDate(user.lastLoginAt),
                lastSeen: formatDate(user.lastSeenAt),
                loginCount: user.loginCount,
              })),
            )
          }
        >
          <Download size={16} /> Exportar XLSX
        </button>
      </div>
      <div className="report-filters">
        <label className="search">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome ou nome de usuário" />
        </label>
        <select value={role} onChange={(event) => setRole(event.target.value)}>
          <option value="all">Todos os perfis</option>
          {state.roles.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </div>
      <div className="access-table-wrap">
        <table className="stats-table">
          <thead>
            <tr><th>Usuário</th><th>Perfil</th><th>Último login</th><th>Última atividade</th><th>Logins</th></tr>
          </thead>
          <tbody>
            {filtered.map((user) => (
              <tr key={user.id}>
                <td><strong>{user.name}</strong><small>@{user.username}</small></td>
                <td>{user.roleName}</td>
                <td>{formatDate(user.lastLoginAt)}</td>
                <td>{formatDate(user.lastSeenAt)}</td>
                <td>{user.loginCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function UsageGuardCard() {
  return (
    <section className="panel usage-guard-card">
      <div className="panel-head">
        <div>
          <h2>Proteção de consumo</h2>
          <p>Configuração econômica aplicada ao ambiente de testes.</p>
        </div>
        <Check size={22} />
      </div>
      <div className="usage-guard-grid">
        <div><strong>60 segundos</strong><span>Sincronização periódica com a aba visível</span></div>
        <div><strong>Zero chamadas</strong><span>Enquanto a aba estiver oculta</span></div>
        <div><strong>48 por dia</strong><span>Máximo teórico da automação de lembretes</span></div>
        <div><strong>Imediata</strong><span>Atualização após qualquer ação do usuário</span></div>
      </div>
      <a
        className="btn btn-soft usage-dashboard-link"
        href="https://vercel.com/dashboard/usage"
        target="_blank"
        rel="noreferrer"
      >
        Abrir Usage da Vercel
      </a>
    </section>
  );
}

export function RankingsPanel() {
  const [data, setData] = useState<RankingData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/reports", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Falha ao carregar rankings.");
        if (active) setData(payload);
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : "Falha ao carregar rankings."));
    return () => { active = false; };
  }, []);
  const rows = data?.rankings.flatMap((ranking) =>
    ranking.rows.map((row, index) => ({
      category: ranking.label,
      position: index + 1,
      user: row.userName,
      count: row.count,
      period: "Últimos 90 dias",
    })),
  ) || [];
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Top 10 de ações</h2>
          <p>Ranking móvel dos últimos três meses.</p>
        </div>
        <button
          className="btn btn-soft"
          disabled={!rows.length}
          onClick={() =>
            downloadWorkbook(
              "rankings-mappa-ultimos-90-dias.xlsx",
              "Rankings",
              [
                { header: "Categoria", key: "category", width: 38 },
                { header: "Posição", key: "position", width: 12 },
                { header: "Usuário", key: "user", width: 30 },
                { header: "Quantidade", key: "count", width: 14 },
                { header: "Período", key: "period", width: 20 },
              ],
              rows,
            )
          }
        >
          <Download size={16} /> Exportar rankings
        </button>
      </div>
      {error && <p className="inline-error">{error}</p>}
      {!data && !error && <p className="muted">Carregando rankings...</p>}
      <div className="ranking-grid">
        {data?.rankings.map((ranking) => (
          <article key={ranking.id} className="ranking-card">
            <h3><BarChart3 size={17} /> {ranking.label}</h3>
            {ranking.rows.map((row, index) => (
              <div key={row.userId}>
                <span>{index + 1}</span>
                <strong>{row.userName}</strong>
                <b>{row.count}</b>
              </div>
            ))}
            {!ranking.rows.length && <small>Nenhum registro no período.</small>}
          </article>
        ))}
      </div>
      <div className="retention-note">
        <Clock3 size={17} />
        <span>Os detalhes operacionais permanecem por até 90 dias. Totais históricos essenciais são preservados de forma agregada.</span>
      </div>
    </section>
  );
}
