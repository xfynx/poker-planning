import { normalizeVoteToNumber } from "./deck.js";
import type { Role, User, VoteAggregates } from "../types.js";

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[mid];
  return (s[mid - 1] + s[mid]) / 2;
}

type VotesByUserId = Record<string, string | null | undefined>;

const ROLE_ORDER: Array<Role> = ["BA", "BE", "FE", "SA", "QA", "Other"];

export function computeAggregates(opts: {
  rolesEnabled: boolean;
  users: User[];
  votesByUserId: VotesByUserId;
}): VoteAggregates {
  const { rolesEnabled, users, votesByUserId } = opts;

  if (!rolesEnabled) {
    const nums = users
      .map((u) => votesByUserId[u.id])
      .filter((v): v is string => typeof v === "string")
      .map(normalizeVoteToNumber)
      .filter((n): n is number => typeof n === "number");

    return {
      mode: "overall",
      groups: [
        {
          key: "Overall",
          label: "Все участники",
          count: nums.length,
          mean: mean(nums),
          median: median(nums)
        }
      ]
    };
  }

  const byRole: Record<string, number[]> = {};
  for (const r of ROLE_ORDER) byRole[r] = [];
  byRole.NoRole = [];

  for (const u of users) {
    const raw = votesByUserId[u.id];
    if (typeof raw !== "string") continue;
    const n = normalizeVoteToNumber(raw);
    if (typeof n !== "number") continue;
    const key = u.role ?? "NoRole";
    if (!byRole[key]) byRole[key] = [];
    byRole[key].push(n);
  }

  const groups: VoteAggregates["groups"] = [];
  for (const r of ROLE_ORDER) {
    const arr = byRole[r];
    if (!arr || arr.length === 0) continue;
    groups.push({ key: r, label: r, count: arr.length, mean: mean(arr), median: median(arr) });
  }
  if (byRole.NoRole?.length) {
    const arr = byRole.NoRole;
    groups.push({ key: "NoRole", label: "Без роли", count: arr.length, mean: mean(arr), median: median(arr) });
  }

  return { mode: "byRole", groups };
}

