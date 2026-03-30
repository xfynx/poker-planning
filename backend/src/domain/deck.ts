export const DEFAULT_DECK = ["0", "1", "2", "3", "5", "8", "13", "21", "34", "55", "89", "?", "☕"];

export function normalizeVoteToNumber(v: string): number | null {
  if (v === "?" || v === "☕") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

