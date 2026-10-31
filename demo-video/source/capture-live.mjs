/**
 * Record the live Marge desk and the real PayPal deposit page.
 * Does not click a PayPal or Venmo button and does not approve a payment.
 */
import { chromium } from "/tmp/marge-film/tools/node_modules/playwright/index.mjs";
import { mkdir, writeFile } from "node:fs/promises";

const OUT = "/tmp/marge-film/raw";
const LIVE = "https://marge-gets-paid.vercel.app";
const MESSAGE =
  "I'm Test Customer, 555-010-2030, test@example.com, 12 Demo St. My water heater is leaking. Tuesday at 9am works.";

const marks = [];
const t0 = Date.now();
function mark(name, extra = {}) {
  const row = { name, t: Number(((Date.now() - t0) / 1000).toFixed(3)), ...extra };
  marks.push(row);
  console.log("MARK", JSON.stringify(row));
  return row;
}

async function drift(page, ms) {
  const start = Date.now();
  let i = 0;
  while (Date.now() - start < ms) {
    const x = 640 + Math.round(Math.sin(i / 5) * 180);
    const y = 420 + Math.round(Math.cos(i / 7) * 80);
    await page.mouse.move(x, y, { steps: 8 });
    await page.waitForTimeout(120);
    i += 1;
  }
}

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } },
  locale: "en-US",
  timezoneId: "America/Los_Angeles",
  colorScheme: "light",
});
await context.addInitScript(() => {
  const paint = () => {
    if (document.getElementById("rec-cursor")) return;
    const cursor = document.createElement("div");
    cursor.id = "rec-cursor";
    cursor.style.cssText = [
      "position:fixed",
      "z-index:2147483646",
      "width:22px",
      "height:22px",
      "margin:-4px 0 0 -4px",
      "border:2px solid #123244",
      "border-radius:50%",
      "background:rgba(255,250,243,0.9)",
      "box-shadow:0 2px 8px rgba(18,50,68,0.25)",
      "pointer-events:none",
      "left:0",
      "top:0",
    ].join(";");
    document.documentElement.appendChild(cursor);
    window.addEventListener(
      "mousemove",
      (event) => {
        cursor.style.left = `${event.clientX}px`;
        cursor.style.top = `${event.clientY}px`;
      },
      true,
    );
  };
  paint();
  document.addEventListener("DOMContentLoaded", paint);
});

const page = await context.newPage();
page.setDefaultTimeout(20_000);
const report = {
  live: LIVE,
  message: MESSAGE,
  paymentCompleted: false,
  paypalButtonClicked: false,
};

try {
  mark("goto");
  await page.goto(LIVE, { waitUntil: "networkidle" });
  await page.locator("#marge-input").waitFor();
  mark("hero");
  await page.screenshot({ path: `${OUT}/live-hero.png` });
  const desk = await page.locator("section.desk").boundingBox();
  report.deskBox = desk;
  await drift(page, 1600);

  mark("type-start");
  await page.locator("#marge-input").click();
  await page.locator("#marge-input").type(MESSAGE, { delay: 32 });
  mark("type-end");
  await drift(page, 700);
  await page.locator("form.composer button[type=submit]").click();
  mark("sent");

  const deadline = Date.now() + 100_000;
  let payHref = "";
  while (Date.now() < deadline) {
    const link = page.locator("a.pay-deposit");
    if ((await link.count()) > 0) {
      payHref = await link.first().getAttribute("href");
      break;
    }
    const banner = page.locator(".error-banner");
    if ((await banner.count()) > 0 && (await banner.first().isVisible())) {
      const text = (await banner.first().innerText()).replace(/\s+/g, " ").trim();
      if (text && !/dismiss/i.test(text)) {
        report.chatError = text;
        break;
      }
    }
    await page.waitForTimeout(400);
  }
  mark("after-wait", { payHref: payHref || null, chatError: report.chatError || null });

  if (!payHref) {
    const follow =
      "Please book it. I'm Test Customer, 555-010-2030, test@example.com, 12 Demo St. Water heater leaking. Tuesday at 9am, or the next open morning if that slot is gone.";
    report.followUp = follow;
    await page.locator("#marge-input").fill("");
    await page.locator("#marge-input").type(follow, { delay: 18 });
    await page.locator("form.composer button[type=submit]").click();
    mark("follow-up-sent");
    const deadline2 = Date.now() + 90_000;
    while (Date.now() < deadline2) {
      const link = page.locator("a.pay-deposit");
      if ((await link.count()) > 0) {
        payHref = await link.first().getAttribute("href");
        break;
      }
      await page.waitForTimeout(400);
    }
    mark("after-follow-up", { payHref: payHref || null });
  }

  report.assistantText = await page.locator(".bubble.assistant").allInnerTexts();
  report.quoteText = await page.locator(".quote-card").allInnerTexts().catch(() => []);
  report.smsText = await page.locator(".sms").allInnerTexts().catch(() => []);
  await page.screenshot({ path: `${OUT}/live-booked.png` });
  await drift(page, 2800);

  if (!payHref) {
    report.failed = "No deposit link appeared.";
    mark("no-pay-link");
  } else {
    const absolute = new URL(payHref, LIVE).toString();
    report.payUrl = absolute;
    report.jobId = absolute.split("/pay/")[1]?.split(/[?#]/)[0] || null;
    mark("open-pay", { url: absolute });
    await page.locator("a.pay-deposit").first().click();
    await page.waitForLoadState("networkidle");
    mark("pay-loaded", { url: page.url() });
    const phone = await page.locator("article.phone").boundingBox();
    report.phoneBox = phone;
    await page.screenshot({ path: `${OUT}/live-pay-early.png` });

    const buttons = page.locator("#paypal-buttons iframe, #paypal-buttons .paypal-buttons");
    try {
      await buttons.first().waitFor({ timeout: 25_000 });
      report.paypalButtons = await page.locator("#paypal-buttons iframe").count();
      mark("paypal-buttons", { iframes: report.paypalButtons });
    } catch {
      report.paypalButtons = 0;
      report.payPageText = await page.locator("article.phone").innerText();
      mark("paypal-buttons-missing");
    }
    await page.screenshot({ path: `${OUT}/live-pay.png` });
    // Hold on the real buttons. Do not click them.
    await drift(page, 4500);
    await page.screenshot({ path: `${OUT}/live-pay-hold.png` });
    mark("pay-hold-done");
  }
} catch (error) {
  report.exception = error instanceof Error ? error.stack : String(error);
  mark("exception");
  try {
    await page.screenshot({ path: `${OUT}/live-error.png` });
  } catch {
    /* page may be closed */
  }
} finally {
  const video = page.video();
  await context.close();
  await browser.close();
  if (video) {
    const path = await video.path();
    report.videoPath = path;
  }
  report.marks = marks;
  await writeFile(`${OUT}/live-report.json`, JSON.stringify(report, null, 2));
  console.log("LIVE_REPORT", JSON.stringify({ video: report.videoPath, payUrl: report.payUrl, jobId: report.jobId, failed: report.failed, buttons: report.paypalButtons }));
}
