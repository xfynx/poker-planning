import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { io, Socket } from "socket.io-client";

type Role = "BA" | "BE" | "FE" | "SA" | "QA" | "Other";
const ROLE_OPTIONS: Array<{ value: Role | ""; label: string }> = [
  { value: "", label: "Не указывать" },
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

  useEffect(() => {
    if (slug) setRoomCode(slug.toUpperCase());
  }, [slug]);

  useEffect(() => {
    const base = getApiBase();
    const s = io(base, { transports: ["websocket"] });
    setSocket(s);
    s.on("room:state", (st: RoomState) => {
      const next = st.history ? st : { ...st, history: [] as RoundHistoryEntry[] };
      setState(next);
      setRolesEnabledForJoin(next.room.rolesEnabled);
      setTitleDraft(next.room.roundTitle ?? "");
    });
    return () => {
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
    if (!socket) return;
    socket.emit(
      "room:join",
      { roomCode: roomCode.trim().toUpperCase(), name: name.trim(), role: role || undefined },
      (ack: { ok?: boolean; userId?: string }) => {
        if (!ack?.ok) return;
        setUserId(ack.userId!);
        setSelectedVote(null);
        const c = roomCode.trim().toUpperCase();
        if (c) navigate(`/r/${c}`, { replace: true });
      }
    );
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

  function setTitle() {
    if (!socket) return;
    socket.emit("round:setTitle", { title: titleDraft });
  }

  return (
    <div className="container">
      <div className="row" style={{ marginBottom: 14 }}>
        <Link to="/" className="title" style={{ textDecoration: "none" }}>
          Poker Planning
        </Link>
        <div className="spacer" />
        {state?.room?.code ? <span className="pill">Комната: {state.room.code}</span> : null}
        {isHost ? <span className="pill">Ведущий</span> : null}
      </div>

      {!userId ? (
        <div className="card">
          {slug ? (
            <div className="inviteBanner" style={{ marginBottom: 14 }}>
              <div className="inviteBannerTitle">Приглашение в комнату</div>
              <div className="muted">
                Код: <strong>{slug.toUpperCase()}</strong> — введите имя и нажмите «Войти».
              </div>
            </div>
          ) : null}

          <div className="row" style={{ alignItems: "end" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div className="muted" style={{ marginBottom: 6 }}>
                Код комнаты
              </div>
              <input value={roomCode} onChange={(e) => setRoomCode(e.target.value)} placeholder="Напр. A1B2C3" />
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div className="muted" style={{ marginBottom: 6 }}>
                Имя
              </div>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ваше имя" />
            </div>

            <div style={{ minWidth: 220 }}>
              <div className="muted" style={{ marginBottom: 6 }}>
                Роль (опционально)
              </div>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role | "")}
                disabled={rolesEnabledForJoin === false}
                title={rolesEnabledForJoin === false ? "В этой комнате роли отключены" : undefined}
              >
                {ROLE_OPTIONS.map((o) => (
                  <option key={o.label} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <button onClick={joinRoom} disabled={!roomCode.trim() || !name.trim()}>
              Войти
            </button>
          </div>

          <div style={{ height: 12 }} />

          <div className="row">
            <button className="secondary" onClick={createRoom}>
              Создать комнату
            </button>
            <label className="row muted" style={{ gap: 8 }}>
              <input type="checkbox" checked={createRolesEnabled} onChange={(e) => setCreateRolesEnabled(e.target.checked)} />
              Использовать роли
            </label>
          </div>

          {roomCode.trim() && !slug ? (
            <div className="shareRow muted" style={{ marginTop: 14 }}>
              <span>Ссылка для гостей:</span>
              <input readOnly className="shareInput" value={inviteUrl || `${typeof window !== "undefined" ? window.location.origin : ""}/r/${roomCode.trim().toUpperCase()}`} />
              <button type="button" className="secondary" onClick={() => copyInvite(inviteUrl || `${window.location.origin}/r/${roomCode.trim().toUpperCase()}`)}>
                Копировать
              </button>
              {copyHint ? <span className="pill">{copyHint}</span> : null}
            </div>
          ) : null}

          <div className="muted" style={{ marginTop: 12 }}>
            Отправьте коллегам ссылку вида <code className="codeInline">/r/КОД</code> — они смогут войти сразу по ней.
          </div>
        </div>
      ) : (
        <RoomView
          state={state}
          userId={userId}
          isHost={isHost}
          titleDraft={titleDraft}
          setTitleDraft={setTitleDraft}
          onSetTitle={setTitle}
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
  );
}

function RoomView(props: {
  state: RoomState | null;
  userId: string;
  isHost: boolean;
  titleDraft: string;
  setTitleDraft: (v: string) => void;
  onSetTitle: () => void;
  onVote: (v: string) => void;
  selectedVote: string | null;
  onReveal: () => void;
  onReset: () => void;
  inviteUrl: string;
  onCopyInvite: (url: string) => void;
  copyHint: string | null;
}) {
  const { state, userId, isHost } = props;
  if (!state) return <div className="card">Подключаемся…</div>;

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
    <div className="layoutMain">
      <div className="card" style={{ flex: 1, minWidth: 300 }}>
        <div className="shareRow" style={{ marginBottom: 14 }}>
          <span className="muted">Ссылка на комнату</span>
          <input readOnly className="shareInput" value={props.inviteUrl} />
          <button type="button" className="secondary" onClick={() => props.onCopyInvite(props.inviteUrl)} disabled={!props.inviteUrl}>
            Копировать
          </button>
          {props.copyHint ? <span className="pill">{props.copyHint}</span> : null}
        </div>

        <div className="row" style={{ marginBottom: 10 }}>
          <div>
            <div className="muted">Вы</div>
            <div style={{ fontWeight: 700 }}>
              {me?.name} {me?.role ? <span className="pill">{me.role}</span> : null}
            </div>
          </div>
          <div className="spacer" />
          <span className="pill">{state.room.rolesEnabled ? "Роли: включены" : "Роли: выкл"}</span>
          <span className="pill">{state.room.revealed ? "Карты открыты" : "Карты скрыты"}</span>
        </div>

        <div className="row" style={{ alignItems: "end", marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="muted" style={{ marginBottom: 6 }}>
              Текущая задача / тикет
            </div>
            <input
              value={props.titleDraft}
              onChange={(e) => props.setTitleDraft(e.target.value)}
              placeholder="Например: PROJ-123 — Авторизация"
            />
          </div>
          <button onClick={props.onSetTitle} disabled={!isHost} title="Укажите задачу до оценки — она попадёт в историю после открытия карт">
            Сохранить
          </button>
        </div>
        {!props.titleDraft.trim() ? (
          <div className="hintWarn">Рекомендуем указать название задачи — так запись в истории будет понятной.</div>
        ) : null}

        {state.room.revealed ? (
          <div className="resultHero">
            <div className="resultHeroTitle">Итог оценки</div>
            {primarySummary.length ? (
              <div className="resultHeroGrid">
                {primarySummary.map((g) => (
                  <div key={g.label} className="resultHeroCard">
                    <div className="resultHeroLabel">{g.label}</div>
                    <div className="resultHeroNums">
                      <div>
                        <span className="resultStatName">Среднее</span>
                        <span className="resultStatVal">{fmtNum(g.mean)}</span>
                      </div>
                      <div>
                        <span className="resultStatName">Медиана</span>
                        <span className="resultStatVal">{fmtNum(g.median)}</span>
                      </div>
                    </div>
                    <div className="resultHeroMeta">Числовых оценок в группе: {g.count}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted">Нет числовых карт для расчёта (например, все «?» или «☕»).</div>
            )}
          </div>
        ) : (
          <div className="resultPending">
            <strong>Оценка в процессе.</strong> После того как все поставят карты, ведущий нажимает «Открыть карты» — здесь появится итог.
          </div>
        )}

        <div className="muted" style={{ marginBottom: 10, marginTop: 16 }}>
          Выберите оценку
        </div>
        <div className="gridCards">
          {state.room.deck.map((v) => (
            <div
              key={v}
              className={"voteCard" + (props.selectedVote === v ? " selected" : "")}
              onClick={() => (state.room.revealed ? null : props.onVote(v))}
              role="button"
              aria-disabled={state.room.revealed}
            >
              <div style={{ fontSize: 18, fontWeight: 800 }}>{v}</div>
            </div>
          ))}
        </div>

        <div style={{ height: 12 }} />

        <div className="row">
          <button onClick={props.onReveal} disabled={!isHost || state.room.revealed}>
            Открыть карты
          </button>
          <button className="secondary" onClick={props.onReset} disabled={!isHost}>
            Новый раунд
          </button>
        </div>
      </div>

      <div className="sideColumn">
        <div className="card sideCard">
          <div className="muted" style={{ marginBottom: 8 }}>
            Участники
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {state.users.map((u) => {
              const voted = !!state.voteStatus[u.id];
              const shown = state.votesRevealed[u.id];
              return (
                <div key={u.id} className="row" style={{ justifyContent: "space-between" }}>
                  <div className="row">
                    <div style={{ fontWeight: 700 }}>{u.name}</div>
                    {u.role ? <span className="pill">{u.role}</span> : null}
                    {u.id === state.room.hostId ? <span className="pill">Ведущий</span> : null}
                  </div>
                  <span className="pill">{state.room.revealed ? (shown ?? "—") : voted ? "✓" : "…"}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card sideCard">
          <div className="muted" style={{ marginBottom: 8 }}>
            История оценок
          </div>
          {history.length === 0 ? (
            <div className="muted">Пока нет завершённых раундов. После «Открыть карты» запись появится здесь.</div>
          ) : (
            <div className="historyList">
              {history.map((h) => (
                <div key={`${h.roundId}-${h.revealedAt}`} className="historyItem">
                  <div className="historyItemTitle">{h.title.trim() || "Без названия задачи"}</div>
                  <div className="historyItemMeta">{formatRuDateTime(h.revealedAt)}</div>
                  <div className="historyItemSummary">{summarizeGroupsRu(h.aggregates.groups)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
