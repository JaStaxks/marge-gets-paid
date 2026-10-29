import { advanceStatus } from "@/lib/money";
import type { PaypalGateway } from "@/lib/paypal";
import { updateStore } from "@/lib/store";
import type { Job } from "@/lib/types";

type WebhookResult = {
  status: number;
  body: Record<string, unknown>;
};

const DEPOSIT_EVENTS = new Set([
  "CHECKOUT.ORDER.APPROVED",
  "CHECKOUT.ORDER.COMPLETED",
  "PAYMENT.CAPTURE.COMPLETED",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function eventId(event: Record<string, unknown>, headers: Record<string, string>): string {
  if (typeof event.id === "string" && event.id) return event.id;
  return headers["paypal-transmission-id"] || "";
}

function orderCustomId(resource: Record<string, unknown>): string | undefined {
  if (typeof resource.custom_id === "string") return resource.custom_id;
  const units = resource.purchase_units;
  if (!Array.isArray(units)) return undefined;
  for (const unit of units) {
    const customId = asRecord(unit)?.custom_id;
    if (typeof customId === "string") return customId;
  }
  return undefined;
}

function relatedOrderId(resource: Record<string, unknown>): string | undefined {
  const supplementary = asRecord(resource.supplementary_data);
  const related = supplementary ? asRecord(supplementary.related_ids) : null;
  const orderId = related?.order_id;
  return typeof orderId === "string" ? orderId : undefined;
}

function invoiceIdFrom(resource: Record<string, unknown>): string | undefined {
  if (typeof resource.id === "string" && resource.id.startsWith("INV")) return resource.id;
  const invoice = asRecord(resource.invoice);
  if (invoice && typeof invoice.id === "string") return invoice.id;
  return undefined;
}

function findJob(jobs: Job[], resource: Record<string, unknown>, eventType: string): Job | undefined {
  const customId = orderCustomId(resource);
  if (customId) {
    const byCustom = jobs.find((job) => job.id === customId);
    if (byCustom) return byCustom;
  }
  const orderId = eventType.startsWith("CHECKOUT.ORDER")
    ? (typeof resource.id === "string" ? resource.id : undefined)
    : relatedOrderId(resource);
  if (orderId) {
    const byOrder = jobs.find((job) => job.paypalOrderId === orderId);
    if (byOrder) return byOrder;
  }
  if (typeof resource.id === "string") {
    const byEither = jobs.find((job) => job.paypalOrderId === resource.id || job.invoiceId === resource.id);
    if (byEither) return byEither;
  }
  const invoiceId = invoiceIdFrom(resource);
  if (invoiceId) return jobs.find((job) => job.invoiceId === invoiceId);
  return undefined;
}

export async function handlePaypalWebhook(input: {
  event: unknown;
  headers: Record<string, string>;
  paypal: PaypalGateway;
}): Promise<WebhookResult> {
  const event = asRecord(input.event);
  if (!event || typeof event.event_type !== "string") {
    return { status: 400, body: { error: "Expected a PayPal webhook event." } };
  }
  const id = eventId(event, input.headers);
  if (!id) return { status: 400, body: { error: "Webhook event id is missing." } };

  let verified = false;
  try {
    verified = await input.paypal.verifyWebhook(input.headers, input.event);
  } catch {
    return { status: 502, body: { error: "Webhook verification could not be completed." } };
  }
  if (!verified) return { status: 401, body: { error: "Webhook signature was not verified." } };

  const eventType = event.event_type;
  const resource = asRecord(event.resource) ?? {};
  let duplicate = false;
  let matched = false;
  let status: string | undefined;

  await updateStore((draft) => {
    if (draft.processedEventIds.includes(id)) {
      duplicate = true;
      return;
    }
    draft.processedEventIds.push(id);
    const job = findJob(draft.jobs, resource, eventType);
    if (!job) return;
    matched = true;
    if (DEPOSIT_EVENTS.has(eventType)) {
      job.status = advanceStatus(job.status, "deposit_paid");
      const captureId = eventType === "PAYMENT.CAPTURE.COMPLETED" && typeof resource.id === "string" ? resource.id : undefined;
      if (captureId && !job.paypalCaptureId) job.paypalCaptureId = captureId;
      const orderId = typeof resource.id === "string" && eventType.startsWith("CHECKOUT.ORDER") ? resource.id : relatedOrderId(resource);
      if (orderId && !job.paypalOrderId) job.paypalOrderId = orderId;
    } else if (eventType === "INVOICING.INVOICE.PAID") {
      job.status = advanceStatus(job.status, "paid");
      const invoiceId = invoiceIdFrom(resource);
      if (invoiceId && !job.invoiceId) job.invoiceId = invoiceId;
    }
    job.updatedAt = new Date().toISOString();
    status = job.status;
  });

  return {
    status: 200,
    body: { ok: true, duplicate, matched, status: status ?? null, eventType },
  };
}
