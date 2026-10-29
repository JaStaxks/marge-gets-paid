import { AppError, type DepositRule, type InvoiceLine, type PriceBookItem } from "@/lib/types";

export function centsToUsd(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function depositCentsFor(item: PriceBookItem): number {
  return applyDepositRule(item.deposit, item.priceCents);
}

export function applyDepositRule(rule: DepositRule, amountCents: number): number {
  if (rule.type === "flat") return rule.cents;
  if (rule.type === "percent") return Math.round((amountCents * rule.bps) / 10_000);
  return 0;
}

export type LineRequest = {
  code: string;
  quantity: number;
};

export function priceLines(
  requests: LineRequest[],
  depositCreditCents: number,
  lookup: (code: string) => PriceBookItem | undefined,
): {
  lines: InvoiceLine[];
  subtotalCents: number;
  depositCreditCents: number;
  totalCents: number;
} {
  if (requests.length === 0) {
    throw new AppError(400, "Add at least one price-book line.");
  }

  const lines: InvoiceLine[] = requests.map((request) => {
    const item = lookup(request.code);
    if (!item) {
      throw new AppError(400, `Unknown price book code: ${request.code}`);
    }
    if (!Number.isFinite(request.quantity) || request.quantity <= 0 || request.quantity > 24) {
      throw new AppError(400, `Quantity for ${request.code} must be between 0 and 24.`);
    }
    const quantity = Math.round(request.quantity * 100) / 100;
    const amountCents = Math.round(item.priceCents * quantity);
    return {
      code: item.code,
      name: item.name,
      quantity,
      unitCents: item.priceCents,
      amountCents,
      discountCents: 0,
      unit: item.unit,
    };
  });

  const subtotalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  let remaining = Math.max(0, Math.min(depositCreditCents, subtotalCents));
  const creditApplied = remaining;
  for (const line of lines) {
    if (remaining <= 0) break;
    const discount = Math.min(remaining, line.amountCents);
    line.discountCents = discount;
    remaining -= discount;
  }
  const totalCents = subtotalCents - creditApplied;
  return {
    lines,
    subtotalCents,
    depositCreditCents: creditApplied,
    totalCents,
  };
}

const STATUS_RANK = {
  new: 0,
  booked: 1,
  deposit_pending: 2,
  deposit_paid: 3,
  completed: 4,
  invoiced: 5,
  paid: 6,
  cancelled: -1,
} as const;

export function advanceStatus<T extends keyof typeof STATUS_RANK>(current: T, next: T): T {
  if (next === "cancelled") {
    if (current === "paid" || current === "invoiced") return current;
    return next;
  }
  if (current === "cancelled") return current;
  if (STATUS_RANK[next] < STATUS_RANK[current]) return current;
  return next;
}

export function splitName(full: string): { given_name: string; surname: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { given_name: "Customer", surname: "Customer" };
  if (parts.length === 1) return { given_name: parts[0], surname: "Customer" };
  return { given_name: parts[0], surname: parts.slice(1).join(" ") };
}

export function formatQuantity(quantity: number): string {
  const rounded = Math.round(quantity * 100) / 100;
  return String(rounded);
}
