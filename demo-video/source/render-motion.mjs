import { chromium } from "/tmp/marge-film/tools/node_modules/playwright/index.mjs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const FPS = 30;
const SCENES = [
  { name: "title", seconds: 9 },
  { name: "problem", seconds: 16 },
  { name: "rail", seconds: 24.672 },
  { name: "end", seconds: 11 },
];
const outRoot = "/tmp/marge-film/motion";
const only = process.argv[2];

const browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(`file://${path.resolve("/workspace/demo-video/source/motion.html")}`, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const loaded = await page.evaluate(() => document.fonts.check("120px Fraunces") && document.fonts.check("32px Outfit"));
console.log("fonts", loaded);

for (const scene of SCENES) {
  if (only && only !== scene.name && only !== "stills") continue;
  const dir = path.join(outRoot, scene.name);
  await mkdir(dir, { recursive: true });
  const frames = only === "stills" ? 2 : Math.round(scene.seconds * FPS);
  const t0 = Date.now();
  for (let i = 0; i < frames; i += 1) {
    const mid = scene.name === "problem" ? 8 : scene.name === "rail" ? 9.2 : 0.2;
    const t = only === "stills" ? (i === 0 ? 0 : mid) : i / FPS;
    await page.evaluate(([name, time]) => window.seek(name, time), [scene.name, t]);
    const file = path.join(dir, only === "stills" ? `still-${i}.png` : `f${String(i).padStart(4, "0")}.jpg`);
    await page.screenshot({ path: file, type: only === "stills" ? "png" : "jpeg", quality: only === "stills" ? undefined : 90, animations: "disabled" });
    if (i % 30 === 0) console.log(scene.name, i, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  console.log("done", scene.name, frames);
}
await browser.close();
