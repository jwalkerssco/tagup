/* scripts/dbg-page.js -- render a URL in headless Chrome, list every image
   (img src + CSS background-image) with its size and alt/text, screenshot.
     node scripts/dbg-page.js <url> [out.png]                                */
"use strict";
const fs = require("fs"); const path = require("path"); const { spawn } = require("child_process");
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const url = process.argv[2]; const out = process.argv[3] || path.join(__dirname, "..", "shots", "dbg-page.png");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const prof = path.join(__dirname, "..", "shots", ".prof-page"); fs.rmSync(prof, { recursive: true, force: true });
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=9335", "--user-data-dir=" + prof, "--window-size=1366,2400", "about:blank"], { stdio: "ignore" });
  try {
    let v; for (let i = 0; i < 60; i++) { try { v = await fetch("http://127.0.0.1:9335/json/version").then((r) => r.json()); if (v.webSocketDebuggerUrl) break; } catch (e) {} await sleep(250); }
    const t = await fetch("http://127.0.0.1:9335/json/new?about:blank", { method: "PUT" }).then((r) => r.json());
    const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pending = {};
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; } };
    const send = (method, params) => new Promise((res) => { const i = ++id; pending[i] = res; ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
    const ev = async (expr) => { const d = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return (d.result && d.result.result && d.result.result.value); };
    await send("Page.enable"); await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 2400, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url }); await sleep(5000);
    const info = await ev(`(function(){
      const out = { title: document.title, imgs: [], bgs: [], links: [] };
      document.querySelectorAll("img").forEach(i => { const r = i.getBoundingClientRect(); out.imgs.push({ src: i.currentSrc || i.src, alt: i.alt, w: Math.round(r.width), h: Math.round(r.height), near: (i.closest("a,li,div") || {}).textContent ? (i.closest("a,li,div").textContent || "").replace(/\\s+/g," ").trim().slice(0,60) : "" }); });
      document.querySelectorAll("*").forEach(e => { const b = getComputedStyle(e).backgroundImage; if (b && b !== "none" && /url\\(/.test(b)) { const r = e.getBoundingClientRect(); out.bgs.push({ url: b.replace(/^url\\(["']?|["']?\\)$/g, ""), w: Math.round(r.width), h: Math.round(r.height), text: (e.textContent||"").replace(/\\s+/g," ").trim().slice(0,60) }); } });
      document.querySelectorAll("a[href]").forEach(a => { if (/product|brand/i.test(a.href) || /product|brand/i.test(a.textContent)) out.links.push(a.href + " :: " + a.textContent.trim().slice(0,40)); });
      out.text = (document.body.innerText || "").replace(/\\s+/g, " ").slice(0, 800);
      return out; })()`);
    console.log(JSON.stringify(info, null, 1));
    const shot = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(out, Buffer.from(shot.result.data, "base64"));
    console.log("screenshot", out);
  } finally { chrome.kill(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
