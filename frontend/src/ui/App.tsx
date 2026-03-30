import React, { useEffect, useMemo, useState } from "react";
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
  aggregates: { mode: "overall" | "byRole"; groups: Array<{ key: string; label: string; count: number; mean?: number; median?: number }> };
};

/** В dev — из `.env.development`; в prod-сборке без env — тот же host:port, что и страница (nginx проксирует API). */
function getApiBase(): string {
  const v = import.meta.env.VITE_API_URL;
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

export function App() {
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

  useEffect(() => {
    const base = getApiBase();
    const s = io(base, { transports: ["websocket"] });
    setSocket(s);
    s.on("room:state", (st: RoomState) => {
      setState(st);
      setRolesEnabledForJoin(st.room.rolesEnabled);
      setTitleDraft(st.room.roundTitle ?? "");
      if (!st.room.revealed && userId) {
        // keep local selected vote if hidden; otherwise clear will be reflected on reset
      }
    });
    return () => {
      s.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  async function createRoom() {
    const res = await fetch(`${getApiBase()}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rolesEnabled: createRolesEnabled })
    });
    const json = await res.json();
    setRoomCode(json.code);
  }

  function joinRoom() {
    if (!socket) return;
    socket.emit(
      "room:join",
      { roomCode: roomCode.trim().toUpperCase(), name: name.trim(), role: role || undefined },
      (ack: any) => {
        if (!ack?.ok) return;
        setUserId(ack.userId);
        setSelectedVote(null);
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
        <div className="title">Poker Planning</div>
        <div className="spacer" />
        {state?.room?.code ? <span className="pill">Комната: {state.room.code}</span> : null}
        {isHost ? <span className="pill">Ведущий</span> : null}
      </div>

      {!userId ? (
        <div className="card">
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
                onChange={(e) => setRole(e.target.value as any)}
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

          <div className="muted" style={{ marginTop: 12 }}>
            Подсказка: после входа можно отправить ссылку с кодом комнаты коллегам.
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
}) {
  const { state, userId, isHost } = props;
  if (!state) return <div className="card">Подключаемся…</div>;

  const me = state.users.find((u) => u.id === userId);

  return (
    <div className="row" style={{ alignItems: "stretch" }}>
      <div className="card" style={{ flex: 1, minWidth: 340 }}>
        <div className="row" style={{ marginBottom: 10 }}>
          <div>
            <div className="muted">Вы</div>
            <div style={{ fontWeight: 700 }}>
              {me?.name} {me?.role ? <span className="pill">{me.role}</span> : null}
            </div>
          </div>
          <div className="spacer" />
          <span className="pill">{state.room.rolesEnabled ? "Роли: включены" : "Роли: выкл"}</span>
          <span className="pill">{state.room.revealed ? "Reveal" : "Hidden"}</span>
        </div>

        <div className="row" style={{ alignItems: "end", marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="muted" style={{ marginBottom: 6 }}>
              Задача
            </div>
            <input value={props.titleDraft} onChange={(e) => props.setTitleDraft(e.target.value)} placeholder="Напр. PROJ-1234: Login" />
          </div>
          <button onClick={props.onSetTitle} disabled={!isHost}>
            Обновить
          </button>
        </div>

        <div className="muted" style={{ marginBottom: 10 }}>
          Выберите оценку
        </div>
        <div className="gridCards">
          {state.room.deck.map((v) => (
            <div
              key={v}
              className={"voteCard" + (props.selectedVote === v ? " selected" : "")}
              onClick={() => state.room.revealed ? null : props.onVote(v)}
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
            Reveal
          </button>
          <button className="secondary" onClick={props.onReset} disabled={!isHost}>
            New round
          </button>
        </div>
      </div>

      <div className="card" style={{ width: 360, minWidth: 320 }}>
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
                  {u.id === state.room.hostId ? <span className="pill">Host</span> : null}
                </div>
                <span className="pill">{state.room.revealed ? (shown ?? "—") : voted ? "✓" : "…"}</span>
              </div>
            );
          })}
        </div>

        <div style={{ height: 14 }} />

        <div className="muted" style={{ marginBottom: 8 }}>
          Агрегаты
        </div>
        {state.room.revealed ? (
          <div style={{ display: "grid", gap: 8 }}>
            {state.aggregates.groups.length ? (
              state.aggregates.groups.map((g) => (
                <div key={g.key} className="row" style={{ justifyContent: "space-between" }}>
                  <span className="pill">{g.label}</span>
                  <span className="muted">
                    n={g.count} • mean={fmt(g.mean)} • median={fmt(g.median)}
                  </span>
                </div>
              ))
            ) : (
              <div className="muted">Нет числовых оценок для расчёта.</div>
            )}
          </div>
        ) : (
          <div className="muted">Станет доступно после Reveal.</div>
        )}
      </div>
    </div>
  );
}

function fmt(v: number | undefined) {
  if (typeof v !== "number") return "—";
  const rounded = Math.round(v * 10) / 10;
  return String(rounded);
}

