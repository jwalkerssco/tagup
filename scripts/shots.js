/* scripts/shots.js -- screenshot the running dev app through Chrome's
   DevTools protocol: real device emulation (a phone is 390 px wide, which
   Chrome's --window-size cannot do on Windows -- it floors at ~500), and
   scripted clicks/typing so multi-step screens get captured too.

     node dev.js --seed > dev.log        (one shell)
     node scripts/shots.js dev.log       (another)   -> shots/*.png

   Needs Node 22+ (global WebSocket) and Chrome.                            */
"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = path.join(__dirname, "..", "shots");
const PORT = 9333;
fs.mkdirSync(OUT, { recursive: true });
const log = fs.readFileSync(process.argv[2] || "dev.log", "utf8");
const seed = JSON.parse(log.slice(log.indexOf("{"), log.lastIndexOf("}") + 1));
const base = seed.base, T = seed.token, O = seed.org;
const auth = (p, tok) => { const [pp, hash] = p.split("#"); return base + pp + (pp.indexOf("?") === -1 ? "?" : "&") + "t=" + (tok || T) + "&o=" + O + (hash ? "#" + hash : ""); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = {}; this.events = []; ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && this.pending[d.id]) { const p = this.pending[d.id]; delete this.pending[d.id]; d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); } else if (d.method) this.events.push(d); }; }
  send(method, params) { const id = ++this.id; return new Promise((res, rej) => { this.pending[id] = { res, rej }; this.ws.send(JSON.stringify({ id, method, params: params || {} })); }); }
  async eval(expr) { const r = await this.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.text || "") + " " + JSON.stringify(r.exceptionDetails.exception || {}).slice(0, 200)); return r.result.value; }
}
async function connect() {
  for (let i = 0; i < 60; i++) { try { const v = await fetch("http://127.0.0.1:" + PORT + "/json/version").then((r) => r.json()); if (v.webSocketDebuggerUrl) break; } catch (e) {} await sleep(250); }
  const t = await fetch("http://127.0.0.1:" + PORT + "/json/new?about:blank", { method: "PUT" }).then((r) => r.json());
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const c = new CDP(ws);
  await c.send("Page.enable"); await c.send("Runtime.enable");
  return c;
}
// Click the first element whose visible text starts with / equals `text`,
// optionally inside the first ancestor matching `within` text. Buttons and
// links first, then anything.
const CLICK_FN = `(function(text, within, nth){
  const norm = s => (s||"").replace(/\\s+/g," ").trim().toLowerCase();
  const want = norm(text);
  let root = document;
  if (within) { const all = Array.from(document.querySelectorAll("div,section,li,tr")); const hit = all.filter(e => norm(e.textContent).includes(norm(within)) && norm(e.textContent).includes(want)).sort((a,b)=>a.textContent.length-b.textContent.length)[0]; if (hit) root = hit; }
  const cands = Array.from(root.querySelectorAll("button,a,label,[role=button],input,select,option,div,span,td"));
  const exact = cands.filter(e => { const t = norm(e.textContent || e.value || e.placeholder); return t === want; });
  const starts = cands.filter(e => { const t = norm(e.textContent || e.value || e.placeholder); return t.startsWith(want); }).sort((a,b)=>a.textContent.length-b.textContent.length);
  const list = (exact.length ? exact : starts).filter(e => e.getClientRects().length);
  const el = list[nth||0]; if (!el) return "NOT FOUND: " + text;
  el.scrollIntoView({ block: "center" });
  const r = el.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2, tag: el.tagName };
})`;
async function click(c, text, within, nth) {
  const pos = await c.eval(CLICK_FN + "(" + JSON.stringify(text) + "," + JSON.stringify(within || null) + "," + (nth || 0) + ")");
  if (typeof pos === "string") throw new Error(pos);
  await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pos.x, y: pos.y });
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pos.x, y: pos.y, button: "left", clickCount: 1 });
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pos.x, y: pos.y, button: "left", clickCount: 1 });
  await sleep(350);
}
async function type(c, placeholderOrSelector, text) {
  const ok = await c.eval(`(function(){ let el = null; try { el = document.querySelector(${JSON.stringify(placeholderOrSelector)}); } catch (e) {} el = el || Array.from(document.querySelectorAll("input,textarea")).find(i => (i.placeholder||"").toLowerCase().includes(${JSON.stringify(placeholderOrSelector.toLowerCase())})); if (!el) return false; el.focus(); el.select && el.select(); return true; })()`);
  if (!ok) throw new Error("no input " + placeholderOrSelector);
  await c.send("Input.insertText", { text });
  await sleep(300);
}
async function goto(c, url, w, h, mobile) {
  await c.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile: !!mobile });
  if (mobile) await c.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await c.send("Page.navigate", { url });
  await sleep(600);
  for (let i = 0; i < 40; i++) { const ready = await c.eval(`document.readyState === "complete" && document.fonts.status === "loaded"`).catch(() => false); if (ready) break; await sleep(150); }
  await sleep(900);
}
async function shot(c, name) {
  const r = await c.send("Page.captureScreenshot", { format: "png" });
  const out = path.join(OUT, name + ".png"); fs.writeFileSync(out, Buffer.from(r.data, "base64"));
  console.log("ok  " + name + " " + fs.statSync(out).size + "b");
}

