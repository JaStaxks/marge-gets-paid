import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

import { geminiLanguageModel, geminiReady } from "@/lib/gemini";
import { advanceStatus, formatUsd, priceLines, type LineRequest } from "@/lib/money";
import { getPaypalGateway } from "@/lib/paypal";
import { getPriceBookItem, linesFromNote, priceBookForPrompt } from "@/lib/price-book";
import { SHOP } from "@/lib/shop";
import { updateStore } from "@/lib/store";
import { AppError, type Job } from "@/lib/types";

async function loadJob(jobId: string): Promise<Job> {
  const job = await updateStore((draft) => draft.jobs.find((item) => item.id === jobId));
  if (!job) throw new AppError(404, "Job not found.");
  return job;
}

async function createPaypalInvoice(job: Job, requests: LineRequest[]): Promise<Job> {
  const priced = priceLines(requests, job.depositCents, getPriceBookItem);
  const gateway = getPaypalGateway();
  const note = `Deposit of ${formatUsd(priced.depositCreditCents)} already collected and credited. ${SHOP.name}.`;
  const created = await gateway.createInvoice({
    jobId: job.id,
    recipientName: job.customerName,
    recipientEmail: job.email,
    note,
    lines: priced.lines,
  });
  return updateStore((draft) => {
    const found = draft.jobs.find((item) => item.id === job.id);
    if (!found) throw new AppError(404, "Job not found.");
    if (!found.invoiceId) {
      found.invoiceId = created.id;
      found.invoiceVia = created.via;
      found.invoiceUrl = created.href;
      found.lines = priced.lines;
      found.invoiceSubtotalCents = priced.subtotalCents;
      found.depositCreditCents = priced.depositCreditCents;
      found.invoiceTotalCents = priced.totalCents;
      found.updatedAt = new Date().toISOString();
    }
    return found;
  });
}

async function sendPaypalInvoice(jobId: string): Promise<Job> {
  const job = await loadJob(jobId);
  if (!job.invoiceId) throw new AppError(409, "Create the invoice before sending it.");
  if (job.status === "invoiced" || job.status === "paid") return job;
  const gateway = getPaypalGateway();
  const sent = await gateway.sendInvoice(job.invoiceId);
  return updateStore((draft) => {
    const found = draft.jobs.find((item) => item.id === jobId);
    if (!found) throw new AppError(404, "Job not found.");
    found.invoiceVia = sent.via || found.invoiceVia;
    if (sent.href) found.invoiceUrl = sent.href;
    found.status = advanceStatus(found.status, "invoiced");
    found.updatedAt = new Date().toISOString();
    return found;
  });
}

async function invoiceWithLines(jobId: string, requests: LineRequest[]): Promise<Job> {
  const job = await loadJob(jobId);
  const drafted = job.invoiceId ? job : await createPaypalInvoice(job, requests);
  return sendPaypalInvoice(drafted.id);
}

export async function completeJob(jobId: string, techNote: string): Promise<Job> {
  const note = techNote.trim();
  if (note.length < 3) throw new AppError(400, "Enter what the technician actually did.");
  if (note.length > 2000) throw new AppError(400, "Keep the technician note under 2000 characters.");

  const current = await loadJob(jobId);
  if (current.status === "invoiced" || current.status === "paid") return current;
  if (current.status !== "deposit_paid" && current.status !== "completed") {
    throw new AppError(409, "Collect the deposit before invoicing the job.");
  }
  if (current.invoiceId && current.status === "completed") {
    return sendPaypalInvoice(current.id);
  }

  await updateStore((draft) => {
    const found = draft.jobs.find((item) => item.id === jobId);
    if (!found) throw new AppError(404, "Job not found.");
    found.techNote = note;
    found.status = advanceStatus(found.status, "completed");
    found.updatedAt = new Date().toISOString();
  });

  const pricedByModel: { items: LineRequest[] | null; sent: boolean } = { items: null, sent: false };
  if (geminiReady()) {
    try {
      await generateText({
        model: geminiLanguageModel(),
        system: [
          `You invoice completed jobs for ${SHOP.name}.`,
          "Choose only price-book codes. Never invent prices, discounts, or dollar amounts.",
          "Call propose_line_items, then create_invoice, then send_invoice.",
          "Labor hours belong on labor-hour. Parts and tasks use their own codes.",
          priceBookForPrompt(),
        ].join("\n"),
        prompt: `Job ${jobId}. Technician note: ${note}`,
        tools: {
          propose_line_items: tool({
            description: "Map a technician note to price-book codes and quantities. Do not include prices.",
            inputSchema: z.object({
              items: z
                .array(
                  z.object({
                    code: z.string(),
                    quantity: z.number().positive(),
                  }),
                )
                .min(1),
            }),
            execute: async ({ items }) => {
              const job = await loadJob(jobId);
              const priced = priceLines(items, job.depositCents, getPriceBookItem);
              pricedByModel.items = items;
              return {
                lines: priced.lines.map((line) => ({
                  code: line.code,
                  name: line.name,
                  quantity: line.quantity,
                  amount: formatUsd(line.amountCents),
                })),
                depositCredit: formatUsd(priced.depositCreditCents),
                balanceDue: formatUsd(priced.totalCents),
              };
            },
          }),
          create_invoice: tool({
            description: "Create the PayPal invoice from the server-priced lines. Do not pass amounts.",
            inputSchema: z.object({ jobId: z.string() }),
            execute: async () => {
              const chosen = pricedByModel.items;
              if (!chosen) return { error: "Call propose_line_items before create_invoice." };
              const job = await loadJob(jobId);
              const saved = job.invoiceId ? job : await createPaypalInvoice(job, chosen);
              return { invoiceId: saved.invoiceId, via: saved.invoiceVia, balanceDue: formatUsd(saved.invoiceTotalCents ?? 0) };
            },
          }),
          send_invoice: tool({
            description: "Send the PayPal invoice that create_invoice just created.",
            inputSchema: z.object({ jobId: z.string() }),
            execute: async () => {
              const saved = await sendPaypalInvoice(jobId);
              pricedByModel.sent = true;
              return { ok: true, invoiceId: saved.invoiceId, status: saved.status, via: saved.invoiceVia };
            },
          }),
        },
        stopWhen: stepCountIs(8),
      });
    } catch (error) {
      console.error("[marge] invoice model failed, using the price-book fallback", error instanceof Error ? error.message : "error");
    }
  }

  if (!pricedByModel.sent) {
    const chosen = pricedByModel.items;
    const requests = chosen && chosen.length > 0 ? chosen : linesFromNote(note);
    return invoiceWithLines(jobId, requests);
  }
  return loadJob(jobId);
}
