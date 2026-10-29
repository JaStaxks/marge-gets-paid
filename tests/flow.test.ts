import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { cookieIsValid, passwordMatches, sessionToken } from "@/lib/auth";
import { bookJob, captureJobDeposit, createDepositForJob, quoteIssue } from "@/lib/jobs";
import { completeJob } from "@/lib/invoicing";
import { kpis } from "@/lib/metrics";
import { depositCentsFor, priceLines } from "@/lib/money";
import { parsePaypalBody } from "@/lib/paypal-parse";
import { getPaypalGateway } from "@/lib/paypal";
import { getPriceBookItem, linesFromNote, requirePriceBookItem } from "@/lib/price-book";
import { runScriptedTurn } from "@/lib/scripted";
import { readStore, resetStore } from "@/lib/store";
import type { UIMessage } from "ai";
import { handlePaypalWebhook } from "@/lib/webhook";

beforeEach(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "marge-test-"));
  process.env.STORE_PATH = path.join(dir, "store.json");
  process.env.PAYPAL_FORCE_MOCK = "1";
  process.env.DASHBOARD_PASSWORD = "coastline";
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.PAYPAL_SANDBOX_CLIENT_ID;
  delete process.env.PAYPAL_CLIENT_ID;
  delete process.env.PAYPAL_SANDBOX_CLIENT_SECRET;
  delete process.env.PAYPAL_CLIENT_SECRET;
  await resetStore();
});

describe("price book money", () => {
  it("uses a flat $49 deposit or 25%, never a caller-supplied price", () => {
    const diagnostic = requirePriceBookItem("ac-diagnostic");
    const tune = requirePriceBookItem("ac-tune");
    const faucet = requirePriceBookItem("faucet");
    expect(diagnostic.priceCents).toBe(8900);
    expect(depositCentsFor(diagnostic)).toBe(4900);
    expect(depositCentsFor(requirePriceBookItem("wh-flush"))).toBe(4900);
    expect(depositCentsFor(requirePriceBookItem("drain-clear"))).toBe(4900);
    expect(depositCentsFor(tune)).toBe(4725);
    expect(depositCentsFor(faucet)).toBe(4375);
    expect(depositCentsFor(requirePriceBookItem("labor-hour"))).toBe(0);

    const priced = priceLines(
      [
        { code: "wh-anode", quantity: 1 },
        { code: "wh-flush", quantity: 1 },
        { code: "labor-hour", quantity: 1.5 },
      ],
      4900,
      getPriceBookItem,
    );
    expect(priced.lines.map((line) => line.unitCents)).toEqual([28900, 14900, 16500]);
    expect(priced.subtotalCents).toBe(68550);
    expect(priced.depositCreditCents).toBe(4900);
    expect(priced.totalCents).toBe(63650);
    expect(priced.lines[0]?.discountCents).toBe(4900);
  });

  it("caps the deposit credit at the subtotal and reads the technician note", () => {
    const priced = priceLines([{ code: "service-call", quantity: 1 }], 999999, getPriceBookItem);
    expect(priced.totalCents).toBe(0);
    expect(priced.depositCreditCents).toBe(8900);
    expect(linesFromNote("replaced anode rod, flushed tank, 1.5 hr")).toEqual([
      { code: "wh-anode", quantity: 1 },
      { code: "wh-flush", quantity: 1 },
      { code: "labor-hour", quantity: 1.5 },
    ]);
  });

  it("parses PayPal ids without treating the payload as trusted money", () => {
    const parsed = parsePaypalBody({
      id: "INV2-ABCD-EFGH",
      detail: { metadata: { recipient_view_url: "https://www.sandbox.paypal.com/invoice/p/#INV2-ABCD-EFGH" } },
    });
    expect(parsed.id).toBe("INV2-ABCD-EFGH");
    expect(parsed.href).toContain("invoice");
  });
});

