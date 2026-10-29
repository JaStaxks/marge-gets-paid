#!/usr/bin/env node
/**
 * Live PayPal sandbox + Gemini check.
 * Reads PAYPAL_SANDBOX_CLIENT_ID, PAYPAL_SANDBOX_CLIENT_SECRET, and GEMINI_API_KEY.
 * Prints pass/fail per step. Does not print secrets.
 *
 *   PAYPAL_SANDBOX_CLIENT_ID=... PAYPAL_SANDBOX_CLIENT_SECRET=... GEMINI_API_KEY=... node scripts/verify-sandbox.mjs
 */

const SANDBOX = "https://api-m.sandbox.paypal.com";
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const clientId = process.env.PAYPAL_SANDBOX_CLIENT_ID || process.env.PAYPAL_CLIENT_ID || "";
const clientSecret = process.env.PAYPAL_SANDBOX_CLIENT_SECRET || process.env.PAYPAL_CLIENT_SECRET || "";
const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || "";
const buyerEmail = process.env.PAYPAL_SANDBOX_BUYER_EMAIL || "buyer@example.com";

const results = [];

function record(step, ok, detail) {
  results.push({ step, ok, detail });
  const label = ok ? "PASS" : "FAIL";
  console.log(`[${label}] ${step}${detail ? ` ${detail}` : ""}`);
}

function safe(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/AIza[\w-]{10,}/g, "[redacted]").slice(0, 240);
}

async function paypalError(response) {
  let detail = "";
  try {
    const body = await response.json();
    const issue = body?.details?.[0]?.issue || body?.details?.[0]?.description || "";
    detail = [body?.name || body?.error || body?.message, issue].filter(Boolean).join(": ");
  } catch {
    detail = "";
  }
  return `status ${response.status}${detail ? ` ${detail}` : ""}`;
}

async function oauth() {
  const response = await fetch(`${SANDBOX}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) throw new Error(await paypalError(response));
  const body = await response.json();
  if (!body.access_token) throw new Error("token missing");
  return body.access_token;
}

async function createOrder(token) {
  const response = await fetch(`${SANDBOX}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: "verify_script",
          description: "Coastline deposit verify",
          amount: { currency_code: "USD", value: "49.00" },
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(await paypalError(response));
  const body = await response.json();
  if (!body.id) throw new Error("order id missing");
  return body.id;
}

function invoiceBody() {
  return {
    detail: {
      currency_code: "USD",
      note: "Sandbox verify. Deposit of 49.00 USD credited.",
      payment_term: { term_type: "DUE_ON_RECEIPT" },
    },
    invoicer: { business_name: "Coastline Heating & Plumbing" },
    primary_recipients: [
      {
        billing_info: {
          name: { given_name: "Sandbox", surname: "Buyer" },
          email_address: buyerEmail,
        },
      },
    ],
    items: [
      {
        name: "AC diagnostic",
        quantity: "1",
        unit_amount: { currency_code: "USD", value: "89.00" },
        discount: { amount: { currency_code: "USD", value: "49.00" } },
      },
    ],
  };
}

async function createInvoice(token) {
  const response = await fetch(`${SANDBOX}/v2/invoicing/invoices`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(invoiceBody()),
  });
  if (!response.ok) throw new Error(await paypalError(response));
  const body = await response.json();
  const href = body?.href;
  const idFromHref = typeof href === "string" ? href.split("/").pop() : "";
  const id = body?.id || idFromHref;
  if (!id) throw new Error("invoice id missing");
  return id;
}

async function sendInvoice(token, invoiceId) {
  const response = await fetch(`${SANDBOX}/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      send_to_recipient: true,
      send_to_invoicer: false,
      note: "Coastline sandbox verify.",
    }),
  });
  if (!response.ok) throw new Error(await paypalError(response));
}

async function geminiLines() {
  const prompt = [
    "Turn this technician note into JSON only: {\"items\":[{\"code\":\"string\",\"quantity\":number}]}",
    "Note: replaced anode rod, flushed tank, 1.5 hr",
    "Allowed codes: wh-anode, wh-flush, labor-hour, ac-diagnostic, drain-clear.",
    "Use wh-anode quantity 1, wh-flush quantity 1, and labor-hour quantity 1.5 when the note mentions them.",
    "Do not include prices.",
  ].join("\n");
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": geminiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
    },
  );
  if (!response.ok) throw new Error(`status ${response.status}`);
  const body = await response.json();
  const text = body?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  const parsed = JSON.parse(text);
  const items = Array.isArray(parsed.items) ? parsed.items : Array.isArray(parsed) ? parsed : [];
  const allowed = new Set(["wh-anode", "wh-flush", "labor-hour", "ac-diagnostic", "drain-clear"]);
  const codes = items.map((item) => item.code).filter((code) => allowed.has(code));
  if (codes.length === 0) throw new Error("no price-book codes in the model response");
  return codes.join(",");
}

async function main() {
  const missing = [];
  if (!clientId) missing.push("PAYPAL_SANDBOX_CLIENT_ID");
  if (!clientSecret) missing.push("PAYPAL_SANDBOX_CLIENT_SECRET");
  if (!geminiKey) missing.push("GEMINI_API_KEY");
  console.log("Marge Gets Paid — sandbox verify");
  if (missing.length > 0) {
    record("env", false, `missing ${missing.join(", ")}`);
    console.log(`0 passed, ${results.length} failed`);
    process.exit(1);
  }
  record("env", true, "credentials present");

  let token = "";
  try {
    token = await oauth();
    record("oauth", true);
  } catch (error) {
    record("oauth", false, safe(error));
  }

  if (token) {
    try {
      const orderId = await createOrder(token);
      record("create_order", true, `id=${orderId}`);
    } catch (error) {
      record("create_order", false, safe(error));
    }
    let invoiceId = "";
    try {
      invoiceId = await createInvoice(token);
      record("create_invoice", true, `id=${invoiceId}`);
    } catch (error) {
      record("create_invoice", false, safe(error));
    }
    if (invoiceId) {
      try {
        await sendInvoice(token, invoiceId);
        record("send_invoice", true, `id=${invoiceId}`);
      } catch (error) {
        record("send_invoice", false, safe(error));
      }
    } else {
      record("send_invoice", false, "skipped because create_invoice failed");
    }
  } else {
    record("create_order", false, "skipped because oauth failed");
    record("create_invoice", false, "skipped because oauth failed");
    record("send_invoice", false, "skipped because oauth failed");
  }

  try {
    const codes = await geminiLines();
    record("gemini_line_items", true, `codes=${codes}`);
  } catch (error) {
    record("gemini_line_items", false, safe(error));
  }

  const failed = results.filter((item) => !item.ok).length;
  const passed = results.length - failed;
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  record("verify", false, safe(error));
  process.exit(1);
});
