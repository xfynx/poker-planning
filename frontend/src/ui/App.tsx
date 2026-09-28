import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { io, Socket } from "socket.io-client";
import { InviteLink } from "./InviteLink";
import { useSeason } from "./season";

function normalizeRoomCode(code: string) {
  const trimmed = code.trim();
  return trimmed.includes("-") ? trimmed.toLowerCase() : trimmed.toUpperCase();
}

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
  if (typeof v === "string" && v.trim().length > 0) return v.trim().replace(/\/$/, "");
  return "";
}

function apiPath(path: string): string {
  const b = getApiBase();
  const p = path.startsWith("/") ? path : `/${path}`;
  return b ? `${b}${p}` : p;
}

function socketOrigin(): string {
  const b = getApiBase();
  if (b) return b;
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
  const season = useSeason();
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
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [connBanner, setConnBanner] = useState<string | null>(null);

  const prevRoundIdRef = useRef<string | null>(null);
  const titleFocusedRef = useRef(false);
  const titleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (slug) setRoomCode(normalizeRoomCode(slug));
  }, [slug]);

  useEffect(() => {
    setJoinError(null);
  }, [roomCode, name, role]);

  useEffect(() => {
    const origin = socketOrigin();
    const s = io(origin, { transports: ["websocket", "polling"] });
    setSocket(s);

    function onDisconnect(reason: string) {
      if (reason === "io client disconnect") return;
      setConnBanner("Связь прервана. Пробуем подключиться снова…");
    }
    function onConnectError() {
      setConnBanner("Не удаётся подключиться. Проверьте соединение; мы попробуем снова автоматически.");
    }

    function onConnect() {
      setConnBanner(null);
      const sess = loadSession();
      if (!sess) return;
      const m = window.location.pathname.match(/^\/r\/([^/]+)\/?$/i);
      const pathCode = m ? normalizeRoomCode(m[1]) : null;
      if (!pathCode || pathCode !== normalizeRoomCode(sess.roomCode)) return;
      s.emit("room:resume", { roomCode: pathCode, userId: sess.userId }, (ack: { ok?: boolean; userId?: string }) => {
        if (ack?.ok && ack.userId) setUserId(ack.userId);
        else clearSession();
      });
    }

    function onRoomState(st: RoomState) {
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
    }

    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.on("connect_error", onConnectError);
    s.on("room:state", onRoomState);
    return () => {
      if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current);
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.off("connect_error", onConnectError);
      s.off("room:state", onRoomState);
      s.disconnect();
    };
  }, []);

  useEffect(() => {
    const code = normalizeRoomCode(roomCode);
    if (!code) {
      setRolesEnabledForJoin(null);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(apiPath(`/rooms/${encodeURIComponent(code)}`), { signal: controller.signal });
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
    const code = normalizeRoomCode(state?.room.code || roomCode);
    if (!code || typeof window === "undefined") return "";
    return `${window.location.origin}/r/${code}`;
  }, [state?.room.code, roomCode]);

  const roleOptionsForSelect = rolesEnabledForJoin === true ? ROLE_OPTIONS_REQUIRED : ROLE_OPTIONS_OPTIONAL;

  const joinBlockedByRole = rolesEnabledForJoin === true && !role;
  const canJoin =
    !creating &&
    !!roomCode.trim() &&
    !!name.trim() &&
    !joinBlockedByRole &&
    !!socket;

  async function createRoom() {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setJoinError(null);
    try {
      const res = await fetch(apiPath("/rooms"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rolesEnabled: createRolesEnabled })
      });
      if (!res.ok) {
        setJoinError("Сервер не отвечает. Попробуйте создать комнату ещё раз.");
        return;
      }
      const json = (await res.json()) as { code?: string };
      const code = json.code;
      if (!code) {
        setJoinError("Некорректный ответ сервера при создании комнаты.");
        return;
      }
      setRoomCode(code);
      setRolesEnabledForJoin(createRolesEnabled);
      navigate(`/r/${code}`, { replace: true });
    } catch {
      setJoinError("Не удалось создать комнату. Проверьте соединение и попробуйте ещё раз.");
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }

  function joinRoom() {
    if (!socket || !canJoin) return;
    setJoinError(null);
    socket.emit(
      "room:join",
      { roomCode: normalizeRoomCode(roomCode), name: name.trim(), role: role || undefined },
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
        const c = normalizeRoomCode(roomCode);
        saveSession(c, ack.userId);
        setUserId(ack.userId);
        setSelectedVote(null);
        if (c) navigate(`/r/${c}`, { replace: true });
      }
    );
  }

  function leaveRoom() {
    if (!socket || !userId) return;
    const code = state?.room.code ?? normalizeRoomCode(roomCode);
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
    <>
      <nav className="navbar is-light has-shadow" role="navigation" aria-label="main navigation">
        <div className="container">
          <div className="navbar-brand">
            <Link to="/" className="navbar-item has-text-weight-bold is-size-5 has-text-primary">
              Poker Planning
            </Link>
          </div>
          <div className="navbar-menu is-active" style={{ boxShadow: "none" }}>
            <div className="navbar-end is-align-items-center" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
              <div className="navbar-item">
                <span className="season-badge" title={season.mood}>
                  <span className="season-mark" aria-hidden="true">{season.mark}</span>
                  {season.name}<span className="season-mood">· {season.mood}</span>
                </span>
              </div>
              {state?.room?.code ? (
                <div className="navbar-item">
                  <span className="tag is-info is-light is-medium">
                    Комната <strong className="ml-1">{state.room.code}</strong>
                  </span>
                </div>
              ) : null}
              {isHost ? (
                <div className="navbar-item">
                  <span className="tag is-primary is-light is-medium">Ведущий</span>
                </div>
              ) : null}
              {userId ? (
                <div className="navbar-item">
                  <button type="button" className="button is-small is-light" onClick={leaveRoom}>
                    Выйти
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </nav>

      <section className="section">
        <div className="container">
          {connBanner ? (
            <div className="notification is-warning is-light mb-4">
              <p className="mb-0">{connBanner}</p>
            </div>
          ) : null}

          {!userId ? (
            <div className="columns is-centered">
              <div className="column is-10-tablet is-8-desktop">
                <div className="box">
                  <h1 className="title is-4 has-text-grey">Оценка усилий с командой</h1>

                  {slug ? (
                    <div className="notification is-info is-light mb-5">
                      <p className="has-text-weight-semibold mb-2">Вы по ссылке-приглашению</p>
                      <p className="is-size-7 mb-2">
                        Код <span className="tag is-info">{normalizeRoomCode(slug)}</span> — укажите <strong>имя</strong> и нажмите
                        «Войти в комнату».
                      </p>
                      {rolesEnabledForJoin === true ? (
                        <p className="is-size-7 mb-0">В комнате включены роли — выберите свою.</p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="subtitle is-6 has-text-grey mb-5">
                      Введите код или создайте новую комнату. После появления кода укажите имя и войдите — первый участник станет
                      ведущим.
                    </p>
                  )}

                  <div className="columns is-multiline is-variable is-3">
                    <div className="column is-12-mobile is-4-tablet">
                      <div className="field">
                        <label className="label" htmlFor="pp-room-code">
                          Код комнаты
                        </label>
                        <div className="control">
                          <input
                            id="pp-room-code"
                            className="input"
                            value={roomCode}
                            onChange={(e) => setRoomCode(e.target.value)}
                            placeholder="calm-amber-otter"
                            maxLength={64}
                            autoCapitalize="none"
                            spellCheck={false}
                            autoComplete="off"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="column is-12-mobile is-4-tablet">
                      <div className="field">
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
                      <div className="field">
                        <label className="label" htmlFor="pp-role">
                          Роль
                          {rolesEnabledForJoin === true ? <span className="has-text-danger"> *</span> : null}
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
                    <div className="notification is-danger is-light mb-4">
                      <p className="mb-0">{joinError}</p>
                    </div>
                  ) : null}

                  <div className="mb-5">
                    <button type="button" className="button is-primary is-medium" onClick={joinRoom} disabled={!canJoin}>
                      Войти в комнату
                    </button>
                  </div>

                  <hr />

                  <h2 className="title is-6 has-text-grey mb-4">Новая комната</h2>
                  <p className="help mb-3">Код из трёх случайных слов легко прочитать и передать команде.</p>
                  <div className="mb-4">
                    <div className="create-controls">
                      <div className="level-item">
                        <button type="button" className={"button is-light" + (creating ? " is-loading" : "")} onClick={createRoom} disabled={creating}>
                          {creating ? "Создаём…" : "Создать комнату"}
                        </button>
                      </div>
                      <div className="level-item">
                        <label className="checkbox">
                          <input
                            type="checkbox"
                            checked={createRolesEnabled}
                            onChange={(e) => setCreateRolesEnabled(e.target.checked)}
                          />
                          <span className="ml-2">Учитывать роли (BA, BE, FE…)</span>
                        </label>
                      </div>
                    </div>
                  </div>

                  <p className="is-size-7 has-text-grey mb-4">
                    Отправьте коллегам ссылку <code>/r/КОД</code>. Сессия хранится в браузере.
                  </p>

                  {roomCode.trim() ? <InviteLink url={inviteUrl} /> : null}
                </div>
              </div>
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
            />
          )}
        </div>
      </section>
    </>
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
}) {
  const { state, userId } = props;
  if (!state) {
    return (
      <div className="columns is-centered">
        <div className="column is-narrow">
          <div className="box has-text-centered">
            <p className="has-text-grey mb-0">Подключаемся к комнате…</p>
          </div>
        </div>
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
    <div className="columns is-multiline is-variable is-5">
      <div className="column is-12-tablet is-7-desktop">
        <div className="box">
          <div className="notification is-link is-light mb-5">
            <div className="level is-mobile mb-0" style={{ alignItems: "flex-start" }}>
              <div className="level-left">
                <div>
                  <p className="heading mb-2 has-text-grey">Вы в столе</p>
                  <p className="title is-5 mb-0">
                    {me?.name}
                    {me?.role ? (
                      <span className="tag is-success is-light ml-2">{me.role}</span>
                    ) : null}
                  </p>
                </div>
              </div>
              <div className="level-right">
                <div className="tags" style={{ justifyContent: "flex-end" }}>
                  <span className="tag is-light">{state.room.rolesEnabled ? "Роли вкл" : "Роли выкл"}</span>
                  <span className="tag is-info is-light">{state.room.revealed ? "Карты открыты" : "Карты скрыты"}</span>
                </div>
              </div>
            </div>
          </div>

          <InviteLink url={props.inviteUrl} />

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
              <p className="title is-6 mb-4">Итог раунда</p>
              {primarySummary.length ? (
                <div className="columns is-multiline is-variable is-3">
                  {primarySummary.map((g) => (
                    <div key={g.label} className="column is-12-mobile is-6-tablet">
                      <div className="box has-background-white-bis mb-0">
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
                <p className="has-text-grey">Нет числовых карт для расчёта (например, все «?» или «☕»).</p>
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
          <div className="buttons are-medium mb-5" style={{ flexWrap: "wrap" }}>
            {state.room.deck.map((v) => (
              <button
                key={v}
                type="button"
                className={
                  "button " + (props.selectedVote === v ? "is-success" : "is-light")
                }
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
        <div className="box mb-4">
          <p className="is-size-7 has-text-weight-bold has-text-grey mb-3">УЧАСТНИКИ</p>
          <table className="table is-fullwidth is-hoverable mb-0">
            <tbody>
              {state.users.map((u) => {
                const voted = !!state.voteStatus[u.id];
                const shown = state.votesRevealed[u.id];
                return (
                  <tr key={u.id}>
                    <td>
                      <span className="has-text-weight-semibold">{u.name}</span>
                      {u.role ? <span className="tag is-info is-light ml-2">{u.role}</span> : null}
                      {u.id === state.room.hostId ? (
                        <span className="tag is-primary is-light ml-1">Ведущий</span>
                      ) : null}
                    </td>
                    <td className="has-text-right">
                      <span className="tag is-light">{state.room.revealed ? (shown ?? "—") : voted ? "✓" : "…"}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="box">
          <p className="is-size-7 has-text-weight-bold has-text-grey mb-3">ИСТОРИЯ</p>
          {history.length === 0 ? (
            <p className="is-size-7 has-text-grey mb-0">Завершите раунд («Открыть карты»), чтобы запись появилась здесь.</p>
          ) : (
            <div className="content is-small" style={{ maxHeight: "22rem", overflowY: "auto" }}>
              {history.map((h) => (
                <div key={`${h.roundId}-${h.revealedAt}`} className="box py-3 px-4 mb-3">
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
