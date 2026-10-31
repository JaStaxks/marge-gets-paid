/**
 * Record the owner desk from a local mock run of this same app.
 * Password is local-only. Invoice uses the mock PayPal gateway. No card is charged.
 */
import { chromium } from "/tmp/marge-film/tools/node_modules/playwright/index.mjs";
import { mkdir, writeFile } from "node:fs/promises";

const OUT = "/tmp/marge-film/raw";
const BASE = process.env.LOCAL_BASE || "http://127.0.0.1:3000";
const PASSWORD = process.env.DASHBOARD_PASSWORD || "local-demo-desk";
const NOTE = "diagnosed the condenser, not cooling, 1 hr";

const marks = [];
const t0 = Date.now();
function mark(name, extra = {}) {
  const row = { name, t: Number(((Date.now() - t0) / 1000).toFixed(3)), ...extra };
  marks.push(row);
  console.log("MARK", JSON.stringify(row));
}

async function drift(page, ms) {
  const start = Date.now();
  let i = 0;
  while (Date.now() - start < ms) {
    const x = 700 + Math.round(Math.sin(i / 4) * 220);
    const y = 380 + Math.round(Math.cos(i / 6) * 90);
    await page.mouse.move(x, y, { steps: 6 });
    await page.waitForTimeout(100);
    i += 1;
  }
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } },
  locale: "en-US",
  timezoneId: "America/Los_Angeles",
  colorScheme: "light",
});
await context.addInitScript(() => {
  const style = document.createElement("style");
  style.textContent = "nextjs-portal{display:none!important}";
  document.documentElement.appendChild(style);
  const hideBadge = () => {
    document.querySelectorAll("nextjs-portal").forEach((node) => node.remove());
  };
  new MutationObserver(hideBadge).observe(document.documentElement, { childList: true, subtree: true });
  const paint = () => {
    if (document.getElementById("rec-cursor")) return;
    const cursor = document.createElement("div");
    cursor.id = "rec-cursor";
    cursor.style.cssText =
      "position:fixed;z-index:2147483646;width:22px;height:22px;margin:-4px 0 0 -4px;border:2px solid #123244;border-radius:50%;background:rgba(255,250,243,0.9);box-shadow:0 2px 8px rgba(18,50,68,0.25);pointer-events:none;left:960px;top:540px;";
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
page.on("dialog", (dialog) => dialog.accept());
const report = { base: BASE, note: NOTE, paymentCompleted: false, mockGateway: true };

try {
  mark("goto-login");
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await page.mouse.move(960, 420);
  await page.locator("#desk-password").waitFor();
  await page.screenshot({ path: `${OUT}/local-login.png` });
  await drift(page, 700);
  await page.locator("#desk-password").click();
  await page.locator("#desk-password").type(PASSWORD, { delay: 55 });
  mark("password-typed");
  await page.getByRole("button", { name: "Open the board" }).click();
  await page.getByRole("heading", { name: "Jobs on the board" }).waitFor();
  mark("board");
  await page.getByRole("button", { name: "Reset demo" }).click();
  await page.getByText("Board reset.").waitFor();
  mark("reset");
  await page.screenshot({ path: `${OUT}/local-board.png` });
  await drift(page, 3500);

  const helen = page.getByText("Helen Cho", { exact: true }).first();
  await helen.click();
  mark("helen");
  await page.locator("#tech-note").scrollIntoViewIfNeeded();
  await drift(page, 1600);
  await page.screenshot({ path: `${OUT}/local-helen.png` });
  await page.locator("#tech-note").click();
  await page.locator("#tech-note").fill("");
  await page.locator("#tech-note").type(NOTE, { delay: 26 });
  mark("note");
  await drift(page, 1400);
  await page.getByRole("button", { name: "Mark complete and invoice" }).click();
  mark("invoice-click");
  await page.getByText(/sent via/i).waitFor({ timeout: 30_000 });
  report.invoiceMessage = (await page.getByRole("status").innerText()).trim();
  report.lines = await page.locator("table.lines").innerText();
  await page.getByRole("status").scrollIntoViewIfNeeded();
  mark("invoiced", { message: report.invoiceMessage });
  await page.screenshot({ path: `${OUT}/local-invoiced.png` });
  await drift(page, 4200);
  await page.screenshot({ path: `${OUT}/local-invoiced-hold.png` });
} catch (error) {
  report.exception = error instanceof Error ? error.stack : String(error);
  mark("exception");
  try {
    await page.screenshot({ path: `${OUT}/local-error.png` });
  } catch {
    /* ignore */
  }
} finally {
  const video = page.video();
  await context.close();
  await browser.close();
  if (video) report.videoPath = await video.path();
  report.marks = marks;
  await writeFile(`${OUT}/local-report.json`, JSON.stringify(report, null, 2));
  console.log("LOCAL_REPORT", JSON.stringify({ video: report.videoPath, message: report.invoiceMessage, failed: report.exception ? true : false }));
}
