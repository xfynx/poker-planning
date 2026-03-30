export const RoleValues = ["BA", "BE", "FE", "SA", "QA", "Other"] as const;
export type Role = (typeof RoleValues)[number];

export type User = {
  id: string;
  name: string;
  role?: Role;
};

export type Room = {
  code: string;
  hostId: string;
  createdAt: number;
  rolesEnabled: boolean;
  deck: string[];
  activeRoundId: string;
  roundTitle: string;
  revealed: boolean;
};

export type VoteAggregates = {
  mode: "overall" | "byRole";
  groups: Array<{
    key: string;
    label: string;
    count: number;
    mean?: number;
    median?: number;
  }>;
};

/** Снимок завершённого раунда (после «Открыть карты»). */
export type RoundHistoryEntry = {
  roundId: string;
  title: string;
  revealedAt: number;
  votes: Array<{
    userId: string;
    name: string;
    role?: Role;
    value: string | null;
  }>;
  aggregates: VoteAggregates;
};

export type PublicRoomState = {
  room: Pick<Room, "code" | "hostId" | "createdAt" | "rolesEnabled" | "deck" | "activeRoundId" | "roundTitle" | "revealed">;
  users: User[];
  votesRevealed: Record<string, string | null>;
  voteStatus: Record<string, boolean>;
  aggregates: VoteAggregates;
  history: RoundHistoryEntry[];
};
