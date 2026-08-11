"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  Armchair,
  BarChart3,
  Bell,
  Bug,
  Building2,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock3,
  Code2,
  DoorOpen,
  Download,
  Eye,
  ExternalLink,
  FileSpreadsheet,
  History,
  KeyRound,
  LayoutGrid,
  Lightbulb,
  LogOut,
  Mail,
  MapPin,
  Menu,
  Monitor,
  Moon,
  Phone,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sun,
  Table2,
  Trash2,
  Users,
  Video,
  Wifi,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import type {
  AppState,
  BookingRequest,
  Permission,
  Reservation,
  Role,
  Room,
  RoomIssue,
} from "@/lib/types";
import {
  SECURITY_FIELDS,
  SECURITY_QUESTIONS,
  securityOptionsFor,
} from "@/lib/security-options";

const EMPTY: AppState = {
  configured: true,
  now: new Date().toISOString(),
  currentUser: null,
  rooms: [],
  reservations: [],
  issues: [],
  requests: [],
  roles: [],
  users: [],
  developmentTeam: [],
  feedbackReports: [],
  notifications: [],
  shifts: [],
  audit: [],
  pushPublicKey: "",
};
const PERMISSION_LABELS: Record<Permission, string> = {
  "booking.create_own": "Reservar para si",
  "booking.create_all": "Reservar para outros",
  "booking.manage_all": "Gerenciar qualquer reserva",
  "booking.request": "Solicitar reserva de sala",
  "booking.review": "Analisar e decidir solicitações",
  "room.manage": "Cadastrar e editar salas",
  "user.manage": "Cadastrar e editar usuários",
  "user.delete": "Excluir usuários",
  "security.reset": "Resetar respostas de segurança",
  "role.manage": "Criar perfis e permissões",
  "audit.view": "Consultar histórico",
  "stats.view": "Consultar estatísticas de utilização",
};

type StatsData = {
  mode: "user" | "room";
  targetName: string;
  totals: { useCount: number; totalMinutes: number; averageMinutes: number };
  breakdown: {
    id: string;
    name: string;
    useCount: number;
    totalMinutes: number;
    averageMinutes: number;
  }[];
};

type PaletteChoice = {
  primary: string;
  accent: string;
};

const DEFAULT_PALETTE: PaletteChoice = {
  primary: "#7C3AED",
  accent: "#A78BFA",
};

const BLUE_ORANGE_PALETTE: PaletteChoice = {
  primary: "#0A00BF",
  accent: "#FF7900",
};

function isHexColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function normalizedPalette(value: unknown): PaletteChoice | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PaletteChoice>;
  return isHexColor(candidate.primary || "") &&
    isHexColor(candidate.accent || "")
    ? {
        primary: candidate.primary!.toUpperCase(),
        accent: candidate.accent!.toUpperCase(),
      }
    : null;
}

function relativeLuminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(hex: string, light = true) {
  const luminance = relativeLuminance(hex);
  const other = light ? 1 : 0;
  return (
    (Math.max(luminance, other) + 0.05) / (Math.min(luminance, other) + 0.05)
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`}>
      <div className="brand-mark">
        <DoorOpen size={22} />
      </div>
      {!compact && (
        <div>
          <strong>
            M<span>app</span>a
          </strong>
          <small>de Salas</small>
        </div>
      )}
    </div>
  );
}

function useInstallPrompt() {
  const [prompt, setPrompt] = useState<
    (Event & { prompt?: () => Promise<void> }) | null
  >(null);
  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setPrompt(event as Event & { prompt: () => Promise<void> });
    };
    window.addEventListener("beforeinstallprompt", handler);
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => null);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);
  return {
    available: Boolean(prompt),
    install: async () => {
      await prompt?.prompt?.();
      setPrompt(null);
    },
  };
}

function urlBase64ToUint8Array(value: string) {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = window.atob(padded);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

function usePushNotifications(
  publicKey: string,
  onError: (message: string) => void,
) {
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >(() =>
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "unsupported",
  );
  const [status, setStatus] = useState<
    "idle" | "syncing" | "active" | "error"
  >("idle");
  const syncing = useRef(false);
  const syncSubscription = useCallback(
    async (sendTest = false, silent = false, forceNew = false) => {
      if (syncing.current) return false;
      syncing.current = true;
      setStatus("syncing");
      try {
        if (!publicKey)
          throw new Error("A chave pública de notificações não está disponível.");
        if (!("serviceWorker" in navigator) || !("PushManager" in window))
          throw new Error("Este navegador não oferece notificações push.");
        await navigator.serviceWorker.register("/sw.js", {
          updateViaCache: "none",
        });
        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        const expectedKey = urlBase64ToUint8Array(publicKey);
        if (subscription && !forceNew) {
          const currentKey = subscription.options.applicationServerKey;
          const currentBytes = currentKey ? new Uint8Array(currentKey) : null;
          const sameKey =
            currentBytes?.length === expectedKey.length &&
            currentBytes.every((value, index) => value === expectedKey[index]);
          if (!sameKey) {
            await subscription.unsubscribe();
            subscription = null;
          }
        }
        if (subscription && forceNew) {
          await subscription.unsubscribe();
          subscription = null;
        }
        subscription =
          subscription ||
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: expectedKey,
          }));
        await api("/api/push", {
          action: "subscribe",
          subscription: subscription.toJSON(),
        });
        setStatus("active");
        if (sendTest) await api("/api/push", { action: "test" });
        return true;
      } catch (error) {
        setStatus("error");
        if (!silent)
          onError(
            error instanceof Error
              ? error.message
              : "Não foi possível ativar notificações.",
          );
        return false;
      } finally {
        syncing.current = false;
      }
    },
    [onError, publicKey],
  );

  useEffect(() => {
    if (permission !== "granted" || !publicKey) return;
    const timer = window.setTimeout(() => {
      void syncSubscription(false, true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [permission, publicKey, syncSubscription]);

  const enable = async () => {
    try {
      if (
        !("Notification" in window) ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window)
      )
        throw new Error("Este navegador não oferece notificações push.");
      const next = await Notification.requestPermission();
      setPermission(next);
      if (next !== "granted")
        throw new Error("A permissão de notificações não foi concedida.");
      return await syncSubscription(true, false, status === "error");
    } catch (error) {
      setStatus("error");
      onError(
        error instanceof Error
          ? error.message
          : "Não foi possível ativar notificações.",
      );
      return false;
    }
  };
  const test = async () => {
    const synchronized = await syncSubscription(false);
    if (!synchronized) return false;
    try {
      await api("/api/push", { action: "test" });
      return true;
    } catch (error) {
      const repaired = await syncSubscription(true, false, true);
      if (repaired) return true;
      setStatus("error");
      onError(
        error instanceof Error
          ? error.message
          : "Não foi possível enviar a notificação de teste.",
      );
      return false;
    }
  };
  return { permission, status, enable, test };
}

async function api(path: string, body?: Record<string, unknown>) {
  const response = await fetch(
    path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data;
}

export function AppShell() {
  const [state, setState] = useState<AppState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [dark, setDark] = useState(false);
  const [palette, setPalette] = useState<PaletteChoice>(DEFAULT_PALETTE);
  const [activeTab, setActiveTab] = useState("map");
  const [mapDate, setMapDate] = useState(() => dateKey(new Date()));
  const [sidebar, setSidebar] = useState(false);
  const [modal, setModal] = useState<{ type: string; data?: unknown } | null>(
    null,
  );
  const actionInFlight = useRef(false);
  const install = useInstallPrompt();
  const showError = useCallback((message: string) => {
    setToast("");
    setError(message);
  }, []);
  const notifications = usePushNotifications(state.pushPublicKey, showError);

  const refresh = useCallback(async (quiet = false) => {
    try {
      const next = await api("/api/state");
      setState(next);
      setError("");
    } catch (e) {
      if (!quiet)
        setError(e instanceof Error ? e.message : "Falha de conexão.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = setTimeout(() => refresh(), 0);
    const timer = setInterval(() => refresh(true), 3000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.style.setProperty(
      "--selected-primary",
      palette.primary,
    );
    document.documentElement.style.setProperty(
      "--selected-accent",
      palette.accent,
    );
    document.documentElement.style.setProperty(
      "--on-brand-light",
      contrastRatio(palette.primary) >= contrastRatio(palette.primary, false)
        ? "#FFFFFF"
        : "#111111",
    );
  }, [dark, palette]);
  useEffect(() => {
    const userId = state.currentUser?.id;
    if (!userId) return;
    const timer = window.setTimeout(() => {
      try {
        const saved = normalizedPalette(
          JSON.parse(localStorage.getItem(`mappa-palette-${userId}`) || "null"),
        );
        setPalette(saved || DEFAULT_PALETTE);
      } catch {
        setPalette(DEFAULT_PALETTE);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [state.currentUser?.id]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  const act = async (body: Record<string, unknown>, success: string) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setError("");
    setToast("");
    try {
      await api("/api/action", body);
      setModal(null);
      setError("");
      setToast(success);
      await refresh(true);
    } catch (e) {
      setToast("");
      setError(e instanceof Error ? e.message : "Falha na operação.");
    } finally {
      actionInFlight.current = false;
    }
  };

  if (loading)
    return (
      <div className="splash">
        <Brand />
        <div className="loading-line" />
      </div>
    );
  if (!state.configured) return <SetupScreen />;
  if (!state.currentUser) return <LoginScreen onDone={() => refresh()} />;

  const user = state.currentUser;
  const can = (permission: Permission) =>
    user.isGod || user.permissions.includes(permission);
  const canBookDirectly =
    can("booking.create_own") || can("booking.create_all");
  const canRequest = can("booking.request");
  const pendingRequests = state.requests.filter(
    (request) => request.status === "pending",
  ).length;
  const unreadNotifications = state.notifications.filter(
    (notification) => !notification.readAt,
  ).length;
  const nav = [
    { id: "map", label: "Mapa de salas", icon: LayoutGrid, show: true },
    { id: "calendar", label: "Agenda", icon: CalendarDays, show: true },
    {
      id: "requests",
      label:
        can("booking.review") && pendingRequests
          ? `Solicitações (${pendingRequests})`
          : "Solicitações",
      icon: ClipboardList,
      show: canRequest || can("booking.review"),
    },
    { id: "rooms", label: "Salas", icon: DoorOpen, show: can("room.manage") },
    {
      id: "users",
      label: "Usuários",
      icon: Users,
      show: can("user.manage") || can("user.delete") || can("security.reset"),
    },
    {
      id: "roles",
      label: "Perfis e acessos",
      icon: ShieldCheck,
      show: can("role.manage"),
    },
    {
      id: "stats",
      label: "Estatísticas",
      icon: BarChart3,
      show: can("stats.view"),
    },
    { id: "audit", label: "Histórico", icon: History, show: can("audit.view") },
    {
      id: "development",
      label: "Equipe de desenvolvimento",
      icon: Code2,
      show: true,
    },
  ].filter((item) => item.show);

  const titles: Record<string, [string, string]> = {
    map: ["Mapa de salas", "Disponibilidade atual e próximas reservas"],
    calendar: ["Agenda", "Reservas por dia e período"],
    requests: ["Solicitações", "Pedidos de sala aguardando análise e decisões"],
    rooms: ["Salas", "Ambientes físicos, virtuais e outras localidades"],
    users: ["Usuários", "Pessoas e níveis de acesso"],
    roles: ["Perfis e acessos", "Permissões sob medida para cada equipe"],
    stats: ["Estatísticas", "Padrões de utilização por pessoa ou sala"],
    audit: ["Histórico", "Rastreabilidade das alterações"],
    development: [
      "Equipe de desenvolvimento",
      "Pessoas que constroem e evoluem o Mappa de Salas",
    ],
  };

  return (
    <div className="app-layout">
      <aside className={`sidebar ${sidebar ? "open" : ""}`}>
        <div className="sidebar-head">
          <Brand />
          <button
            className="icon-btn mobile-only"
            onClick={() => setSidebar(false)}
          >
            <X size={20} />
          </button>
        </div>
        <nav>
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={activeTab === id ? "active" : ""}
              onClick={() => {
                setActiveTab(id);
                setSidebar(false);
              }}
            >
              <Icon size={19} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          {install.available && (
            <button onClick={install.install}>
              <Download size={18} />
              <span>Instalar aplicativo</span>
            </button>
          )}
          <button onClick={() => setModal({ type: "password" })}>
            <KeyRound size={18} />
            <span>Alterar minha senha</span>
          </button>
          <button onClick={() => setModal({ type: "feedback" })}>
            <Bug size={18} />
            <span>Reportar bug ou sugerir melhoria</span>
          </button>
          <div className="user-mini">
            <div className="avatar">
              {user.name
                .split(" ")
                .slice(0, 2)
                .map((p) => p[0])
                .join("")}
            </div>
            <div>
              <strong>{user.name}</strong>
              <small style={{ color: user.roleColor }}>{user.roleName}</small>
            </div>
            <button
              className="icon-btn"
              title="Sair"
              onClick={async () => {
                await api("/api/auth", { action: "logout" });
                refresh();
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      {sidebar && (
        <button
          className="backdrop mobile-only"
          onClick={() => setSidebar(false)}
        />
      )}
      <main>
        <header className="topbar">
          <button
            className="icon-btn mobile-only"
            onClick={() => setSidebar(true)}
          >
            <Menu size={21} />
          </button>
          <div>
            <h1>{(titles[activeTab] || titles.map)[0]}</h1>
            <p>{(titles[activeTab] || titles.map)[1]}</p>
          </div>
          <div className="top-actions">
            <div className="sync">
              <span /> Sincronizado agora
            </div>
            {state.pushPublicKey &&
              (notifications.permission !== "granted" ||
                notifications.status === "error") && (
              <button
                className="btn btn-soft notification-action"
                onClick={async () => {
                  const ok = await notifications.enable();
                  if (ok) setToast("Push ativado e testado neste dispositivo.");
                }}
              >
                <Bell size={17} />
                {notifications.permission === "granted"
                  ? "Reconectar alertas"
                  : "Ativar alertas"}
              </button>
            )}
            <button
              className="icon-btn notification-center-button"
              title="Abrir notificações"
              onClick={() => setModal({ type: "notifications" })}
            >
              <Bell size={18} />
              {unreadNotifications > 0 && (
                <span>{Math.min(unreadNotifications, 99)}</span>
              )}
            </button>
            {install.available && (
              <button
                className="btn btn-soft desktop-install"
                onClick={install.install}
              >
                <Download size={17} /> Instalar
              </button>
            )}
            <button
              className="icon-btn"
              title="Alternar tema"
              onClick={() => setDark((v) => !v)}
            >
              {dark ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <button
              className="icon-btn"
              title="Personalizar cores"
              onClick={() => setModal({ type: "palette" })}
            >
              <Settings2 size={19} />
            </button>
          </div>
        </header>
        <div className="content">
          {error && (
            <div className="alert global-alert" role="alert">
              <span>{error}</span>
              <button onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {activeTab === "map" && (
            <RoomMap
              state={state}
              selectedDate={mapDate}
              onSelectedDateChange={setMapDate}
              canBookDirectly={canBookDirectly}
              canRequest={canRequest}
              onSchedule={(room) =>
                setModal({
                  type: canBookDirectly ? "booking" : "request",
                  data: room,
                })
              }
              onInspect={(room) => setModal({ type: "room-life", data: room })}
              onOpenAgenda={() => setActiveTab("calendar")}
            />
          )}
          {activeTab === "calendar" && (
            <CalendarView
              state={state}
              can={can}
              scheduleMode={
                canBookDirectly ? "booking" : canRequest ? "request" : "none"
              }
              onSchedule={() =>
                setModal({ type: canBookDirectly ? "booking" : "request" })
              }
              onEdit={(reservation) =>
                setModal({ type: "booking-edit", data: reservation })
              }
              onCancel={(r) =>
                act(
                  { action: "booking.cancel", id: r.id },
                  "Reserva cancelada.",
                )
              }
              onCancelSeries={(r) =>
                act(
                  { action: "booking.cancel_series", seriesId: r.seriesId },
                  "Período de reservas cancelado.",
                )
              }
            />
          )}
          {activeTab === "requests" && (
            <RequestsView
              state={state}
              canReview={can("booking.review")}
              canRequest={canRequest}
              onNew={() => setModal({ type: "request" })}
              onReview={(request) =>
                setModal({ type: "request-review", data: request })
              }
              onCancel={(request) =>
                act(
                  { action: "request.cancel", id: request.id },
                  "Solicitação cancelada.",
                )
              }
            />
          )}
          {activeTab === "rooms" && (
            <RoomsAdmin
              state={state}
              onNew={() => setModal({ type: "room" })}
              onEdit={(room) => setModal({ type: "room", data: room })}
              onDisable={(room) =>
                act({ action: "room.disable", id: room.id }, "Sala desativada.")
              }
            />
          )}
          {activeTab === "users" && (
            <UsersAdmin
              state={state}
              canManage={can("user.manage")}
              canDelete={can("user.delete")}
              canReset={can("security.reset")}
              canEditGod={user.isGod}
              onNew={() => setModal({ type: "user" })}
              onEdit={(managed) => setModal({ type: "user", data: managed })}
              onReset={(managed) => {
                if (
                  window.confirm(
                    `Resetar as respostas de segurança de ${managed.name}? No próximo login, a pessoa precisará cadastrar novas respostas.`,
                  )
                )
                  act(
                    { action: "user.security.reset", id: managed.id },
                    "Respostas de segurança resetadas.",
                  );
              }}
              onDelete={(managed) => {
                if (
                  window.confirm(
                    `Excluir o acesso de ${managed.name}? O histórico será preservado, mas a pessoa não poderá mais entrar.`,
                  )
                )
                  act(
                    { action: "user.delete", id: managed.id },
                    "Usuário excluído.",
                  );
              }}
            />
          )}
          {activeTab === "roles" && (
            <RolesAdmin
              state={state}
              canDelete={user.isGod}
              onNew={() => setModal({ type: "role" })}
              onEdit={(role) => setModal({ type: "role", data: role })}
              onDelete={(role) => {
                if (
                  window.confirm(
                    `Excluir o perfil ${role.name}? Esta ação não pode ser desfeita.`,
                  )
                )
                  act(
                    { action: "role.delete", id: role.id },
                    "Perfil excluído.",
                  );
              }}
            />
          )}
          {activeTab === "stats" && <StatsView state={state} />}
          {activeTab === "audit" && <AuditView state={state} />}
          {activeTab === "development" && (
            <DevelopmentTeamView
              state={state}
              canEdit={user.isGod}
              onNew={() => setModal({ type: "development-member" })}
              onEdit={(member) =>
                setModal({ type: "development-member", data: member })
              }
              onDelete={(member) => {
                if (
                  window.confirm(
                    `Remover ${member.name} da equipe de desenvolvimento?`,
                  )
                )
                  act(
                    { action: "development_team.delete", id: member.id },
                    "Integrante removido.",
                  );
              }}
              onFeedbackStatus={(report, status) =>
                act(
                  { action: "feedback.status", id: report.id, status },
                  "Status do relato atualizado.",
                )
              }
            />
          )}
        </div>
      </main>
      {modal?.type === "booking" && (
        <BookingModal
          room={modal.data as Room | undefined}
          state={state}
          initialDate={activeTab === "map" ? mapDate : undefined}
          canAll={can("booking.create_all")}
          onClose={() => setModal(null)}
          onSave={(data) =>
            act(
              { action: "booking.create", ...(data as object) },
              "Reserva criada.",
            )
          }
        />
      )}
      {modal?.type === "booking-edit" && (
        <BookingEditModal
          reservation={modal.data as Reservation}
          state={state}
          canManageAll={can("booking.manage_all")}
          onClose={() => setModal(null)}
          onSave={(data, scope) =>
            act(
              {
                action:
                  scope === "series"
                    ? "booking.update_series"
                    : "booking.update",
                ...(data as object),
              },
              scope === "series"
                ? "Período de reservas atualizado."
                : "Reserva atualizada.",
            )
          }
        />
      )}
      {modal?.type === "request" && (
        <RequestModal
          room={modal.data as Room | undefined}
          state={state}
          initialDate={activeTab === "map" ? mapDate : undefined}
          onClose={() => setModal(null)}
          onSave={(data) =>
            act(
              { action: "request.create", ...(data as object) },
              "Solicitação enviada para análise.",
            )
          }
        />
      )}
      {modal?.type === "request-review" && (
        <RequestReviewModal
          request={modal.data as BookingRequest}
          state={state}
          onClose={() => setModal(null)}
          onSave={(data) =>
            act(
              { action: "request.update", ...(data as object) },
              "Solicitação atualizada.",
            )
          }
          onDecide={(data, decision) =>
            act(
              { action: "request.review", ...(data as object), decision },
              decision === "approved"
                ? "Solicitação aprovada e reserva criada."
                : "Solicitação rejeitada.",
            )
          }
        />
      )}
      {modal?.type === "room" && (
        <RoomModal
          room={modal.data as Room | undefined}
          onClose={() => setModal(null)}
          onSave={(data) =>
            act({ action: "room.save", ...(data as object) }, "Sala salva.")
          }
        />
      )}
      {modal?.type === "room-life" && (
        <RoomLifeModal
          room={modal.data as Room}
          state={state}
          canSchedule={canBookDirectly || canRequest}
          onClose={() => setModal(null)}
          onSchedule={(room) =>
            setModal({
              type: canBookDirectly ? "booking" : "request",
              data: room,
            })
          }
          onReport={(room) => setModal({ type: "issue", data: room })}
          onResolve={(issue) =>
            act(
              { action: "issue.resolve", id: issue.id },
              "Problema marcado como resolvido.",
            )
          }
        />
      )}
      {modal?.type === "issue" && (
        <IssueModal
          room={modal.data as Room}
          onClose={() => setModal(null)}
          onSave={(data) =>
            act(
              { action: "issue.report", ...(data as object) },
              "Problema reportado para toda a equipe.",
            )
          }
        />
      )}
      {modal?.type === "password" && (
        <PasswordModal
          onClose={() => setModal(null)}
          onSave={(data) =>
            act(
              { action: "user.password.change", ...(data as object) },
              "Sua senha foi alterada.",
            )
          }
        />
      )}
      {modal?.type === "palette" && (
        <PaletteModal
          palette={palette}
          onClose={() => setModal(null)}
          onSave={(next) => {
            setPalette(next);
            localStorage.setItem(
              `mappa-palette-${user.id}`,
              JSON.stringify(next),
            );
            setModal(null);
            setToast("Paleta de cores atualizada.");
          }}
        />
      )}
      {modal?.type === "user" && (
        <UserModal
          user={modal.data as AppState["users"][number] | undefined}
          state={state}
          canCreateGod={user.isGod}
          onClose={() => setModal(null)}
          onSave={(data) =>
            act({ action: "user.save", ...(data as object) }, "Usuário salvo.")
          }
        />
      )}
      {modal?.type === "role" && (
        <RoleModal
          role={modal.data as Role | undefined}
          onClose={() => setModal(null)}
          onSave={(data) =>
            act({ action: "role.save", ...(data as object) }, "Perfil salvo.")
          }
        />
      )}
      {modal?.type === "development-member" && (
        <DevelopmentMemberModal
          member={
            modal.data as AppState["developmentTeam"][number] | undefined
          }
          onClose={() => setModal(null)}
          onSave={(data) =>
            act(
              { action: "development_team.save", ...(data as object) },
              "Perfil da equipe atualizado.",
            )
          }
        />
      )}
      {modal?.type === "feedback" && (
        <FeedbackModal
          currentUserName={user.name}
          onClose={() => setModal(null)}
          onSave={async (data) => {
            await api("/api/feedback", data as Record<string, unknown>);
            setModal(null);
            setError("");
            setToast("Relato enviado para a equipe de desenvolvimento.");
            await refresh(true);
          }}
        />
      )}
      {modal?.type === "notifications" && (
        <NotificationsModal
          state={state}
          pushAvailable={Boolean(state.pushPublicKey)}
          pushActive={notifications.permission === "granted"}
          onClose={() => setModal(null)}
          onMarkAll={async () => {
            await api("/api/action", { action: "notification.read_all" });
            await refresh(true);
          }}
          onEnablePush={async () => {
            const ok = await notifications.enable();
            if (ok) setToast("Push ativado e testado neste dispositivo.");
          }}
          onTestPush={async () => {
            const ok = await notifications.test();
            if (ok) setToast("Notificação de teste enviada.");
          }}
        />
      )}
      {toast && !error && (
        <div className="toast">
          <Check size={18} />
          {toast}
        </div>
      )}
      {(canBookDirectly || canRequest) && (
        <button
          className="agenda-fab"
          title="Abrir agenda"
          onClick={() =>
            setModal({ type: canBookDirectly ? "booking" : "request" })
          }
        >
          <CalendarRange size={21} />
          <span>{canBookDirectly ? "Reservar" : "Solicitar"}</span>
        </button>
      )}
    </div>
  );
}

function SetupScreen() {
  return (
    <div className="auth-page">
      <section className="auth-card setup-card">
        <Brand />
        <div className="setup-icon">
          <Settings2 size={30} />
        </div>
        <h1>Falta conectar o banco</h1>
        <p>
          O aplicativo já está publicado, mas precisa de um banco Postgres e dos
          segredos do acesso inicial para sincronizar dados com segurança.
        </p>
        <div className="code-list">
          <code>DATABASE_URL</code>
          <code>AUTH_SECRET</code>
          <code>GOD_BOOTSTRAP_PASSWORD</code>
        </div>
        <p className="muted">
          Depois de configurar as variáveis no Vercel, uma nova implantação
          ativa o acesso God automaticamente.
        </p>
      </section>
    </div>
  );
}

function LoginScreen({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"login" | "recover" | "setup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api("/api/auth", {
        action: "login",
        username,
        password,
      });
      if (data.requiresSecuritySetup) {
        const required = Array.isArray(data.questions)
          ? data.questions
          : SECURITY_QUESTIONS;
        setQuestions(required);
        setAnswers(required.map(() => ""));
        setMode("setup");
      } else onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no acesso.");
    } finally {
      setBusy(false);
    }
  };
  const loadQuestions = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await api("/api/auth", {
        action: "security_questions",
        username,
      });
      if (!data.questions?.length)
        throw new Error("Recuperação não configurada para esse usuário.");
      setQuestions(data.questions);
      setAnswers(data.questions.map(() => ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha.");
    } finally {
      setBusy(false);
    }
  };
  const reset = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth", {
        action: "reset",
        username,
        answers,
        newPassword,
      });
      setMode("login");
      setQuestions([]);
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha.");
    } finally {
      setBusy(false);
    }
  };
  const setupSecurity = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth", { action: "setup_security", answers });
      onDone();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Falha ao salvar as respostas.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-page">
      <div className="auth-art">
        <div className="art-grid" />
        <div className="art-copy">
          <span className="eyebrow">
            <Zap size={15} /> Disponibilidade em tempo real
          </span>
          <h1>
            Encontre a sala certa,
            <br />
            <em>na hora certa.</em>
          </h1>
          <p>
            Um mapa vivo para sua equipe reservar, compartilhar e aproveitar
            melhor cada espaço.
          </p>
          <div className="art-stats">
            <div>
              <strong>08:00</strong>
              <span>Primeiro turno</span>
            </div>
            <div>
              <strong>21:00</strong>
              <span>Fim da operação</span>
            </div>
          </div>
        </div>
      </div>
      <section className="auth-panel">
        <Brand />
        <div className="auth-form-wrap">
          {mode === "login" ? (
            <>
              <div>
                <h2>Que bom ter você aqui</h2>
                <p>Entre para ver a disponibilidade das salas.</p>
              </div>
              <form onSubmit={submit}>
                <label>
                  Usuário
                  <input
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Seu usuário"
                    required
                  />
                </label>
                <label>
                  Senha
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Sua senha"
                    required
                  />
                </label>
                {error && <p className="form-error">{error}</p>}
                <button className="btn btn-primary full" disabled={busy}>
                  {busy ? "Entrando..." : "Entrar"}
                </button>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setMode("recover");
                    setQuestions([]);
                    setAnswers([]);
                    setError("");
                  }}
                >
                  Esqueci minha senha
                </button>
              </form>
            </>
          ) : mode === "recover" ? (
            <>
              <div>
                <button className="back-link" onClick={() => setMode("login")}>
                  <ChevronLeft size={17} /> Voltar
                </button>
                <h2>Recuperar acesso</h2>
                <p>Responda suas perguntas de segurança.</p>
              </div>
              <form onSubmit={reset}>
                <label>
                  Usuário
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                </label>
                {questions.length === 0 ? (
                  <button
                    type="button"
                    className="btn btn-primary full"
                    disabled={busy}
                    onClick={loadQuestions}
                  >
                    Continuar
                  </button>
                ) : (
                  <>
                    {questions.map((question, index) => (
                      <SecuritySelect
                        key={question}
                        question={question}
                        value={answers[index] || ""}
                        onChange={(value) =>
                          setAnswers((old) =>
                            old.map((answer, answerIndex) =>
                              answerIndex === index ? value : answer,
                            ),
                          )
                        }
                      />
                    ))}
                    <label>
                      Nova senha
                      <input
                        type="password"
                        minLength={8}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        required
                      />
                    </label>
                    <button className="btn btn-primary full" disabled={busy}>
                      Redefinir senha
                    </button>
                  </>
                )}
                {error && <p className="form-error">{error}</p>}
              </form>
            </>
          ) : (
            <>
              <div>
                <h2>Proteja seu acesso</h2>
                <p>
                  Antes do primeiro acesso, defina suas respostas de segurança.
                </p>
              </div>
              <form onSubmit={setupSecurity}>
                {questions.map((question, index) => (
                  <SecuritySelect
                    key={question}
                    question={question}
                    value={answers[index] || ""}
                    onChange={(value) =>
                      setAnswers((old) =>
                        old.map((answer, answerIndex) =>
                          answerIndex === index ? value : answer,
                        ),
                      )
                    }
                  />
                ))}
                {error && <p className="form-error">{error}</p>}
                <button className="btn btn-primary full" disabled={busy}>
                  {busy ? "Salvando..." : "Salvar e entrar"}
                </button>
              </form>
            </>
          )}
        </div>
        <div className="auth-footer">
          <span>Mappa de Salas • Ambiente corporativo</span>
          <button type="button" onClick={() => setShowFeedback(true)}>
            <Bug size={14} /> Reportar bug ou sugerir melhoria
          </button>
          {feedbackSent && <strong>Relato enviado. Obrigado!</strong>}
        </div>
      </section>
      {showFeedback && (
        <FeedbackModal
          onClose={() => setShowFeedback(false)}
          onSave={async (data) => {
            await api("/api/feedback", data as Record<string, unknown>);
            setShowFeedback(false);
            setFeedbackSent(true);
          }}
        />
      )}
    </div>
  );
}

function SecuritySelect({
  question,
  value,
  onChange,
}: {
  question: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {question}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
      >
        <option value="">Selecione uma opção</option>
        {securityOptionsFor(question).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

const MAP_SHIFTS = [
  { id: "morning", name: "Manhã", startTime: "07:00", endTime: "14:20" },
  {
    id: "afternoon",
    name: "Tarde",
    startTime: "14:20",
    endTime: "21:00",
  },
  { id: "extra", name: "Extra", startTime: "21:00", endTime: "07:00" },
] as const;

function mapShiftForNow(value: string) {
  const localTime = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Bahia",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
  if (localTime >= "07:00" && localTime < "14:20") return "morning";
  if (localTime >= "14:20" && localTime < "21:00") return "afternoon";
  return "extra";
}

function RoomMap({
  state,
  selectedDate,
  onSelectedDateChange,
  canBookDirectly,
  canRequest,
  onSchedule,
  onInspect,
  onOpenAgenda,
}: {
  state: AppState;
  selectedDate: string;
  onSelectedDateChange: (date: string) => void;
  canBookDirectly: boolean;
  canRequest: boolean;
  onSchedule: (r: Room) => void;
  onInspect: (r: Room) => void;
  onOpenAgenda: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedShiftId, setSelectedShiftId] = useState(() =>
    mapShiftForNow(state.now),
  );
  const [dayReservations, setDayReservations] = useState<Reservation[]>([]);
  const [loadedKey, setLoadedKey] = useState("");
  const [dayLoading, setDayLoading] = useState(true);
  const [dayError, setDayError] = useState("");
  const [reloadDay, setReloadDay] = useState(0);
  const now = new Date(state.now);
  const today = dateKey(state.now);
  const isToday = selectedDate === today;
  const selectedShift =
    MAP_SHIFTS.find((shift) => shift.id === selectedShiftId) || MAP_SHIFTS[0];
  const shiftCrossesMidnight = selectedShift.endTime <= selectedShift.startTime;
  const shiftEndDate = shiftCrossesMidnight
    ? addDays(selectedDate, 1)
    : selectedDate;
  const shiftStart = new Date(
    `${selectedDate}T${selectedShift.startTime}:00-03:00`,
  );
  const shiftEnd = new Date(
    `${shiftEndDate}T${selectedShift.endTime}:00-03:00`,
  );
  const reference =
    isToday && now >= shiftStart && now < shiftEnd ? now : shiftStart;
  const referenceIsNow = reference.getTime() === now.getTime();
  const loadKey = `${selectedDate}:${selectedShift.id}`;
  const dayReady = loadedKey === loadKey;

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      setDayLoading(true);
      setDayError("");
      try {
        const data = await api(
          `/api/agenda?from=${selectedDate}&to=${shiftEndDate}`,
        );
        if (cancelled) return;
        setDayReservations(data.reservations || []);
        setLoadedKey(loadKey);
      } catch (error) {
        if (cancelled) return;
        setDayError(
          error instanceof Error
            ? error.message
            : "Não foi possível carregar este dia.",
        );
      } finally {
        if (!cancelled) setDayLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadKey, selectedDate, shiftEndDate, state.now, reloadDay]);

  const reservations = dayReady ? dayReservations : [];
  const shiftReservationsFor = (roomId: string) =>
    reservations
      .filter(
        (reservation) =>
          reservation.roomId === roomId &&
          reservation.status === "reserved" &&
          new Date(reservation.startsAt) < shiftEnd &&
          new Date(reservation.endsAt) > shiftStart,
      )
      .sort(
        (left, right) =>
          new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime(),
      );
  const currentFor = (roomId: string) =>
    shiftReservationsFor(roomId).find(
      (reservation) =>
        new Date(reservation.startsAt) <= reference &&
        new Date(reservation.endsAt) > reference,
    );
  const nextFor = (roomId: string) =>
    shiftReservationsFor(roomId).find(
      (reservation) => new Date(reservation.startsAt) > reference,
    );
  const filtered = state.rooms.filter((room) => {
    const roomShiftReservations = shiftReservationsFor(room.id);
    const hasReservation = roomShiftReservations.length > 0;
    const matchesFilter =
      filter === "all" ||
      (filter === "free"
        ? !hasReservation
        : filter === "reserved"
          ? hasReservation
          : room.kind === filter);
    const searchText = `${room.name} ${room.location}`.toLowerCase();
    const reservationMatches = roomShiftReservations.some((reservation) =>
      `${reservation.userName} ${reservation.userUsername || ""}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    );
    return (
      matchesFilter &&
      (!query.trim() ||
        searchText.includes(query.trim().toLowerCase()) ||
        reservationMatches)
    );
  });
  const free = state.rooms.filter(
    (room) => shiftReservationsFor(room.id).length === 0,
  ).length;
  const cycleShift = () => {
    const currentIndex = MAP_SHIFTS.findIndex(
      (shift) => shift.id === selectedShift.id,
    );
    setSelectedShiftId(MAP_SHIFTS[(currentIndex + 1) % MAP_SHIFTS.length].id);
  };
  const changeDate = (nextDate: string) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) onSelectedDateChange(nextDate);
  };
  return (
    <>
      <div className="map-date-bar" aria-busy={dayLoading}>
        <div className="map-date-copy">
          <span className="map-date-icon">
            <CalendarDays size={20} />
          </span>
          <div>
            <strong>{isToday ? "Hoje" : requestDateLabel(selectedDate)}</strong>
            <small>
              Status referente ao turno {selectedShift.name.toLowerCase()}, das{" "}
              {selectedShift.startTime} às {selectedShift.endTime}
            </small>
          </div>
        </div>
        <div className="map-date-controls">
          <button
            className="icon-btn"
            type="button"
            title="Dia anterior"
            aria-label="Dia anterior"
            onClick={() => changeDate(addDays(selectedDate, -1))}
          >
            <ChevronLeft size={18} />
          </button>
          <input
            type="date"
            aria-label="Data do mapa de salas"
            value={selectedDate}
            onChange={(event) => changeDate(event.target.value)}
          />
          <button
            className="icon-btn"
            type="button"
            title="Dia seguinte"
            aria-label="Dia seguinte"
            onClick={() => changeDate(addDays(selectedDate, 1))}
          >
            <ChevronRight size={18} />
          </button>
          {!isToday && (
            <button
              className="btn btn-soft"
              type="button"
              onClick={() => changeDate(today)}
            >
              Hoje
            </button>
          )}
          <button
            className="btn btn-soft map-shift-button"
            type="button"
            title="Clique para alternar entre manhã, tarde e turno extra"
            onClick={cycleShift}
          >
            <Clock3 size={16} /> Turno: {selectedShift.name}
          </button>
        </div>
      </div>
      {!dayReady && (
        <div className="map-day-state">
          {dayError ? (
            <>
              <span>{dayError}</span>
              <button
                className="btn btn-soft"
                type="button"
                onClick={() => setReloadDay((value) => value + 1)}
              >
                Tentar novamente
              </button>
            </>
          ) : (
            <span>Carregando o mapa deste dia...</span>
          )}
        </div>
      )}
      {dayReady && (
        <>
      <div className="summary-grid">
        <Summary
          icon={DoorOpen}
          label="Livres durante todo o turno"
          value={`${free} de ${state.rooms.length}`}
          tone="green"
        />
        <Summary
          icon={Users}
          label="Com reserva no turno"
          value={String(state.rooms.length - free)}
          tone="amber"
        />
        <Summary
          icon={CalendarDays}
          label="Reservas no turno"
          value={String(
            reservations.filter(
              (reservation) =>
                reservation.status === "reserved" &&
                new Date(reservation.startsAt) < shiftEnd &&
                new Date(reservation.endsAt) > shiftStart,
            ).length,
          )}
          tone="blue"
          onClick={onOpenAgenda}
        />
        <Summary
          icon={Clock3}
          label="Turno selecionado"
          value={`${selectedShift.startTime} às ${selectedShift.endTime}`}
          tone="violet"
        />
      </div>
      <div className="toolbar">
        <div className="search">
          <Search size={18} />
          <input
            placeholder="Buscar sala, localidade, nome ou usuário"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="chips">
          {[
            ["all", "Todas"],
            ["free", "Disponíveis"],
            ["reserved", "Reservadas"],
            ["virtual", "Virtuais"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={filter === id ? "active" : ""}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {state.rooms.length === 0 ? (
        <Empty
          icon={DoorOpen}
          title="Nenhuma sala cadastrada"
          text="Um administrador pode cadastrar a primeira sala na área Salas."
        />
      ) : (
        <div className="room-grid">
          {filtered.map((room) => {
            const current = currentFor(room.id);
            const next = nextFor(room.id);
            const roomShiftReservations = shiftReservationsFor(room.id);
            const hasReservation = roomShiftReservations.length > 0;
            const matchedUsers = query.trim()
              ? roomShiftReservations.filter((reservation) =>
                  `${reservation.userName} ${reservation.userUsername || ""}`
                    .toLowerCase()
                    .includes(query.trim().toLowerCase()),
                )
              : [];
            const issues = state.issues.filter(
              (issue) => issue.roomId === room.id && issue.status === "open",
            );
            return (
              <article
                className={`room-card ${hasReservation ? "reserved" : "free"}`}
                key={room.id}
              >
                <div className="room-card-head">
                  <div className="room-icon">
                    {room.kind === "virtual" ? (
                      <Video size={21} />
                    ) : (
                      <DoorOpen size={21} />
                    )}
                  </div>
                  <span className="status-dot">
                    <i />
                    {current
                      ? referenceIsNow
                        ? "Reservada agora"
                        : `Reservada às ${selectedShift.startTime}`
                      : hasReservation
                        ? `${roomShiftReservations.length} reserva${roomShiftReservations.length > 1 ? "s" : ""} no turno`
                        : "Livre durante o turno"}
                  </span>
                </div>
                <button
                  className="room-title-button"
                  onClick={() => onInspect(room)}
                >
                  <div className="room-title">
                    <h3>{room.name}</h3>
                    <p>
                      <MapPin size={14} />
                      {room.location ||
                        (room.kind === "virtual"
                          ? "Online"
                          : "Local não informado")}
                    </p>
                  </div>
                  <Eye size={18} />
                </button>
                <div className="room-meta">
                  <span>
                    <Users size={15} /> Até {room.capacity}
                  </span>
                  <span>
                    <Monitor size={15} /> {room.workstations} PAs
                  </span>
                </div>
                {matchedUsers.length > 0 && (
                  <div className="user-search-hit">
                    <Search size={15} />
                    <div>
                      <strong>{matchedUsers[0].userName}</strong>
                      <span>
                        @{matchedUsers[0].userUsername || "usuário"} •{" "}
                        {time(matchedUsers[0].startsAt)} às{" "}
                        {time(matchedUsers[0].endsAt)}
                      </span>
                    </div>
                  </div>
                )}
                {issues.length > 0 && (
                  <button
                    className="issue-banner"
                    onClick={() => onInspect(room)}
                  >
                    <AlertTriangle size={16} />
                    <span>
                      {issues.length} problema{issues.length > 1 ? "s" : ""} em
                      aberto
                    </span>
                  </button>
                )}
                {current ? (
                  <div className="occupation">
                    <div>
                      <span>Reservada para</span>
                      <strong>{current.userName}</strong>
                      <p>{current.reason}</p>
                    </div>
                    <div className="occupation-foot">
                      <span>
                        <Clock3 size={14} /> Reservada até {time(current.endsAt)}
                      </span>
                      {current.shareable && (
                        <span className="share-tag">Aceita compartilhar</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="availability">
                    <span className="pulse" />
                    <div>
                      <strong>Disponível</strong>
                      <small>
                        {next
                          ? `Disponível até ${time(next.startsAt)}`
                          : `Disponível até ${selectedShift.endTime}`}
                      </small>
                    </div>
                  </div>
                )}
                {roomShiftReservations.length > 0 && (
                  <div className="shift-bookings">
                    <span>Agenda do turno</span>
                    {roomShiftReservations.slice(0, 3).map((reservation) => (
                      <div key={reservation.id}>
                        <strong>
                          {time(reservation.startsAt)} às {time(reservation.endsAt)}
                        </strong>
                        <small>{reservation.userName}</small>
                      </div>
                    ))}
                    {roomShiftReservations.length > 3 && (
                      <small>
                        + {roomShiftReservations.length - 3} reserva(s)
                      </small>
                    )}
                  </div>
                )}
                <button
                  className="btn btn-outline full"
                  onClick={() => onInspect(room)}
                >
                  <CalendarRange size={16} /> Agenda e recursos
                </button>
                <div className="card-actions">
                  {(canBookDirectly || canRequest) && (
                    <button
                      className="btn btn-soft"
                      onClick={() => onSchedule(room)}
                    >
                      <CalendarDays size={16} />{" "}
                      {canBookDirectly ? "Reservar" : "Solicitar"}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
        </>
      )}
    </>
  );
}

function Summary({
  icon: Icon,
  label,
  value,
  tone,
  onClick,
}: {
  icon: typeof DoorOpen;
  label: string;
  value: string;
  tone: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className={`summary-icon ${tone}`}>
        <Icon size={20} />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </>
  );
  return onClick ? (
    <button className="summary summary-link" onClick={onClick}>
      {content}
      <ChevronRight className="summary-link-arrow" size={18} />
    </button>
  ) : (
    <div className="summary">{content}</div>
  );
}
function time(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Horário indisponível"
    : new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Bahia",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}
function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Data indisponível"
    : new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Bahia",
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(date);
}
function dateKey(value: string | Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bahia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function addDays(date: string, amount: number) {
  const next = new Date(`${date}T12:00:00-03:00`);
  next.setUTCDate(next.getUTCDate() + amount);
  return dateKey(next);
}
function statusLabel(status: Reservation["status"]) {
  return status === "cancelled" ? "Cancelada" : "Reservada";
}
function reservationShift(state: AppState, reservation: Reservation) {
  const start = time(reservation.startsAt);
  return (
    state.shifts.find(
      (shift) => start >= shift.startTime && start <= shift.endTime,
    )?.name || "Fora dos turnos"
  );
}
async function exportAgenda(
  from: string,
  to: string,
  reservations: Reservation[],
  state: AppState,
) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Mappa de Salas";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet("Agenda", {
    views: [{ state: "frozen", ySplit: 1 }],
    properties: { defaultRowHeight: 20 },
  });
  worksheet.columns = [
    { header: "Data", key: "date", width: 14 },
    { header: "Sala", key: "room", width: 30 },
    { header: "Turno", key: "shift", width: 18 },
    { header: "Horário", key: "time", width: 20 },
    { header: "Usuário ou pessoa", key: "user", width: 30 },
    { header: "Motivo", key: "reason", width: 42 },
    { header: "Status", key: "status", width: 18 },
  ];
  worksheet.addRows(
    reservations.map((reservation) => ({
      date: new Date(`${dateKey(reservation.startsAt)}T12:00:00`),
      room:
        reservation.roomName ||
        state.rooms.find((room) => room.id === reservation.roomId)?.name ||
        "Sala não encontrada",
      shift: reservationShift(state, reservation),
      time: `${time(reservation.startsAt)} às ${time(reservation.endsAt)}`,
      user: reservation.userName,
      reason: reservation.reason,
      status: statusLabel(reservation.status),
    })),
  );
  worksheet.getColumn("date").numFmt = "dd/mm/yyyy";
  worksheet.autoFilter = {
    from: "A1",
    to: `G${Math.max(1, reservations.length + 1)}`,
  };
  const header = worksheet.getRow(1);
  header.height = 26;
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0A00BF" },
  };
  header.alignment = { vertical: "middle" };
  worksheet.eachRow((row, rowNumber) => {
    row.alignment = { vertical: "middle", wrapText: rowNumber > 1 };
    if (rowNumber > 1 && rowNumber % 2 === 1) {
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF7F5FF" },
      };
    }
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
  link.download = `agenda-${from}${from === to ? "" : `-a-${to}`}.xlsx`;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function CalendarView({
  state,
  can,
  scheduleMode,
  onSchedule,
  onEdit,
  onCancel,
  onCancelSeries,
}: {
  state: AppState;
  can: (p: Permission) => boolean;
  scheduleMode: "booking" | "request" | "none";
  onSchedule: () => void;
  onEdit: (r: Reservation) => void;
  onCancel: (r: Reservation) => void;
  onCancelSeries: (r: Reservation) => void;
}) {
  const today = dateKey(state.now);
  const tomorrow = addDays(today, 1);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [agendaLoading, setAgendaLoading] = useState(true);
  const [agendaError, setAgendaError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [roomFilter, setRoomFilter] = useState("all");
  const [shiftFilter, setShiftFilter] = useState("all");
  const [timeFilter, setTimeFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [reasonFilter, setReasonFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    if (!from || !to || from > to) return;
    let active = true;
    api(
      `/api/agenda?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    )
      .then((data) => {
        if (!active) return;
        setReservations(
          Array.isArray(data.reservations) ? data.reservations : [],
        );
        setAgendaError("");
      })
      .catch((error) => {
        if (!active) return;
        setAgendaError(
          error instanceof Error ? error.message : "Não foi possível carregar.",
        );
      })
      .finally(() => {
        if (active) setAgendaLoading(false);
      });
    return () => {
      active = false;
    };
  }, [from, to, state.now]);

  const roomName = (reservation: Reservation) =>
    reservation.roomName ||
    state.rooms.find((room) => room.id === reservation.roomId)?.name ||
    "Sala não encontrada";
  const roomOptions = Array.from(
    new Map(
      reservations.map((reservation) => [
        reservation.roomId,
        roomName(reservation),
      ]),
    ),
  ).sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  const normalizedTime = timeFilter.trim().toLocaleLowerCase("pt-BR");
  const normalizedUser = userFilter.trim().toLocaleLowerCase("pt-BR");
  const normalizedReason = reasonFilter.trim().toLocaleLowerCase("pt-BR");
  const filtered = reservations.filter((reservation) => {
    const shift = reservationShift(state, reservation);
    const schedule = `${time(reservation.startsAt)} às ${time(reservation.endsAt)}`;
    return (
      (roomFilter === "all" || reservation.roomId === roomFilter) &&
      (shiftFilter === "all" || shift === shiftFilter) &&
      (!normalizedTime ||
        schedule.toLocaleLowerCase("pt-BR").includes(normalizedTime)) &&
      (!normalizedUser ||
        reservation.userName
          .toLocaleLowerCase("pt-BR")
          .includes(normalizedUser)) &&
      (!normalizedReason ||
        reservation.reason
          .toLocaleLowerCase("pt-BR")
          .includes(normalizedReason)) &&
      (statusFilter === "all" || reservation.status === statusFilter)
    );
  });
  const shiftRange = (amount: number) => {
    setAgendaLoading(true);
    setReservations([]);
    setFrom((current) => addDays(current, amount));
    setTo((current) => addDays(current, amount));
  };
  const setRange = (nextFrom: string, nextTo: string) => {
    setAgendaLoading(true);
    setReservations([]);
    setFrom(nextFrom);
    setTo(nextTo);
  };
  const handleExport = async () => {
    setExporting(true);
    setAgendaError("");
    try {
      await exportAgenda(from, to, filtered, state);
    } catch {
      setAgendaError(
        "Não foi possível gerar a planilha XLSX. Tente novamente.",
      );
    } finally {
      setExporting(false);
    }
  };
  return (
    <div className="panel">
      <div className="panel-head agenda-head">
        <div>
          <div className="date-nav">
            <button
              className="icon-btn"
              title="Mover intervalo um dia para trás"
              onClick={() => shiftRange(-1)}
            >
              <ChevronLeft size={19} />
            </button>
            <label className="date-field">
              <span>Data inicial</span>
              <input
                aria-label="Data inicial da agenda"
                type="date"
                value={from}
                onChange={(e) => {
                  setAgendaLoading(true);
                  setReservations([]);
                  setFrom(e.target.value);
                  if (e.target.value > to) setTo(e.target.value);
                }}
              />
            </label>
            <label className="date-field">
              <span>Data final</span>
              <input
                aria-label="Data final da agenda"
                type="date"
                min={from}
                value={to}
                onChange={(e) => {
                  setAgendaLoading(true);
                  setReservations([]);
                  setTo(e.target.value);
                }}
              />
            </label>
            <button
              className="icon-btn"
              title="Mover intervalo um dia para frente"
              onClick={() => shiftRange(1)}
            >
              <ChevronRight size={19} />
            </button>
            <button
              className="btn btn-soft"
              onClick={() => setRange(today, today)}
            >
              Hoje
            </button>
            <button
              className={`btn ${from === tomorrow && to === tomorrow ? "btn-primary" : "btn-soft"}`}
              onClick={() => setRange(tomorrow, tomorrow)}
            >
              Amanhã
            </button>
          </div>
          <p className="agenda-caption">
            {agendaLoading && !reservations.length
              ? "Carregando agendas..."
              : `${filtered.length} de ${reservations.length} agenda(s) no período selecionado`}
          </p>
        </div>
        <div className="agenda-actions">
          <button
            className="btn btn-soft"
            disabled={!filtered.length || exporting}
            onClick={handleExport}
          >
            <FileSpreadsheet size={17} />
            {exporting ? "Gerando XLSX..." : "Exportar XLSX"}
          </button>
          {scheduleMode !== "none" && (
            <button className="btn btn-primary" onClick={onSchedule}>
              <Plus size={17} />{" "}
              {scheduleMode === "request" ? "Nova solicitação" : "Nova reserva"}
            </button>
          )}
        </div>
      </div>
      <div className="agenda-quick-ranges">
        <button
          className="btn btn-soft"
          onClick={() => setRange(addDays(today, -29), today)}
        >
          Últimos 30 dias
        </button>
        <button
          className="btn btn-soft"
          onClick={() => setRange(today, addDays(today, 6))}
        >
          Próximos 7 dias
        </button>
        <button
          className="btn btn-soft"
          onClick={() => setRange(today, addDays(today, 29))}
        >
          Próximos 30 dias
        </button>
      </div>
      <div className="agenda-filters">
        <label>
          Sala
          <select
            value={roomFilter}
            onChange={(e) => setRoomFilter(e.target.value)}
          >
            <option value="all">Todas as salas</option>
            {roomOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Turno
          <select
            value={shiftFilter}
            onChange={(e) => setShiftFilter(e.target.value)}
          >
            <option value="all">Todos os turnos</option>
            {state.shifts.map((shift) => (
              <option key={shift.id} value={shift.name}>
                {shift.name}
              </option>
            ))}
            <option value="Fora dos turnos">Fora dos turnos</option>
          </select>
        </label>
        <label>
          Horário
          <input
            value={timeFilter}
            onChange={(e) => setTimeFilter(e.target.value)}
            placeholder="Ex.: 08:00 ou 14:20"
          />
        </label>
        <label>
          Usuário ou pessoa
          <input
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            placeholder="Buscar pelo nome"
          />
        </label>
        <label>
          Motivo
          <input
            value={reasonFilter}
            onChange={(e) => setReasonFilter(e.target.value)}
            placeholder="Buscar no motivo"
          />
        </label>
        <label>
          Status
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">Todos os status</option>
            <option value="reserved">Reservada</option>
            <option value="cancelled">Cancelada</option>
          </select>
        </label>
      </div>
      {agendaError && <div className="inline-error">{agendaError}</div>}
      {!agendaLoading && filtered.length ? (
        <div className="agenda-table-wrap">
          <table className="agenda-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Sala</th>
                <th>Turno</th>
                <th>Horário</th>
                <th>Usuário ou pessoa</th>
                <th>Motivo</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((reservation) => {
                const canEdit =
                  reservation.status === "reserved" &&
                  new Date(reservation.endsAt) > new Date(state.now) &&
                  (can("booking.manage_all") ||
                    (reservation.userId === state.currentUser?.id &&
                      can("booking.create_own")));
                return (
                  <tr key={reservation.id}>
                    <td data-label="Data">
                      {requestDateLabel(dateKey(reservation.startsAt))}
                    </td>
                    <td data-label="Sala">
                      <strong>{roomName(reservation)}</strong>
                    </td>
                    <td data-label="Turno">
                      {reservationShift(state, reservation)}
                    </td>
                    <td data-label="Horário">
                      {time(reservation.startsAt)} às {time(reservation.endsAt)}
                    </td>
                    <td data-label="Usuário ou pessoa">
                      <span className="person-cell">
                        <span className="avatar small">
                          {reservation.userName.slice(0, 2).toUpperCase()}
                        </span>
                        {reservation.userName}
                      </span>
                    </td>
                    <td data-label="Motivo">{reservation.reason}</td>
                    <td data-label="Status">
                      <span className={`mini-status ${reservation.status}`}>
                        {statusLabel(reservation.status)}
                      </span>
                    </td>
                    <td className="agenda-row-actions">
                      {canEdit && (
                        <button
                          className="btn btn-soft"
                          onClick={() => onEdit(reservation)}
                        >
                          Editar
                        </button>
                      )}
                      {reservation.seriesId &&
                        (reservation.userId === state.currentUser?.id ||
                          can("booking.manage_all")) &&
                        reservation.status === "reserved" && (
                          <button
                            className="btn btn-soft"
                            title="Cancelar todo o período futuro"
                            onClick={() => onCancelSeries(reservation)}
                          >
                            <CalendarRange size={15} /> Período
                          </button>
                        )}
                      {(reservation.userId === state.currentUser?.id ||
                        can("booking.manage_all")) &&
                        reservation.status === "reserved" && (
                          <button
                            className="icon-btn danger"
                            title="Cancelar reserva"
                            onClick={() => onCancel(reservation)}
                          >
                            <X size={17} />
                          </button>
                        )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          icon={CalendarDays}
          title={
            agendaLoading ? "Carregando agendas" : "Nenhuma agenda encontrada"
          }
          text={
            agendaLoading
              ? "Aguarde enquanto consultamos o período selecionado."
              : "Ajuste o intervalo ou remova filtros para visualizar outras agendas."
          }
        />
      )}
    </div>
  );
}

function requestStatusLabel(status: BookingRequest["status"]) {
  return status === "approved"
    ? "Aprovada"
    : status === "rejected"
      ? "Rejeitada"
      : status === "cancelled"
        ? "Cancelada"
        : "Pendente";
}
function requestDateLabel(value: string) {
  const date = new Date(`${value}T12:00:00-03:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Bahia",
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(date);
}

function RequestsView({
  state,
  canReview,
  canRequest,
  onNew,
  onReview,
  onCancel,
}: {
  state: AppState;
  canReview: boolean;
  canRequest: boolean;
  onNew: () => void;
  onReview: (request: BookingRequest) => void;
  onCancel: (request: BookingRequest) => void;
}) {
  const pending = state.requests.filter(
    (request) => request.status === "pending",
  ).length;
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>
            {canReview
              ? `${pending} solicitação(ões) pendente(s)`
              : "Minhas solicitações"}
          </h2>
          <p>
            Uma solicitação não bloqueia a sala até ser aprovada e convertida em
            reserva.
          </p>
        </div>
        {canRequest && (
          <button className="btn btn-primary" onClick={onNew}>
            <Plus size={17} /> Nova solicitação
          </button>
        )}
      </div>
      {state.requests.length ? (
        <div className="request-list">
          {state.requests.map((request) => (
            <article className="request-card" key={request.id}>
              <div className="request-main">
                <div className="request-heading">
                  <div className="avatar small">
                    {request.requesterName.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <strong>{request.requesterName}</strong>
                    <span>
                      {request.roomName || "Qualquer sala disponível"}
                    </span>
                  </div>
                  <span className={`mini-status ${request.status}`}>
                    {requestStatusLabel(request.status)}
                  </span>
                </div>
                <div className="request-details">
                  <span>
                    <CalendarDays size={15} />{" "}
                    {requestDateLabel(request.requestedDate)}
                  </span>
                  <span>
                    <Clock3 size={15} /> {request.startTime} às{" "}
                    {request.endTime}
                  </span>
                  <span>
                    <Users size={15} /> {request.expectedPeople} pessoa(s)
                  </span>
                </div>
                <p className="request-reason">{request.reason}</p>
                {request.shareable && (
                  <span className="share-tag">Aceita compartilhar</span>
                )}
                {request.reviewComment && (
                  <div className="review-comment">
                    <strong>
                      Comentário de {request.reviewerName || "análise"}
                    </strong>
                    <p>{request.reviewComment}</p>
                  </div>
                )}
              </div>
              {request.status === "pending" && (
                <div className="request-actions">
                  {canReview && (
                    <button
                      className="btn btn-primary"
                      onClick={() => onReview(request)}
                    >
                      Analisar e editar
                    </button>
                  )}
                  {request.requesterId === state.currentUser?.id && (
                    <button
                      className="btn btn-soft"
                      onClick={() => onCancel(request)}
                    >
                      Cancelar solicitação
                    </button>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <Empty
          icon={ClipboardList}
          title="Nenhuma solicitação"
          text={
            canReview
              ? "As solicitações enviadas pela equipe aparecerão aqui."
              : "Você ainda não solicitou uma sala."
          }
        />
      )}
    </div>
  );
}

function RoomsAdmin({
  state,
  onNew,
  onEdit,
  onDisable,
}: {
  state: AppState;
  onNew: () => void;
  onEdit: (r: Room) => void;
  onDisable: (r: Room) => void;
}) {
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>{state.rooms.length} ambientes ativos</h2>
          <p>Cadastre salas, links virtuais ou outras localidades.</p>
        </div>
        <button className="btn btn-primary" onClick={onNew}>
          <Plus size={17} /> Nova sala
        </button>
      </div>
      <div className="data-list">
        {state.rooms.map((room) => (
          <div className="data-row" key={room.id}>
            <div className="room-icon">
              {room.kind === "virtual" ? (
                <Video size={20} />
              ) : (
                <Building2 size={20} />
              )}
            </div>
            <div className="grow">
              <strong>{room.name}</strong>
              <span>{room.location || "Sem localidade"}</span>
            </div>
            <div className="row-stat">
              <span>Capacidade</span>
              <strong>{room.capacity}</strong>
            </div>
            <span className="kind-tag">
              {room.kind === "physical"
                ? "Física"
                : room.kind === "virtual"
                  ? "Virtual"
                  : "Outra"}
            </span>
            <button className="btn btn-soft" onClick={() => onEdit(room)}>
              Editar
            </button>
            <button
              className="icon-btn danger"
              title="Desativar"
              onClick={() => onDisable(room)}
            >
              <X size={17} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function UsersAdmin({
  state,
  canManage,
  canDelete,
  canReset,
  canEditGod,
  onNew,
  onEdit,
  onReset,
  onDelete,
}: {
  state: AppState;
  canManage: boolean;
  canDelete: boolean;
  canReset: boolean;
  canEditGod: boolean;
  onNew: () => void;
  onEdit: (u: AppState["users"][number]) => void;
  onReset: (u: AppState["users"][number]) => void;
  onDelete: (u: AppState["users"][number]) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredUsers = state.users.filter((user) =>
    `${user.name} ${user.username} ${user.roleName}`
      .toLowerCase()
      .includes(normalizedQuery),
  );
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Equipe cadastrada</h2>
          <p>Acessos, perfis e recuperação de senha.</p>
        </div>
        {canManage && (
          <button className="btn btn-primary" onClick={onNew}>
            <Plus size={17} /> Novo usuário
          </button>
        )}
      </div>
      <div className="user-admin-search">
        <div className="search">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nome ou nome de usuário"
          />
        </div>
        <span>
          {filteredUsers.length} de {state.users.length} usuário(s)
        </span>
      </div>
      <div className="data-list">
        {filteredUsers.map((user) => (
          <div
            className={`data-row ${!user.active ? "muted-row" : ""}`}
            key={user.id}
          >
            <div className="avatar">
              {user.name
                .split(" ")
                .slice(0, 2)
                .map((part) => part[0])
                .join("")}
            </div>
            <div className="grow">
              <strong>
                {user.name}
                {user.isGod && <ShieldCheck size={15} />}
              </strong>
              <span>@{user.username}</span>
            </div>
            <span className="kind-tag">{user.roleName}</span>
            <span
              className={`security-status ${user.hasSecurityAnswers ? "configured" : "pending"}`}
            >
              {user.hasSecurityAnswers
                ? "Segurança configurada"
                : "Configuração pendente"}
            </span>
            <span
              className={`mini-status ${user.active ? "active" : "cancelled"}`}
            >
              {user.active ? "Ativo" : "Inativo"}
            </span>
            {canReset &&
              user.hasSecurityAnswers &&
              (!user.isGod ||
                (canEditGod &&
                  (!user.isOwnerGod || user.id === state.currentUser?.id))) && (
                <button className="btn btn-soft" onClick={() => onReset(user)}>
                  <KeyRound size={15} /> Resetar segurança
                </button>
              )}
            {canManage &&
              (!user.isGod ||
                (canEditGod &&
                  (!user.isOwnerGod || user.id === state.currentUser?.id))) && (
                <button className="btn btn-soft" onClick={() => onEdit(user)}>
                  Editar
                </button>
              )}
            {canDelete &&
              !user.isOwnerGod &&
              (!user.isGod || canEditGod) &&
              user.id !== state.currentUser?.id && (
                <button
                  className="icon-btn danger"
                  title={`Excluir usuário ${user.name}`}
                  onClick={() => onDelete(user)}
                >
                  <Trash2 size={17} />
                </button>
              )}
          </div>
        ))}
        {filteredUsers.length === 0 && (
          <Empty
            icon={Search}
            title="Nenhum usuário encontrado"
            text="Tente pesquisar por outro nome ou nome de usuário."
          />
        )}
      </div>
    </div>
  );
}

function DevelopmentTeamView({
  state,
  canEdit,
  onNew,
  onEdit,
  onDelete,
  onFeedbackStatus,
}: {
  state: AppState;
  canEdit: boolean;
  onNew: () => void;
  onEdit: (member: AppState["developmentTeam"][number]) => void;
  onDelete: (member: AppState["developmentTeam"][number]) => void;
  onFeedbackStatus: (
    report: AppState["feedbackReports"][number],
    status: AppState["feedbackReports"][number]["status"],
  ) => void;
}) {
  return (
    <div className="development-page">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Equipe de desenvolvimento</h2>
            <p>Contribuições complementares apresentadas com o mesmo destaque.</p>
          </div>
          {canEdit && (
            <button className="btn btn-primary" onClick={onNew}>
              <Plus size={17} /> Adicionar integrante
            </button>
          )}
        </div>
        <div className="development-grid">
          {state.developmentTeam.map((member) => (
            <article className="development-card" key={member.id}>
              <div className="development-avatar">
                {member.name
                  .split(" ")
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join("")}
              </div>
              <h3>{member.name}</h3>
              <p>{member.role}</p>
              <div className="development-contacts">
                {member.email && (
                  <a href={`mailto:${member.email}`}>
                    <Mail size={15} /> {member.email}
                  </a>
                )}
                {member.phone && (
                  <a href={`tel:${member.phone.replace(/[^\d+]/g, "")}`}>
                    <Phone size={15} /> {member.phone}
                  </a>
                )}
                {member.profileUrl && (
                  <a href={member.profileUrl} target="_blank" rel="noreferrer">
                    <ExternalLink size={15} /> Perfil profissional
                  </a>
                )}
              </div>
              {canEdit && (
                <div className="development-actions">
                  <button className="btn btn-soft" onClick={() => onEdit(member)}>
                    Editar perfil
                  </button>
                  <button
                    className="icon-btn danger"
                    title={`Remover ${member.name}`}
                    onClick={() => onDelete(member)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
      {canEdit && (
        <section className="panel feedback-admin-panel">
          <div className="panel-head">
            <div>
              <h2>Relatos recebidos</h2>
              <p>Bugs e sugestões enviados pelo menu e pela tela de login.</p>
            </div>
          </div>
          {state.feedbackReports.length ? (
            <div className="feedback-report-list">
              {state.feedbackReports.map((report) => (
                <article key={report.id}>
                  <div className="feedback-report-icon">
                    {report.type === "bug" ? (
                      <Bug size={18} />
                    ) : (
                      <Lightbulb size={18} />
                    )}
                  </div>
                  <div className="grow">
                    <strong>{report.title}</strong>
                    <p>{report.description}</p>
                    <small>
                      {report.reporterName || "Pessoa não identificada"}
                      {report.reporterEmail ? ` • ${report.reporterEmail}` : ""}
                      {` • ${dateLabel(report.createdAt)}`}
                    </small>
                  </div>
                  <select
                    aria-label={`Status de ${report.title}`}
                    value={report.status}
                    onChange={(event) =>
                      onFeedbackStatus(
                        report,
                        event.target.value as typeof report.status,
                      )
                    }
                  >
                    <option value="open">Aberto</option>
                    <option value="in_review">Em análise</option>
                    <option value="resolved">Resolvido</option>
                  </select>
                </article>
              ))}
            </div>
          ) : (
            <Empty
              icon={Check}
              title="Nenhum relato recebido"
              text="Novos bugs e sugestões aparecerão aqui."
            />
          )}
        </section>
      )}
    </div>
  );
}

function RolesAdmin({
  state,
  canDelete,
  onNew,
  onEdit,
  onDelete,
}: {
  state: AppState;
  canDelete: boolean;
  onNew: () => void;
  onEdit: (r: Role) => void;
  onDelete: (r: Role) => void;
}) {
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Perfis de acesso</h2>
          <p>Combine permissões conforme a responsabilidade.</p>
        </div>
        <button className="btn btn-primary" onClick={onNew}>
          <Plus size={17} /> Novo perfil
        </button>
      </div>
      <div className="role-grid">
        {state.roles.map((role) => (
          <article className="role-card" key={role.id}>
            <div className="role-head">
              <span className="role-color" style={{ background: role.color }} />
              <div>
                <h3>{role.name}</h3>
                <p>{role.permissions.length} permissões</p>
              </div>
              {role.system && <span className="system-tag">Sistema</span>}
            </div>
            <div className="permission-preview">
              {role.permissions.slice(0, 4).map((permission) => (
                <span key={permission}>
                  <Check size={13} />
                  {PERMISSION_LABELS[permission] || permission}
                </span>
              ))}
              {role.permissions.length > 4 && (
                <small>+ {role.permissions.length - 4} outras</small>
              )}
            </div>
            <div className="role-actions">
              <button
                className="btn btn-soft full"
                disabled={role.name === "God"}
                onClick={() => onEdit(role)}
              >
                {role.name === "God" ? "Perfil protegido" : "Editar permissões"}
              </button>
              {canDelete && role.name !== "God" && (
                <button
                  className="icon-btn danger"
                  title={`Excluir perfil ${role.name}`}
                  onClick={() => onDelete(role)}
                >
                  <Trash2 size={17} />
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function AuditView({ state }: { state: AppState }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Últimas alterações</h2>
          <p>Registro de responsabilidade e segurança.</p>
        </div>
      </div>
      {state.audit.length ? (
        <div className="timeline">
          {state.audit.map((item) => (
            <div className="timeline-item" key={item.id}>
              <span className="timeline-dot" />
              <div>
                <strong>{item.action}</strong>
                <p>{item.details}</p>
                <small>
                  {item.actorName || "Sistema"} • {dateLabel(item.createdAt)} às{" "}
                  {time(item.createdAt)}
                </small>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty
          icon={History}
          title="Histórico ainda vazio"
          text="As próximas alterações realizadas no sistema aparecerão aqui."
        />
      )}
    </div>
  );
}

function StatsView({ state }: { state: AppState }) {
  const [mode, setMode] = useState<"user" | "room">("user");
  const [targetId, setTargetId] = useState(state.users[0]?.id || "");
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(Boolean(state.users[0]?.id));
  const [error, setError] = useState("");
  const options = mode === "user" ? state.users : state.rooms;
  useEffect(() => {
    if (!targetId) return;
    let cancelled = false;
    api(`/api/stats?mode=${mode}&id=${encodeURIComponent(targetId)}`)
      .then((result) => {
        if (!cancelled) setData(result as StatsData);
      })
      .catch((reason) => {
        if (!cancelled) {
          setData(null);
          setError(
            reason instanceof Error
              ? reason.message
              : "Falha ao carregar estatísticas.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, targetId]);
  const selectTarget = (id: string) => {
    setTargetId(id);
    setData(null);
    setError("");
    setLoading(Boolean(id));
  };
  const changeMode = (nextMode: "user" | "room") => {
    setMode(nextMode);
    selectTarget(
      nextMode === "user" ? state.users[0]?.id || "" : state.rooms[0]?.id || "",
    );
  };
  return (
    <>
      <div className="stats-controls">
        <div className="stats-mode">
          <button
            className={mode === "user" ? "active" : ""}
            onClick={() => changeMode("user")}
          >
            <Users size={17} /> Por usuário
          </button>
          <button
            className={mode === "room" ? "active" : ""}
            onClick={() => changeMode("room")}
          >
            <DoorOpen size={17} /> Por sala
          </button>
        </div>
        <label>
          {mode === "user" ? "Selecione a pessoa" : "Selecione a sala"}
          <select
            value={targetId}
            onChange={(event) => selectTarget(event.target.value)}
          >
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <div className="alert">
          <span>{error}</span>
        </div>
      )}
      {loading ? (
        <div className="panel stats-loading">Carregando estatísticas...</div>
      ) : data ? (
        <>
          <div className="summary-grid stats-summary">
            <Summary
              icon={BarChart3}
              label="Utilizações concluídas"
              value={String(data.totals.useCount)}
              tone="green"
            />
            <Summary
              icon={Clock3}
              label="Tempo total"
              value={durationLabel(data.totals.totalMinutes)}
              tone="blue"
            />
            <Summary
              icon={Clock3}
              label="Duração média"
              value={durationLabel(data.totals.averageMinutes)}
              tone="violet"
            />
          </div>
          <div className="panel">
            <div className="panel-head">
              <div>
                <h2>{data.targetName}</h2>
                <p>
                  {mode === "user"
                    ? "Salas mais utilizadas por esta pessoa"
                    : "Pessoas que mais utilizam esta sala"}
                </p>
              </div>
            </div>
            {data.breakdown.length ? (
              <div className="stats-table-wrap">
                <table className="stats-table">
                  <thead>
                    <tr>
                      <th>{mode === "user" ? "Sala" : "Usuário ou pessoa"}</th>
                      <th>Utilizações</th>
                      <th>Tempo total</th>
                      <th>Duração média</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.breakdown.map((row) => (
                      <tr key={row.id}>
                        <td
                          data-label={
                            mode === "user" ? "Sala" : "Usuário ou pessoa"
                          }
                        >
                          <strong>{row.name}</strong>
                        </td>
                        <td data-label="Utilizações">{row.useCount}</td>
                        <td data-label="Tempo total">
                          {durationLabel(row.totalMinutes)}
                        </td>
                        <td data-label="Duração média">
                          {durationLabel(row.averageMinutes)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                icon={BarChart3}
                title="Sem utilizações registradas"
                text="As estatísticas considerarão o tempo das reservas que já começaram."
              />
            )}
          </div>
        </>
      ) : (
        <Empty
          icon={BarChart3}
          title="Selecione uma opção"
          text="Escolha um usuário ou uma sala para visualizar as estatísticas."
        />
      )}
    </>
  );
}

function durationLabel(minutes: number) {
  const safe = Math.max(0, Math.round(minutes || 0));
  const hours = Math.floor(safe / 60);
  const remainder = safe % 60;
  return hours
    ? `${hours}h ${String(remainder).padStart(2, "0")}min`
    : `${remainder}min`;
}

function Modal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function RoomLifeModal({
  room,
  state,
  canSchedule,
  onClose,
  onSchedule,
  onReport,
  onResolve,
}: {
  room: Room;
  state: AppState;
  canSchedule: boolean;
  onClose: () => void;
  onSchedule: (room: Room) => void;
  onReport: (room: Room) => void;
  onResolve: (issue: RoomIssue) => void;
}) {
  const today = dateKey(state.now);
  const [view, setView] = useState<"day" | "week" | "month">("week");
  const [anchor, setAnchor] = useState(today);
  const [selectedDate, setSelectedDate] = useState(today);
  const monthDays = new Date(
    Number(anchor.slice(0, 4)),
    Number(anchor.slice(5, 7)),
    0,
  ).getDate();
  const rangeStart = view === "month" ? `${anchor.slice(0, 8)}01` : anchor;
  const count = view === "day" ? 1 : view === "week" ? 7 : monthDays;
  const dates = Array.from({ length: count }, (_, index) =>
    addDays(rangeStart, index),
  );
  const roomReservations = state.reservations.filter(
    (reservation) => reservation.roomId === room.id,
  );
  const issues = state.issues.filter(
    (issue) => issue.roomId === room.id && issue.status === "open",
  );
  const dayReservations = roomReservations
    .filter(
      (reservation) =>
        reservation.status === "reserved" &&
        dateKey(reservation.startsAt) === selectedDate,
    )
    .sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    );
  const statusFor = (date: string) => {
    const hasReservation = roomReservations.some(
      (reservation) =>
        reservation.status === "reserved" &&
        dateKey(reservation.startsAt) === date,
    );
    return hasReservation ? "reserved" : "available";
  };
  const now = new Date(state.now);
  const currentReservation =
    selectedDate === today
      ? dayReservations.find(
          (reservation) =>
            new Date(reservation.startsAt) <= now &&
            new Date(reservation.endsAt) > now,
        )
      : undefined;
  const nextReservation =
    selectedDate === today && !currentReservation
      ? dayReservations.find((reservation) => new Date(reservation.startsAt) > now)
      : undefined;
  const minutes = (value: string) => {
    const [hour, minute] = time(value).split(":").map(Number);
    return hour * 60 + minute;
  };
  const minuteLabel = (value: number) =>
    `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  const timelineStart = Math.min(
    8 * 60,
    ...dayReservations.map((reservation) => minutes(reservation.startsAt)),
  );
  const timelineEnd = Math.max(
    21 * 60,
    ...dayReservations.map((reservation) => minutes(reservation.endsAt)),
  );
  const timeline: {
    start: number;
    end: number;
    reservation?: Reservation;
  }[] = [];
  let cursor = timelineStart;
  for (const reservation of dayReservations) {
    const start = Math.max(timelineStart, minutes(reservation.startsAt));
    const end = Math.min(timelineEnd, minutes(reservation.endsAt));
    if (end <= cursor) continue;
    if (start > cursor) timeline.push({ start: cursor, end: start });
    timeline.push({
      start: Math.max(cursor, start),
      end,
      reservation,
    });
    cursor = end;
  }
  if (cursor < timelineEnd) timeline.push({ start: cursor, end: timelineEnd });
  return (
    <Modal
      title={`Vida da sala · ${room.name}`}
      subtitle="Disponibilidade, linha do tempo, recursos e problemas reportados."
      onClose={onClose}
    >
      <div className="room-life">
        <div className="life-controls">
          <div className="mode-toggle">
            {(["day", "week", "month"] as const).map((mode) => (
              <button
                type="button"
                key={mode}
                className={view === mode ? "active" : ""}
                onClick={() => setView(mode)}
              >
                {mode === "day" ? "Dia" : mode === "week" ? "Semana" : "Mês"}
              </button>
            ))}
          </div>
          <input
            aria-label="Data inicial"
            type="date"
            value={anchor}
            onChange={(event) => {
              setAnchor(event.target.value);
              setSelectedDate(event.target.value);
            }}
          />
        </div>
        <div className="status-legend">
          <span className="available">
            <i />
            Disponível
          </span>
          <span className="reserved">
            <i />
            Reservado
          </span>
        </div>
        <div className={`life-calendar ${view}`}>
          {dates.map((date) => (
            <button
              type="button"
              key={date}
              className={`${statusFor(date)} ${selectedDate === date ? "selected" : ""}`}
              onClick={() => setSelectedDate(date)}
            >
              <strong>
                {new Date(`${date}T12:00:00-03:00`).toLocaleDateString(
                  "pt-BR",
                  { day: "2-digit", month: "short" },
                )}
              </strong>
              <small>
                {statusFor(date) === "reserved" ? "Com reserva" : "Disponível"}
              </small>
            </button>
          ))}
        </div>
        <section className="life-section">
          <h3>Linha do tempo de {requestDateLabel(selectedDate)}</h3>
          {selectedDate === today && (
            <div
              className={`life-current-status ${currentReservation ? "reserved" : "available"}`}
            >
              <strong>
                {currentReservation
                  ? `Reservada até ${time(currentReservation.endsAt)}`
                  : nextReservation
                    ? `Disponível até ${time(nextReservation.startsAt)}`
                    : "Disponível no restante do dia"}
              </strong>
              <small>Atualizado automaticamente</small>
            </div>
          )}
          <div className="day-timeline">
            {timeline.map((segment) => {
              const reservation = segment.reservation;
              const tone = reservation ? "reserved" : "available";
              return (
                <div
                  key={`${segment.start}-${segment.end}-${reservation?.id || "free"}`}
                  className={`timeline-slot ${tone}`}
                >
                  <time>
                    {minuteLabel(segment.start)} às {minuteLabel(segment.end)}
                  </time>
                  <span>
                    {reservation
                      ? `Reservada · ${reservation.userName} · ${reservation.reason}`
                      : "Disponível"}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
        <section className="life-section">
          <h3>Infraestrutura e recursos</h3>
          <div className="resource-grid">
            <div>
              <Wifi size={19} />
              <span>
                Rede<strong>{room.networkStatus || "Não informado"}</strong>
              </span>
            </div>
            <div>
              <Armchair size={19} />
              <span>
                Cadeiras<strong>{room.chairs}</strong>
              </span>
            </div>
            <div>
              <Table2 size={19} />
              <span>
                Mesas<strong>{room.tables}</strong>
              </span>
            </div>
            <div>
              <Monitor size={19} />
              <span>
                PAs<strong>{room.workstations}</strong>
              </span>
            </div>
          </div>
          {room.resources && (
            <p className="resource-notes">
              <Settings2 size={16} />
              {room.resources}
            </p>
          )}
        </section>
        <section className="life-section">
          <div className="section-head">
            <h3>Problemas reportados</h3>
            <button className="btn btn-soft" onClick={() => onReport(room)}>
              <Wrench size={16} /> Reportar
            </button>
          </div>
          {issues.length ? (
            <div className="issue-list">
              {issues.map((issue) => (
                <article key={issue.id}>
                  <AlertTriangle size={18} />
                  <div>
                    <strong>{issue.description}</strong>
                    <small>
                      Por {issue.reporterName}
                      {issue.ticketOpened
                        ? ` · chamado ${issue.ticketReference || "aberto"}`
                        : " · sem chamado aberto"}
                    </small>
                  </div>
                  <button
                    className="btn btn-soft"
                    onClick={() => onResolve(issue)}
                  >
                    Resolvido
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p className="all-clear">
              <Check size={16} /> Nenhum problema em aberto.
            </p>
          )}
        </section>
        <div className="modal-actions">
          <button className="btn btn-soft" onClick={onClose}>
            Fechar
          </button>
          {canSchedule && (
            <button
              className="btn btn-primary"
              onClick={() => onSchedule(room)}
            >
              <CalendarDays size={16} /> Agendar esta sala
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function IssueModal({
  room,
  onClose,
  onSave,
}: {
  room: Room;
  onClose: () => void;
  onSave: (value: unknown) => void;
}) {
  const [description, setDescription] = useState("");
  const [ticketOpened, setTicketOpened] = useState(false);
  const [ticketReference, setTicketReference] = useState("");
  return (
    <Modal
      title={`Reportar problema · ${room.name}`}
      subtitle="O alerta ficará visível para todos antes da utilização."
      onClose={onClose}
    >
      <form
        className="modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            roomId: room.id,
            description,
            ticketOpened,
            ticketReference,
          });
        }}
      >
        <label>
          Problema encontrado
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            minLength={5}
            placeholder="Ex.: rede instável ou cadeira danificada"
            required
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={ticketOpened}
            onChange={(event) => setTicketOpened(event.target.checked)}
          />
          <span>
            <strong>Um chamado já foi aberto</strong>
          </span>
        </label>
        {ticketOpened && (
          <label>
            Número ou referência do chamado
            <input
              value={ticketReference}
              onChange={(event) => setTicketReference(event.target.value)}
              placeholder="Ex.: INC-12345"
            />
          </label>
        )}
        <ModalActions onClose={onClose} submit="Publicar alerta" />
      </form>
    </Modal>
  );
}

function PasswordModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (value: unknown) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const mismatch = Boolean(confirmation && confirmation !== newPassword);
  return (
    <Modal
      title="Alterar minha senha"
      subtitle="Disponível para qualquer usuário autenticado."
      onClose={onClose}
    >
      <form
        className="modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!mismatch) onSave({ currentPassword, newPassword });
        }}
      >
        <label>
          Senha atual
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
        </label>
        <label>
          Nova senha
          <input
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />
        </label>
        <label>
          Confirmar nova senha
          <input
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
          />
        </label>
        {mismatch && (
          <p className="form-error">
            A confirmação não corresponde à nova senha.
          </p>
        )}
        <ModalActions onClose={onClose} submit="Alterar senha" />
      </form>
    </Modal>
  );
}

function PaletteModal({
  palette,
  onClose,
  onSave,
}: {
  palette: PaletteChoice;
  onClose: () => void;
  onSave: (palette: PaletteChoice) => void;
}) {
  const [primary, setPrimary] = useState(palette.primary);
  const [accent, setAccent] = useState(palette.accent);
  const primaryContrast = contrastRatio(primary);
  const isRecommendedContrast = primaryContrast >= 4.5;
  const select = (choice: PaletteChoice) => {
    setPrimary(choice.primary);
    setAccent(choice.accent);
  };
  return (
    <Modal
      title="Personalizar paleta"
      subtitle="A escolha fica salva neste dispositivo para o seu usuário."
      onClose={onClose}
    >
      <form
        className="modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            primary: primary.toUpperCase(),
            accent: accent.toUpperCase(),
          });
        }}
      >
        <div className="palette-presets">
          <button
            type="button"
            className="palette-option"
            onClick={() => select(DEFAULT_PALETTE)}
          >
            <span>
              <i style={{ background: DEFAULT_PALETTE.primary }} />
              <i style={{ background: DEFAULT_PALETTE.accent }} />
            </span>
            <strong>Lilás</strong>
            <small>Padrão atual</small>
          </button>
          <button
            type="button"
            className="palette-option"
            onClick={() => select(BLUE_ORANGE_PALETTE)}
          >
            <span>
              <i style={{ background: BLUE_ORANGE_PALETTE.primary }} />
              <i style={{ background: BLUE_ORANGE_PALETTE.accent }} />
            </span>
            <strong>Azul e laranja</strong>
            <small>#0A00BF e #FF7900</small>
          </button>
        </div>
        <div className="form-grid palette-inputs">
          <label>
            Cor principal
            <input
              type="color"
              value={primary}
              onChange={(event) => setPrimary(event.target.value.toUpperCase())}
            />
            <code>{primary}</code>
          </label>
          <label>
            Cor de destaque
            <input
              type="color"
              value={accent}
              onChange={(event) => setAccent(event.target.value.toUpperCase())}
            />
            <code>{accent}</code>
          </label>
        </div>
        <div
          className={`contrast-note ${isRecommendedContrast ? "good" : "warning"}`}
        >
          <ShieldCheck size={18} />
          <div>
            <strong>
              {isRecommendedContrast
                ? "Contraste recomendado"
                : "Atenção ao contraste"}
            </strong>
            <p>
              Prefira uma cor principal escura e uma cor de destaque bem
              diferente. Isso preserva a leitura de botões, textos e estados das
              salas. O aplicativo ajusta automaticamente a cor do texto dos
              botões quando necessário.
            </p>
          </div>
        </div>
        <ModalActions onClose={onClose} submit="Aplicar cores" />
      </form>
    </Modal>
  );
}

function BookingEditModal({
  reservation,
  state,
  canManageAll,
  onClose,
  onSave,
}: {
  reservation: Reservation;
  state: AppState;
  canManageAll: boolean;
  onClose: () => void;
  onSave: (value: unknown, scope: "single" | "series") => void;
}) {
  const today = dateKey(state.now);
  const related = state.reservations
    .filter(
      (item) =>
        reservation.seriesId &&
        item.seriesId === reservation.seriesId &&
        item.status === "reserved" &&
        new Date(item.endsAt) > new Date(state.now),
    )
    .concat(
      state.reservations.some((item) => item.id === reservation.id)
        ? []
        : [reservation],
    )
    .sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    );
  const periodDates = Array.from(
    new Set(related.map((item) => dateKey(item.startsAt))),
  ).filter((date) => date >= today);
  const [scope, setScope] = useState<"single" | "series">("single");
  const [roomId, setRoomId] = useState(reservation.roomId);
  const [userId, setUserId] = useState(reservation.userId);
  const [reason, setReason] = useState(reservation.reason);
  const [startTime, setStartTime] = useState(time(reservation.startsAt));
  const [endTime, setEndTime] = useState(time(reservation.endsAt));
  const [startDate, setStartDate] = useState(dateKey(reservation.startsAt));
  const [endDate, setEndDate] = useState(
    periodDates.at(-1) || dateKey(reservation.startsAt),
  );
  const [shareable, setShareable] = useState(reservation.shareable);
  const [people, setPeople] = useState(reservation.expectedPeople);
  const dates = useMemo(() => {
    if (scope === "single") return [startDate];
    const result: string[] = [];
    let cursor = startDate;
    while (cursor <= endDate && result.length < 31) {
      result.push(cursor);
      cursor = addDays(cursor, 1);
    }
    return result;
  }, [endDate, scope, startDate]);
  const tooLong =
    dates.length > 30 || (scope === "series" && endDate < startDate);
  const conflicts = dates.slice(0, 30).flatMap((date) => {
    const conflict = state.reservations.find(
      (item) =>
        item.status === "reserved" &&
        item.roomId === roomId &&
        dateKey(item.startsAt) === date &&
        time(item.startsAt) < endTime &&
        time(item.endsAt) > startTime &&
        (scope === "single"
          ? item.id !== reservation.id
          : item.seriesId !== reservation.seriesId),
    );
    return conflict ? [{ date, conflict }] : [];
  });
  const applyShift = (shift: { startTime: string; endTime: string }) => {
    setStartTime(shift.startTime);
    setEndTime(shift.endTime);
  };
  const selectScope = (next: "single" | "series") => {
    setScope(next);
    if (next === "single") {
      const selected = dateKey(reservation.startsAt);
      setStartDate(selected);
      setEndDate(selected);
    } else {
      setStartDate(periodDates[0] || today);
      setEndDate(periodDates.at(-1) || periodDates[0] || today);
    }
  };
  return (
    <Modal
      title="Editar reserva"
      subtitle={
        reservation.seriesId
          ? "Altere somente esta reserva ou todo o período de uma vez."
          : "Altere os dados da reserva selecionada."
      }
      onClose={onClose}
    >
      <form
        className="modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (tooLong) return;
          onSave(
            scope === "series"
              ? {
                  seriesId: reservation.seriesId,
                  roomId,
                  userId,
                  reason,
                  startTime,
                  endTime,
                  dates,
                  shareable,
                  expectedPeople: people,
                }
              : {
                  id: reservation.id,
                  roomId,
                  userId,
                  reason,
                  requestedDate: startDate,
                  startTime,
                  endTime,
                  shareable,
                  expectedPeople: people,
                },
            scope,
          );
        }}
      >
        {reservation.seriesId && (
          <div className="mode-toggle">
            <button
              type="button"
              className={scope === "single" ? "active" : ""}
              onClick={() => selectScope("single")}
            >
              Somente esta reserva
            </button>
            <button
              type="button"
              className={scope === "series" ? "active" : ""}
              onClick={() => selectScope("series")}
            >
              Todo o período
            </button>
          </div>
        )}
        <div className="form-grid">
          <label>
            Sala
            <select value={roomId} onChange={(event) => setRoomId(event.target.value)}>
              {state.rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
          </label>
          {canManageAll && state.users.length > 0 && (
            <label>
              Utilizador
              <select value={userId} onChange={(event) => setUserId(event.target.value)}>
                {state.users
                  .filter((user) => user.active)
                  .map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </div>
        <label>
          Motivo
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={3}
            required
          />
        </label>
        <div className="form-grid">
          <label>
            {scope === "series" ? "Data inicial" : "Data"}
            <input
              type="date"
              min={today}
              value={startDate}
              onChange={(event) => {
                setStartDate(event.target.value);
                if (scope === "single" || event.target.value > endDate)
                  setEndDate(event.target.value);
              }}
              required
            />
          </label>
          {scope === "series" && (
            <label>
              Data final
              <input
                type="date"
                min={startDate}
                max={addDays(startDate, 29)}
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                required
              />
            </label>
          )}
        </div>
        <div>
          <span className="section-label">Turnos rápidos</span>
          <div className="shift-buttons">
            {state.shifts.map((shift) => (
              <button
                type="button"
                key={shift.id}
                className={
                  shift.startTime === startTime && shift.endTime === endTime
                    ? "active"
                    : ""
                }
                onClick={() => applyShift(shift)}
              >
                {shift.name}
                <small>
                  {shift.startTime}–{shift.endTime}
                </small>
              </button>
            ))}
          </div>
        </div>
        <div className="form-grid">
          <label>
            Início
            <input
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              required
            />
          </label>
          <label>
            Fim
            <input
              type="time"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              required
            />
          </label>
        </div>
        {tooLong && (
          <p className="form-error">O período deve ter no máximo 30 dias.</p>
        )}
        {conflicts.length > 0 && (
          <div className="replacement-notice">
            <strong>
              {conflicts.length} reserva(s) anterior(es) serão substituída(s)
            </strong>
            <span>
              A edição mais recente terá prioridade nos horários coincidentes.
            </span>
          </div>
        )}
        <div className="form-grid">
          <label>
            Pessoas previstas
            <input
              type="number"
              min={1}
              value={people}
              onChange={(event) => setPeople(Number(event.target.value))}
            />
          </label>
          <label className="check-row compact">
            <input
              type="checkbox"
              checked={shareable}
              onChange={(event) => setShareable(event.target.checked)}
            />
            <span>
              <strong>Aceito compartilhar a sala</strong>
            </span>
          </label>
        </div>
        <ModalActions
          onClose={onClose}
          submit={scope === "series" ? "Salvar período" : "Salvar reserva"}
        />
      </form>
    </Modal>
  );
}

function BookingModal({
  room,
  state,
  initialDate,
  canAll,
  onClose,
  onSave,
}: {
  room?: Room;
  state: AppState;
  initialDate?: string;
  canAll: boolean;
  onClose: () => void;
  onSave: (v: unknown) => void;
}) {
  const today = dateKey(state.now);
  const startingDate = initialDate && initialDate >= today ? initialDate : today;
  const [roomId, setRoomId] = useState(room?.id || state.rooms[0]?.id || "");
  const [reason, setReason] = useState("");
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("14:20");
  const [mode, setMode] = useState<"single" | "period">("single");
  const [startDate, setStartDate] = useState(startingDate);
  const [endDate, setEndDate] = useState(startingDate);
  const [userId, setUserId] = useState(state.currentUser!.id);
  const [shareable, setShareable] = useState(false);
  const [people, setPeople] = useState(1);
  const dates = useMemo(() => {
    const result: string[] = [];
    let cursor = startDate;
    while (cursor <= endDate && result.length < 31) {
      result.push(cursor);
      cursor = addDays(cursor, 1);
    }
    return mode === "single" ? [startDate] : result;
  }, [mode, startDate, endDate]);
  const tooLong =
    dates.length > 30 || (mode === "period" && endDate < startDate);
  const checks = dates.slice(0, 30).map((date) => {
    const conflict = state.reservations.find(
      (reservation) =>
        reservation.roomId === roomId &&
        reservation.status === "reserved" &&
        dateKey(reservation.startsAt) === date &&
        time(reservation.startsAt) < endTime &&
        time(reservation.endsAt) > startTime,
    );
    return { date, conflict };
  });
  const applyShift = (shift: { startTime: string; endTime: string }) => {
    setStartTime(shift.startTime);
    setEndTime(shift.endTime);
  };
  return (
    <Modal
      title="Nova reserva"
      subtitle="Reserve uma data ou um período contínuo de até 30 dias."
      onClose={onClose}
    >
      <form
        className="modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!tooLong)
            onSave({
              roomId,
              reason,
              startTime,
              endTime,
              dates,
              userId,
              shareable,
              expectedPeople: people,
            });
        }}
      >
        <div className="form-grid">
          <label>
            Sala
            <select
              value={roomId}
              onChange={(event) => setRoomId(event.target.value)}
            >
              {state.rooms.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {canAll && (
            <label>
              Utilizador
              <select
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
              >
                {state.users
                  .filter((item) => item.active)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </div>
        <label>
          Motivo
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={3}
            required
          />
        </label>
        <div className="mode-toggle">
          <button
            type="button"
            className={mode === "single" ? "active" : ""}
            onClick={() => {
              setMode("single");
              setEndDate(startDate);
            }}
          >
            Uma data
          </button>
          <button
            type="button"
            className={mode === "period" ? "active" : ""}
            onClick={() => setMode("period")}
          >
            Período
          </button>
        </div>
        <div className="form-grid">
          <label>
            Data inicial
            <input
              type="date"
              min={today}
              value={startDate}
              onChange={(event) => {
                setStartDate(event.target.value);
                if (mode === "single" || event.target.value > endDate)
                  setEndDate(event.target.value);
              }}
              required
            />
          </label>
          {mode === "period" && (
            <label>
              Data final
              <input
                type="date"
                min={startDate}
                max={addDays(startDate, 29)}
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                required
              />
            </label>
          )}
        </div>
        <div>
          <span className="section-label">Turnos rápidos</span>
          <div className="shift-buttons">
            {state.shifts.map((shift) => (
              <button
                type="button"
                key={shift.id}
                className={
                  shift.startTime === startTime && shift.endTime === endTime
                    ? "active"
                    : ""
                }
                onClick={() => applyShift(shift)}
              >
                {shift.name}
                <small>
                  {shift.startTime}–{shift.endTime}
                </small>
              </button>
            ))}
          </div>
        </div>
        <div className="form-grid">
          <label>
            Início
            <input
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              required
            />
          </label>
          <label>
            Fim
            <input
              type="time"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              required
            />
          </label>
        </div>
        {tooLong && (
          <p className="form-error">
            O período deve ter no máximo 30 dias e a data final não pode
            preceder a inicial.
          </p>
        )}
        <div className="availability-check">
          <strong>Verificação antecipada</strong>
          <div>
            {checks.map(({ date, conflict }) => (
              <span
                key={date}
                className={conflict ? "replacement" : "available"}
              >
                <i />
                {requestDateLabel(date)}
                {conflict
                  ? ` · substituirá a reserva de ${conflict.userName}`
                  : " · livre"}
              </span>
            ))}
          </div>
          {checks.some(({ conflict }) => conflict) && (
            <small className="field-help">
              A nova reserva terá prioridade e substituirá qualquer reserva
              anterior que coincida com o período.
            </small>
          )}
        </div>
        <div className="form-grid">
          <label>
            Pessoas previstas
            <input
              type="number"
              min={1}
              value={people}
              onChange={(event) => setPeople(Number(event.target.value))}
            />
          </label>
          <label className="check-row compact">
            <input
              type="checkbox"
              checked={shareable}
              onChange={(event) => setShareable(event.target.checked)}
            />
            <span>
              <strong>Compartilhável</strong>
            </span>
          </label>
        </div>
        <ModalActions
          onClose={onClose}
          submit={`Reservar ${Math.min(dates.length, 30)} data${dates.length !== 1 ? "s" : ""}`}
        />
      </form>
    </Modal>
  );
}

function RequestModal({
  room,
  state,
  initialDate,
  onClose,
  onSave,
}: {
  room?: Room;
  state: AppState;
  initialDate?: string;
  onClose: () => void;
  onSave: (value: unknown) => void;
}) {
  const today = dateKey(state.now);
  const startingDate = initialDate && initialDate >= today ? initialDate : today;
  const [roomId, setRoomId] = useState(room?.id || "");
  const [requestedDate, setRequestedDate] = useState(startingDate);
  const [reason, setReason] = useState("");
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("14:20");
  const [shareable, setShareable] = useState(false);
  const [people, setPeople] = useState(1);
  return (
    <Modal
      title="Solicitar uma sala"
      subtitle="O pedido será analisado antes de virar reserva. Você pode pedir uma sala já reservada ou deixar a escolha em aberto."
      onClose={onClose}
    >
      <form
        className="modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            roomId: roomId || null,
            requestedDate,
            reason,
            startTime,
            endTime,
            shareable,
            expectedPeople: people,
          });
        }}
      >
        <label>
          Sala desejada
          <select
            value={roomId}
            onChange={(event) => setRoomId(event.target.value)}
          >
            <option value="">Qualquer sala disponível</option>
            {state.rooms.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.location ? ` — ${item.location}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Motivo da utilização
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={3}
            placeholder="Explique como a sala será utilizada"
            required
          />
        </label>
        <div className="form-grid">
          <label>
            Data
            <input
              type="date"
              min={today}
              value={requestedDate}
              onChange={(event) => setRequestedDate(event.target.value)}
              required
            />
          </label>
          <label>
            Pessoas previstas
            <input
              type="number"
              min={1}
              value={people}
              onChange={(event) => setPeople(Number(event.target.value))}
              required
            />
          </label>
        </div>
        <div className="form-grid">
          <label>
            Início
            <input
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              required
            />
          </label>
          <label>
            Fim
            <input
              type="time"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              required
            />
          </label>
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={shareable}
            onChange={(event) => setShareable(event.target.checked)}
          />
          <span>
            <strong>Aceito compartilhar a sala</strong>
            <small>
              Essa informação ficará disponível para quem analisar o pedido.
            </small>
          </span>
        </label>
        <ModalActions onClose={onClose} submit="Enviar solicitação" />
      </form>
    </Modal>
  );
}

function RequestReviewModal({
  request,
  state,
  onClose,
  onSave,
  onDecide,
}: {
  request: BookingRequest;
  state: AppState;
  onClose: () => void;
  onSave: (value: unknown) => void;
  onDecide: (value: unknown, decision: "approved" | "rejected") => void;
}) {
  const today = dateKey(state.now);
  const [roomId, setRoomId] = useState(request.roomId || "");
  const [requestedDate, setRequestedDate] = useState(request.requestedDate);
  const [reason, setReason] = useState(request.reason);
  const [startTime, setStartTime] = useState(request.startTime);
  const [endTime, setEndTime] = useState(request.endTime);
  const [shareable, setShareable] = useState(request.shareable);
  const [people, setPeople] = useState(request.expectedPeople);
  const [comment, setComment] = useState(request.reviewComment || "");
  const reservationToReplace = state.reservations.find(
    (reservation) =>
      reservation.roomId === roomId &&
      reservation.status === "reserved" &&
      dateKey(reservation.startsAt) === requestedDate &&
      time(reservation.startsAt) < endTime &&
      time(reservation.endsAt) > startTime,
  );
  const values = () => ({
    id: request.id,
    roomId: roomId || null,
    requestedDate,
    reason,
    startTime,
    endTime,
    shareable,
    expectedPeople: people,
    comment,
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    const intent = submitter?.value || "save";
    if (intent === "approved") onDecide(values(), "approved");
    else if (intent === "rejected") onDecide(values(), "rejected");
    else onSave(values());
  };
  return (
    <Modal
      title={`Analisar solicitação de ${request.requesterName}`}
      subtitle="Você pode ajustar a sala, data, horário e demais detalhes antes da decisão."
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={submit}>
        <label>
          Sala
          <select
            value={roomId}
            onChange={(event) => setRoomId(event.target.value)}
          >
            <option value="">Qualquer sala disponível</option>
            {state.rooms.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.location ? ` — ${item.location}` : ""}
              </option>
            ))}
          </select>
          <small className="field-help">
            Para aprovar, escolha uma sala específica. Pedidos em aberto podem
            ser editados e salvos sem decisão.
          </small>
        </label>
        <label>
          Motivo
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={3}
            required
          />
        </label>
        <div className="form-grid">
          <label>
            Data
            <input
              type="date"
              min={today}
              value={requestedDate}
              onChange={(event) => setRequestedDate(event.target.value)}
              required
            />
          </label>
          <label>
            Pessoas previstas
            <input
              type="number"
              min={1}
              value={people}
              onChange={(event) => setPeople(Number(event.target.value))}
              required
            />
          </label>
        </div>
        <div className="form-grid">
          <label>
            Início
            <input
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              required
            />
          </label>
          <label>
            Fim
            <input
              type="time"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              required
            />
          </label>
        </div>
        {reservationToReplace && (
          <div className="replacement-notice">
            <strong>Esta aprovação substituirá uma reserva anterior</strong>
            <span>
              {reservationToReplace.userName}, das {time(reservationToReplace.startsAt)} às{" "}
              {time(reservationToReplace.endsAt)}.
            </span>
          </div>
        )}
        <label className="check-row">
          <input
            type="checkbox"
            checked={shareable}
            onChange={(event) => setShareable(event.target.checked)}
          />
          <span>
            <strong>Utilização compartilhável</strong>
          </span>
        </label>
        <label>
          Comentário da decisão, opcional
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={2000}
            placeholder="Ex.: aprovada com ajuste de horário ou indisponibilidade da sala solicitada"
          />
        </label>
        <div className="review-actions">
          <button type="button" className="btn btn-soft" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-soft" value="save">
            Salvar edição
          </button>
          <button className="btn btn-danger" value="rejected">
            Rejeitar
          </button>
          <button
            className="btn btn-primary"
            value="approved"
            disabled={!roomId}
          >
            Aprovar e reservar
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RoomModal({
  room,
  onClose,
  onSave,
}: {
  room?: Room;
  onClose: () => void;
  onSave: (v: unknown) => void;
}) {
  const [name, setName] = useState(room?.name || "");
  const [location, setLocation] = useState(room?.location || "");
  const [kind, setKind] = useState(room?.kind || "physical");
  const [capacity, setCapacity] = useState(room?.capacity || 1);
  const [resources, setResources] = useState(room?.resources || "");
  const [networkStatus, setNetworkStatus] = useState(
    room?.networkStatus || "Não informado",
  );
  const [chairs, setChairs] = useState(room?.chairs || 0);
  const [tables, setTables] = useState(room?.tables || 0);
  const [workstations, setWorkstations] = useState(room?.workstations || 0);
  return (
    <Modal
      title={room ? "Editar sala" : "Nova sala"}
      subtitle="O ambiente pode ser físico, virtual ou de outra localidade."
      onClose={onClose}
    >
      <form
        className="modal-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            id: room?.id,
            name,
            location,
            kind,
            capacity,
            resources,
            networkStatus,
            chairs,
            tables,
            workstations,
          });
        }}
      >
        <label>
          Nome da sala
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Sala 04"
            required
          />
        </label>
        <div className="form-grid">
          <label>
            Tipo
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as Room["kind"])}
            >
              <option value="physical">Sala física</option>
              <option value="virtual">Sala virtual</option>
              <option value="other">Outra localidade</option>
            </select>
          </label>
          <label>
            Capacidade
            <input
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value))}
            />
          </label>
        </div>
        <label>
          Localidade ou link
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Ex.: Prédio A, 2º andar"
          />
        </label>
        <label>
          Recursos
          <input
            value={resources}
            onChange={(e) => setResources(e.target.value)}
            placeholder="TV, projetor, computadores..."
          />
        </label>
        <div className="form-grid">
          <label>
            Rede
            <select
              value={networkStatus}
              onChange={(event) => setNetworkStatus(event.target.value)}
            >
              <option>Não informado</option>
              <option>Disponível e estável</option>
              <option>Disponível com restrições</option>
              <option>Indisponível</option>
            </select>
          </label>
          <label>
            PAs ou computadores
            <input
              type="number"
              min={0}
              value={workstations}
              onChange={(event) => setWorkstations(Number(event.target.value))}
            />
          </label>
        </div>
        <div className="form-grid">
          <label>
            Cadeiras
            <input
              type="number"
              min={0}
              value={chairs}
              onChange={(event) => setChairs(Number(event.target.value))}
            />
          </label>
          <label>
            Mesas
            <input
              type="number"
              min={0}
              value={tables}
              onChange={(event) => setTables(Number(event.target.value))}
            />
          </label>
        </div>
        <ModalActions onClose={onClose} submit="Salvar sala" />
      </form>
    </Modal>
  );
}

function DevelopmentMemberModal({
  member,
  onClose,
  onSave,
}: {
  member?: AppState["developmentTeam"][number];
  onClose: () => void;
  onSave: (value: unknown) => void;
}) {
  const [name, setName] = useState(member?.name || "");
  const [role, setRole] = useState(member?.role || "");
  const [email, setEmail] = useState(member?.email || "");
  const [phone, setPhone] = useState(member?.phone || "");
  const [profileUrl, setProfileUrl] = useState(member?.profileUrl || "");
  const [displayOrder, setDisplayOrder] = useState(member?.displayOrder || 0);
  return (
    <Modal
      title={member ? "Editar integrante" : "Adicionar integrante"}
      subtitle="Atualize os dados profissionais e os canais de contato."
      onClose={onClose}
    >
      <form
        className="modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            id: member?.id,
            name,
            role,
            email,
            phone,
            profileUrl,
            displayOrder,
          });
        }}
      >
        <label>
          Nome
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          Atuação
          <input
            value={role}
            onChange={(event) => setRole(event.target.value)}
            placeholder="Ex.: Produto | UI | UX"
            required
          />
        </label>
        <div className="form-grid">
          <label>
            E-mail
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="nome@empresa.com"
            />
          </label>
          <label>
            Telefone
            <input
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="(71) 99999-9999"
            />
          </label>
        </div>
        <div className="form-grid">
          <label>
            Link profissional
            <input
              type="url"
              value={profileUrl}
              onChange={(event) => setProfileUrl(event.target.value)}
              placeholder="https://..."
            />
          </label>
          <label>
            Ordem de exibição
            <input
              type="number"
              min={0}
              max={999}
              value={displayOrder}
              onChange={(event) => setDisplayOrder(Number(event.target.value))}
            />
          </label>
        </div>
        <small className="field-help">
          Todos os perfis usam o mesmo tamanho e o mesmo nível de destaque.
        </small>
        <ModalActions onClose={onClose} submit="Salvar perfil" />
      </form>
    </Modal>
  );
}

function FeedbackModal({
  currentUserName,
  onClose,
  onSave,
}: {
  currentUserName?: string;
  onClose: () => void;
  onSave: (value: unknown) => Promise<void>;
}) {
  const [type, setType] = useState<"bug" | "suggestion">("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reporterName, setReporterName] = useState(currentUserName || "");
  const [reporterEmail, setReporterEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title="Reportar bug ou sugerir melhoria"
      subtitle="Sua mensagem será encaminhada à equipe de desenvolvimento."
      onClose={onClose}
    >
      <form
        className="modal-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onSave({
              type,
              title,
              description,
              reporterName,
              reporterEmail,
              website: "",
            });
          } catch (submitError) {
            setError(
              submitError instanceof Error
                ? submitError.message
                : "Não foi possível enviar o relato.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="feedback-type-selector">
          <button
            type="button"
            className={type === "bug" ? "active" : ""}
            onClick={() => setType("bug")}
          >
            <Bug size={17} /> Reportar bug
          </button>
          <button
            type="button"
            className={type === "suggestion" ? "active" : ""}
            onClick={() => setType("suggestion")}
          >
            <Lightbulb size={17} /> Sugerir melhoria
          </button>
        </div>
        {!currentUserName && (
          <label>
            Seu nome
            <input
              value={reporterName}
              onChange={(event) => setReporterName(event.target.value)}
              required
            />
          </label>
        )}
        <label>
          E-mail para contato, opcional
          <input
            type="email"
            value={reporterEmail}
            onChange={(event) => setReporterEmail(event.target.value)}
          />
        </label>
        <label>
          Título
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            minLength={3}
            maxLength={140}
            required
          />
        </label>
        <label>
          Descrição
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            minLength={10}
            maxLength={5000}
            placeholder="Explique o que aconteceu ou como a melhoria poderia funcionar."
            required
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-soft" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Enviando..." : "Enviar relato"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function NotificationsModal({
  state,
  pushAvailable,
  pushActive,
  onClose,
  onMarkAll,
  onEnablePush,
  onTestPush,
}: {
  state: AppState;
  pushAvailable: boolean;
  pushActive: boolean;
  onClose: () => void;
  onMarkAll: () => Promise<void>;
  onEnablePush: () => Promise<void>;
  onTestPush: () => Promise<void>;
}) {
  const unread = state.notifications.filter((notification) => !notification.readAt);
  return (
    <Modal
      title="Notificações"
      subtitle="Atualizações de solicitações, reservas e agenda."
      onClose={onClose}
    >
      <div className="notifications-toolbar">
        {unread.length > 0 && (
          <button className="btn btn-soft" onClick={() => void onMarkAll()}>
            <Check size={16} /> Marcar todas como lidas
          </button>
        )}
        {pushAvailable && (
          <button
            className="btn btn-soft"
            onClick={() => void (pushActive ? onTestPush() : onEnablePush())}
          >
            <Bell size={16} /> {pushActive ? "Testar Push" : "Ativar Push"}
          </button>
        )}
      </div>
      {state.notifications.length ? (
        <div className="notification-list">
          {state.notifications.map((notification) => (
            <article
              className={notification.readAt ? "" : "unread"}
              key={notification.id}
            >
              <span className="notification-dot" />
              <div>
                <strong>{notification.title}</strong>
                <p>{notification.body}</p>
                <small>{dateLabel(notification.createdAt)}</small>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          icon={Bell}
          title="Nenhuma notificação"
          text="As atualizações das suas reservas aparecerão aqui."
        />
      )}
    </Modal>
  );
}

function UserModal({
  user,
  state,
  canCreateGod,
  onClose,
  onSave,
}: {
  user?: AppState["users"][number];
  state: AppState;
  canCreateGod: boolean;
  onClose: () => void;
  onSave: (v: unknown) => void;
}) {
  const availableRoles = state.roles.filter(
    (role) => role.name !== "God" || canCreateGod,
  );
  const defaultRoleId =
    availableRoles.find((role) => role.name === "Usuário")?.id ||
    availableRoles[0]?.id ||
    "";
  const [name, setName] = useState(user?.name || "");
  const [username, setUsername] = useState(user?.username || "");
  const [roleId, setRoleId] = useState(user?.roleId || defaultRoleId);
  const [password, setPassword] = useState("");
  const [active, setActive] = useState(user?.active !== false);
  const [answers, setAnswers] = useState(
    SECURITY_FIELDS.map((field) => ({ question: field.question, answer: "" })),
  );
  const showAnswers = !user;
  return (
    <Modal
      title={user ? "Editar usuário" : "Novo usuário"}
      subtitle="Cadastre o acesso e a forma de recuperação segura."
      onClose={onClose}
    >
      <form
        className="modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            id: user?.id,
            name,
            username,
            roleId,
            password,
            active,
            securityAnswers: showAnswers ? answers : [],
          });
        }}
      >
        <div className="form-grid">
          <label>
            Nome completo
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
          <label>
            Usuário
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>
        </div>
        <div className="form-grid">
          <label>
            Perfil
            <select
              value={roleId}
              onChange={(event) => setRoleId(event.target.value)}
              disabled={user?.isOwnerGod}
            >
              {availableRoles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {user ? "Nova senha, opcional" : "Senha inicial"}
            <input
              type="password"
              minLength={user ? 0 : 8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required={!user}
            />
          </label>
        </div>
        {showAnswers && (
          <fieldset>
            <legend>Perguntas de segurança</legend>
            {answers.map((answer, index) => (
              <SecuritySelect
                key={answer.question}
                question={answer.question}
                value={answer.answer}
                onChange={(value) =>
                  setAnswers((old) =>
                    old.map((item, answerIndex) =>
                      answerIndex === index ? { ...item, answer: value } : item,
                    ),
                  )
                }
              />
            ))}
            {!user && (
              <small className="field-help">
                Se ficarem vazias, o usuário será obrigado a defini-las antes do
                primeiro acesso.
              </small>
            )}
          </fieldset>
        )}
        {user && !user.isOwnerGod && (
          <label className="check-row">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
            <span>
              <strong>Usuário ativo</strong>
            </span>
          </label>
        )}
        <ModalActions onClose={onClose} submit="Salvar usuário" />
      </form>
    </Modal>
  );
}

function RoleModal({
  role,
  onClose,
  onSave,
}: {
  role?: Role;
  onClose: () => void;
  onSave: (v: unknown) => void;
}) {
  const [name, setName] = useState(role?.name || "");
  const [color, setColor] = useState(role?.color || "#34785a");
  const [permissions, setPermissions] = useState<Permission[]>(
    role?.permissions || ["booking.create_own"],
  );
  const toggle = (p: Permission) =>
    setPermissions((old) =>
      old.includes(p) ? old.filter((v) => v !== p) : [...old, p],
    );
  return (
    <Modal
      title={role ? "Editar perfil" : "Novo perfil"}
      subtitle="Defina exatamente o que este grupo pode fazer."
      onClose={onClose}
    >
      <form
        className="modal-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ id: role?.id, name, color, permissions });
        }}
      >
        <div className="form-grid color-form">
          <label>
            Nome do perfil
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <label>
            Cor
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </label>
        </div>
        <div className="permission-list">
          {(Object.keys(PERMISSION_LABELS) as Permission[]).map((p) => (
            <label className="check-row" key={p}>
              <input
                type="checkbox"
                checked={permissions.includes(p)}
                onChange={() => toggle(p)}
              />
              <span>
                <strong>{PERMISSION_LABELS[p]}</strong>
              </span>
            </label>
          ))}
        </div>
        <ModalActions onClose={onClose} submit="Salvar perfil" />
      </form>
    </Modal>
  );
}

function ModalActions({
  onClose,
  submit,
}: {
  onClose: () => void;
  submit: string;
}) {
  return (
    <div className="modal-actions">
      <button type="button" className="btn btn-soft" onClick={onClose}>
        Cancelar
      </button>
      <button className="btn btn-primary">{submit}</button>
    </div>
  );
}
function Empty({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof DoorOpen;
  title: string;
  text: string;
}) {
  return (
    <div className="empty">
      <div>
        <Icon size={28} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
