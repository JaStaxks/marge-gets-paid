import { createClient, type RedisClientType } from "redis";

import { redisTcpUrl } from "@/lib/env";
import { AppError } from "@/lib/types";

export type TcpRedis = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
};

let testClient: TcpRedis | null = null;
let client: RedisClientType | null = null;
let connecting: Promise<void> | null = null;

export function setTcpRedisForTests(next: TcpRedis | null): void {
  testClient = next;
}

function safeRedisMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Redis command failed";
  return message.replace(/rediss?:\/\/\S+/gi, "redis://[redacted]").slice(0, 240);
}

async function liveClient(): Promise<RedisClientType> {
  const url = redisTcpUrl();
  if (!url) throw new AppError(500, "REDIS_URL is not a redis:// or rediss:// URL.");
  if (!client) {
    const created = createClient({
      url,
      socket: {
        connectTimeout: 10_000,
        reconnectStrategy(retries) {
          if (retries > 2) return new Error("Redis reconnect stopped");
          return retries * 200;
        },
      },
    });
    created.on("error", (error) => {
      console.error(`[marge] redis ${safeRedisMessage(error)}`);
    });
    client = created;
  }
  if (!client.isOpen) {
    const current = client;
    if (!connecting) {
      connecting = current
        .connect()
        .then(() => undefined)
        .finally(() => {
          connecting = null;
        });
    }
    try {
      await connecting;
    } catch (error) {
      throw new AppError(502, `Redis connection failed. ${safeRedisMessage(error)}`);
    }
  }
  return client;
}

export async function tcpGet(key: string): Promise<string | null> {
  try {
    if (testClient) return await testClient.get(key);
    const redis = await liveClient();
    return await redis.get(key);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(502, `Redis read failed. ${safeRedisMessage(error)}`);
  }
}

export async function tcpSet(key: string, value: string): Promise<void> {
  try {
    if (testClient) {
      await testClient.set(key, value);
      return;
    }
    const redis = await liveClient();
    await redis.set(key, value);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(502, `Redis write failed. ${safeRedisMessage(error)}`);
  }
}