describe("booking, deposit, webhook, invoice", () => {
  it("books from the price book and creates a mock deposit order", async () => {
    const store = await readStore();
    const slot = store.slots.find((item) => item.available && item.weekday === "Tue" && item.hour === 9);
    expect(slot).toBeTruthy();
    const quote = quoteIssue("water heater is leaking");
    expect(quote.serviceCode).toBe("wh-leak");
    expect(quote.depositCents).toBe(4900);
    const job = await bookJob({
      customerName: "Dana Ruiz",
      phone: "619-555-0199",
      email: "dana@example.com",
      address: "2100 Sunset Cliffs Blvd",
      issue: "Water heater is leaking",
      serviceCode: quote.serviceCode,
      slotId: slot!.id,
    });
    expect(job.quoteCents).toBe(8900);
    expect(job.depositCents).toBe(4900);
    expect(job.status).toBe("booked");
    const deposit = await createDepositForJob(job.id);
    expect(deposit.orderId.startsWith("MOCK-")).toBe(true);
    expect(deposit.payUrl).toContain(`/pay/${job.id}`);
    expect(deposit.via).toBe("mock");
    const again = await createDepositForJob(job.id);
    expect(again.orderId).toBe(deposit.orderId);
    expect(again.alreadyCreated).toBe(true);
  });

  it("marks the deposit paid once when the same webhook is delivered twice", async () => {
    const store = await readStore();
    const slot = store.slots.find((item) => item.available);
    const job = await bookJob({
      customerName: "Dana Ruiz",
      phone: "619-555-0199",
      email: "dana@example.com",
      address: "2100 Sunset Cliffs Blvd",
      issue: "Water heater is leaking",
      serviceCode: "wh-leak",
      slotId: slot!.id,
    });
    const deposit = await createDepositForJob(job.id);
    const paypal = getPaypalGateway();
    const event = {
      id: "WH-TEST-1",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: {
        id: "CAP-1",
        custom_id: job.id,
        supplementary_data: { related_ids: { order_id: deposit.orderId } },
      },
    };
    const headers = {
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-cert-url": "https://example.test/cert",
      "paypal-transmission-id": "tx-1",
      "paypal-transmission-sig": "signed",
      "paypal-transmission-time": new Date().toISOString(),
    };
    const [first, second] = await Promise.all([
      handlePaypalWebhook({ event, headers, paypal }),
      handlePaypalWebhook({ event, headers, paypal }),
    ]);
    const statuses = [first, second].map((result) => result.status);
    expect(statuses).toEqual([200, 200]);
    expect([first.body.duplicate, second.body.duplicate].filter(Boolean)).toHaveLength(1);
    const saved = (await readStore()).jobs.find((item) => item.id === job.id);
    expect(saved?.status).toBe("deposit_paid");
    expect(saved?.paypalCaptureId).toBe("CAP-1");
    const seen = (await readStore()).processedEventIds.filter((id) => id === "WH-TEST-1");
    expect(seen).toHaveLength(1);

    const rejected = await handlePaypalWebhook({
      event: { ...event, id: "WH-TEST-2" },
      headers: { ...headers, "paypal-transmission-sig": "invalid" },
      paypal,
    });
    expect(rejected.status).toBe(401);
    expect((await readStore()).processedEventIds.includes("WH-TEST-2")).toBe(false);
  });

  it("invoices from the technician note and credits the deposit", async () => {
    const store = await readStore();
    const slot = store.slots.find((item) => item.available);
    const job = await bookJob({
      customerName: "Dana Ruiz",
      phone: "619-555-0199",
      email: "dana@example.com",
      address: "2100 Sunset Cliffs Blvd",
      issue: "Water heater is leaking",
      serviceCode: "wh-leak",
      slotId: slot!.id,
    });
    const deposit = await createDepositForJob(job.id);
    await captureJobDeposit(job.id, deposit.orderId);
    const invoiced = await completeJob(job.id, "replaced anode rod, flushed tank, 1.5 hr");
    expect(invoiced.status).toBe("invoiced");
    expect(invoiced.invoiceVia).toBe("mock");
    expect(invoiced.invoiceId?.startsWith("INV2-MOCK-")).toBe(true);
    expect(invoiced.invoiceSubtotalCents).toBe(68550);
    expect(invoiced.depositCreditCents).toBe(4900);
    expect(invoiced.invoiceTotalCents).toBe(63650);
    expect(invoiced.lines?.map((line) => line.code)).toEqual(["wh-anode", "wh-flush", "labor-hour"]);

    const paid = await handlePaypalWebhook({
      event: {
        id: "WH-INV-1",
        event_type: "INVOICING.INVOICE.PAID",
        resource: { id: invoiced.invoiceId },
      },
      headers: {
        "paypal-auth-algo": "SHA256withRSA",
        "paypal-cert-url": "https://example.test/cert",
        "paypal-transmission-id": "tx-inv",
        "paypal-transmission-sig": "signed",
        "paypal-transmission-time": new Date().toISOString(),
      },
      paypal: getPaypalGateway(),
    });
    expect(paid.status).toBe(200);
    const afterPay = (await readStore()).jobs.find((item) => item.id === job.id);
    expect(afterPay?.status).toBe("paid");

    const late = await handlePaypalWebhook({
      event: {
        id: "WH-LATE",
        event_type: "CHECKOUT.ORDER.APPROVED",
        resource: { id: deposit.orderId, purchase_units: [{ custom_id: job.id }] },
      },
      headers: {
        "paypal-auth-algo": "SHA256withRSA",
        "paypal-cert-url": "https://example.test/cert",
        "paypal-transmission-id": "tx-late",
        "paypal-transmission-sig": "signed",
        "paypal-transmission-time": new Date().toISOString(),
      },
      paypal: getPaypalGateway(),
    });
    expect(late.body.status).toBe("paid");
  });

  it("refuses to invoice before the deposit is paid", async () => {
    const helen = (await readStore()).jobs.find((job) => job.customerName === "Luis Ortega");
    expect(helen?.status).toBe("deposit_pending");
    await expect(completeJob(helen!.id, "Cleared the kitchen drain, 1 hr")).rejects.toThrow(/deposit/i);
  });
});

