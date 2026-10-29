import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { storeBackend, usesRedis } from "@/lib/env";
import { setTcpRedisForTests, type TcpRedis } from "@/lib/redis-tcp";
import { readStore, resetStore } from "@/lib/store";
import { AppError } from "@/lib/types";

const KEY = "marge:store:v1";

function memoryRedis(): { client: TcpRedis; values: Map<string, string>; sets: number } {
  const values = new Map<string, string>();
  let sets = 0;
  return {
    values,
    get sets() {
      return sets;
    },
    client: {
      async get(key) {
        return values.get(key) ?? null;
      },
      async set(key, value) {
        sets += 1;
        values.set(key, value);
      },
    },
  };
}

beforeEach(() => {
  const dir = mkdtempSync(path.join(tmpdir(), "marge-redis-"));
  process.env.STORE_PATH = path.join(dir, "store.json");
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.REDIS_URL;
  setTcpRedisForTests(null);
});

afterEach(() => {
  delete process.env.REDIS_URL;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  setTcpRedisForTests(null);
});

describe("REDIS_URL store selection", () => {
  it("uses the TCP client for redis:// and rediss:// and ignores other schemes", () => {
    expect(storeBackend()).toBe("file");
    expect(usesRedis()).toBe(false);
    process.env.REDIS_URL = "redis://default:secret@example.internal:6379/0";
    expect(storeBackend()).toBe("redis");
    expect(usesRedis()).toBe(true);
    process.env.REDIS_URL = "rediss://default:secret@example.internal:6380";
    expect(storeBackend()).toBe("redis");
    process.env.REDIS_URL = "http://example.internal";
    expect(storeBackend()).toBe("file");
  });

  it("keeps the Upstash REST path when those variables are set alongside REDIS_URL", () => {
    process.env.REDIS_URL = "redis://127.0.0.1:6379";
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    expect(storeBackend()).toBe("upstash");
  });

  it("saves the board through REDIS_URL and does not write the JSON file", async () => {
    process.env.REDIS_URL = "redis://127.0.0.1:6379";
    const memory = memoryRedis();
    setTcpRedisForTests(memory.client);
    const first = await readStore();
    expect(first.jobs.map((job) => job.customerName)).toContain("Luis Ortega");
    expect(memory.values.get(KEY)).toContain("Luis Ortega");
    expect(existsSync(process.env.STORE_PATH || "")).toBe(false);
    const again = await readStore();
    expect(again.seededAt).toBe(first.seededAt);
    expect(memory.sets).toBeGreaterThan(1);
    await resetStore();
    const saved = JSON.parse(memory.values.get(KEY) || "{}") as { jobs: unknown[] };
    expect(saved.jobs).toHaveLength(4);
    expect(existsSync(process.env.STORE_PATH || "")).toBe(false);
  });

  it("does not call the TCP client when the Upstash REST pair is configured", async () => {
    process.env.REDIS_URL = "redis://127.0.0.1:6379";
    process.env.UPSTASH_REDIS_REST_URL = "http://127.0.0.1:9";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    let calls = 0;
    setTcpRedisForTests({
      async get() {
        calls += 1;
        return null;
      },
      async set() {
        calls += 1;
      },
    });
    await expect(readStore()).rejects.toThrow();
    expect(calls).toBe(0);
    expect(existsSync(process.env.STORE_PATH || "")).toBe(false);
  });

  it("hides the Redis URL when a TCP read fails", async () => {
    process.env.REDIS_URL = "redis://127.0.0.1:6379";
    setTcpRedisForTests({
      async get() {
        throw new Error("connect redis://default:secret@example.internal:6379 failed");
      },
      async set() {
        throw new Error("should not write");
      },
    });
    await expect(readStore()).rejects.toMatchObject({
      name: "AppError",
      status: 502,
    });
    try {
      await readStore();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).message).toMatch(/Redis read failed/);
      expect((error as AppError).message).not.toContain("secret");
    }
    expect(existsSync(process.env.STORE_PATH || "")).toBe(false);
  });

  it("refuses to replace a corrupt Redis value with a new seed", async () => {
    process.env.REDIS_URL = "redis://127.0.0.1:6379";
    let writes = 0;
    setTcpRedisForTests({
      async get() {
        return "not-json";
      },
      async set() {
        writes += 1;
      },
    });
    await expect(readStore()).rejects.toThrow(/not valid JSON/);
    expect(writes).toBe(0);
  });
});
