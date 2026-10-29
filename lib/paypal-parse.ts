export type ParsedPaypal = {
  id?: string;
  status?: string;
  href?: string;
  captureId?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function findHref(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const metadata = asRecord(record.metadata);
  const detail = asRecord(record.detail);
  const detailMeta = detail ? asRecord(detail.metadata) : null;
  const candidates = [
    metadata?.recipient_view_url,
    detailMeta?.recipient_view_url,
    record.recipient_view_url,
    record.href,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.startsWith("http")) return candidate;
  }
  const links = record.links;
  if (Array.isArray(links)) {
    for (const link of links) {
      const href = asRecord(link)?.href;
      const rel = asRecord(link)?.rel;
      if (typeof href === "string" && (rel === "payer-view" || href.includes("/invoice/"))) return href;
    }
    for (const link of links) {
      const href = asRecord(link)?.href;
      if (typeof href === "string" && href.includes("paypal.com") && !href.includes("/v2/invoicing/")) {
        return href;
      }
    }
  }
  return undefined;
}

export function parsePaypalBody(raw: unknown): ParsedPaypal {
  let value = raw;
  if (typeof raw === "string") {
    const invoiceMatch = raw.match(/INV2-[A-Z0-9-]+/);
    const orderMatch = raw.match(/\b[A-Z0-9]{17}\b/);
    try {
      value = JSON.parse(raw);
    } catch {
      return { id: invoiceMatch?.[0] || orderMatch?.[0] };
    }
  }
  const record = asRecord(value);
  if (!record) return {};
  const nested = asRecord(record.invoice) || asRecord(record.result) || asRecord(record.data);
  const id =
    (typeof record.id === "string" && record.id) ||
    (typeof record.invoice_id === "string" && record.invoice_id) ||
    (nested && typeof nested.id === "string" ? nested.id : undefined) ||
    undefined;
  const status = typeof record.status === "string" ? record.status : undefined;
  const href = findHref(record) || (nested ? findHref(nested) : undefined);
  const captureId = findCaptureId(record);
  return { id, status, href, captureId };
}

export function findCaptureId(order: unknown): string | undefined {
  const record = asRecord(order);
  const units = record?.purchase_units;
  if (!Array.isArray(units)) return undefined;
  for (const unit of units) {
    const payments = asRecord(asRecord(unit)?.payments);
    const captures = payments?.captures;
    if (!Array.isArray(captures)) continue;
    for (const capture of captures) {
      const id = asRecord(capture)?.id;
      if (typeof id === "string") return id;
    }
  }
  return undefined;
}

export function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/\bA21[A-Za-z0-9._-]{20,}\b/g, "[redacted]").slice(0, 400);
}
