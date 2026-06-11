const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const URL = process.env.PAGE_URL;
const W = parseInt(process.env.VW || "1600", 10);
const H = parseInt(process.env.VH || "900", 10);
const OUT = process.env.OUT || "/tmp/promo-rec/list.txt";
const FRAMES_DIR = process.env.FRAMES_DIR || "/tmp/promo-rec/frames";
const DURATION_MS = 65800;

(async () => {
  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  fs.mkdirSync(FRAMES_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      `--window-size=${W},${H}`,
      "--force-device-scale-factor=1",
      "--hide-scrollbars",
      "--font-render-hinting=none",
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: "#replay{display:none!important}" });

  const client = await page.createCDPSession();
  const frames = [];
  let n = 0;
  client.on("Page.screencastFrame", async (ev) => {
    const file = path.join(FRAMES_DIR, `f${String(n++).padStart(5, "0")}.jpg`);
    fs.writeFileSync(file, Buffer.from(ev.data, "base64"));
    frames.push({ file, ts: ev.metadata.timestamp });
    try {
      await client.send("Page.screencastFrameAck", { sessionId: ev.sessionId });
    } catch {}
  });

  await client.send("Page.startScreencast", {
    format: "jpeg",
    quality: 92,
    maxWidth: W,
    maxHeight: H,
    everyNthFrame: 1,
  });
  await page.evaluate(() => restart());
  await new Promise((r) => setTimeout(r, DURATION_MS));
  await client.send("Page.stopScreencast");
  await new Promise((r) => setTimeout(r, 500));
  await browser.close();

  let list = "";
  for (let i = 0; i < frames.length; i++) {
    const dur = i < frames.length - 1
      ? Math.max(0.005, frames[i + 1].ts - frames[i].ts)
      : 0.1;
    list += `file '${frames[i].file}'\nduration ${dur.toFixed(4)}\n`;
  }
  if (frames.length) list += `file '${frames[frames.length - 1].file}'\n`;
  fs.writeFileSync(OUT, list);
  console.log(`captured ${frames.length} frames over ${(frames.at(-1).ts - frames[0].ts).toFixed(1)}s -> ${OUT}`);
})();
