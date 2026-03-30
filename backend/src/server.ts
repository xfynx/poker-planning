import Fastify from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { Server as SocketIOServer } from "socket.io";
import type { Socket } from "socket.io";
import { createRedis } from "./redis.js";
import { createRoomStore, CreateRoomInput, JoinRoomInput } from "./domain/roomStore.js";
import { computeAggregates } from "./domain/stats.js";
import type { PublicRoomState, Role, User, VoteAggregates } from "./types.js";

const PORT = Number(process.env.PORT ?? 3000);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:5173";

const app = Fastify({ logger: true });

await app.register(cors, { origin: CORS_ORIGIN, credentials: true });

const httpServer = app.server;
const io = new SocketIOServer(httpServer, {
  cors: { origin: CORS_ORIGIN, credentials: true }
});

const redis = createRedis();
const store = createRoomStore(redis);

app.get("/health", async () => ({ ok: true }));

app.get("/rooms/:code", async (req: FastifyRequest, reply: FastifyReply) => {
  const code = String((req.params as any)?.code ?? "").toUpperCase();
  if (!code) return reply.code(400).send({ error: "bad_request" });
  const room = await store.getRoom(code);
  if (!room) return reply.code(404).send({ error: "room_not_found" });
  return reply.send({ code: room.code, rolesEnabled: room.rolesEnabled });
});

app.post("/rooms", async (req: FastifyRequest, reply: FastifyReply) => {
  const parsed = CreateRoomInput.safeParse(req.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: "bad_request" });

  const room = await store.createRoom(parsed.data.rolesEnabled);
  return reply.send({ code: room.code });
});

type ClientCtx = { userId?: string; roomCode?: string };

io.on("connection", (socket: Socket) => {
  const ctx: ClientCtx = {};

  socket.on("room:join", async (payload: unknown, ack?: (v: any) => void) => {
    const parsed = JoinRoomInput.safeParse(payload);
    if (!parsed.success) return ack?.({ ok: false, error: "bad_request" });

    const room = await store.getRoom(parsed.data.roomCode);
    if (!room) return ack?.({ ok: false, error: "room_not_found" });

    const userId = genUserId();
    const role: Role | undefined = room.rolesEnabled ? parsed.data.role : undefined;
    const user: User = { id: userId, name: parsed.data.name, role };

    ctx.userId = userId;
    ctx.roomCode = room.code;

    if (!room.hostId) {
      room.hostId = userId;
      await store.setRoom(room);
    }

    await store.upsertUser(room.code, user);
    await store.touchRoom(room.code);

    socket.join(room.code);
    await emitRoomState(room.code);

    return ack?.({ ok: true, userId, roomCode: room.code });
  });

  socket.on("room:leave", async (_payload: unknown, ack?: (v: any) => void) => {
    if (!ctx.roomCode || !ctx.userId) return ack?.({ ok: true });
    await store.removeUser(ctx.roomCode, ctx.userId);
    socket.leave(ctx.roomCode);
    await emitRoomState(ctx.roomCode);
    return ack?.({ ok: true });
  });

  socket.on("round:setTitle", async (payload: any, ack?: (v: any) => void) => {
    if (!ctx.roomCode || !ctx.userId) return ack?.({ ok: false, error: "not_joined" });
    const room = await store.getRoom(ctx.roomCode);
    if (!room) return ack?.({ ok: false, error: "room_not_found" });
    if (room.hostId !== ctx.userId) return ack?.({ ok: false, error: "forbidden" });
    const title = typeof payload?.title === "string" ? payload.title.slice(0, 200) : "";
    room.roundTitle = title;
    await store.setRoom(room);
    await emitRoomState(room.code);
    return ack?.({ ok: true });
  });

  socket.on("vote:set", async (payload: any, ack?: (v: any) => void) => {
    if (!ctx.roomCode || !ctx.userId) return ack?.({ ok: false, error: "not_joined" });
    const room = await store.getRoom(ctx.roomCode);
    if (!room) return ack?.({ ok: false, error: "room_not_found" });
    if (room.revealed) return ack?.({ ok: false, error: "already_revealed" });

    const value = payload?.value;
    const v = typeof value === "string" ? value : null;
    await store.setVote(room.code, room.activeRoundId, ctx.userId, v);
    await emitRoomState(room.code);
    return ack?.({ ok: true });
  });

  socket.on("round:reveal", async (_payload: unknown, ack?: (v: any) => void) => {
    if (!ctx.roomCode || !ctx.userId) return ack?.({ ok: false, error: "not_joined" });
    const room = await store.getRoom(ctx.roomCode);
    if (!room) return ack?.({ ok: false, error: "room_not_found" });
    if (room.hostId !== ctx.userId) return ack?.({ ok: false, error: "forbidden" });
    room.revealed = true;
    await store.setRoom(room);
    await emitRoomState(room.code);
    return ack?.({ ok: true });
  });

  socket.on("round:reset", async (_payload: unknown, ack?: (v: any) => void) => {
    if (!ctx.roomCode || !ctx.userId) return ack?.({ ok: false, error: "not_joined" });
    const room = await store.getRoom(ctx.roomCode);
    if (!room) return ack?.({ ok: false, error: "room_not_found" });
    if (room.hostId !== ctx.userId) return ack?.({ ok: false, error: "forbidden" });

    await store.clearVotes(room.code, room.activeRoundId);
    room.activeRoundId = `r_${Math.random().toString(36).slice(2, 10)}`;
    room.revealed = false;
    room.roundTitle = "";
    await store.setRoom(room);
    await emitRoomState(room.code);
    return ack?.({ ok: true });
  });

  socket.on("disconnect", async () => {
    if (!ctx.roomCode || !ctx.userId) return;
    await store.removeUser(ctx.roomCode, ctx.userId);
    await emitRoomState(ctx.roomCode);
  });
});

async function emitRoomState(code: string) {
  const room = await store.getRoom(code);
  if (!room) return;
  const users = await store.listUsers(code);
  const votes = await store.getVotes(code, room.activeRoundId);

  const voteStatus: Record<string, boolean> = {};
  for (const u of users) voteStatus[u.id] = typeof votes[u.id] === "string" || votes[u.id] === null;

  const votesRevealed: Record<string, string | null> = {};
  for (const u of users) {
    votesRevealed[u.id] = room.revealed ? (votes[u.id] ?? null) : null;
  }

  const aggregates: VoteAggregates = room.revealed
    ? computeAggregates({ rolesEnabled: room.rolesEnabled, users, votesByUserId: votes })
    : { mode: room.rolesEnabled ? "byRole" : "overall", groups: [] };

  const state: PublicRoomState = {
    room: {
      code: room.code,
      hostId: room.hostId,
      createdAt: room.createdAt,
      rolesEnabled: room.rolesEnabled,
      deck: room.deck,
      activeRoundId: room.activeRoundId,
      roundTitle: room.roundTitle,
      revealed: room.revealed
    },
    users,
    votesRevealed,
    voteStatus,
    aggregates
  };

  io.to(code).emit("room:state", state);
}

function genUserId() {
  return `u_${Math.random().toString(36).slice(2, 10)}`;
}

app.listen({ port: PORT, host: "0.0.0.0" });