describe("scripted receptionist and dashboard", () => {
  it("books Dana from one message and exposes the text-message link", async () => {
    const messages = [
      {
        id: "u1",
        role: "user",
        parts: [
          {
            type: "text",
            text: "I'm Dana Ruiz, 619-555-0199, dana@example.com, 2100 Sunset Cliffs Blvd. Water heater is leaking. Tuesday at 9am works.",
          },
        ],
      },
    ] as UIMessage[];
    const turn = await runScriptedTurn(messages);
    const deposit = turn.tools.find((tool) => tool.name === "create_deposit_order");
    expect(deposit).toBeTruthy();
    const output = deposit?.output as { payUrl: string; deposit: string };
    expect(output.deposit).toBe("$49.00");
    expect(output.payUrl).toContain("/pay/job_");
    expect(turn.text).toMatch(/booked/i);
    const saved = (await readStore()).jobs.find((job) => job.email === "dana@example.com");
    expect(saved?.status).toBe("deposit_pending");
    expect(saved?.depositCents).toBe(4900);
    expect(saved?.transcript.length).toBeGreaterThan(0);
  });

  it("seeds realistic totals and checks the owner password", async () => {
    const data = await readStore();
    const totals = kpis(data.jobs);
    expect(totals.booked).toBe(4);
    expect(totals.depositsCollectedCents).toBe(4900 + 4900 + 4375);
    expect(data.jobs.map((job) => job.status).sort()).toEqual(
      ["deposit_paid", "deposit_pending", "invoiced", "paid"].sort(),
    );
    expect(passwordMatches("coastline")).toBe(true);
    expect(passwordMatches("wrong-password")).toBe(false);
    expect(cookieIsValid(sessionToken())).toBe(true);
    expect(cookieIsValid("nope")).toBe(false);
  });
});
