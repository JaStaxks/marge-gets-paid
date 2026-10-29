import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";

import { geminiLanguageModel, geminiReady } from "@/lib/gemini";
import { bookJob, createDepositForJob, listOpenSlots, quoteIssue } from "@/lib/jobs";
import { formatUsd } from "@/lib/money";
import { priceBookForPrompt } from "@/lib/price-book";
import { runScriptedTurn } from "@/lib/scripted";
import { SHOP } from "@/lib/shop";
import { AppError } from "@/lib/types";
import { transcriptFromModel } from "@/lib/transcript";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = [
  `You are ${SHOP.receptionist}, the front-desk receptionist at ${SHOP.name} in ${SHOP.city}.`,
  "You book HVAC and plumbing visits. You sound like a calm dispatcher: short, specific, and warm.",
  "Collect the customer name, mobile phone, email, service address, what is wrong, and one open slot.",
  "Always call quote_service before you say a price. Always call list_open_slots before you offer times.",
  "Never invent prices, deposits, or slots. Repeat only the numbers and slot labels the tools return.",
  "The deposit is calculated by the server. Do not propose a different deposit.",
  "After the customer confirms a slot, call book_job, then create_deposit_order with that jobId only.",
  "create_deposit_order talks to PayPal. Tell the customer you texted the link. Do not ask them to pay some other way.",
  "If a tool returns an error, say what went wrong and ask for a fix. Do not pretend the job is booked.",
  `Shop phone ${SHOP.phone}. Address ${SHOP.address}. Hours ${SHOP.hours}.`,
  "Price book codes:",
  priceBookForPrompt(),
].join("\n");

async function guard<T>(run: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    console.error("[marge] tool", error instanceof Error ? error.message : "error");
    return { error: "That step failed. Ask the customer to try again." };
  }
}

function margeTools() {
  return {
    list_open_slots: tool({
      description: "List open Coastline appointment slots. Book with the returned slot id.",
      inputSchema: z.object({}),
      execute: async () => guard(async () => ({ slots: await listOpenSlots() })),
    }),
    quote_service: tool({
      description: "Look up a bookable service. The server returns the only price and deposit you may quote.",
      inputSchema: z.object({
        issue: z.string().describe("The customer's problem in their words."),
        serviceCode: z.string().optional().describe("Price book code, if you already know it."),
      }),
      execute: async ({ issue, serviceCode }) => guard(async () => quoteIssue(issue, serviceCode)),
    }),
    book_job: tool({
      description: "Book the visit after the customer confirms a slot. Do not pass a price.",
      inputSchema: z.object({
        customerName: z.string(),
        phone: z.string(),
        email: z.string(),
        address: z.string(),
        issue: z.string(),
        serviceCode: z.string(),
        slotId: z.string(),
      }),
      execute: async (input, options) =>
        guard(async () => {
          const job = await bookJob({
            ...input,
            transcript: transcriptFromModel(options.messages),
          });
          return {
            jobId: job.id,
            status: job.status,
            slotLabel: job.slotLabel,
            quote: formatUsd(job.quoteCents),
            deposit: formatUsd(job.depositCents),
          };
        }),
    }),
    create_deposit_order: tool({
      description:
        "Create the PayPal or Venmo deposit order for a booked job. Pass only jobId. The amount and custom_id are set in code.",
      inputSchema: z.object({
        jobId: z.string(),
      }),
      execute: async ({ jobId }) => guard(() => createDepositForJob(jobId)),
    }),
  };
}

export async function POST(req: Request) {
  let messages: UIMessage[];
  try {
    const body = (await req.json()) as { messages?: UIMessage[] };
    if (!Array.isArray(body.messages)) {
      return Response.json({ error: "Expected a messages array." }, { status: 400 });
    }
    messages = body.messages;
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }

  if (!geminiReady()) {
    try {
      const turn = await runScriptedTurn(messages);
      const stream = createUIMessageStream({
        execute: ({ writer }) => {
          writer.write({ type: "start" });
          writer.write({ type: "start-step" });
          writer.write({ type: "text-start", id: "marge" });
          writer.write({ type: "text-delta", id: "marge", delta: turn.text });
          writer.write({ type: "text-end", id: "marge" });
          turn.tools.forEach((call, index) => {
            const toolCallId = `scripted-${call.name}-${index}`;
            writer.write({
              type: "tool-input-available",
              toolCallId,
              toolName: call.name,
              input: call.input ?? {},
            });
            writer.write({
              type: "tool-output-available",
              toolCallId,
              output: call.output ?? {},
            });
          });
          writer.write({ type: "finish-step" });
          writer.write({ type: "finish", finishReason: "stop" });
        },
      });
      return createUIMessageStreamResponse({ stream });
    } catch (error) {
      console.error("[marge] scripted", error instanceof Error ? error.message : "error");
      return Response.json({ error: "Marge could not book that. Try again." }, { status: 500 });
    }
  }

  try {
    const result = streamText({
      model: geminiLanguageModel(),
      system: SYSTEM,
      messages: await convertToModelMessages(messages),
      tools: margeTools(),
      stopWhen: stepCountIs(8),
    });
    return result.toUIMessageStreamResponse({
      onError: (error) => {
        console.error("[marge] chat", error instanceof Error ? error.message : "error");
        return "Marge lost the model for a moment. Send that again.";
      },
    });
  } catch (error) {
    console.error("[marge] chat setup", error instanceof Error ? error.message : "error");
    return Response.json({ error: "Marge could not reach the model." }, { status: 500 });
  }
}
