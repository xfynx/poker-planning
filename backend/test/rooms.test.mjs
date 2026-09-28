import { test } from "node:test";
import assert from "node:assert/strict";
import { generateRoomCode } from "../dist/domain/roomCode.js";
import { createRoomStore, JoinRoomInput, ResumeRoomInput } from "../dist/domain/roomStore.js";

test("generated word codes fit both join and resume contracts", () => {
  for (let i = 0; i < 1000; i++) {
    const code = generateRoomCode();
    assert.match(code, /^[a-z]+-[a-z]+-[a-z]+$/);
    assert.equal(JoinRoomInput.parse({ roomCode: ` ${code.toUpperCase()} `, name: "Alice" }).roomCode, code);
    assert.equal(ResumeRoomInput.parse({ roomCode: code, userId: "u_test" }).roomCode, code);
  }
  assert.equal(JoinRoomInput.parse({ roomCode: " a1b2c3 ", name: "Bob" }).roomCode, "A1B2C3");
  assert.equal(ResumeRoomInput.parse({ roomCode: "a1b2c3", userId: "u_test" }).roomCode, "A1B2C3");
  assert.equal(JoinRoomInput.safeParse({ roomCode: "x".repeat(65), name: "Bob" }).success, false);
});

test("collisions retry with atomic NX and TTL instead of overwriting rooms", async () => {
  let calls = 0;
  const store = createRoomStore({
    async set(key, value, ex, ttl, nx) {
      calls++;
      assert.equal(ex, "EX");
      assert.equal(ttl, 86400);
      assert.equal(nx, "NX");
      assert.equal(key, `room:${JSON.parse(value).code}`);
      return calls === 1 ? null : "OK";
    }
  });
  const room = await store.createRoom(true);
  assert.equal(calls, 2);
  assert.equal(room.rolesEnabled, true);
});

test("allocation retries are bounded when every code is occupied", async () => {
  let calls = 0;
  const store = createRoomStore({ async set() { calls++; return null; } });
  await assert.rejects(store.createRoom(false), /unique room code/);
  assert.equal(calls, 20);
});

test("lookup uses canonical keys for both old and new codes", async () => {
  const keys = [];
  const store = createRoomStore({ async get(key) { keys.push(key); return null; } });
  await store.getRoom(" CALM-AMBER-OTTER ");
  await store.getRoom("a1b2c3");
  assert.deepEqual(keys, ["room:calm-amber-otter", "room:A1B2C3"]);
});
