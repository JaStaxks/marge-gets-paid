import { randomBytes } from "node:crypto";

import {
  appBaseUrl,
  forcePaypalMock,
  hasPaypalCredentials,
  paypalClientId,
  paypalClientSecret,
  paypalWebhookId,
} from "@/lib/env";
import { centsToUsd, formatQuantity, splitName } from "@/lib/money";
import { findCaptureId, parsePaypalBody, safeError, type ParsedPaypal } from "@/lib/paypal-parse";
import { SHOP } from "@/lib/shop";
import { AppError, type InvoiceLine, type PaymentVia } from "@/lib/types";

const SANDBOX = "https://api-m.sandbox.paypal.com";

export type OrderResult = {
  id: string;
  status: string;
  via: PaymentVia;
  approveUrl?: string;
};

export type CaptureResult = {
  orderId: string;
  status: string;
  captureId?: string;
  via: PaymentVia;
};

export type InvoiceResult = {
  id: string;
  status?: string;
  href?: string;
  via: PaymentVia;
};

export type PaypalGateway = {
  mode: "mock" | "sandbox";
  createDepositOrder(input: {
    jobId: string;
    amountCents: number;
    description: string;
  }): Promise<OrderResult>;
  captureOrder(orderId: string): Promise<CaptureResult>;
  createInvoice(input: {
    jobId: string;
    recipientName: string;
    recipientEmail: string;
    note: string;
    lines: InvoiceLine[];
  }): Promise<InvoiceResult>;
  sendInvoice(invoiceId: string): Promise<InvoiceResult>;
  verifyWebhook(headers: Record<string, string>, event: unknown): Promise<boolean>;
};

const mockOrders = new Map<string, { status: string; captureId?: string }>();

function mockGateway(): PaypalGateway {
  return {
    mode: "mock",
    async createDepositOrder(input) {
      const id = `MOCK-${randomBytes(4).toString("hex").toUpperCase()}`;
      mockOrders.set(id, { status: "CREATED" });
      return { id, status: "CREATED", via: "mock" };
    },
    async captureOrder(orderId) {
      const existing = mockOrders.get(orderId);
      const captureId = existing?.captureId || `MOCKCAP-${randomBytes(3).toString("hex").toUpperCase()}`;
      mockOrders.set(orderId, { status: "COMPLETED", captureId });
      return { orderId, status: "COMPLETED", captureId, via: "mock" };
    },
    async createInvoice() {
      const id = `INV2-MOCK-${randomBytes(3).toString("hex").toUpperCase()}`;
      return { id, status: "DRAFT", via: "mock" };
    },
    async sendInvoice(invoiceId) {
      return { id: invoiceId, status: "SENT", via: "mock" };
    },
    async verifyWebhook(headers) {
      const signature = headers["paypal-transmission-sig"] || "";
      return signature.length > 0 && signature !== "invalid";
    },
  };
}

