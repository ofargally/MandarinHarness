/** Packaged personal app smoke, using a throwaway profile and an existing MP3.
 * Run: node --import tsx scripts/smoke-personal-app.mjs /path/to/sample.mp3
 * Never generates speech or uses real credentials. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { SPEECH_PROFILE } from "../config.ts";
import { speechCacheKey } from "../src/server/speech-service.ts";
import { createSpeechCache } from "../src/store/speech-cache.ts";

const root = path.resolve(import.meta.dirname, "..");
const binary = path.join(root, "dist/mac-arm64/MandarinHarness.app/Contents/MacOS/MandarinHarness");
assert.ok(process.argv[2], "Supply an existing MP3 for offline playback verification");
const audio = await readFile(process.argv[2]);
const profile = await mkdtemp(path.join(os.tmpdir(), "mandarinharness-packaged-"));
const text = "你好，我想要一杯热茶。";
const cache = createSpeechCache({ directory: path.join(profile, "data/cache/speech") });
await cache.put(speechCacheKey(text, SPEECH_PROFILE), audio, "audio/mpeg");

try {
  for (let attempt = 0; attempt < 2; attempt++) {
    const child = spawn(binary, [`--user-data-dir=${profile}`, "--remote-debugging-port=0"], {
      env: { PATH: process.env.PATH, TMPDIR: os.tmpdir() },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let browser;
    let logs = "";
    try {
      const endpoint = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`App boot timed out: ${logs}`)), 30000);
        const collect = chunk => {
          logs += chunk.toString();
          const match = logs.match(/DevTools listening on (ws:\/\/[^\s]+)/);
          if (match) { clearTimeout(timer); resolve(match[1]); }
        };
        child.stdout.on("data", collect);
        child.stderr.on("data", collect);
        child.once("error", err => { clearTimeout(timer); reject(err); });
        child.once("exit", code => { clearTimeout(timer); reject(new Error(`App exited ${code}: ${logs}`)); });
      });
      browser = await puppeteer.connect({ browserWSEndpoint: endpoint, defaultViewport: null });
      const target = await browser.waitForTarget(t => /^http:\/\/127\.0\.0\.1:/.test(t.url()), { timeout: 30000 });
      const page = await target.page();
      await page.waitForFunction(() => !!window.lh);
      const update = await page.evaluate(() => window.lh.getUpdateState());
      assert.equal(update.status, "disabled");
      await page.evaluate(() => window.lh.checkForUpdates());
      assert.equal((await page.evaluate(() => window.lh.getUpdateState())).status, "disabled");
      const response = await page.evaluate(async text => {
        const res = await fetch("/api/speech", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
        return { status: res.status, cache: res.headers.get("x-speech-cache"), size: (await res.arrayBuffer()).byteLength };
      }, text);
      assert.deepEqual(response, { status: 200, cache: "hit", size: audio.length });
      if (attempt === 0) {
        const chat = await page.evaluate(async () => (await fetch("/api/chats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Offline packaging check" }) })).json());
        assert.ok(chat.id);
        await page.goto(new URL(`/chat/${chat.id}`, page.url()).href);
        await page.waitForSelector("[data-speech-scope]");
        // Fixture text in the real packaged chat exercises its selection and player.
        await page.evaluate(text => {
          const p = document.createElement("p"); p.className = "lh-prose"; p.textContent = text;
          p.style.cssText = "position:fixed;top:100px;left:100px;z-index:9999";
          document.querySelector("[data-speech-scope]").append(p);
          const range = document.createRange(); range.selectNodeContents(p);
          const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        }, text);
        await page.waitForSelector("[data-testid=speech-popup]");
        await page.evaluate(() => [...document.querySelectorAll("[data-testid=speech-popup] button")].find(b => b.textContent === "Read").click());
        await page.waitForFunction(() => [...document.querySelectorAll("[role=status]")].some(el => el.textContent === "Reading…"));
      }
      assert.match(await readFile(path.join(profile, "logs/main.log"), "utf8"), /auto-update: disabled for this personal build/);
      console.log(`PASS packaged launch ${attempt + 1}: isolated profile, disabled updates, cached speech${attempt === 0 ? ", selection and native playback" : " after restart"}`);
    } finally {
      if (browser) await browser.close().catch(() => {});
      if (child.exitCode === null) {
        const exited = once(child, "exit"); child.kill("SIGTERM"); await exited;
      }
    }
  }
} finally {
  await rm(profile, { recursive: true, force: true });
}
