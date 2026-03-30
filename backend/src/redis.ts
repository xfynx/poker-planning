import Redis from "ioredis";

export function createRedis() {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  return new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 2 });
}