let tokenCache: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) return tokenCache.value;
  const id = paypalClientId();
  const secret = paypalClientSecret();
  const response = await fetch(`${SANDBOX}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new AppError(502, `PayPal OAuth failed (${response.status}). Check the sandbox client id and secret.`);
  }
  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new AppError(502, "PayPal OAuth response did not include a token.");
  tokenCache = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 300) * 1000,
  };
  return body.access_token;
}

async function paypalFetch(pathname: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Content-Type", "application/json");
  return fetch(`${SANDBOX}${pathname}`, { ...init, headers, signal: AbortSignal.timeout(25_000) });
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      message?: string;
      name?: string;
      error?: string;
      details?: Array<{ issue?: string; description?: string }>;
    };
    const issue = body.details?.[0]?.issue;
    const description = body.details?.[0]?.description;
    return [body.name || body.error || body.message, issue, description].filter(Boolean).join(": ");
  } catch {
    return "";
  }
}

function toolkitInvoicePayload(input: {
  jobId: string;
  recipientName: string;
  recipientEmail: string;
  note: string;
  lines: InvoiceLine[];
}) {
  return {
    currency_code: "USD",
    reference: input.jobId,
    note: input.note,
    invoicer_business_name: SHOP.name,
    invoicer_address_line_1: "4120 Voltaire St",
    invoicer_city: "San Diego",
    invoicer_state: "CA",
    invoicer_postal_code: "92107",
    invoicer_country_code: "US",
    primary_recipients: [
      {
        billing_info: {
          business_name: input.recipientName,
          email_address: input.recipientEmail,
        },
      },
    ],
    items: input.lines.map((line) => ({
      name: line.name,
      description: line.discountCents > 0 ? "Deposit already paid is credited on this line." : line.name,
      quantity: formatQuantity(line.quantity),
      unit_amount: { currency_code: "USD", value: centsToUsd(line.unitCents) },
      unit_of_measure: line.unit,
      ...(line.discountCents > 0
        ? { discount: { amount: { currency_code: "USD", value: centsToUsd(line.discountCents) } } }
        : {}),
    })),
  };
}

type ToolkitTool = {
  execute?: (args: unknown, options: { toolCallId: string; messages: unknown[] }) => Promise<unknown>;
};

let toolkitPromise: Promise<Record<string, ToolkitTool>> | null = null;

async function toolkitTools(): Promise<Record<string, ToolkitTool>> {
  if (!toolkitPromise) {
    toolkitPromise = (async () => {
      const { PayPalAgentToolkit } = await import("@paypal/agent-toolkit/ai-sdk");
      const toolkit = new PayPalAgentToolkit({
        clientId: paypalClientId(),
        clientSecret: paypalClientSecret(),
        configuration: {
          context: { sandbox: true },
          actions: {
            orders: { create: true, get: true },
            invoices: { create: true, send: true, get: true },
          },
        },
      });
      return toolkit.getTools() as Record<string, ToolkitTool>;
    })();
  }
  return toolkitPromise;
}

async function callToolkit(name: string, args: Record<string, unknown>): Promise<ParsedPaypal> {
  const tools = await toolkitTools();
  const tool = tools[name];
  if (!tool?.execute) throw new Error(`Agent Toolkit has no ${name} tool`);
  const raw = await tool.execute(args, { toolCallId: `marge-${name}`, messages: [] });
  const parsed = parsePaypalBody(raw);
  if (!parsed.id) throw new Error(`Agent Toolkit ${name} did not return an id`);
  return parsed;
}

function restInvoiceBody(input: {
  jobId: string;
  recipientName: string;
  recipientEmail: string;
  note: string;
  lines: InvoiceLine[];
}) {
  const name = splitName(input.recipientName);
  return {
    detail: {
      currency_code: "USD",
      note: input.note,
      memo: `${SHOP.name}, San Diego`,
      reference: input.jobId,
      payment_term: { term_type: "DUE_ON_RECEIPT" },
    },
    invoicer: {
      business_name: SHOP.name,
      address: {
        address_line_1: "4120 Voltaire St",
        admin_area_2: "San Diego",
        admin_area_1: "CA",
        postal_code: "92107",
        country_code: "US",
      },
    },
    primary_recipients: [
      {
        billing_info: {
          name,
          email_address: input.recipientEmail,
        },
      },
    ],
    items: input.lines.map((line) => ({
      name: line.name,
      quantity: formatQuantity(line.quantity),
      unit_amount: { currency_code: "USD", value: centsToUsd(line.unitCents) },
      unit_of_measure: line.unit,
      ...(line.discountCents > 0
        ? { discount: { amount: { currency_code: "USD", value: centsToUsd(line.discountCents) } } }
        : {}),
    })),
  };
}

function realGateway(): PaypalGateway {
  return {
    mode: "sandbox",
    async createDepositOrder(input) {
      const base = appBaseUrl();
      const response = await paypalFetch("/v2/checkout/orders", {
        method: "POST",
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [
            {
              custom_id: input.jobId,
              description: input.description.slice(0, 127),
              amount: { currency_code: "USD", value: centsToUsd(input.amountCents) },
            },
          ],
          application_context: {
            brand_name: SHOP.name,
            shipping_preference: "NO_SHIPPING",
            user_action: "PAY_NOW",
            return_url: `${base}/pay/${input.jobId}`,
            cancel_url: `${base}/pay/${input.jobId}?cancelled=1`,
          },
        }),
      });
      if (!response.ok) {
        throw new AppError(502, `PayPal create order failed (${response.status} ${await readError(response)})`);
      }
      const body = parsePaypalBody(await response.json());
      if (!body.id) throw new AppError(502, "PayPal create order did not return an id.");
      return { id: body.id, status: body.status || "CREATED", via: "rest", approveUrl: body.href };
    },
    async captureOrder(orderId) {
      const response = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
        method: "POST",
        body: "{}",
      });
      if (response.status === 422) {
        const text = await response.clone().text();
        if (text.includes("ORDER_ALREADY_CAPTURED") || text.includes("ORDER_ALREADY_COMPLETED")) {
          const existing = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
          const body = parsePaypalBody(await existing.json());
          return {
            orderId,
            status: body.status || "COMPLETED",
            captureId: body.captureId || findCaptureId(body),
            via: "rest",
          };
        }
      }
      if (!response.ok) {
        throw new AppError(502, `PayPal capture failed (${response.status} ${await readError(response)})`);
      }
      const json = await response.json();
      const body = parsePaypalBody(json);
      return {
        orderId,
        status: body.status || "COMPLETED",
        captureId: findCaptureId(json) || body.captureId,
        via: "rest",
      };
    },
    async createInvoice(input) {
      try {
        const parsed = await callToolkit("create_invoice", toolkitInvoicePayload(input));
        return { id: parsed.id!, status: parsed.status || "DRAFT", href: parsed.href, via: "agent-toolkit" };
      } catch (error) {
        console.error(`[marge] agent toolkit create_invoice failed, using REST: ${safeError(error)}`);
      }
      const response = await paypalFetch("/v2/invoicing/invoices", {
        method: "POST",
        body: JSON.stringify(restInvoiceBody(input)),
      });
      if (!response.ok) {
        throw new AppError(502, `PayPal create invoice failed (${response.status} ${await readError(response)})`);
      }
      const body = parsePaypalBody(await response.json());
      if (!body.id) throw new AppError(502, "PayPal create invoice did not return an id.");
      return { id: body.id, status: body.status || "DRAFT", href: body.href, via: "rest" };
    },
    async sendInvoice(invoiceId) {
      try {
        const parsed = await callToolkit("send_invoice", {
          invoice_id: invoiceId,
          send_to_recipient: true,
          note: "Your Coastline deposit is already credited on this invoice.",
        });
        return { id: parsed.id || invoiceId, status: "SENT", href: parsed.href, via: "agent-toolkit" };
      } catch (error) {
        console.error(`[marge] agent toolkit send_invoice failed, using REST: ${safeError(error)}`);
      }
      const response = await paypalFetch(`/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/send`, {
        method: "POST",
        body: JSON.stringify({
          send_to_recipient: true,
          send_to_invoicer: false,
          note: "Your Coastline deposit is already credited on this invoice.",
        }),
      });
      if (!response.ok) {
        throw new AppError(502, `PayPal send invoice failed (${response.status} ${await readError(response)})`);
      }
      let href: string | undefined;
      try {
        const lookup = await paypalFetch(`/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`);
        if (lookup.ok) href = parsePaypalBody(await lookup.json()).href;
      } catch {
        href = undefined;
      }
      return { id: invoiceId, status: "SENT", href, via: "rest" };
    },
    async verifyWebhook(headers, event) {
      const webhookId = paypalWebhookId();
      if (!webhookId) return false;
      const response = await paypalFetch("/v1/notifications/verify-webhook-signature", {
        method: "POST",
        body: JSON.stringify({
          auth_algo: headers["paypal-auth-algo"],
          cert_url: headers["paypal-cert-url"],
          transmission_id: headers["paypal-transmission-id"],
          transmission_sig: headers["paypal-transmission-sig"],
          transmission_time: headers["paypal-transmission-time"],
          webhook_id: webhookId,
          webhook_event: event,
        }),
      });
      if (!response.ok) return false;
      const body = (await response.json()) as { verification_status?: string };
      return body.verification_status === "SUCCESS";
    },
  };
}

let testOverride: PaypalGateway | null = null;

export function setPaypalGatewayForTests(gateway: PaypalGateway | null): void {
  testOverride = gateway;
}

export function getPaypalGateway(): PaypalGateway {
  if (testOverride) return testOverride;
  if (forcePaypalMock() || !hasPaypalCredentials()) return mockGateway();
  return realGateway();
}

export function paymentsAreMock(): boolean {
  return getPaypalGateway().mode === "mock";
}
