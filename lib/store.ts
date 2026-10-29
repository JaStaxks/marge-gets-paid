import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { appBaseUrl, redisConfig, sandboxBuyerEmail, storeBackend } from "@/lib/env";
import { tcpGet, tcpSet } from "@/lib/redis-tcp";
import { depositCentsFor, priceLines } from "@/lib/money";
import { getPriceBookItem, linesFromNote, requirePriceBookItem } from "@/lib/price-book";
import { generateSlots } from "@/lib/slots";
import { AppError, type Job, type Slot, type StoreData, type TranscriptEntry } from "@/lib/types";

const REDIS_KEY = "marge:store:v1";

function storeFile(): string {
  return process.env.STORE_PATH || path.join(process.cwd(), "data", "store.json");
}

export function createId(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString("hex")}`;
}

function transcript(text: string, role: TranscriptEntry["role"]): TranscriptEntry {
  return { role, text, at: new Date().toISOString() };
}

function takeSlot(slots: Slot[], predicate: (slot: Slot) => boolean): Slot {
  const slot = slots.find((item) => item.available && predicate(item));
  if (!slot) {
    const fallback = slots.find((item) => item.available);
    if (!fallback) throw new Error("No slots to seed");
    fallback.available = false;
    return fallback;
  }
  slot.available = false;
  return slot;
}

function sampleJob(input: {
  slot: Slot;
  name: string;
  phone: string;
  email: string;
  address: string;
  issue: string;
  serviceCode: string;
  status: Job["status"];
  techNote?: string;
  ageHours: number;
}): Job {
  const service = requirePriceBookItem(input.serviceCode);
  const now = Date.now() - input.ageHours * 60 * 60 * 1000;
  const createdAt = new Date(now).toISOString();
  const job: Job = {
    id: createId("job"),
    customerName: input.name,
    phone: input.phone,
    email: input.email,
    address: input.address,
    issue: input.issue,
    serviceCode: service.code,
    serviceName: service.name,
    slotId: input.slot.id,
    slotLabel: input.slot.label,
    quoteCents: service.priceCents,
    depositCents: depositCentsFor(service),
    status: input.status,
    transcript: [
      transcript(input.issue, "user"),
      transcript(
        `Booked ${service.name} for ${input.slot.label}. Deposit ${depositCentsFor(service) / 100} dollars.`,
        "assistant",
      ),
    ],
    techNote: input.techNote,
    createdAt,
    updatedAt: createdAt,
  };
  if (input.status === "deposit_pending" || input.status === "deposit_paid" || input.status === "completed" || input.status === "invoiced" || input.status === "paid") {
    job.paypalOrderId = `SAMPLE-${job.id}`;
    job.orderVia = "mock";
  }
  if (input.status === "deposit_paid" || input.status === "completed" || input.status === "invoiced" || input.status === "paid") {
    job.paypalCaptureId = `SAMPLE-CAP-${job.id}`;
  }
  if ((input.status === "invoiced" || input.status === "paid") && input.techNote) {
    const priced = priceLines(linesFromNote(input.techNote), job.depositCents, getPriceBookItem);
    job.lines = priced.lines;
    job.invoiceSubtotalCents = priced.subtotalCents;
    job.depositCreditCents = priced.depositCreditCents;
    job.invoiceTotalCents = priced.totalCents;
    job.invoiceId = `INV2-SAMPLE-${job.id.slice(-6).toUpperCase()}`;
    job.invoiceVia = "mock";
  }
  return job;
}

export function createSeed(now = new Date()): StoreData {
  const slots = generateSlots(now);
  const reservedTuesday = slots.find((slot) => slot.available && slot.weekday === "Tue" && slot.hour === 9);
  const drain = takeSlot(slots, (slot) => slot.id !== reservedTuesday?.id && slot.hour === 11);
  const ac = takeSlot(slots, (slot) => slot.id !== reservedTuesday?.id && slot.hour === 13);
  const heater = takeSlot(slots, (slot) => slot.id !== reservedTuesday?.id && slot.hour === 15);
  const faucet = takeSlot(slots, (slot) => slot.id !== reservedTuesday?.id && slot.hour === 8);
  const buyer = sandboxBuyerEmail() || "buyer@example.com";
  const jobs: Job[] = [
    sampleJob({
      slot: drain,
      name: "Luis Ortega",
      phone: "619-555-0172",
      email: buyer,
      address: "3758 Newton Ave, San Diego, CA 92113",
      issue: "Kitchen drain is backing up into the sink.",
      serviceCode: "drain-clear",
      status: "deposit_pending",
      ageHours: 5,
    }),
    sampleJob({
      slot: ac,
      name: "Helen Cho",
      phone: "619-555-0164",
      email: "helen@example.com",
      address: "1844 Granada Ave, San Diego, CA 92102",
      issue: "Upstairs AC is running but the house will not cool.",
      serviceCode: "ac-diagnostic",
      status: "deposit_paid",
      ageHours: 30,
    }),
    sampleJob({
      slot: heater,
      name: "Marcus Hale",
      phone: "619-555-0133",
      email: "marcus@example.com",
      address: "5021 Newport Ave, San Diego, CA 92107",
      issue: "Water heater was rumbling and the hot water went lukewarm.",
      serviceCode: "wh-flush",
      status: "invoiced",
      techNote: "Flushed tank, replaced anode rod, 1.5 hr",
      ageHours: 50,
    }),
    sampleJob({
      slot: faucet,
      name: "Priya Raman",
      phone: "858-555-0194",
      email: "priya@example.com",
      address: "6123 Balboa Ave, San Diego, CA 92111",
      issue: "Hall bath faucet drips after shutoff.",
      serviceCode: "faucet",
      status: "paid",
      techNote: "Replaced the faucet cartridge.",
      ageHours: 80,
    }),
  ];
  return {
    slots,
    jobs,
    processedEventIds: [],
    seededAt: now.toISOString(),
  };
}

async function redisCommand(command: unknown[]): Promise<unknown> {
  const redis = redisConfig();
  if (!redis) throw new AppError(500, "Redis is not configured.");
  const response = await fetch(redis.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${redis.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new AppError(502, `Redis responded ${response.status}. Check the Upstash URL and token.`);
  }
  const body = (await response.json()) as { result?: unknown; error?: string };
  if (body.error) throw new AppError(502, "Redis rejected the store command.");
  return body.result;
}

async function readRaw(): Promise<StoreData | null> {
  const backend = storeBackend();
  if (backend === "upstash") {
    const result = await redisCommand(["GET", REDIS_KEY]);
    if (typeof result !== "string" || result.length === 0) return null;
    return JSON.parse(result) as StoreData;
  }
  if (backend === "redis") {
    const result = await tcpGet(REDIS_KEY);
    if (!result) return null;
    try {
      return JSON.parse(result) as StoreData;
    } catch {
      throw new AppError(500, "The Redis store value is not valid JSON.");
    }
  }
  try {
    const text = await readFile(storeFile(), "utf8");
    return JSON.parse(text) as StoreData;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeRaw(data: StoreData): Promise<void> {
  const backend = storeBackend();
  if (backend === "upstash") {
    await redisCommand(["SET", REDIS_KEY, JSON.stringify(data)]);
    return;
  }
  if (backend === "redis") {
    await tcpSet(REDIS_KEY, JSON.stringify(data));
    return;
  }
  const file = storeFile();
  try {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2));
    await rename(tmp, file);
  } catch {
    throw new AppError(
      500,
      "This server cannot store jobs on disk. On Vercel, set REDIS_URL from the Redis store, or set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.",
    );
  }
}

let queue: Promise<void> = Promise.resolve();

export async function updateStore<T>(mutator: (draft: StoreData) => T | Promise<T>): Promise<T> {
  let result!: T;
  let failure: unknown;
  const run = queue.then(async () => {
    try {
      let draft = await readRaw();
      if (!draft) {
        draft = createSeed();
        await writeRaw(draft);
      }
      result = await mutator(draft);
      await writeRaw(draft);
    } catch (error) {
      failure = error;
    }
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  await run;
  if (failure) throw failure;
  return result;
}

export async function readStore(): Promise<StoreData> {
  return updateStore((draft) => draft);
}

export async function resetStore(): Promise<StoreData> {
  const seed = createSeed();
  return updateStore((draft) => {
    draft.slots = seed.slots;
    draft.jobs = seed.jobs;
    draft.processedEventIds = [];
    draft.seededAt = seed.seededAt;
    return draft;
  });
}

export function payPath(jobId: string): string {
  return `${appBaseUrl()}/pay/${jobId}`;
}
