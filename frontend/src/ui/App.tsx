import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { io, Socket } from "socket.io-client";

const SESSION_STORAGE_KEY = "pokerplanning_session_v1";

type Role = "BA" | "BE" | "FE" | "SA" | "QA" | "Other";
const ROLE_OPTIONS_OPTIONAL: Array<{ value: Role | ""; label: string }> = [
  { value: "", label: "Не указывать" },
  { value: "BA", label: "BA" },
  { value: "BE", label: "BE" },
  { value: "FE", label: "FE" },
  { value: "SA", label: "SA" },
  { value: "QA", label: "QA" },
  { value: "Other", label: "Other" }
];

const ROLE_OPTIONS_REQUIRED: Array<{ value: Role | ""; label: string }> = [
  { value: "", label: "Выберите роль" },
  { value: "BA", label: "BA" },
  { value: "BE", label: "BE" },
  { value: "FE", label: "FE" },
  { value: "SA", label: "SA" },
  { value: "QA", label: "QA" },
  { value: "Other", label: "Other" }
];

type AggGroup = { key: string; label: string; count: number; mean?: number; median?: number };

type RoundHistoryEntry = {
  roundId: string;
  title: string;
  revealedAt: number;
  votes: Array<{ userId: string; name: string; role?: Role; value: string | null }>;
  aggregates: { mode: "overall" | "byRole"; groups: AggGroup[] };
};

type RoomState = {
  room: {
    code: string;
    hostId: string;
    rolesEnabled: boolean;
    deck: string[];
    roundTitle: string;
    revealed: boolean;
    activeRoundId: string;
  };
  users: Array<{ id: string; name: string; role?: Role }>;
  votesRevealed: Record<string, string | null>;
  voteStatus: Record<string, boolean>;
  aggregates: { mode: "overall" | "byRole"; groups: AggGroup[] };
  history: RoundHistoryEntry[];
};

function getApiBase(): string {
  const v = import.meta.env.VITE_API_URL;
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

function saveSession(roomCode: string, userId: string) {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ roomCode, userId }));
  } catch {
    /* ignore */
  }
}

function loadSession(): { roomCode: string; userId: string } | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as { roomCode?: string; userId?: string };
    if (typeof o.roomCode === "string" && typeof o.userId === "string") return { roomCode: o.roomCode, userId: o.userId };
  } catch {
    /* ignore */
  }
  return null;
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function fmtNum(v: number | undefined): string {
  if (typeof v !== "number") return "—";
  const rounded = Math.round(v * 10) / 10;
  return String(rounded);
}

