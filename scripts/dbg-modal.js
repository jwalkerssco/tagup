/* scripts/dbg-modal.js -- open a page, click a button, dump console errors +
   the DOM around the modal, screenshot. node scripts/dbg-modal.js dev.log "/app/stores" "Upload account list" */
"use strict";
const fs = require("fs"); const path = require("path"); const { spawn } = require("child_process");
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const log = fs.readFileSync(process.argv[2] || "dev.log", "utf8");
const seed = JSON.parse(log.slice(log.indexOf("{"), log.lastIndexOf("}") + 1));
const url = seed.base + process.argv[3] + "?t=" + seed.token + "&o=" + seed.org;
const label = process.argv[4];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const prof = path.join(__dirname, "..", "shots", ".prof-dbg"); fs.rmSync(prof, { recursive: true, force: true });
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=9334", "--user-data-dir=" + prof, "--window-size=1366,900", "about:blank"], { stdio: "ignore" });
  try {
    let v; for (let i = 0; i < 60; i++) { try { v = await fetch("http://127.0.0.1:9334/json/version").then((r) => r.json()); if (v.webSocketDebuggerUrl) break; } catch (e) {} await sleep(250); }
    const t = await fetch("http://127.0.0.1:9334/json/new?about:blank", { method: "PUT" }).then((r) => r.json());
    const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pending = {}; const events = [];
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; } else if (d.method) events.push(d); };
    const send = (method, params) => new Promise((res) => { const i = ++id; pending[i] = res; ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
    const ev = async (expr) => { const d = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (d.result && d.result.exceptionDetails) console.log("EVAL ERR", JSON.stringify(d.result.exceptionDetails).slice(0, 300)); return (d.result && d.result.result) || {}; };
    await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url });
    for (let i = 0; i < 40; i++) { const r = await ev('document.querySelectorAll("button").length'); if (r.value > 3) break; await sleep(300); }
    await sleep(800);
    console.log("buttons:", (await ev('Array.from(document.querySelectorAll("button")).map(b => b.textContent.trim()).slice(0, 30).join(" | ")')).value);
    console.log("location:", (await ev("location.href")).value, "| body:", JSON.stringify(((await ev("document.body.innerText")).value || "").slice(0, 300)), "| scripts:", (await ev('Array.from(document.scripts).map(s => s.src).join(",")')).value);
    const clicked = await ev(`(function(){ const b = Array.from(document.querySelectorAll("button")).find(x => x.textContent.trim().startsWith(${JSON.stringify(label)})); if (!b) return "no button"; b.click(); return "clicked"; })()`);
    console.log("click:", JSON.stringify(clicked));
    await sleep(1200);
    const dom = await ev(`(function(){ const fixed = Array.from(document.querySelectorAll("div")).filter(d => getComputedStyle(d).position === "fixed"); return fixed.map(d => ({ z: getComputedStyle(d).zIndex, kids: d.children.length, w: d.getBoundingClientRect().width, h: d.getBoundingClientRect().height, firstKidW: d.firstElementChild && d.firstElementChild.getBoundingClientRect().width, firstKidH: d.firstElementChild && d.firstElementChild.getBoundingClientRect().height, text: (d.textContent||"").slice(0,80) })); })()`);
    console.log("fixed layers:", JSON.stringify(dom.value, null, 1));
    const errs = events.filter((e) => e.method === "Runtime.exceptionThrown" || (e.method === "Runtime.consoleAPICalled" && /error|warn/.test(e.params.type)) || e.method === "Log.entryAdded");
    console.log("console/errors:", errs.length); errs.slice(0, 8).forEach((e) => console.log(JSON.stringify(e.params).slice(0, 600)));
    const shot = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(__dirname, "..", "shots", "dbg-modal.png"), Buffer.from(shot.result.data, "base64"));
  } finally { chrome.kill(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
