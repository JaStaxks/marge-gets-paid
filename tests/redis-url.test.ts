import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { storeBackend, usesRedis } from "@/lib/env";
import { isGeminiQuotaError } from "@/lib/gemini";
import { bookJob, listOpenSlots } from "@/lib/jobs";
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
    const writesAfterSeed = memory.sets;
    const again = await readStore();
    expect(again.seededAt).toBe(first.seededAt);
    expect(memory.sets).toBe(writesAfterSeed);
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

  it("lists a slot and books it on the REDIS_URL backend, including by the spoken label", async () => {
    process.env.REDIS_URL = "redis://127.0.0.1:6379";
    process.env.PAYPAL_FORCE_MOCK = "1";
    const memory = memoryRedis();
    setTcpRedisForTests(memory.client);
    const open = await listOpenSlots();
    const listed = open.find((slot) => slot.label.includes("9:00 AM")) ?? open[0];
    expect(listed).toBeTruthy();
    const byId = await bookJob({
      customerName: "Dana Ruiz",
      phone: "619-555-0199",
      email: "dana-redis@example.com",
      address: "2100 Sunset Cliffs Blvd",
      issue: "Water heater is leaking",
      serviceCode: "wh-leak",
      slotId: listed!.id,
    });
    expect(byId.slotId).toBe(listed!.id);
    expect(byId.slotLabel).toBe(listed!.label);
    expect(byId.status).toBe("booked");
    const afterId = await listOpenSlots();
    expect(afterId.some((slot) => slot.id === listed!.id)).toBe(false);
    const saved = JSON.parse(memory.values.get(KEY) || "{}") as { slots: Array<{ id: string; available: boolean }> };
    expect(saved.slots.find((slot) => slot.id === listed!.id)?.available).toBe(false);

    const spoken = afterId[0];
    expect(spoken).toBeTruthy();
    const byLabel = await bookJob({
      customerName: "Luis Ortega",
      phone: "619-555-0172",
      email: "luis-redis@example.com",
      address: "3758 Newton Ave, San Diego, CA 92113",
      issue: "Kitchen drain is backing up",
      serviceCode: "drain-clear",
      slotId: spoken!.label,
    });
    expect(byLabel.slotId).toBe(spoken!.id);
    await expect(
      bookJob({
        customerName: "Helen Cho",
        phone: "619-555-0164",
        email: "helen-redis@example.com",
        address: "1844 Granada Ave, San Diego, CA 92102",
        issue: "AC will not cool",
        serviceCode: "ac-diagnostic",
        slotId: spoken!.label,
      }),
    ).rejects.toThrow(/just taken/);
    const still = await listOpenSlots();
    expect(still.some((slot) => slot.id === spoken!.id)).toBe(false);
  });
});

describe("Gemini quota", () => {
  it("recognizes RESOURCE_EXHAUSTED and the free-tier quota message", () => {
    const quota = Object.assign(new Error("Failed after 3 attempts. Last error: You exceeded your current quota."), {
      lastError: new Error("Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests"),
      responseBody: JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED" } }),
    });
    expect(isGeminiQuotaError(quota)).toBe(true);
    expect(isGeminiQuotaError(new Error("socket hang up"))).toBe(false);
  });
});
