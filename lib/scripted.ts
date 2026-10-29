import type { UIMessage } from "ai";

import { formatUsd } from "@/lib/money";
import { appendTranscript, bookJob, createDepositForJob, listOpenSlots, quoteIssue } from "@/lib/jobs";
import { matchService } from "@/lib/price-book";
import { SHOP } from "@/lib/shop";
import { readStore } from "@/lib/store";
import { userText } from "@/lib/transcript";
import type { TranscriptEntry } from "@/lib/types";

export type ScriptedTool = {
  name: string;
  input: unknown;
  output: unknown;
};

const WEEKDAYS: Record<string, string> = {
  sunday: "Sun",
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  sun: "Sun",
  mon: "Mon",
  tue: "Tue",
  tues: "Tue",
  wed: "Wed",
  thu: "Thu",
  thur: "Thu",
  thurs: "Thu",
  fri: "Fri",
};

function priorDeposit(messages: UIMessage[]): Record<string, unknown> | null {
  for (const message of messages) {
    for (const part of message.parts) {
      if (
        part.type === "tool-create_deposit_order" &&
        "state" in part &&
        part.state === "output-available" &&
        part.output &&
        typeof part.output === "object"
      ) {
        return part.output as Record<string, unknown>;
      }
    }
  }
  return null;
}

function field(text: string): {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  weekday?: string;
  hour?: number;
} {
  const nameMatch = text.match(/(?:i'm|i am|my name is|this is)\s+([A-Za-z]+(?:\s+[A-Za-z]+){0,2})/i);
  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const phoneMatch = text.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/);
  const addressMatch = text.match(
    /\d{2,6}\s+[A-Za-z0-9.'#\-\s]{2,48}?\s(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Way|Ct|Court|Ln|Lane|Pl|Place)\b\.?/i,
  );
  let weekday: string | undefined;
  const lower = text.toLowerCase();
  for (const [alias, short] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${alias}\\b`).test(lower)) weekday = short;
  }
  const timeMatch = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  let hour: number | undefined;
  if (timeMatch) {
    hour = Number(timeMatch[1]);
    if (timeMatch[3] === "pm" && hour < 12) hour += 12;
    if (timeMatch[3] === "am" && hour === 12) hour = 0;
  }
  return {
    name: nameMatch?.[1]?.trim(),
    phone: phoneMatch?.[0],
    email: emailMatch?.[0],
    address: addressMatch?.[0]?.replace(/\.$/, ""),
    weekday,
    hour,
  };
}

export async function runScriptedTurn(messages: UIMessage[]): Promise<{ text: string; tools: ScriptedTool[] }> {
  const previous = priorDeposit(messages);
  if (previous && typeof previous.smsText === "string") {
    return {
      text: "You're already on the board. The deposit link in that text is the one to use.",
      tools: [],
    };
  }

  const text = userText(messages).trim();
  const slots = await listOpenSlots();
  const store = await readStore();
  const open = store.slots.filter((slot) => slot.available);
  if (!text) {
    return {
      text: `Coastline dispatch. Tell me the trouble, your name, mobile, email, and address, and which opening works. I have ${slots[0]?.label ?? "a few openings"} and others this week.`,
      tools: [],
    };
  }

  const parsed = field(text);
  const service = matchService(text);
  const quote = quoteIssue(text, service.code);
  const slot = open.find((item) => {
    const weekdayOk = !parsed.weekday || item.weekday === parsed.weekday;
    const hourOk = parsed.hour === undefined || item.hour === parsed.hour;
    return weekdayOk && hourOk && (parsed.weekday || parsed.hour !== undefined);
  });

  const missing: string[] = [];
  if (!parsed.name) missing.push("your name");
  if (!parsed.phone) missing.push("a mobile number");
  if (!parsed.email) missing.push("an email for the invoice");
  if (!parsed.address) missing.push("the service address");
  if (!slot) missing.push("a time (for example Tuesday at 9am)");

  const slotPreview = slots
    .slice(0, 4)
    .map((item) => item.label)
    .join(", ");

  if (missing.length > 0 || !slot || !parsed.name || !parsed.phone || !parsed.email || !parsed.address) {
    return {
      text: `${quote.serviceName} is ${quote.quote}, and the deposit to hold the truck is ${quote.deposit}. I still need ${missing.join(", ")}. Openings: ${slotPreview}.`,
      tools: [
        {
          name: "quote_service",
          input: { issue: text.slice(0, 180) },
          output: quote,
        },
      ],
    };
  }

  const transcript: TranscriptEntry[] = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role as "user" | "assistant",
      text: message.parts
        .filter((part) => part.type === "text")
        .map((part) => ("text" in part ? part.text : ""))
        .join("\n"),
      at: new Date().toISOString(),
    }))
    .filter((entry) => entry.text.trim().length > 0);

  const job = await bookJob({
    customerName: parsed.name,
    phone: parsed.phone,
    email: parsed.email,
    address: parsed.address,
    issue: text.slice(0, 280),
    serviceCode: service.code,
    slotId: slot.id,
    transcript,
  });
  const deposit = await createDepositForJob(job.id);
  await appendTranscript(job.id, [
    ...transcript,
    { role: "assistant", text: deposit.smsText, at: new Date().toISOString() },
  ]);

  return {
    text: `You're booked, ${parsed.name.split(" ")[0]}. ${job.serviceName} is ${formatUsd(job.quoteCents)}. I held ${job.slotLabel} with a ${formatUsd(job.depositCents)} deposit. I texted the PayPal link to ${job.phone}. ${SHOP.name} will see it on the board once it clears.`,
    tools: [
      { name: "quote_service", input: { issue: text.slice(0, 180), serviceCode: service.code }, output: quote },
      { name: "book_job", input: { jobId: job.id, slotId: slot.id }, output: { jobId: job.id, status: "booked" } },
      { name: "create_deposit_order", input: { jobId: job.id }, output: deposit },
    ],
  };
}
