export type JobStatus =
  | "new"
  | "booked"
  | "deposit_pending"
  | "deposit_paid"
  | "completed"
  | "invoiced"
  | "paid"
  | "cancelled";

export type PaymentVia = "agent-toolkit" | "rest" | "mock";

export type DepositRule =
  | { type: "flat"; cents: number }
  | { type: "percent"; bps: number }
  | { type: "none" };

export type PriceBookItem = {
  code: string;
  name: string;
  summary: string;
  priceCents: number;
  deposit: DepositRule;
  unit: "QUANTITY" | "HOURS";
  bookable: boolean;
};

export type Slot = {
  id: string;
  startsAt: string;
  label: string;
  weekday: string;
  hour: number;
  available: boolean;
};

export type TranscriptEntry = {
  role: "user" | "assistant";
  text: string;
  at: string;
};

export type InvoiceLine = {
  code: string;
  name: string;
  quantity: number;
  unitCents: number;
  amountCents: number;
  discountCents: number;
  unit: "QUANTITY" | "HOURS";
};

export type Job = {
  id: string;
  customerName: string;
  phone: string;
  email: string;
  address: string;
  issue: string;
  serviceCode: string;
  serviceName: string;
  slotId: string;
  slotLabel: string;
  quoteCents: number;
  depositCents: number;
  status: JobStatus;
  paypalOrderId?: string;
  paypalCaptureId?: string;
  orderVia?: PaymentVia;
  invoiceId?: string;
  invoiceUrl?: string;
  invoiceVia?: PaymentVia;
  invoiceSubtotalCents?: number;
  invoiceTotalCents?: number;
  depositCreditCents?: number;
  lines?: InvoiceLine[];
  techNote?: string;
  transcript: TranscriptEntry[];
  createdAt: string;
  updatedAt: string;
};

export type StoreData = {
  slots: Slot[];
  jobs: Job[];
  processedEventIds: string[];
  seededAt: string;
};

export type PayJobView = {
  id: string;
  customerName: string;
  serviceName: string;
  slotLabel: string;
  address: string;
  depositCents: number;
  quoteCents: number;
  status: JobStatus;
  orderVia?: PaymentVia;
  paypalOrderId?: string;
  mockPayments: boolean;
};

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}
