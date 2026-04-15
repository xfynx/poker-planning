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
      <nav className="navbar is-white has-shadow is-spaced mb-4" role="navigation">
        <div className="container">
          <div className="navbar-brand">
            <Link to="/" className="navbar-item has-text-weight-bold is-size-5">
              Poker Planning
            </Link>
          </div>
          <div className="navbar-menu is-active" style={{ boxShadow: "none" }}>
            <div className="navbar-end is-align-items-center" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
              {state?.room?.code ? (
                <span className="tag is-light is-medium">
                  Комната: <span className="has-text-weight-bold ml-1">{state.room.code}</span>
                </span>
              ) : null}
              {isHost ? (
                <span className="tag is-primary is-light is-medium">
                  Ведущий
                </span>
              ) : null}
              {userId ? (
                <div className="navbar-item py-0">
                  <button type="button" className="button is-small is-light" onClick={leaveRoom}>
                    Выйти
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </nav>

      <div className="container px-4 pb-5">
        {!userId ? (
          <div className="box" style={{ maxWidth: "920px", margin: "0 auto" }}>
            {slug ? (
              <div className="notification is-info is-light py-3 px-4 mb-4">
                <p className="has-text-weight-semibold mb-1">Приглашение в комнату</p>
                <p className="is-size-7 mb-2">
                  Код <span className="tag is-info is-light">{slug.toUpperCase()}</span> — чтобы войти, обязательно укажите{" "}
                  <strong>имя</strong> (его видят все участники) и нажмите «Войти».
                </p>
                {rolesEnabledForJoin === true ? (
                  <p className="is-size-7 mb-0">В этой комнате по ролям: выберите роль в списке — без неё вход недоступен.</p>
                ) : null}
              </div>
            ) : (
              <p className="is-size-7 has-text-grey mb-4">
                Чтобы создать комнату, нажмите кнопку ниже — откроется код. Затем введите <strong>ваше имя</strong> в поле
                «Как вас зовут» и нажмите «Войти», чтобы зайти первым и стать ведущим.
              </p>
            )}

            <div className="columns is-multiline is-variable is-2">
              <div className="column is-12-mobile is-4-tablet">
                <div className="field mb-0">
                  <label className="label is-small" htmlFor="pp-room-code">
                    Код комнаты
                  </label>
                  <div className="control">
                    <input
                      id="pp-room-code"
                      className="input is-small"
                      value={roomCode}
                      onChange={(e) => setRoomCode(e.target.value)}
                      placeholder="Напр. A1B2C3"
                      autoComplete="off"
                    />
                  </div>
                </div>
              </div>
              <div className="column is-12-mobile is-4-tablet">
                <div className="field mb-0">
                  <label className="label is-small" htmlFor="pp-name">
                    Как вас зовут <span className="has-text-danger">*</span>
                  </label>
                  <div className="control">
                    <input
                      id="pp-name"
                      className="input is-small"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Например: Алексей"
                      autoComplete="name"
                      autoFocus={!!slug}
                    />
                  </div>
                  <p className="help is-info">Имя обязательно — без него кнопка «Войти» неактивна.</p>
                </div>
              </div>
              <div className="column is-12-mobile is-4-tablet">
                <div className="field mb-0">
                  <label className="label is-small" htmlFor="pp-role">
                    Роль
                    {rolesEnabledForJoin === true ? (
                      <span className="has-text-danger"> *</span>
                    ) : (
                      <span className="has-text-grey"> (если включено в комнате)</span>
                    )}
                  </label>
                  <div className="control">
                    <div className={"select is-fullwidth is-small" + (joinBlockedByRole ? " is-danger" : "")}>
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
                    <p className="help is-warning mb-0">Выберите роль — в этой комнате включено распределение по ролям.</p>
                  ) : rolesEnabledForJoin === false ? (
                    <p className="help is-size-7">Для этой комнаты роли выключены.</p>
                  ) : null}
                </div>
              </div>
            </div>

            {joinError ? (
              <div className="notification is-danger is-light py-2 px-3 my-3">
                <p className="is-size-7 mb-0">{joinError}</p>
              </div>
            ) : null}

            <div className="field is-grouped is-grouped-multiline mt-3">
              <div className="control">
                <button type="button" className="button is-primary is-small" onClick={joinRoom} disabled={!canJoin}>
                  Войти
                </button>
              </div>
            </div>

            <hr className="my-4" />

            <div className="columns is-vcentered is-multiline is-variable is-2">
              <div className="column is-narrow">
                <button type="button" className="button is-small is-light" onClick={createRoom}>
                  Создать комнату
                </button>
              </div>
              <div className="column">
                <label className="checkbox is-size-7">
                  <input
                    type="checkbox"
                    className="mr-2"
                    checked={createRolesEnabled}
                    onChange={(e) => setCreateRolesEnabled(e.target.checked)}
                  />
                  Распределение участников по ролям (BA, BE, FE…)
                </label>
                <p className="help mt-1 mb-0">
                  После создания скопируйте ссылку коллегам. Сами введите имя выше и нажмите «Войти», чтобы подключиться к новой
                  комнате.
                </p>
              </div>
            </div>

            {roomCode.trim() && !slug ? (
              <div className="field has-addons mt-4" style={{ flexWrap: "wrap" }}>
                <div className="control is-expanded" style={{ minWidth: "200px" }}>
                  <input
                    readOnly
                    className="input is-small"
                    value={inviteUrl || `${typeof window !== "undefined" ? window.location.origin : ""}/r/${roomCode.trim().toUpperCase()}`}
                  />
                </div>
                <div className="control">
                  <button
                    type="button"
                    className="button is-small is-link is-light"
                    onClick={() =>
                      copyInvite(inviteUrl || `${window.location.origin}/r/${roomCode.trim().toUpperCase()}`)
                    }
                  >
                    Копировать ссылку
                  </button>
                </div>
                {copyHint ? (
                  <div className="control">
                    <span className="tag is-success is-light">{copyHint}</span>
                  </div>
                ) : null}
              </div>
            ) : null}

            <p className="is-size-7 has-text-grey mt-3 mb-0">
              Ссылка для гостей: <span className="is-monospace-inline has-background-white-ter px-1">/r/КОД</span> — сессия
              сохраняется в этом браузере.
            </p>
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
      <div className="box has-text-centered">
        <p className="has-text-grey">Подключаемся…</p>
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
    <div className="columns is-multiline is-variable is-4">
      <div className="column is-12-tablet is-8-desktop">
        <div className="box">
          <div className="field has-addons mb-4" style={{ flexWrap: "wrap" }}>
            <div className="control is-expanded" style={{ minWidth: "180px" }}>
              <input readOnly className="input is-small" value={props.inviteUrl} />
            </div>
            <div className="control">
              <button
                type="button"
                className="button is-small is-link is-light"
                onClick={() => props.onCopyInvite(props.inviteUrl)}
                disabled={!props.inviteUrl}
              >
                Копировать
              </button>
            </div>
            {props.copyHint ? (
              <div className="control">
                <span className="tag is-success is-light is-small">{props.copyHint}</span>
              </div>
            ) : null}
          </div>

          <div className="level is-mobile mb-3">
            <div className="level-left">
              <div>
                <p className="is-size-7 has-text-grey mb-0">Вы</p>
                <p className="has-text-weight-semibold mb-0">
                  {me?.name}{" "}
                  {me?.role ? (
                    <span className="tag is-info is-light is-small ml-1">{me.role}</span>
                  ) : null}
                </p>
              </div>
            </div>
            <div className="level-right">
              <div className="tags mb-0">
                <span className={`tag is-small ${state.room.rolesEnabled ? "is-warning is-light" : "is-light"}`}>
                  Роли: {state.room.rolesEnabled ? "вкл" : "выкл"}
                </span>
                <span className={`tag is-small ${state.room.revealed ? "is-success is-light" : "is-light"}`}>
                  {state.room.revealed ? "Открыто" : "Скрыто"}
                </span>
              </div>
            </div>
          </div>

          <div className="field mb-4">
            <label className="label is-small">Текущая задача / тикет</label>
            <div className="control">
              <input
                className="input is-small"
                value={props.titleDraft}
                onChange={(e) => props.onTitleDraftChange(e.target.value)}
                onFocus={props.onTitleFocus}
                onBlur={props.onTitleBlur}
                placeholder="Например: PROJ-123 — Авторизация"
              />
            </div>
            <p className="help">Изменения видны всем участникам.</p>
          </div>

          {!props.titleDraft.trim() ? (
            <div className="notification is-warning is-light py-2 px-3 mb-4">
              <p className="is-size-7 mb-0">Лучше указать название задачи — так запись в истории будет понятнее.</p>
            </div>
          ) : null}

          {state.room.revealed ? (
            <div className="message is-success is-light mb-4">
              <div className="message-body py-3">
                <p className="has-text-weight-semibold is-size-7 mb-2">Итог оценки</p>
                {primarySummary.length ? (
                  <div className="columns is-multiline is-variable is-2">
                    {primarySummary.map((g) => (
                      <div key={g.label} className="column is-6-tablet">
                        <div className="box py-3 px-3 mb-0" style={{ background: "rgba(255,255,255,0.85)" }}>
                          <p className="has-text-weight-bold is-size-6 mb-2">{g.label}</p>
                          <div className="columns is-mobile is-1 mb-0">
                            <div className="column pb-0">
                              <p className="is-size-7 has-text-grey mb-0">Среднее</p>
                              <p className="title is-5 mb-0" style={{ fontVariantNumeric: "tabular-nums" }}>
                                {fmtNum(g.mean)}
                              </p>
                            </div>
                            <div className="column pb-0">
                              <p className="is-size-7 has-text-grey mb-0">Медиана</p>
                              <p className="title is-5 mb-0" style={{ fontVariantNumeric: "tabular-nums" }}>
                                {fmtNum(g.median)}
                              </p>
                            </div>
                          </div>
                          <p className="is-size-7 has-text-grey mb-0">Числовых оценок: {g.count}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="is-size-7 mb-0">Нет числовых карт для расчёта (например, все «?» или «☕»).</p>
                )}
              </div>
            </div>
          ) : (
            <div className="notification is-light py-3 mb-4">
              <p className="is-size-7 mb-0">
                <strong>Оценка в процессе.</strong> Когда все поставят карты, нажмите «Открыть карты» — здесь появится итог.
              </p>
            </div>
          )}

          <p className="is-size-7 has-text-grey mb-2">Выберите оценку</p>
          <div className="vote-grid mb-4">
            {state.room.deck.map((v) => (
              <button
                key={v}
                type="button"
                className={
                  "button is-small is-light" + (props.selectedVote === v ? " is-selected" : "")
                }
                disabled={state.room.revealed}
                onClick={() => (state.room.revealed ? undefined : props.onVote(v))}
              >
                {v}
              </button>
            ))}
          </div>

          <div className="buttons">
            <button type="button" className="button is-primary is-small" onClick={props.onReveal} disabled={state.room.revealed}>
              Открыть карты
            </button>
            <button type="button" className="button is-small" onClick={props.onReset}>
              Новый раунд
            </button>
          </div>
        </div>
      </div>

      <div className="column is-12-tablet is-4-desktop">
        <div className="box mb-3">
          <p className="is-size-7 has-text-weight-semibold mb-2">Участники</p>
          <ul className="mb-0" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {state.users.map((u) => {
              const voted = !!state.voteStatus[u.id];
              const shown = state.votesRevealed[u.id];
              return (
                <li
                  key={u.id}
                  className="is-flex is-justify-content-space-between is-align-items-center py-2"
                  style={{ borderBottom: "1px solid #f0f0f0", gap: "0.5rem" }}
                >
                  <span>
                    <span className="has-text-weight-medium">{u.name}</span>
                    {u.role ? (
                      <span className="tag is-info is-light is-small ml-1">{u.role}</span>
                    ) : null}
                    {u.id === state.room.hostId ? (
                      <span className="tag is-primary is-light is-small ml-1">Ведущий</span>
                    ) : null}
                  </span>
                  <span className="tag is-light">{state.room.revealed ? (shown ?? "—") : voted ? "✓" : "…"}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="box">
          <p className="is-size-7 has-text-weight-semibold mb-2">История оценок</p>
          {history.length === 0 ? (
            <p className="is-size-7 has-text-grey">Пока нет завершённых раундов.</p>
          ) : (
            <div className="history-scroll">
              {history.map((h) => (
                <div key={`${h.roundId}-${h.revealedAt}`} className="box py-2 px-3 mb-2" style={{ background: "#fafafa" }}>
                  <p className="has-text-weight-semibold is-size-7 mb-1">{h.title.trim() || "Без названия задачи"}</p>
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
