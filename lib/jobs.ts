import { advanceStatus, depositCentsFor, formatUsd } from "@/lib/money";
import { getPaypalGateway } from "@/lib/paypal";
import { getPriceBookItem, matchService, requirePriceBookItem } from "@/lib/price-book";
import { matchSlot, slotsForModel } from "@/lib/slots";
import { createId, payPath, readStore, updateStore } from "@/lib/store";
import { AppError, type Job, type PayJobView, type TranscriptEntry } from "@/lib/types";

export type Quote = {
  serviceCode: string;
  serviceName: string;
  summary: string;
  quoteCents: number;
  depositCents: number;
  quote: string;
  deposit: string;
};

export function quoteIssue(issue: string, serviceCode?: string): Quote {
  const item = serviceCode ? getPriceBookItem(serviceCode) : matchService(issue);
  if (!item || !item.bookable) {
    throw new AppError(400, "Pick a bookable service from the price book.");
  }
  const depositCents = depositCentsFor(item);
  return {
    serviceCode: item.code,
    serviceName: item.name,
    summary: item.summary,
    quoteCents: item.priceCents,
    depositCents,
    quote: formatUsd(item.priceCents),
    deposit: formatUsd(depositCents),
  };
}

export async function listOpenSlots() {
  const data = await readStore();
  return slotsForModel(data.slots);
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) {
    throw new AppError(400, "Phone needs a real 10-digit number so the pay link has somewhere to go.");
  }
  return phone.trim();
}

export async function bookJob(input: {
  customerName: string;
  phone: string;
  email: string;
  address: string;
  issue: string;
  serviceCode: string;
  slotId: string;
  transcript?: TranscriptEntry[];
}): Promise<Job> {
  const name = input.customerName.trim();
  const email = input.email.trim().toLowerCase();
  const address = input.address.trim();
  const issue = input.issue.trim();
  if (name.length < 2) throw new AppError(400, "Customer name is missing.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError(400, "A real email is required for the PayPal invoice.");
  if (address.length < 6) throw new AppError(400, "Service address is missing.");
  if (issue.length < 3) throw new AppError(400, "Describe the issue.");
  const phone = normalizePhone(input.phone);
  const service = requirePriceBookItem(input.serviceCode);
  if (!service.bookable) throw new AppError(400, "That price-book item is billed after the visit, not booked on the phone.");

  return updateStore((draft) => {
    const slot = matchSlot(draft.slots, input.slotId);
    if (!slot) {
      const open = slotsForModel(draft.slots)
        .slice(0, 4)
        .map((item) => `${item.id} (${item.label})`)
        .join("; ");
      throw new AppError(409, `No slot matches "${input.slotId}". Open slots: ${open}`);
    }
    const existing = draft.jobs.find(
      (job) =>
        job.email === email &&
        job.slotId === slot.id &&
        (job.status === "booked" || job.status === "deposit_pending"),
    );
    if (existing) return existing;
    if (!slot.available) throw new AppError(409, "That slot was just taken. Offer another open slot.");
    slot.available = false;
    const now = new Date().toISOString();
    const job: Job = {
      id: createId("job"),
      customerName: name,
      phone,
      email,
      address,
      issue,
      serviceCode: service.code,
      serviceName: service.name,
      slotId: slot.id,
      slotLabel: slot.label,
      quoteCents: service.priceCents,
      depositCents: depositCentsFor(service),
      status: "booked",
      transcript: input.transcript ?? [],
      createdAt: now,
      updatedAt: now,
    };
    draft.jobs.unshift(job);
    return job;
  });
}

export async function createDepositForJob(jobId: string): Promise<{
  jobId: string;
  orderId: string;
  payUrl: string;
  deposit: string;
  via: string;
  smsText: string;
  alreadyCreated: boolean;
}> {
  const gateway = getPaypalGateway();
  const job = await updateStore((draft) => {
    const found = draft.jobs.find((item) => item.id === jobId);
    if (!found) throw new AppError(404, "Job not found.");
    return found;
  });
  if (job.paypalOrderId && job.status !== "booked" && job.status !== "new") {
    return depositPayload(job, true);
  }
  const order = await gateway.createDepositOrder({
    jobId: job.id,
    amountCents: job.depositCents,
    description: `${job.serviceName} deposit for ${job.customerName}`,
  });
  const saved = await updateStore((draft) => {
    const found = draft.jobs.find((item) => item.id === jobId);
    if (!found) throw new AppError(404, "Job not found.");
    if (!found.paypalOrderId) {
      found.paypalOrderId = order.id;
      found.orderVia = order.via;
      found.status = advanceStatus(found.status, "deposit_pending");
      found.updatedAt = new Date().toISOString();
    }
    return found;
  });
  return depositPayload(saved, false);
}

function depositPayload(job: Job, alreadyCreated: boolean) {
  const payUrl = payPath(job.id);
  const first = job.customerName.split(" ")[0];
  return {
    jobId: job.id,
    orderId: job.paypalOrderId || "",
    payUrl,
    deposit: formatUsd(job.depositCents),
    via: job.orderVia || "mock",
    alreadyCreated,
    smsText: `Coastline Heating & Plumbing: Hi ${first}, your ${job.slotLabel} visit is held. Deposit ${formatUsd(job.depositCents)}: ${payUrl}`,
  };
}

export async function captureJobDeposit(jobId: string, orderId: string): Promise<Job> {
  const gateway = getPaypalGateway();
  const job = await updateStore((draft) => {
    const found = draft.jobs.find((item) => item.id === jobId);
    if (!found) throw new AppError(404, "Job not found.");
    return { ...found };
  });
  if (job.paypalOrderId && orderId && job.paypalOrderId !== orderId) {
    throw new AppError(409, "That PayPal order does not belong to this job.");
  }
  if (job.status === "deposit_paid" || job.status === "completed" || job.status === "invoiced" || job.status === "paid") {
    return job;
  }
  if (job.orderVia === "mock" && gateway.mode === "sandbox") {
    throw new AppError(409, "This row is sample data. Book a new visit with Marge to take a live sandbox payment.");
  }
  const target = job.paypalOrderId || orderId;
  if (!target) throw new AppError(409, "This job has no PayPal order yet.");
  const capture = await gateway.captureOrder(target);
  if (capture.status !== "COMPLETED") {
    throw new AppError(402, `PayPal capture status is ${capture.status}.`);
  }
  return updateStore((draft) => {
    const found = draft.jobs.find((item) => item.id === jobId);
    if (!found) throw new AppError(404, "Job not found.");
    found.paypalCaptureId = capture.captureId || found.paypalCaptureId;
    found.status = advanceStatus(found.status, "deposit_paid");
    found.updatedAt = new Date().toISOString();
    return found;
  });
}

export async function getJob(jobId: string): Promise<Job | undefined> {
  return updateStore((draft) => draft.jobs.find((job) => job.id === jobId));
}

export function toPayView(job: Job, mockPayments: boolean): PayJobView {
  return {
    id: job.id,
    customerName: job.customerName,
    serviceName: job.serviceName,
    slotLabel: job.slotLabel,
    address: job.address,
    depositCents: job.depositCents,
    quoteCents: job.quoteCents,
    status: job.status,
    orderVia: job.orderVia,
    paypalOrderId: job.paypalOrderId,
    mockPayments,
  };
}

export async function appendTranscript(jobId: string, entries: TranscriptEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await updateStore((draft) => {
    const job = draft.jobs.find((item) => item.id === jobId);
    if (!job) return;
    job.transcript = entries.slice(-40);
    job.updatedAt = new Date().toISOString();
  });
}