function formatRuDateTime(ts: number): string {
  return new Date(ts).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

function summarizeGroupsRu(groups: AggGroup[]): string {
  if (!groups.length) return "Нет числовых оценок для расчёта.";
  return groups
    .map(
      (g) =>
        `${g.label}: среднее ${fmtNum(g.mean)}, медиана ${fmtNum(g.median)} · оценок: ${g.count}`
    )
    .join("  |  ");
}

export function App() {
  const { slug } = useParams<{ slug?: string }>();
  const navigate = useNavigate();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [rolesEnabledForJoin, setRolesEnabledForJoin] = useState<boolean | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [state, setState] = useState<RoomState | null>(null);
  const [createRolesEnabled, setCreateRolesEnabled] = useState(true);
  const [titleDraft, setTitleDraft] = useState("");
  const [selectedVote, setSelectedVote] = useState<string | null>(null);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  const prevRoundIdRef = useRef<string | null>(null);
  const titleFocusedRef = useRef(false);
  const titleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (slug) setRoomCode(slug.toUpperCase());
  }, [slug]);

  useEffect(() => {
    setJoinError(null);
  }, [roomCode, name, role]);

  useEffect(() => {
    const base = getApiBase();
    const s = io(base, { transports: ["websocket"] });
    setSocket(s);

    function resumeIfNeeded() {
      const sess = loadSession();
      if (!sess) return;
      const m = window.location.pathname.match(/^\/r\/([^/]+)\/?$/i);
      const pathCode = m ? m[1].toUpperCase() : null;
      if (!pathCode || pathCode !== sess.roomCode.toUpperCase()) return;
      s.emit("room:resume", { roomCode: pathCode, userId: sess.userId }, (ack: { ok?: boolean; userId?: string }) => {
        if (ack?.ok && ack.userId) setUserId(ack.userId);
        else clearSession();
      });
    }

    s.on("connect", resumeIfNeeded);
    s.on("room:state", (st: RoomState) => {
      const next: RoomState = st.history ? st : { ...st, history: [] as RoundHistoryEntry[] };
      if (!next.room.activeRoundId) {
        (next.room as { activeRoundId?: string }).activeRoundId = "";
      }

      const rid = next.room.activeRoundId;
      if (prevRoundIdRef.current !== null && prevRoundIdRef.current !== rid) {
        setSelectedVote(null);
      }
      prevRoundIdRef.current = rid;

      if (!titleFocusedRef.current) {
        setTitleDraft(next.room.roundTitle ?? "");
      }

      setState(next);
      setRolesEnabledForJoin(next.room.rolesEnabled);
    });
    return () => {
      if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current);
      s.off("connect", resumeIfNeeded);
      s.disconnect();
    };
  }, []);

  useEffect(() => {
    const code = roomCode.trim().toUpperCase();
    if (!code) {
      setRolesEnabledForJoin(null);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${getApiBase()}/rooms/${encodeURIComponent(code)}`, { signal: controller.signal });
        if (!res.ok) {
          setRolesEnabledForJoin(null);
          return;
        }
        const json = await res.json();
        setRolesEnabledForJoin(!!json.rolesEnabled);
      } catch {
        setRolesEnabledForJoin(null);
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [roomCode]);

  const isHost = useMemo(() => {
    if (!state || !userId) return false;
    return state.room.hostId === userId;
  }, [state, userId]);

  const inviteUrl = useMemo(() => {
    const code = (state?.room.code || roomCode).trim().toUpperCase();
    if (!code || typeof window === "undefined") return "";
    return `${window.location.origin}/r/${code}`;
  }, [state?.room.code, roomCode]);

  const roleOptionsForSelect = rolesEnabledForJoin === true ? ROLE_OPTIONS_REQUIRED : ROLE_OPTIONS_OPTIONAL;

  const joinBlockedByRole = rolesEnabledForJoin === true && !role;
  const canJoin =
    !!roomCode.trim() &&
    !!name.trim() &&
    !joinBlockedByRole &&
    !!socket;

  async function copyInvite(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopyHint("Скопировано");
      setTimeout(() => setCopyHint(null), 2000);
    } catch {
      setCopyHint("Не удалось скопировать");
      setTimeout(() => setCopyHint(null), 2500);
    }
  }

  async function createRoom() {
    const res = await fetch(`${getApiBase()}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rolesEnabled: createRolesEnabled })
    });
    const json = await res.json();
    const code = json.code as string;
    setRoomCode(code);
    navigate(`/r/${code}`, { replace: true });
  }

  function joinRoom() {
    if (!socket || !canJoin) return;
    setJoinError(null);
    socket.emit(
      "room:join",
      { roomCode: roomCode.trim().toUpperCase(), name: name.trim(), role: role || undefined },
      (ack: { ok?: boolean; userId?: string; error?: string }) => {
        if (!ack?.ok || !ack.userId) {
          if (ack?.error === "role_required") {
            setJoinError("В этой комнате включено распределение по ролям — выберите свою роль.");
          } else if (ack?.error === "room_not_found") {
            setJoinError("Комната с таким кодом не найдена.");
          } else {
            setJoinError("Не удалось войти. Проверьте код комнаты и имя.");
          }
          return;
        }
        const c = roomCode.trim().toUpperCase();
        saveSession(c, ack.userId);
        setUserId(ack.userId);
        setSelectedVote(null);
        if (c) navigate(`/r/${c}`, { replace: true });
      }
    );
  }

  function leaveRoom() {
    if (!socket || !userId) return;
    const code = state?.room.code ?? roomCode.trim().toUpperCase();
    socket.emit("room:leave", {}, () => {});
    clearSession();
    setUserId(null);
    setState(null);
    prevRoundIdRef.current = null;
    if (code) navigate(`/r/${code}`, { replace: true });
    else navigate("/", { replace: true });
  }

  function setVote(v: string) {
    if (!socket) return;
    setSelectedVote(v);
    socket.emit("vote:set", { value: v });
  }

  function reveal() {
    if (!socket) return;
    socket.emit("round:reveal", {});
  }

  function resetRound() {
    if (!socket) return;
    setSelectedVote(null);
    socket.emit("round:reset", {});
  }

  const scheduleTitleEmit = useCallback(
    (title: string) => {
      if (!socket) return;
      if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current);
      titleDebounceRef.current = setTimeout(() => {
        socket.emit("round:setTitle", { title });
      }, 350);
    },
    [socket]
  );

  const onTitleDraftChange = useCallback(
    (v: string) => {
      setTitleDraft(v);
      scheduleTitleEmit(v);
    },
    [scheduleTitleEmit]
  );

  const onTitleFocus = useCallback(() => {
    titleFocusedRef.current = true;
  }, []);

  const onTitleBlur = useCallback(() => {
    titleFocusedRef.current = false;
  }, []);

  return (
    <div className="app-root">
      <header className="pp-header" role="banner">
        <div className="container px-4">
          <div className="pp-header-inner">
            <Link to="/" className="pp-logo">
              Poker Planning
            </Link>
            <div className="pp-header-actions">
              {state?.room?.code ? (
                <span className="pp-chip">
                  Комната <strong>{state.room.code}</strong>
                </span>
              ) : null}
              {isHost ? <span className="pp-chip is-host">Ведущий</span> : null}
              {userId ? (
                <button type="button" className="button is-small pp-btn-ghost" onClick={leaveRoom}>
                  Выйти
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <main className="pp-main">
        <div className="container px-4">
          {!userId ? (
            <div className="pp-card is-narrow mt-5">
              <h1 className="title is-4 mb-3" style={{ letterSpacing: "-0.02em" }}>
                Оценка усилий с командой
              </h1>
              {slug ? (
                <div className="pp-callout">
                  <p className="pp-callout-title">Вы по ссылке-приглашению</p>
                  <p>
                    Код <span className="pp-chip is-accent">{slug.toUpperCase()}</span> — укажите <strong>имя</strong> и
                    нажмите «Войти в комнату».
                  </p>
                  {rolesEnabledForJoin === true ? (
                    <p>Здесь включены роли: выберите свою в списке (без роли войти нельзя).</p>
                  ) : null}
                </div>
              ) : (
                <p className="pp-lead">
                  Введите код или создайте новую комнату. После появления кода укажите имя и войдите — первый участник станет
                  ведущим.
                </p>
              )}

              <div className="columns is-multiline is-variable is-3">
                <div className="column is-12-mobile is-4-tablet">
                  <div className="field mb-0">
                    <label className="label" htmlFor="pp-room-code">
                      Код комнаты
                    </label>
                    <div className="control">
                      <input
                        id="pp-room-code"
                        className="input"
                        value={roomCode}
                        onChange={(e) => setRoomCode(e.target.value)}
                        placeholder="Например A1B2C3"
                        autoComplete="off"
                      />
                    </div>
                  </div>
                </div>
                <div className="column is-12-mobile is-4-tablet">
                  <div className="field mb-0">
                    <label className="label" htmlFor="pp-name">
                      Ваше имя <span className="has-text-danger">*</span>
                    </label>
                    <div className="control">
                      <input
                        id="pp-name"
                        className="input"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Как вас видят в столе"
                        autoComplete="name"
                        autoFocus={!!slug}
                      />
                    </div>
                    <p className="help">Имя нужно, чтобы активировать кнопку входа.</p>
                  </div>
                </div>
                <div className="column is-12-mobile is-4-tablet">
                  <div className="field mb-0">
                    <label className="label" htmlFor="pp-role">
                      Роль
                      {rolesEnabledForJoin === true ? (
                        <span className="has-text-danger"> *</span>
                      ) : (
                        <span className="has-text-grey"> (по настройкам комнаты)</span>
                      )}
                    </label>
                    <div className="control">
                      <div className={"select is-fullwidth" + (joinBlockedByRole ? " is-danger" : "")}>
                        <select
                          id="pp-role"
                          value={role}
                          onChange={(e) => setRole(e.target.value as Role | "")}
                          disabled={rolesEnabledForJoin === false}
                          title={rolesEnabledForJoin === false ? "В этой комнате роли отключены" : undefined}
                        >
                          {roleOptionsForSelect.map((o) => (
                            <option key={o.label} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {rolesEnabledForJoin === true ? (
                      <p className="help">Нужна для комнат с распределением по ролям.</p>
                    ) : rolesEnabledForJoin === false ? (
                      <p className="help">В этой комнате роли выключены.</p>
                    ) : null}
                  </div>
                </div>
              </div>

              {joinError ? (
                <div className="notification is-danger is-light mt-4 mb-0">
                  <p className="mb-0">{joinError}</p>
                </div>
              ) : null}

              <div className="mt-4">
                <button type="button" className="button is-primary is-medium" onClick={joinRoom} disabled={!canJoin}>
                  Войти в комнату
                </button>
              </div>

              <hr className="pp-divider" />

              <h2 className="title is-6 mb-3 has-text-grey">Новая комната</h2>
              <div className="is-flex is-flex-wrap is-align-items-center" style={{ gap: "1rem" }}>
                <button type="button" className="button is-light" onClick={createRoom}>
                  Создать комнату
                </button>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    className="mr-2"
                    checked={createRolesEnabled}
                    onChange={(e) => setCreateRolesEnabled(e.target.checked)}
                  />
                  Учитывать роли (BA, BE, FE…)
                </label>
              </div>
              <p className="pp-muted mt-3 mb-0">
                Отправьте коллегам ссылку <span className="is-monospace-inline">/r/КОД</span>. Сессия хранится в браузере.
              </p>

              {roomCode.trim() && !slug ? (
                <div className="field has-addons mt-4" style={{ flexWrap: "wrap" }}>
                  <div className="control is-expanded" style={{ minWidth: "220px" }}>
                    <input
                      readOnly
                      className="input"
                      value={
                        inviteUrl ||
                        `${typeof window !== "undefined" ? window.location.origin : ""}/r/${roomCode.trim().toUpperCase()}`
                      }
                    />
                  </div>
                  <div className="control">
                    <button
                      type="button"
                      className="button is-primary is-light"
                      onClick={() => copyInvite(inviteUrl || `${window.location.origin}/r/${roomCode.trim().toUpperCase()}`)}
                    >
                      Копировать ссылку
                    </button>
                  </div>
                  {copyHint ? (
                    <div className="control">
                      <span className="pp-chip is-accent">{copyHint}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
          <RoomView
            state={state}
            userId={userId}
            titleDraft={titleDraft}
            onTitleDraftChange={onTitleDraftChange}
            onTitleFocus={onTitleFocus}
            onTitleBlur={onTitleBlur}
            onVote={setVote}
            selectedVote={selectedVote}
            onReveal={reveal}
            onReset={resetRound}
            inviteUrl={inviteUrl}
            onCopyInvite={copyInvite}
            copyHint={copyHint}
          />
        )}
        </div>
      </main>
    </div>
  );
}

function RoomView(props: {
  state: RoomState | null;
  userId: string;
  titleDraft: string;
  onTitleDraftChange: (v: string) => void;
  onTitleFocus: () => void;
  onTitleBlur: () => void;
  onVote: (v: string) => void;
  selectedVote: string | null;
  onReveal: () => void;
  onReset: () => void;
  inviteUrl: string;
  onCopyInvite: (url: string) => void;
  copyHint: string | null;
}) {
  const { state, userId } = props;
  if (!state) {
    return (
      <div className="pp-card pp-loading-card mt-5">
        <p className="has-text-grey mb-0">Подключаемся к комнате…</p>
      </div>
    );
  }

  const me = state.users.find((u) => u.id === userId);
  const history = state.history ?? [];

  const primarySummary =
    state.room.revealed && state.aggregates.groups.length
      ? state.aggregates.groups.map((g) => ({
          label: g.label,
          mean: g.mean,
          median: g.median,
          count: g.count
        }))
      : [];

  return (
    <div className="columns is-multiline is-variable is-5 mt-4">
      <div className="column is-12-tablet is-7-desktop">
        <div className="pp-card">
          <div className="pp-room-hero">
            <div className="level is-mobile mb-0 pp-room-hero-level">
              <div className="level-left">
                <div>
                  <p className="heading mb-2 has-text-grey">Вы в столе</p>
                  <p className="title is-5 mb-0" style={{ letterSpacing: "-0.02em" }}>
                    {me?.name}
                    {me?.role ? (
                      <span className="pp-chip is-accent ml-2" style={{ verticalAlign: "middle" }}>
                        {me.role}
                      </span>
                    ) : null}
                  </p>
                </div>
              </div>
              <div className="level-right">
                <div className="is-flex is-flex-wrap" style={{ gap: "0.5rem", justifyContent: "flex-end" }}>
                  <span className="pp-chip">{state.room.rolesEnabled ? "Роли вкл" : "Роли выкл"}</span>
                  <span className="pp-chip is-accent">{state.room.revealed ? "Карты открыты" : "Карты скрыты"}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="field has-addons mb-5" style={{ flexWrap: "wrap" }}>
            <div className="control is-expanded" style={{ minWidth: "200px" }}>
              <input readOnly className="input" value={props.inviteUrl} />
            </div>
            <div className="control">
              <button
                type="button"
                className="button is-primary is-light"
                onClick={() => props.onCopyInvite(props.inviteUrl)}
                disabled={!props.inviteUrl}
              >
                Скопировать ссылку
              </button>
            </div>
            {props.copyHint ? (
              <div className="control">
                <span className="pp-chip is-accent">{props.copyHint}</span>
              </div>
            ) : null}
          </div>

          <div className="field mb-5">
            <label className="label">Задача или тикет</label>
            <div className="control">
              <input
                className="input"
                value={props.titleDraft}
                onChange={(e) => props.onTitleDraftChange(e.target.value)}
                onFocus={props.onTitleFocus}
                onBlur={props.onTitleBlur}
                placeholder="Например: PROJ-123 — Авторизация"
              />
            </div>
            <p className="help">Поле общее для всех — правки видны сразу.</p>
          </div>

          {!props.titleDraft.trim() ? (
            <div className="notification is-warning is-light mb-5">
              <p className="mb-0">Добавьте название задачи — так история раундов будет понятнее.</p>
            </div>
          ) : null}

          {state.room.revealed ? (
            <div className="mb-5">
              <p className="title is-6 mb-3">Итог раунда</p>
              {primarySummary.length ? (
                <div className="columns is-multiline is-variable is-3">
                  {primarySummary.map((g) => (
                    <div key={g.label} className="column is-12-mobile is-6-tablet">
                      <div className="pp-stat-card mb-0">
                        <p className="has-text-weight-bold mb-3">{g.label}</p>
                        <div className="columns is-mobile is-2 mb-0">
                          <div className="column pb-0">
                            <p className="is-size-7 has-text-grey mb-1">Среднее</p>
                            <p className="title is-4 mb-0" style={{ fontVariantNumeric: "tabular-nums" }}>
                              {fmtNum(g.mean)}
                            </p>
                          </div>
                          <div className="column pb-0">
                            <p className="is-size-7 has-text-grey mb-1">Медиана</p>
                            <p className="title is-4 mb-0" style={{ fontVariantNumeric: "tabular-nums" }}>
                              {fmtNum(g.median)}
                            </p>
                          </div>
                        </div>
                        <p className="is-size-7 has-text-grey mt-2 mb-0">Числовых оценок: {g.count}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="pp-muted">Нет числовых карт для расчёта (например, все «?» или «☕»).</p>
              )}
            </div>
          ) : (
            <div className="notification is-info is-light mb-5">
              <p className="mb-0">
                <strong>Раунд идёт.</strong> Когда все выберут карты, нажмите «Открыть карты» — итог появится выше.
              </p>
            </div>
          )}

          <p className="title is-6 mb-3">Ваша оценка</p>
          <div className="vote-grid mb-5">
            {state.room.deck.map((v) => (
              <button
                key={v}
                type="button"
                className={"button is-light" + (props.selectedVote === v ? " is-selected" : "")}
                disabled={state.room.revealed}
                onClick={() => (state.room.revealed ? undefined : props.onVote(v))}
              >
                {v}
              </button>
            ))}
          </div>

          <div className="buttons">
            <button type="button" className="button is-primary is-medium" onClick={props.onReveal} disabled={state.room.revealed}>
              Открыть карты
            </button>
            <button type="button" className="button is-light" onClick={props.onReset}>
              Новый раунд
            </button>
          </div>
        </div>
      </div>

      <div className="column is-12-tablet is-5-desktop">
        <div className="pp-side-card">
          <p className="pp-side-title">Участники</p>
          <ul className="mb-0" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {state.users.map((u) => {
              const voted = !!state.voteStatus[u.id];
              const shown = state.votesRevealed[u.id];
              return (
                <li key={u.id} className="pp-participant-row">
                  <span>
                    <span className="has-text-weight-semibold">{u.name}</span>
                    {u.role ? <span className="pp-chip is-accent ml-2">{u.role}</span> : null}
                    {u.id === state.room.hostId ? <span className="pp-chip is-host ml-1">Ведущий</span> : null}
                  </span>
                  <span className="pp-chip">{state.room.revealed ? (shown ?? "—") : voted ? "✓" : "…"}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="pp-side-card">
          <p className="pp-side-title">История</p>
          {history.length === 0 ? (
            <p className="pp-muted mb-0">Завершите раунд («Открыть карты»), чтобы запись появилась здесь.</p>
          ) : (
            <div className="history-scroll">
              {history.map((h) => (
                <div key={`${h.roundId}-${h.revealedAt}`} className="pp-history-item">
                  <p className="has-text-weight-semibold mb-1">{h.title.trim() || "Без названия"}</p>
                  <p className="is-size-7 has-text-grey mb-1">{formatRuDateTime(h.revealedAt)}</p>
                  <p className="is-size-7 mb-0">{summarizeGroupsRu(h.aggregates.groups)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
