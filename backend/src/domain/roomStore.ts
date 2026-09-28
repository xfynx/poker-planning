import { z } from "zod";
import type { Role, Room, RoundHistoryEntry, User } from "../types.js";
import { DEFAULT_DECK } from "./deck.js";
import { generateRoomCode, normalizeRoomCode } from "./roomCode.js";

const roomCodeInput = z.string().trim().min(2).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/i).transform(normalizeRoomCode);

export const CreateRoomInput = z.object({
  rolesEnabled: z.boolean().default(false)
});

export const JoinRoomInput = z.object({
  roomCode: roomCodeInput,
  name: z.string().min(1).max(48),
  role: z.enum(["BA", "BE", "FE", "SA", "QA", "Other"]).optional()
});

export const ResumeRoomInput = z.object({
  roomCode: roomCodeInput,
  userId: z.string().min(2).max(48)
});

export type RoomStore = {
  createRoom(rolesEnabled: boolean): Promise<Room>;
  getRoom(code: string): Promise<Room | null>;
  setRoom(room: Room): Promise<void>;
  touchRoom(code: string): Promise<void>;

  upsertUser(code: string, user: User): Promise<void>;
  removeUser(code: string, userId: string): Promise<void>;
  listUsers(code: string): Promise<User[]>;

  getVotes(code: string, roundId: string): Promise<Record<string, string | null>>;
  setVote(code: string, roundId: string, userId: string, value: string | null): Promise<void>;
  clearVotes(code: string, roundId: string): Promise<void>;

  appendHistory(code: string, entry: RoundHistoryEntry): Promise<void>;
  listHistory(code: string): Promise<RoundHistoryEntry[]>;
};

function roomKey(code: string) {
  return `room:${code}`;
}
function usersKey(code: string) {
  return `room:${code}:users`;
}
function votesKey(code: string, roundId: string) {
  return `room:${code}:votes:${roundId}`;
}
function historyKey(code: string) {
  return `room:${code}:history`;
}

export function createRoomStore(redis: {
  get: any;
  set: any;
  expire: any;
  hset: any;
  hdel: any;
  hgetall: any;
  del: any;
  exists: any;
  lpush: any;
  lrange: any;
  ltrim: any;
}) {
  const TTL_SECONDS = 60 * 60 * 24;

  async function touch(code: string) {
    await redis.expire(roomKey(code), TTL_SECONDS);
    await redis.expire(usersKey(code), TTL_SECONDS);
    await redis.expire(historyKey(code), TTL_SECONDS);
  }

  return {
    async createRoom(rolesEnabled: boolean) {
      for (let attempt = 0; attempt < 20; attempt++) {
        const code = generateRoomCode();
        const now = Date.now();
        const room: Room = {
          code,
          hostId: "",
          createdAt: now,
          rolesEnabled,
          deck: DEFAULT_DECK,
          activeRoundId: genRoundId(),
          roundTitle: "",
          revealed: false
        };
        // Reserve atomically: concurrent requests must never overwrite an existing room.
        const reserved = await redis.set(roomKey(code), JSON.stringify(room), "EX", TTL_SECONDS, "NX");
        if (reserved === "OK") return room;
      }
      throw new Error("Unable to allocate a unique room code");
    },

    async getRoom(code: string) {
      const raw = await redis.get(roomKey(normalizeRoomCode(code)));
      if (!raw) return null;
      return JSON.parse(raw) as Room;
    },

    async setRoom(room: Room) {
      await redis.set(roomKey(room.code), JSON.stringify(room));
      await touch(room.code);
    },

    async touchRoom(code: string) {
      await touch(code);
    },

    async upsertUser(code: string, user: User) {
      await redis.hset(usersKey(code), user.id, JSON.stringify(user));
      await touch(code);
    },

    async removeUser(code: string, userId: string) {
      await redis.hdel(usersKey(code), userId);
      await touch(code);
    },

    async listUsers(code: string) {
      const raw = (await redis.hgetall(usersKey(code))) as Record<string, string>;
      const users: User[] = [];
      for (const k of Object.keys(raw)) {
        try {
          users.push(JSON.parse(raw[k]) as User);
        } catch {
          // ignore malformed
        }
      }
      return users;
    },

    async getVotes(code: string, roundId: string) {
      const raw = (await redis.hgetall(votesKey(code, roundId))) as Record<string, string>;
      const out: Record<string, string | null> = {};
      for (const [uid, v] of Object.entries(raw)) {
        out[uid] = v === "__null__" ? null : v;
      }
      return out;
    },

    async setVote(code: string, roundId: string, userId: string, value: string | null) {
      await redis.hset(votesKey(code, roundId), userId, value === null ? "__null__" : value);
      await redis.expire(votesKey(code, roundId), TTL_SECONDS);
      await touch(code);
    },

    async clearVotes(code: string, roundId: string) {
      await redis.del(votesKey(code, roundId));
      await touch(code);
    },

    async appendHistory(code: string, entry: RoundHistoryEntry) {
      await redis.lpush(historyKey(code), JSON.stringify(entry));
      await redis.ltrim(historyKey(code), 0, 99);
      await redis.expire(historyKey(code), TTL_SECONDS);
      await touch(code);
    },

    async listHistory(code: string) {
      const raw = (await redis.lrange(historyKey(code), 0, 49)) as string[];
      const out: RoundHistoryEntry[] = [];
      for (const s of raw) {
        try {
          out.push(JSON.parse(s) as RoundHistoryEntry);
        } catch {
          // skip
        }
      }
      return out;
    }
  } satisfies RoomStore;
}

function genRoundId() {
  return `r_${Math.random().toString(36).slice(2, 10)}`;
}