async function main() {
  const prof = path.join(OUT, ".prof");
  fs.rmSync(prof, { recursive: true, force: true });
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--remote-debugging-port=" + PORT, "--user-data-dir=" + prof, "--window-size=1400,1000", "about:blank"], { stdio: "ignore" });
  try {
    const c = await connect();
    const b = await fetch(base + "/api/batches", { headers: { authorization: "Bearer " + T, "x-org-id": O } }).then((r) => r.json());
    const batchId = b.batches && b.batches[0] && b.batches[0].id;
    const D = [1366, 900], P = [390, 844];
    const step = async (name, fn) => { try { await fn(); await shot(c, name); } catch (e) { console.log("ERR " + name + ": " + e.message); } };

    // Public
    await step("landing-desktop", () => goto(c, base + "/", 1366, 1600));
    await step("landing-phone", () => goto(c, base + "/", P[0], 1500, true));
    await step("signup", () => goto(c, base + "/signup", D[0], D[1]));
    await step("login", () => goto(c, base + "/login", D[0], D[1]));
    // Workspace (owner)
    await step("home", () => goto(c, auth("/app/home"), D[0], D[1]));
    await step("queue", () => goto(c, auth("/app/queue"), D[0], 1000));
    await step("queue-import", async () => { await click(c, "Import price book"); await sleep(500); });
    await step("batches", () => goto(c, auth("/app/batches"), D[0], D[1]));
    await step("styles", () => goto(c, auth("/app/styles"), D[0], 1000));
    await step("style-editor-rules", async () => { await click(c, "Edit", "7-Eleven"); await sleep(600); });
    await step("style-editor-rules-try", async () => { await type(c, "price", "5.00"); await sleep(500); });
    await step("style-template-new", async () => { await goto(c, auth("/app/styles"), D[0], 1000); await click(c, "+ Template"); await sleep(600); });
    await step("materials", () => goto(c, auth("/app/materials"), D[0], D[1]));
    await step("brands", () => goto(c, auth("/app/brands"), D[0], 1000));
    await step("stores", () => goto(c, auth("/app/stores"), D[0], D[1]));
    await step("stores-edit", async () => { await click(c, "Stripes #2134"); await sleep(200); const pos = await c.eval("(function(){const tr=Array.from(document.querySelectorAll(\"tr\")).find(t=>t.textContent.includes(\"Stripes #2134\")); const b=tr&&tr.querySelector(\"button\"); if(!b) return null; b.click(); return true; })()"); await sleep(500); });
    await step("stores-upload", async () => { await click(c, "Upload account list"); await sleep(400); });
    await step("catalog", () => goto(c, auth("/app/catalog"), D[0], D[1]));
    await step("team", () => goto(c, auth("/app/team"), D[0], D[1]));
    await step("team-invite", async () => { await click(c, "Invite someone"); await sleep(400); });
    await step("help", () => goto(c, auth("/app/help#chain"), D[0], 1000));
    await step("settings", () => goto(c, auth("/app/settings"), D[0], D[1]));
    await step("request-desktop", () => goto(c, auth("/app/request"), D[0], D[1]));
    // Phone: owner
    await step("home-phone", () => goto(c, auth("/app/home"), P[0], P[1], true));
    await step("queue-phone", () => goto(c, auth("/app/queue"), P[0], P[1], true));
    // Phone: the rep's flow, step by step
    await step("rep-1-list", () => goto(c, auth("/app/request", seed.repToken), P[0], P[1], true));
    await step("rep-2-store", async () => { await click(c, "Request a tag"); });
    await step("rep-3-type", async () => { await click(c, "Stripes #2134"); });
    await step("rep-4-item", async () => { await click(c, "Standard price"); });
    await step("rep-4b-item-search", async () => { await type(c, "Michelob", "mich ult"); await sleep(700); });
    await step("rep-5-price", async () => { await click(c, "MICH ULT 12PK 12OZ CN"); await click(c, "Next"); });
    await step("rep-5b-price-typed", async () => { await type(c, "0.00", "14.99"); await sleep(300); });
    await step("rep-6-review", async () => { await click(c, "Review"); await sleep(600); });
    await step("rep-7-done", async () => { await click(c, "Send to the sign shop"); await sleep(900); });
    if (batchId) await step("print-sheet", () => goto(c, base + "/api/batches/" + batchId + "/print?t=" + T + "&org=" + O, 816, 1056));
  } finally { chrome.kill(); try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {} }
}
main().catch((e) => { console.error(e); process.exit(1); });
