/* src/tagup-ui.jsx -- the tagup screens: the rep's request flow and the
   sign shop's queue, batches, styles, materials and brand library. Ported
   from the embedded module by scripts/port_ui.js -- edit lib/tagup-ui.orig.jsx
   and re-run, or edit here and delete the script.

   tagup-core.js is bundled in: the preview a rep sees, the sample in the
   style editor and the print sheet the server renders come from ONE renderer,
   so what is shown is what prints. */
import React, { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
const CORE = require("../lib/tagup-core");


/* ---------------- fetch helpers ---------------- */
const j = (r) => r.json();
function jget(ui, url) { return fetch(url, { headers: ui.H() }).then(j); }
function jpost(ui, url, body) { return fetch(url, { method: "POST", headers: ui.H(), body: JSON.stringify(body || {}) }).then(j); }
function jput(ui, url, body) { return fetch(url, { method: "PUT", headers: ui.H(), body: JSON.stringify(body || {}) }).then(j); }
function Icon({ ui, name, size, color }) { const I = ui.icons && ui.icons[name]; return I ? React.createElement(I, { size: size || 18, color: color }) : null; }
/* The tagup brand (brand sheet 2026-09-19): Signal orange, Ink, Paper, Kraft,
   Slate, Posted green, Pull red. Text on Signal is always Ink; Signal never
   sets type on Paper. The mark is a tag with a 45deg cut and a punched hole. */
const TB = { signal: "#FF6A13", ink: "#14110F", paper: "#FAF7F2", kraft: "#D9C7A9", slate: "#3D4450", posted: "#1E9E5A", pull: "#D62828", signalSoft: "#FFE3D0", postedSoft: "#DDF3E6", pullSoft: "#F9DADA", slateSoft: "#E3E6EA" };
const TAGLINE = "Prices today. On shelf tomorrow.";
function TagUpMark({ size, ink, hole }) {
  const s = size || 22;
  return <svg width={s} height={s} viewBox="0 0 100 100" aria-hidden="true" style={{ display: "block", flexShrink: 0 }}>
    <path d="M18 8 H63 L92 37 V84 a8 8 0 0 1 -8 8 H16 a8 8 0 0 1 -8 -8 V18 a10 10 0 0 1 10 -10 Z" fill={ink || TB.signal} />
    <circle cx="70.5" cy="29.5" r="8.5" fill={hole || TB.paper} />
  </svg>;
}
function Wordmark({ size, color }) { return <span style={{ fontFamily: "'Archivo Black','Inter',system-ui,sans-serif", fontWeight: 800, fontSize: size || 26, letterSpacing: -0.6, color: color || TB.ink, lineHeight: 1 }}>tagup</span>; }
const TABULAR = { fontVariantNumeric: "tabular-nums lining-nums" };
const qs = (o) => { const p = Object.keys(o || {}).filter((k) => o[k] != null && o[k] !== "").map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(o[k])); return p.length ? "?" + p.join("&") : ""; };

/* ---------------- primitives in the app's vocabulary ---------------- */
function Card({ ui, children, style, accent, onClick }) {
  const C = ui.C;
  return <div onClick={onClick} style={Object.assign({ background: "#fff", border: `2px solid ${C.line}`, borderLeft: accent ? `5px solid ${accent}` : `2px solid ${C.line}`, borderRadius: 16, padding: 14, marginBottom: 10, cursor: onClick ? "pointer" : "default" }, style || {})}>{children}</div>;
}
function Btn({ ui, kind, small, disabled, onClick, children, title, style, block }) {
  const C = ui.C;
  const bg = kind === "gold" ? C.gold : kind === "navy" ? C.navy : kind === "red" ? C.red : "#fff";
  const fg = kind === "gold" ? C.navy : kind === "navy" || kind === "red" ? "#fff" : C.navy;
  return <button type="button" title={title} disabled={disabled} onClick={onClick} style={Object.assign({ font: "inherit", fontFamily: ui.HEAD, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", fontSize: small ? 12 : 14, padding: small ? "7px 12px" : "12px 18px", borderRadius: small ? 9 : 12, border: kind ? "none" : `2px solid ${C.navy}`, background: bg, color: fg, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1, boxShadow: kind === "gold" ? `0 3px 0 ${C.goldDeep}` : "none", width: block ? "100%" : undefined }, style || {})}>{children}</button>;
}
function Eyebrow({ ui, children, color }) { return <div style={{ fontFamily: ui.HEAD, fontWeight: 600, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: color || ui.C.sub }}>{children}</div>; }
function Chip({ ui, children, color, bg, small }) {
  return <span style={{ display: "inline-block", padding: small ? "2px 7px" : "3px 9px", borderRadius: 99, fontSize: small ? 10.5 : 11.5, fontFamily: ui.HEAD, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: color || ui.C.navy, background: bg || ui.C.goldSoft, whiteSpace: "nowrap" }}>{children}</span>;
}
function Field({ ui, label, children, hint }) {
  return <label style={{ display: "block", marginBottom: 12 }}><span style={ui.lbl}>{label}</span>{children}{hint && <div style={{ fontSize: 11.5, color: ui.C.mute, marginTop: 4 }}>{hint}</div>}</label>;
}
const inputStyle = (ui, big) => ({ width: "100%", padding: big ? "14px 14px" : "10px 12px", fontSize: big ? 22 : 15, fontFamily: big ? ui.HEAD : ui.BODY, fontWeight: big ? 600 : 500, border: `2px solid ${ui.C.line}`, borderRadius: 12, background: "#fff", color: ui.C.ink, outline: "none", boxSizing: "border-box" });
function StatusChip({ ui, status }) {
  const C = ui.C;
  const m = { pending: ["Queued", TB.ink, TB.signalSoft], reviewed: ["Printing", TB.slate, TB.slateSoft], printed: ["Printed", "#fff", TB.posted], rejected: ["Sent back", "#fff", TB.pull], cancelled: ["Withdrawn", C.sub, C.line] }[status] || [status, C.sub, C.line];
  return <Chip ui={ui} color={m[1]} bg={m[2]}>{m[0]}</Chip>;
}
function ago(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 2) return "just now";
  if (m < 60) return m + " min ago";
  const h = Math.round(m / 60);
  if (h < 36) return h + " hr" + (h === 1 ? "" : "s") + " ago";
  const d = Math.round(h / 24);
  return d + " day" + (d === 1 ? "" : "s") + " ago";
}
const PREVIEW_MAT = { tagW: 3, tagH: 2, cols: 1, rows: 1 };
const CASE_MAT = { tagW: 8.5, tagH: 11, cols: 1, rows: 1 };
// The shape a preview should have: a template's own size, a case card's
// page, else the 3x2 reference tag.
function previewMat(style, format) {
  if (CORE.isTemplate(style) && style.templateW > 0 && style.templateH > 0) return { tagW: style.templateW, tagH: style.templateH, cols: 1, rows: 1 };
  return format === "case_card" ? CASE_MAT : PREVIEW_MAT;
}
// One tag, rendered by the shared core, at a given width in px.
function TagPreview({ req, style, material, widthPx, showAccount, opts }) {
  const mat = material || previewMat(style, req && req.format);
  const html = useMemo(() => CORE.renderPreviewHtml(req, style, mat, Object.assign({ showAccount: !!showAccount }, opts || {})), [JSON.stringify(req), JSON.stringify(style), JSON.stringify(mat), showAccount, JSON.stringify(opts || {})]);
  const scale = widthPx ? widthPx / (mat.tagW * 96) : 1;
  return <div style={{ width: mat.tagW * 96 * scale, height: mat.tagH * 96 * scale, overflow: "hidden" }}><div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: mat.tagW * 96, height: mat.tagH * 96 }} dangerouslySetInnerHTML={{ __html: html }} /></div>;
}
function styleFor(styles, req) { return CORE.resolveStyle(styles || [], req.chainId, req.styleIdOverride || req.styleId, req.format); }
function FormatChip({ ui, format }) { return format === "case_card" ? <Chip ui={ui} small color="#fff" bg={ui.C.navy}>Case card</Chip> : null; }

// The sheet's empty states: a Kraft mark, a Slate line, never an error tone.
function EmptyState({ ui, title, sub }) {
  return <div style={{ background: "#fff", border: `2px dashed ${TB.kraft}`, borderRadius: 16, padding: "26px 16px", textAlign: "center", marginBottom: 10 }}>
    <div style={{ display: "grid", placeItems: "center" }}><TagUpMark size={40} ink={TB.kraft} hole="#fff" /></div>
    <div style={{ fontFamily: ui.HEAD, fontWeight: 700, fontSize: 16, color: TB.ink, marginTop: 8 }}>{title}</div>
    <div style={{ fontSize: 13, color: TB.slate, marginTop: 3 }}>{sub}</div>
  </div>;
}

/* ================================================================
   REP SCREEN
   ================================================================ */
const BLANK = { storeId: "", storeName: "", chainId: null, chainLabel: "", styleId: null, format: "tag", contentType: "standard_price", itemNo: null, itemName: "", brand: "", itemFreeText: false, packageSize: "", price: "", wasPrice: "", multiBuyQty: "", note: "", copies: 1 };
const OP_NOTES = ["Discontinued", "Driver Pick Up", "Do Not Stock", "Temporarily Out", "New Item"];

function RepScreen({ ui, me, onBack, standalone }) {
  const C = ui.C;
  const [step, setStep] = useState("list");          // list | account | type | item | price | review | done
  const [f, setF] = useState(BLANK);
  const [accounts, setAccounts] = useState(null);
  const [scopeNote, setScopeNote] = useState("");
  const [styles, setStyles] = useState([]);
  const [mine, setMine] = useState(null);
  const [pendingTable, setPendingTable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const set = (patch) => setF((v) => Object.assign({}, v, patch));

  function loadMine() { jget(ui, "/api/requests?status=all&limit=60").then((r) => { setMine((r && r.requests) || []); setPendingTable(!!(r && r.pending)); }).catch(() => setMine([])); }
  useEffect(() => {
    loadMine();
    jget(ui, "/api/stores?styles=1").then((r) => { setAccounts((r && r.stores) || []); setScopeNote(r && r.scope === "all" && r.scopeReason && r.scopeReason !== "no-reps-on-list" ? (r.scopeReason === "rep-no-unmatched" ? "Your Rep # does not match any account on the list yet, so every store is shown. Ask your admin to check it under Team." : "The account list does not name you yet, so every store is shown. Ask your admin to set your Rep # under Team.") : ""); }).catch(() => setAccounts([]));
    jget(ui, "/api/setup").then((r) => setStyles((r && r.styles) || [])).catch(() => {});
  }, []);

  function startNew() { setF(BLANK); setErr(""); setQ(""); setStep("account"); }
  function pickAccount(a) { set({ storeId: a.id, storeName: a.name, chainId: a.chainId, chainLabel: a.chainLabel, styleId: a.styleId, caseCardStyleId: a.caseCardStyleId }); setQ(""); setStep("type"); }
  function pickType(id) { set({ contentType: id }); setStep("item"); }
  async function submit() {
    setBusy(true); setErr("");
    try {
      const r = await jpost(ui, "/api/requests", f);
      if (r && r.error) { setErr(r.error); setBusy(false); return; }
      setStep("done"); loadMine();
    } catch (e) { setErr("Couldn't reach the server."); }
    setBusy(false);
  }
  async function cancel(id) {
    if (!window.confirm("Withdraw this request?")) return;
    const r = await jpost(ui, "/api/requests/" + encodeURIComponent(id) + "/cancel");
    if (r && r.error) window.alert(r.error); else loadMine();
  }

  // The tagup header: Paper ground, the mark + wordmark, Ink type. Signal is
  // the accent (the mark, the primary button), never the type colour.
  const Header = ({ title, sub, back, brand }) => (
    <div style={{ background: TB.paper, padding: "14px 18px 16px", flexShrink: 0, borderBottom: `1px solid ${TB.kraft}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button onClick={back || onBack} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: TB.slate, display: "flex", alignItems: "center", gap: 5, fontWeight: 600, fontSize: 13, fontFamily: ui.BODY }}><Icon ui={ui} name="ChevronLeft" size={20} color={TB.slate} /> {back ? "Back" : (standalone ? "Sign out" : "Home")}</button>
        {!brand && <div style={{ display: "flex", alignItems: "center", gap: 6 }}><TagUpMark size={18} /><Wordmark size={17} /></div>}
      </div>
      {brand
        ? <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}><TagUpMark size={40} /><div><Wordmark size={34} /><div style={{ fontFamily: ui.HEAD, fontSize: 10.5, letterSpacing: 2.2, textTransform: "uppercase", color: TB.slate, marginTop: 2 }}>{TAGLINE}</div></div></div>
        : <div style={{ fontFamily: ui.DISP, fontSize: 30, color: TB.ink, lineHeight: 1, marginTop: 8 }}>{title}</div>}
      {sub && <div style={{ color: TB.slate, fontSize: 13, marginTop: 6 }}>{sub}</div>}
    </div>
  );
  const Steps = () => {
    const order = ["account", "type", "item", "price", "review"];
    const i = order.indexOf(step);
    return <div style={{ display: "flex", gap: 4, margin: "0 0 14px" }}>{order.map((s, k) => <div key={s} style={{ flex: 1, height: 4, borderRadius: 2, background: k <= i ? C.gold : C.line }} />)}</div>;
  };
  const wrap = (children) => <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px 40px" }}>{children}</div>;

  /* ---- list ---- */
  if (step === "list") {
    const open = (mine || []).filter((r) => r.status === "pending" || r.status === "reviewed");
    const back = (mine || []).filter((r) => r.status === "rejected");
    const done = (mine || []).filter((r) => r.status === "printed");
    const gone = (mine || []).filter((r) => r.status === "cancelled");
    const Row = ({ r }) => (
      <Card ui={ui} accent={r.status === "rejected" ? C.red : r.status === "printed" ? C.win : C.gold}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: ui.HEAD, fontWeight: 700, fontSize: 16, color: C.ink, textTransform: "uppercase" }}>{r.itemName} {r.price != null && <span style={Object.assign({ color: C.navy }, TABULAR)}>· {CORE.priceLine(r.price, r.multiBuyQty)}</span>}</div>
            <div style={{ fontSize: 12.5, color: C.sub, marginTop: 2 }}>{r.storeName}{r.packageSize ? " · " + r.packageSize : ""}{r.copies > 1 ? " · ×" + r.copies : ""}</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 7, flexWrap: "wrap" }}>
              <StatusChip ui={ui} status={r.status} />
              <FormatChip ui={ui} format={r.format} />
              <Chip ui={ui} small bg={C.lineCool}>{CORE.contentType(r.contentType) ? CORE.contentType(r.contentType).short : r.contentType}</Chip>
              <span style={{ fontSize: 11.5, color: C.mute }}>{ago(r.status === "printed" ? r.printedAt : r.updatedAt)}</span>
            </div>
            {r.status === "rejected" && r.rejectReason && <div style={{ marginTop: 8, background: C.redSoft, color: C.redDeep, borderRadius: 9, padding: "7px 10px", fontSize: 12.5, fontWeight: 600 }}>{r.rejectReason}</div>}
          </div>
          {r.status === "pending" && <button onClick={() => cancel(r.id)} title="Withdraw" style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><Icon ui={ui} name="X" size={18} color={C.mute} /></button>}
        </div>
      </Card>
    );
    return <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.paper }}>
      <Header brand sub="Price tags and shelf signs, made by the sign shop. Ask in seconds, see when they're printed." />
      {wrap(<>
        <button onClick={startNew} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 16, padding: "15px 18px", borderRadius: 14, border: "none", background: TB.signal, color: TB.ink, fontFamily: ui.HEAD, fontWeight: 700, fontSize: 16, textTransform: "uppercase", letterSpacing: 0.5, cursor: "pointer", boxShadow: "0 3px 0 #C24F0A" }}><TagUpMark size={20} ink={TB.ink} hole={TB.signal} /> Request a tag</button>
        {pendingTable && <Card ui={ui}><div style={{ fontSize: 13, color: C.sub }}>tagup is still finishing its setup. Try again in a minute.</div></Card>}
        {mine === null && <div style={{ color: C.sub, fontSize: 13 }}>Loading…</div>}
        {mine && !mine.length && !pendingTable && <EmptyState ui={ui} title="Nothing queued" sub="When you're ready to print, it'll show up here." />}
        {back.length > 0 && <><Eyebrow ui={ui} color={C.red}>Sent back — needs a new request</Eyebrow><div style={{ height: 8 }} />{back.map((r) => <Row key={r.id} r={r} />)}</>}
        {open.length > 0 && <><Eyebrow ui={ui}>Waiting on the sign shop ({open.length})</Eyebrow><div style={{ height: 8 }} />{open.map((r) => <Row key={r.id} r={r} />)}</>}
        {done.length > 0 && <><Eyebrow ui={ui}>Printed</Eyebrow><div style={{ height: 8 }} />{done.map((r) => <Row key={r.id} r={r} />)}</>}
        {gone.length > 0 && <div style={{ color: C.mute, fontSize: 12, marginTop: 6 }}>{gone.length} withdrawn</div>}
      </>)}
    </div>;
  }

  /* ---- account ---- */
  if (step === "account") {
    const list = (accounts || []).filter((a) => !q || (a.name + " " + (a.storeNo || "") + " " + (a.address || "") + " " + a.city + " " + a.chainLabel).toLowerCase().includes(q.toLowerCase()));
    return <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.paper }}>
      <Header title="WHICH ACCOUNT?" sub="The chain's tag style follows the account." back={() => setStep("list")} />
      {wrap(<>
        <Steps />
        <div style={{ position: "relative", marginBottom: 12 }}>
          <span style={{ position: "absolute", left: 12, top: 13 }}><Icon ui={ui} name="Search" size={18} color={C.mute} /></span>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your accounts" style={Object.assign(inputStyle(ui), { paddingLeft: 38 })} />
        </div>
        {scopeNote && <div style={{ background: TB.signalSoft, color: "#8A3A08", borderRadius: 10, padding: "8px 12px", fontSize: 12.5, fontWeight: 600, marginBottom: 10, lineHeight: 1.45 }}>{scopeNote}</div>}
        {accounts === null && <div style={{ color: C.sub, fontSize: 13 }}>Loading your route…</div>}
        {accounts && !accounts.length && <Card ui={ui}><div style={{ fontSize: 13, color: C.sub }}>No stores yet. An owner or admin adds them under Stores — one at a time or from a spreadsheet.</div></Card>}
        {list.slice(0, 80).map((a) => (
          <button key={a.id} onClick={() => pickAccount(a)} style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", marginBottom: 8, borderRadius: 14, border: `2px solid ${C.line}`, background: "#fff", cursor: "pointer", fontFamily: ui.BODY }}>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, color: C.ink, fontSize: 15 }}>{a.name}</div><div style={{ fontSize: 12, color: C.sub }}>{[a.address, a.city].filter(Boolean).join(", ")}{(a.address || a.city) && a.storeNo ? " · " : ""}{a.storeNo ? '#' + a.storeNo : ''}</div></div>
            <Chip ui={ui} small bg={a.chainId ? C.goldSoft : C.lineCool}>{a.chainLabel || "Independent"}</Chip>
            <Icon ui={ui} name="ChevronRight" size={18} color={C.mute} />
          </button>
        ))}
        {accounts && list.length > 80 && <div style={{ color: C.mute, fontSize: 12 }}>Showing 80 of {list.length} — keep typing.</div>}
      </>)}
    </div>;
  }

  /* ---- type ---- */
  if (step === "type") {
    return <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.paper }}>
      <Header title="WHAT KIND OF TAG?" back={() => setStep("account")} />
      {wrap(<>
        <Steps />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}><Icon ui={ui} name="Store" size={16} color={C.sub} /><span style={{ fontSize: 13, color: C.sub, flex: 1 }}>{f.storeName}</span><Chip ui={ui} small>{f.chainLabel || "Independent"}</Chip></div>
        {/* Format first: a shelf tag or a full-page case card. The chain's own
            artwork for each, when the sign shop has loaded it, follows the store. */}
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {CORE.FORMATS.map((fm) => <button key={fm.id} onClick={() => set({ format: fm.id })} style={{ flex: 1, padding: "12px 10px", borderRadius: 14, border: `2px solid ${f.format === fm.id ? C.gold : C.line}`, background: f.format === fm.id ? C.goldSoft : "#fff", cursor: "pointer", textAlign: "left", fontFamily: ui.BODY }}>
            <div style={{ fontFamily: ui.HEAD, fontWeight: 700, fontSize: 15, color: C.ink, textTransform: "uppercase" }}>{fm.label}</div><div style={{ fontSize: 11.5, color: C.sub }}>{fm.sub}</div>
          </button>)}
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {CORE.CONTENT_TYPES.map((t) => {
            const accent = t.id === "price_drop" ? C.red : t.id === "promo" ? C.win : t.id === "operational" ? C.sub : C.navy;
            return <button key={t.id} onClick={() => pickType(t.id)} style={{ textAlign: "left", display: "flex", alignItems: "center", gap: 14, padding: "18px 16px", borderRadius: 16, border: `2px solid ${C.line}`, borderLeft: `6px solid ${accent}`, background: "#fff", cursor: "pointer", fontFamily: ui.BODY }}>
              <div style={{ flex: 1 }}><div style={{ fontFamily: ui.HEAD, fontWeight: 700, fontSize: 19, color: C.ink, textTransform: "uppercase" }}>{t.label}</div><div style={{ fontSize: 12.5, color: C.sub, marginTop: 2 }}>{t.sub}</div></div>
              <Icon ui={ui} name="ChevronRight" size={20} color={C.mute} />
            </button>;
          })}
        </div>
      </>)}
    </div>;
  }

  /* ---- item ---- */
  if (step === "item") return <ItemStep ui={ui} f={f} set={set} onBack={() => setStep("type")} onNext={() => setStep("price")} Header={Header} Steps={Steps} wrap={wrap} />;

  /* ---- price ---- */
  if (step === "price") {
    const ct = f.contentType;
    const priceOk = !CORE.hasPrice(ct) || CORE.toPrice(f.price) > 0;
    const wasOk = !CORE.hasWas(ct) || (CORE.toPrice(f.wasPrice) != null && CORE.toPrice(f.wasPrice) > CORE.toPrice(f.price));
    const noteOk = CORE.hasPrice(ct) || !!f.note.trim();
    const canNext = priceOk && wasOk && noteOk;
    const multi = parseInt(f.multiBuyQty, 10) || 1;
    return <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.paper }}>
      <Header title={CORE.hasPrice(ct) ? "THE PRICE" : "THE MESSAGE"} sub={f.itemName + (f.packageSize ? " · " + f.packageSize : "")} back={() => setStep("item")} />
      {wrap(<>
        <Steps />
        {CORE.hasWas(ct) && <Field ui={ui} label="Was">
          <input inputMode="decimal" value={f.wasPrice} onChange={(e) => set({ wasPrice: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="0.00" style={inputStyle(ui, true)} />
        </Field>}
        {CORE.hasPrice(ct) && <Field ui={ui} label={CORE.hasWas(ct) ? "Now" : "Shelf price"}>
          <input autoFocus inputMode="decimal" value={f.price} onChange={(e) => set({ price: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="0.00" style={Object.assign(inputStyle(ui, true), { fontSize: 30, borderColor: C.gold })} />
        </Field>}
        {CORE.hasPrice(ct) && <Field ui={ui} label="Multi-buy" hint={multi > 1 ? `Prints as ${CORE.priceLine(f.price || 0, multi)}` : "One price per unit. Tap 2 for \"2/$5.99\"."}>
          <div style={{ display: "flex", gap: 8 }}>{[1, 2, 3, 4, 6].map((n) => <button key={n} onClick={() => set({ multiBuyQty: n === 1 ? "" : String(n) })} style={{ flex: 1, padding: "12px 0", borderRadius: 12, border: `2px solid ${multi === n ? C.gold : C.line}`, background: multi === n ? C.goldSoft : "#fff", fontFamily: ui.HEAD, fontWeight: 700, fontSize: 16, color: C.ink, cursor: "pointer" }}>{n === 1 ? "1" : n + "/"}</button>)}</div>
        </Field>}
        {!CORE.hasPrice(ct) && <Field ui={ui} label="Message on the tag">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>{OP_NOTES.map((n) => <button key={n} onClick={() => set({ note: n })} style={{ padding: "8px 12px", borderRadius: 99, border: `2px solid ${f.note === n ? C.gold : C.line}`, background: f.note === n ? C.goldSoft : "#fff", fontFamily: ui.HEAD, fontWeight: 700, fontSize: 12, textTransform: "uppercase", color: C.ink, cursor: "pointer" }}>{n}</button>)}</div>
          <input value={f.note} onChange={(e) => set({ note: e.target.value.slice(0, CORE.NOTE_MAX) })} placeholder="Or type your own" style={inputStyle(ui)} />
        </Field>}
        {CORE.hasPrice(ct) && <Field ui={ui} label="Second line (optional)" hint="Prints small under the price — e.g. Reg. $16.99, or $1.29 each, Sept 22 – Oct 5.">
          <input value={f.note} onChange={(e) => set({ note: e.target.value.slice(0, CORE.NOTE_MAX) })} placeholder="Reg. $16.99" style={inputStyle(ui)} />
        </Field>}
        <Field ui={ui} label="How many copies" hint="Same tag, printed more than once.">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => set({ copies: Math.max(1, f.copies - 1) })} style={{ width: 48, height: 48, borderRadius: 12, border: `2px solid ${C.line}`, background: "#fff", fontSize: 22, cursor: "pointer" }}>−</button>
            <div style={{ fontFamily: ui.HEAD, fontWeight: 700, fontSize: 24, width: 40, textAlign: "center" }}>{f.copies}</div>
            <button onClick={() => set({ copies: Math.min(50, f.copies + 1) })} style={{ width: 48, height: 48, borderRadius: 12, border: `2px solid ${C.line}`, background: "#fff", fontSize: 22, cursor: "pointer" }}>+</button>
          </div>
        </Field>
        {CORE.hasWas(ct) && f.wasPrice && f.price && !wasOk && <div style={{ color: C.redDeep, fontSize: 13, fontWeight: 600, marginBottom: 10 }}>The was-price has to be higher than the new price.</div>}
        <Btn ui={ui} kind="gold" block disabled={!canNext} onClick={() => setStep("review")}>Review →</Btn>
      </>)}
    </div>;
  }

  /* ---- review ---- */
  if (step === "review") {
    const st = CORE.resolveStyle(styles, f.chainId, null, f.format);
    const preview = Object.assign({}, f, { price: CORE.toPrice(f.price), wasPrice: CORE.toPrice(f.wasPrice), multiBuyQty: parseInt(f.multiBuyQty, 10) || null, chainLabel: f.chainLabel });
    return <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.paper }}>
      <Header title="LOOK RIGHT?" sub="A rough preview — the sign shop prints it in the chain's real style." back={() => setStep("price")} />
      {wrap(<>
        <Steps />
        <div style={{ display: "grid", placeItems: "center", padding: "14px 0 18px" }}><div style={{ boxShadow: "0 6px 20px rgba(0,0,0,.18)", borderRadius: 4 }}><TagPreview req={preview} style={st} widthPx={Math.min(f.format === "case_card" ? 240 : 300, (window.innerWidth || 360) - 60)} /></div></div>
        <Card ui={ui}>
          {[["Store", f.storeName], ["Style", (f.chainLabel || "Independent") + " · " + st.name + (CORE.isTemplate(st) ? " (chain template)" : "")], ["Format", CORE.formatOf(f.format).label], ["Tag", CORE.contentType(f.contentType).label], ["Item", f.itemName + (f.itemFreeText ? " (typed)" : "")], ["Size", f.packageSize || "—"],
            CORE.hasPrice(f.contentType) ? ["Price", (CORE.hasWas(f.contentType) ? "was " + CORE.fmtPrice(f.wasPrice) + " → " : "") + CORE.priceLine(f.price, f.multiBuyQty)] : ["Message", f.note],
            ["Copies", String(f.copies)]].map(([k, v]) => <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: `1px solid ${C.line}`, fontSize: 14 }}><span style={{ color: C.sub }}>{k}</span><span style={{ fontWeight: 600, color: C.ink, textAlign: "right" }}>{v}</span></div>)}
        </Card>
        {err && <div style={{ color: C.redDeep, fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{err}</div>}
        <Btn ui={ui} kind="gold" block disabled={busy} onClick={submit} style={{ fontSize: 16, padding: "15px 18px" }}>{busy ? "Sending…" : "Send to the sign shop"}</Btn>
      </>)}
    </div>;
  }

  /* ---- done ---- */
  return <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.paper }}>
    <Header title="SENT" back={() => setStep("list")} />
    {wrap(<>
      <div style={{ display: "grid", placeItems: "center", padding: "30px 0 10px" }}><div style={{ width: 72, height: 72, borderRadius: 99, background: TB.postedSoft, display: "grid", placeItems: "center" }}><Icon ui={ui} name="Check" size={36} color={TB.posted} /></div></div>
      <div style={{ textAlign: "center", fontFamily: ui.HEAD, fontWeight: 700, fontSize: 20, color: TB.ink, textTransform: "uppercase" }}>Queued — the sign shop will review</div>
      <div style={{ textAlign: "center", fontFamily: ui.HEAD, fontSize: 10.5, letterSpacing: 2.2, textTransform: "uppercase", color: TB.signal, marginTop: 4 }}>{TAGLINE}</div>
      <div style={{ textAlign: "center", fontSize: 13.5, color: C.sub, marginTop: 6, marginBottom: 22 }}>{f.itemName} for {f.storeName}. You'll see it flip to Printed here, or come back with a reason if something's off.</div>
      <Btn ui={ui} kind="gold" block onClick={startNew} style={{ marginBottom: 10 }}>Request another</Btn>
      <Btn ui={ui} block onClick={() => setStep("list")}>My requests</Btn>
    </>)}
  </div>;
}

function ItemStep({ ui, f, set, onBack, onNext, Header, Steps, wrap }) {
  const C = ui.C;
  const [q, setQ] = useState(f.itemName || "");
  const [hits, setHits] = useState([]);
  const [source, setSource] = useState(null);
  const timer = useRef(null);
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      jget(ui, "/api/catalog" + qs({ q: q.trim(), limit: 12 })).then((r) => { setHits((r && r.items) || []); setSource(r && r.source); }).catch(() => setHits([]));
    }, 220);
    return () => clearTimeout(timer.current);
  }, [q]);
  const typed = q.trim();
  const chosen = f.itemName && !f.itemFreeText;
  function pick(it) { set({ itemNo: it.itemNo || null, itemName: it.name, itemFreeText: false, brand: it.brand || "", packageSize: f.packageSize || it.pack || "" }); setQ(it.name); }
  function useTyped() { set({ itemNo: null, itemName: typed.slice(0, CORE.ITEM_MAX), itemFreeText: true, brand: "" }); }
  const canNext = !!f.itemName;
  return <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.paper }}>
    <Header title="WHICH ITEM?" sub={source === "none" ? "No item list loaded yet — type the item." : "Pick from your item list, or type it."} back={onBack} />
    {wrap(<>
      <Steps />
      <div style={{ position: "relative", marginBottom: 10 }}>
        <span style={{ position: "absolute", left: 12, top: 13 }}><Icon ui={ui} name="Search" size={18} color={C.mute} /></span>
        <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); if (chosen) set({ itemName: "", itemNo: null, itemFreeText: false }); }} placeholder="Michelob Ultra 12pk…" style={Object.assign(inputStyle(ui), { paddingLeft: 38 })} />
      </div>
      {chosen && <Card ui={ui} accent={C.win}><div style={{ display: "flex", alignItems: "center", gap: 10 }}><Icon ui={ui} name="Check" size={18} color={C.win} /><div style={{ flex: 1 }}><div style={{ fontWeight: 700, color: C.ink }}>{f.itemName}</div><div style={{ fontSize: 12, color: C.sub }}>{f.itemNo ? "#" + f.itemNo : ""}</div></div></div></Card>}
      {!chosen && typed.length > 1 && <>
        {hits.slice(0, 8).map((it, i) => (
          <button key={it.itemNo + "-" + i} onClick={() => pick(it)} style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", marginBottom: 6, borderRadius: 12, border: `2px solid ${C.line}`, background: "#fff", cursor: "pointer", fontFamily: ui.BODY }}>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, color: C.ink, fontSize: 14.5 }}>{it.name}</div><div style={{ fontSize: 12, color: C.sub }}>{[it.pack, it.itemNo ? "#" + it.itemNo : ""].filter(Boolean).join(" · ")}</div></div>
          </button>
        ))}
        <button onClick={useTyped} style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", marginBottom: 6, borderRadius: 12, border: `2px dashed ${f.itemFreeText ? C.gold : C.line}`, background: f.itemFreeText ? C.goldSoft : "#fff", cursor: "pointer", fontFamily: ui.BODY }}>
          <div style={{ flex: 1 }}><div style={{ fontWeight: 600, color: C.ink, fontSize: 14.5 }}>Use “{typed}” as typed</div><div style={{ fontSize: 12, color: C.sub }}>The sign shop will double-check the name.</div></div>
          {f.itemFreeText && <Icon ui={ui} name="Check" size={18} color={C.goldDeep} />}
        </button>
      </>}
      <Field ui={ui} label="Package / size" hint="As it should read on the tag, e.g. 12pk 12oz Cans.">
        <input value={f.packageSize} onChange={(e) => set({ packageSize: e.target.value.slice(0, 40) })} placeholder="12pk 12oz Cans" style={inputStyle(ui)} />
      </Field>
      <Btn ui={ui} kind="gold" block disabled={!canNext} onClick={onNext}>Next →</Btn>
    </>)}
  </div>;
}

/* ================================================================
   THE SIGN SHOP: queue, batches, styles, materials
   ================================================================ */
function Section({ ui, branch, role, me, god, kind, showPrintable }) {
  const C = ui.C;
  const [tab, setTab] = useState("queue");
  const [setup, setSetup] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const bump = () => setReloadKey((k) => k + 1);
  const bq = qs({ branch: kind === "comms" ? branch : null });
  useEffect(() => { jget(ui, "/api/setup" + bq).then(setSetup).catch(() => setSetup({ error: "Couldn't load TagUp setup." })); }, [branch, reloadKey]);
  const canEdit = !!(setup && setup.canEdit);
  const Pill = ({ id, label }) => <button onClick={() => setTab(id)} style={{ padding: "7px 15px", borderRadius: 99, cursor: "pointer", border: "1.5px solid " + (tab === id ? C.navy : "rgba(0,0,0,.16)"), background: tab === id ? C.navy : "transparent", color: tab === id ? C.cream : C.navy, fontFamily: ui.HEAD, fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</button>;
  return <div>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
      <Pill id="queue" label="Queue" /><Pill id="batches" label="Print batches" />
      {canEdit && <><Pill id="styles" label="Chain styles" /><Pill id="materials" label="Materials" /><Pill id="brands" label="Brand logos" /></>}
    </div>
    {setup && setup.pending && <Card ui={ui}><div style={{ fontSize: 13, color: C.sub, lineHeight: 1.6 }}>tagup is still finishing its setup. Give it a minute and reload.</div></Card>}
    {setup && setup.error && <Card ui={ui} accent={C.red}><div style={{ color: C.red, fontSize: 13 }}>{setup.error}</div></Card>}
    {tab === "queue" && <Queue ui={ui} branch={branch} bq={bq} setup={setup} canEdit={canEdit} onChanged={bump} reloadKey={reloadKey} />}
    {tab === "batches" && <Batches ui={ui} branch={branch} bq={bq} setup={setup} canEdit={canEdit} onChanged={bump} reloadKey={reloadKey} showPrintable={showPrintable} />}
    {tab === "styles" && canEdit && <StylesEditor ui={ui} branch={branch} bq={bq} setup={setup} onChanged={bump} />}
    {tab === "materials" && canEdit && <MaterialsEditor ui={ui} branch={branch} bq={bq} setup={setup} onChanged={bump} />}
    {tab === "brands" && canEdit && <BrandsPanel ui={ui} />}
  </div>;
}

/* ---------------- queue ---------------- */
function Queue({ ui, branch, bq, setup, canEdit, onChanged, reloadKey }) {
  const C = ui.C;
  const [status, setStatus] = useState("pending");
  const [data, setData] = useState(null);
  const [sel, setSel] = useState({});
  const [editing, setEditing] = useState(null);
  const [materialId, setMaterialId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [chainFilter, setChainFilter] = useState("");
  const [importing, setImporting] = useState(false);
  function load() { jget(ui, "/api/requests" + bq + (bq ? "&" : "?") + "status=" + status + "&limit=500").then((r) => { setData(r); setSel({}); }).catch(() => setData({ requests: [], error: "Couldn't load the queue." })); }
  useEffect(() => { load(); }, [branch, status, reloadKey]);
  const materials = (setup && setup.materials || []).filter((m) => m.active);
  useEffect(() => { if (!materialId && materials.length) setMaterialId(materials[0].id); }, [materials.length]);
  const reqs = (data && data.requests) || [];
  const styles = (data && data.styles) || (setup && setup.styles) || [];
  const chains = useMemo(() => { const m = {}; reqs.forEach((r) => { const k = r.chainId || "__ind"; const e = m[k] || (m[k] = { id: k, label: r.chainLabel || "Independent", n: 0 }); e.n++; }); return Object.values(m).sort((a, b) => b.n - a.n); }, [reqs]);
  const shown = chainFilter ? reqs.filter((r) => (r.chainId || "__ind") === chainFilter) : reqs;
  const selIds = Object.keys(sel).filter((k) => sel[k]);
  const mat = materials.find((m) => m.id === materialId);
  const tiled = mat && selIds.length ? CORE.tile(reqs.filter((r) => sel[r.id]), mat) : null;
  function toggle(id) { setSel((s) => Object.assign({}, s, { [id]: !s[id] })); }
  function selectAll(list) { setSel((s) => { const n = Object.assign({}, s); list.forEach((r) => { if (r.status === "pending") n[r.id] = true; }); return n; }); }
  async function batch() {
    if (!selIds.length || !mat) return;
    setBusy(true); setMsg("");
    const r = await jpost(ui, "/api/batches", { branch, materialId: mat.id, requestIds: selIds });
    setBusy(false);
    if (r && r.error) { setMsg(r.error); return; }
    setMsg(`Batch made: ${r.batch.count} request${r.batch.count === 1 ? "" : "s"}, ${r.batch.cells} tag${r.batch.cells === 1 ? "" : "s"} on ${r.batch.sheets} sheet${r.batch.sheets === 1 ? "" : "s"}. Print it from Print batches.`);
    onChanged();
  }
  async function reject(r) {
    const reason = window.prompt("Send back to " + (r.userName || "the rep") + " — why? (they see this)", "");
    if (!reason) return;
    const x = await jpost(ui, "/api/requests/" + encodeURIComponent(r.id) + "/reject", { reason });
    if (x && x.error) window.alert(x.error); else onChanged();
  }
  async function unbatch(r) { const x = await jpost(ui, "/api/requests/" + encodeURIComponent(r.id) + "/unbatch"); if (x && x.error) window.alert(x.error); else onChanged(); }
  const Filter = ({ id, label }) => <button onClick={() => setStatus(id)} style={{ padding: "6px 12px", borderRadius: 99, cursor: "pointer", border: `1.5px solid ${status === id ? C.gold : "rgba(0,0,0,.14)"}`, background: status === id ? C.goldSoft : "#fff", color: C.navy, fontFamily: ui.HEAD, fontWeight: 700, fontSize: 11.5, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</button>;
  return <div>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
      <Filter id="pending" label="Pending" /><Filter id="reviewed" label="In a batch" /><Filter id="printed" label="Printed" /><Filter id="rejected" label="Sent back" /><Filter id="all" label="All" />
      <span style={{ flex: 1 }} />
      {data && !data.error && <span style={{ fontSize: 12.5, color: C.sub }}>{reqs.length} request{reqs.length === 1 ? "" : "s"}</span>}
      {canEdit && <Btn ui={ui} kind="navy" small onClick={() => setImporting(true)}>Import price book</Btn>}
      <a href={"/api/export" + bq + (bq ? "&" : "?") + "status=" + status} onClick={(e) => { e.preventDefault(); downloadAuth(ui, e.currentTarget.href, "tagup-" + status + ".xlsx"); }} style={{ fontFamily: ui.HEAD, fontWeight: 700, fontSize: 12, textTransform: "uppercase", color: C.navy, textDecoration: "none", padding: "7px 10px", border: `2px solid ${C.navy}`, borderRadius: 9 }}>Export .xlsx</a>
    </div>
    {importing && <ImportModal ui={ui} branch={branch} bq={bq} setup={setup} onClose={() => setImporting(false)} onDone={() => { setImporting(false); onChanged(); }} />}
    {chains.length > 1 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
      <button onClick={() => setChainFilter("")} style={{ padding: "4px 10px", borderRadius: 99, border: `1.5px solid ${!chainFilter ? C.navy : C.line}`, background: !chainFilter ? C.navy : "#fff", color: !chainFilter ? C.cream : C.navy, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: ui.HEAD }}>Every chain</button>
      {chains.map((c) => <button key={c.id} onClick={() => setChainFilter(chainFilter === c.id ? "" : c.id)} style={{ padding: "4px 10px", borderRadius: 99, border: `1.5px solid ${chainFilter === c.id ? C.navy : C.line}`, background: chainFilter === c.id ? C.navy : "#fff", color: chainFilter === c.id ? C.cream : C.navy, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: ui.HEAD }}>{c.label} · {c.n}</button>)}
    </div>}
    {data && data.error && <Card ui={ui} accent={C.red}><div style={{ color: C.red, fontSize: 13 }}>{data.error}</div></Card>}
    {data && !data.error && !shown.length && (status === "pending" ? <EmptyState ui={ui} title="Nothing queued" sub="When you're ready to print, it'll show up here." /> : <EmptyState ui={ui} title="Nothing here" sub="Try another filter." />)}
    {canEdit && status === "pending" && shown.length > 0 && <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, fontSize: 12.5, color: C.sub }}>
      <button onClick={() => selectAll(shown)} style={{ background: "none", border: "none", color: C.navy, fontWeight: 700, cursor: "pointer", fontSize: 12.5, padding: 0 }}>Select all shown</button>
      <span>·</span>
      <button onClick={() => setSel({})} style={{ background: "none", border: "none", color: C.navy, fontWeight: 700, cursor: "pointer", fontSize: 12.5, padding: 0 }}>Clear</button>
    </div>}
    {shown.map((r) => <RequestRow key={r.id} ui={ui} r={r} styles={styles} canEdit={canEdit} selected={!!sel[r.id]} onToggle={() => toggle(r.id)} onEdit={() => setEditing(r)} onReject={() => reject(r)} onUnbatch={() => unbatch(r)} />)}
    {editing && <EditRequest ui={ui} r={editing} styles={styles} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
    {canEdit && selIds.length > 0 && <div style={{ position: "sticky", bottom: 0, background: C.navy, color: C.cream, borderRadius: 14, padding: "12px 14px", marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", boxShadow: "0 -4px 16px rgba(0,0,0,.15)" }}>
      <div style={{ fontFamily: ui.HEAD, fontWeight: 700, fontSize: 14, textTransform: "uppercase" }}>{selIds.length} selected{tiled ? ` · ${tiled.cells} tags · ${tiled.sheets.length} sheet${tiled.sheets.length === 1 ? "" : "s"}` : ""}</div>
      <select value={materialId} onChange={(e) => setMaterialId(e.target.value)} style={{ padding: "8px 10px", borderRadius: 9, border: "none", fontSize: 13, fontFamily: ui.BODY }}>
        {materials.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.perSheet}/sheet</option>)}
      </select>
      <Btn ui={ui} kind="gold" small disabled={busy || !mat} onClick={batch}>Make a print batch</Btn>
    </div>}
    {msg && <div style={{ marginTop: 10, background: C.winSoft, color: C.win, borderRadius: 10, padding: "9px 12px", fontSize: 13, fontWeight: 600 }}>{msg}</div>}
  </div>;
}
function RequestRow({ ui, r, styles, canEdit, selected, onToggle, onEdit, onReject, onUnbatch }) {
  const C = ui.C;
  const st = styleFor(styles, r);
  const ct = CORE.contentType(r.contentType);
  const accent = r.status === "rejected" ? C.red : r.status === "printed" ? C.win : r.contentType === "price_drop" ? C.red : r.contentType === "promo" ? C.win : C.navy;
  return <div style={{ display: "flex", gap: 12, alignItems: "stretch", background: "#fff", border: `2px solid ${selected ? C.gold : C.line}`, borderLeft: `5px solid ${accent}`, borderRadius: 14, padding: 12, marginBottom: 8 }}>
    {canEdit && r.status === "pending" && <label style={{ display: "grid", placeItems: "center", paddingRight: 2 }}><input type="checkbox" checked={selected} onChange={onToggle} style={{ width: 20, height: 20 }} /></label>}
    <div style={{ flexShrink: 0 }}><TagPreview req={r} style={st} widthPx={r.format === "case_card" || CORE.isTemplate(st) ? 120 : 150} /></div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontFamily: ui.HEAD, fontWeight: 700, fontSize: 15, color: C.ink, textTransform: "uppercase" }}>{r.itemName}</span>
        <FormatChip ui={ui} format={r.format} />
        {r.itemFreeText && <Chip ui={ui} small color={C.redDeep} bg={C.redSoft} >Typed — check name</Chip>}
        {r.editedBy && <Chip ui={ui} small bg={C.lineCool}>Edited</Chip>}
        {r.brandLogoKey && <Chip ui={ui} small bg={C.winSoft} color={C.win}>Brand logo</Chip>}
        {r.importId && <Chip ui={ui} small bg={C.lineCool}>Imported</Chip>}
        <StatusChip ui={ui} status={r.status} />
      </div>
      <div style={Object.assign({ fontSize: 12.5, color: C.sub, marginTop: 3 }, TABULAR)}>{r.packageSize || "no size"} · {ct ? ct.label : r.contentType}{r.price != null ? " · " + (CORE.hasWas(r.contentType) ? "was " + CORE.fmtPrice(r.wasPrice) + " → " : "") + CORE.priceLine(r.price, r.multiBuyQty) : " · " + r.note}{r.copies > 1 ? " · ×" + r.copies : ""}</div>
      <div style={{ fontSize: 12.5, color: C.ink, marginTop: 5 }}><b>{r.storeName}</b> {r.storeNo ? <span style={{ color: C.mute }}>#{r.storeNo}</span> : null} · <Chip ui={ui} small>{r.chainLabel || "Independent"}</Chip> <span style={{ color: C.mute }}>→ {st.name}{CORE.isTemplate(st) ? " · chain template" : ""}</span></div>
      <div style={{ fontSize: 12, color: C.mute, marginTop: 4 }}>{r.userName} · {ago(r.createdAt)}{r.status === "rejected" && r.rejectReason ? " · sent back: " + r.rejectReason : ""}</div>
    </div>
    {canEdit && CORE.isOpen(r.status) && <div style={{ display: "flex", flexDirection: "column", gap: 6, justifyContent: "center" }}>
      <Btn ui={ui} small onClick={onEdit}>Edit</Btn>
      {r.status === "reviewed" ? <Btn ui={ui} small onClick={onUnbatch} title="Pull out of its batch">Un-batch</Btn> : <Btn ui={ui} small kind="red" onClick={onReject}>Send back</Btn>}
    </div>}
  </div>;
}
function EditRequest({ ui, r, styles, onClose, onSaved }) {
  const C = ui.C;
  const [f, setF] = useState({ contentType: r.contentType, format: r.format || "tag", itemName: r.itemName, itemNo: r.itemNo || "", itemFreeText: r.itemFreeText, packageSize: r.packageSize, price: r.price == null ? "" : String(r.price), wasPrice: r.wasPrice == null ? "" : String(r.wasPrice), multiBuyQty: r.multiBuyQty || "", note: r.note, copies: r.copies, styleIdOverride: r.styleIdOverride || "" });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const set = (p) => setF((v) => Object.assign({}, v, p));
  async function save() {
    setBusy(true); setErr("");
    const x = await jput(ui, "/api/requests/" + encodeURIComponent(r.id), Object.assign({}, f, { styleIdOverride: f.styleIdOverride || null, itemFreeText: f.itemFreeText }));
    setBusy(false);
    if (x && x.error) setErr(x.error); else onSaved();
  }
  const preview = Object.assign({}, r, f, { price: CORE.toPrice(f.price), wasPrice: CORE.toPrice(f.wasPrice), multiBuyQty: parseInt(f.multiBuyQty, 10) || null, styleIdOverride: f.styleIdOverride || null });
  return createPortal(<div style={{ position: "fixed", inset: 0, zIndex: 8000, background: "rgba(11,30,57,.6)", display: "grid", placeItems: "center", padding: 16 }} onClick={onClose}>
    <div onClick={(e) => e.stopPropagation()} style={{ background: C.paper, borderRadius: 18, padding: 18, width: "min(620px, 100%)", maxHeight: "92vh", overflowY: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}><div style={{ fontFamily: ui.HEAD, fontWeight: 700, fontSize: 18, color: C.navy, textTransform: "uppercase" }}>Edit request</div><button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><Icon ui={ui} name="X" size={20} color={C.sub} /></button></div>
      <div style={{ display: "grid", placeItems: "center", marginBottom: 12 }}><TagPreview req={preview} style={styleFor(styles, preview)} widthPx={f.format === "case_card" ? 200 : 260} /></div>
      <div style={{ display: "flex", gap: 10 }}>
        <Field ui={ui} label="Format"><select value={f.format} onChange={(e) => set({ format: e.target.value })} style={inputStyle(ui)}>{CORE.FORMATS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></Field>
        <Field ui={ui} label="Tag type"><select value={f.contentType} onChange={(e) => set({ contentType: e.target.value })} style={inputStyle(ui)}>{CORE.CONTENT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></Field>
      </div>
      <Field ui={ui} label="Item"><input value={f.itemName} onChange={(e) => set({ itemName: e.target.value, itemFreeText: false })} style={inputStyle(ui)} /></Field>
      <div style={{ display: "flex", gap: 10 }}>
        <Field ui={ui} label="Package / size"><input value={f.packageSize} onChange={(e) => set({ packageSize: e.target.value })} style={inputStyle(ui)} /></Field>
        <Field ui={ui} label="Item #"><input value={f.itemNo} onChange={(e) => set({ itemNo: e.target.value })} style={inputStyle(ui)} /></Field>
      </div>
      {CORE.hasPrice(f.contentType) && <div style={{ display: "flex", gap: 10 }}>
        {CORE.hasWas(f.contentType) && <Field ui={ui} label="Was"><input inputMode="decimal" value={f.wasPrice} onChange={(e) => set({ wasPrice: e.target.value })} style={inputStyle(ui)} /></Field>}
        <Field ui={ui} label={CORE.hasWas(f.contentType) ? "Now" : "Price"}><input inputMode="decimal" value={f.price} onChange={(e) => set({ price: e.target.value })} style={inputStyle(ui)} /></Field>
        <Field ui={ui} label="Multi-buy qty"><input inputMode="numeric" value={f.multiBuyQty} onChange={(e) => set({ multiBuyQty: e.target.value })} placeholder="1" style={inputStyle(ui)} /></Field>
      </div>}
      <Field ui={ui} label={CORE.hasPrice(f.contentType) ? "Second line (alt text)" : "Message"}><input value={f.note} onChange={(e) => set({ note: e.target.value })} placeholder={CORE.hasPrice(f.contentType) ? "Reg. $16.99 · or $1.29 each" : ""} style={inputStyle(ui)} /></Field>
      <div style={{ display: "flex", gap: 10 }}>
        <Field ui={ui} label="Copies"><input inputMode="numeric" value={f.copies} onChange={(e) => set({ copies: e.target.value })} style={inputStyle(ui)} /></Field>
        <Field ui={ui} label="Style override" hint="Blank = the store's chain style."><select value={f.styleIdOverride} onChange={(e) => set({ styleIdOverride: e.target.value })} style={inputStyle(ui)}><option value="">— chain default —</option>{(styles || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      </div>
      {err && <div style={{ color: C.redDeep, fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><Btn ui={ui} onClick={onClose}>Cancel</Btn><Btn ui={ui} kind="gold" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</Btn></div>
    </div>
  </div>, document.body);
}

/* ---------------- Excel import / export ---------------- */
// The export and the template are files, and an <a href> cannot send the
// auth header: fetch with it, then hand the blob to the browser.
async function downloadAuth(ui, url, name) {
  try {
    const r = await fetch(url, { headers: ui.H() });
    if (!r.ok) { window.alert("Couldn't build the file (" + r.status + ")."); return; }
    const blob = await r.blob(); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  } catch (e) { window.alert("Couldn't download."); }
}
/* A chain's price book -> requests. Tagify's import, in three moves: pick
   the file and who it is for, read the preview (every row ok / adjusted /
   error with the reason), then import. Nothing is written until the last
   click, and the same call does both -- the preview IS the import with
   apply off, so what it shows is what it makes. */
function ImportModal({ ui, branch, bq, setup, onClose, onDone }) {
  const C = ui.C;
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState("account");
  const [storeId, setAccountId] = useState("");
  const [chainId, setChainId] = useState("");
  const [format, setFormat] = useState("tag");
  const [contentType, setContentType] = useState("standard_price");
  const [accounts, setAccounts] = useState(null);
  const [q, setQ] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { jget(ui, "/api/stores?styles=1").then((r) => setAccounts((r && r.stores) || [])).catch(() => setAccounts([])); }, [branch]);
  const chains = (setup && setup.chains) || [];
  const acct = (accounts || []).find((a) => a.id === storeId);
  const list = (accounts || []).filter((a) => !q || (a.name + " " + (a.storeNo || "") + " " + a.chainLabel).toLowerCase().includes(q.toLowerCase())).slice(0, 12);
  async function run(apply) {
    if (!file) { setErr("Pick the spreadsheet first."); return; }
    if (mode === "account" && !storeId) { setErr("Pick the store."); return; }
    if (mode === "chain" && !chainId) { setErr("Pick the chain."); return; }
    setBusy(apply ? "apply" : "preview"); setErr("");
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("mode", mode); fd.append("storeId", storeId); fd.append("chainId", chainId); fd.append("format", format); fd.append("contentType", contentType); if (apply) fd.append("apply", "1");
      const h = ui.H(); delete h["Content-Type"];
      const r = await fetch("/api/import", { method: "POST", headers: h, body: fd }).then(j);
      if (r && r.error) { setErr(r.error + (r.sheets ? " (tabs: " + r.sheets.join(", ") + ")" : "")); setPreview(null); }
      else if (apply) { setPreview(r); setBusy(""); onDone(); window.alert("Imported " + r.created + " request" + (r.created === 1 ? "" : "s") + " into the queue."); return; }
      else setPreview(r);
    } catch (e) { setErr("Couldn't reach the server."); }
    setBusy("");
  }
  const rows = (preview && preview.rows) || [];
  const shown = showAll ? rows : rows.filter((r) => r.status !== "ok").concat(rows.filter((r) => r.status === "ok")).slice(0, 60);
  const St = ({ s }) => { const m = { ok: ["OK", "#fff", C.win], adjusted: ["Adjusted", C.navy, C.goldSoft], error: ["Error", "#fff", C.red], skipped: ["Skipped", C.sub, C.line] }[s] || [s, C.sub, C.line]; return <Chip ui={ui} small color={m[1]} bg={m[2]}>{m[0]}</Chip>; };
  const Seg = ({ value, options, onPick }) => <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{options.map((o) => <button key={o.id} onClick={() => onPick(o.id)} style={{ padding: "7px 10px", borderRadius: 10, border: `2px solid ${value === o.id ? C.gold : C.line}`, background: value === o.id ? C.goldSoft : "#fff", fontFamily: ui.HEAD, fontWeight: 700, fontSize: 11.5, textTransform: "uppercase", cursor: "pointer" }}>{o.label}</button>)}</div>;
  return createPortal(<div style={{ position: "fixed", inset: 0, zIndex: 8000, background: "rgba(11,30,57,.6)", display: "grid", placeItems: "center", padding: 16 }} onClick={onClose}>
    <div onClick={(e) => e.stopPropagation()} style={{ background: C.paper, borderRadius: 18, padding: 18, width: "min(1000px, 100%)", maxHeight: "94vh", overflowY: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}><div style={{ fontFamily: ui.HEAD, fontWeight: 700, fontSize: 18, color: C.navy, textTransform: "uppercase" }}>Import a price book</div><button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><Icon ui={ui} name="X" size={20} color={C.sub} /></button></div>
      <div style={{ fontSize: 13, color: C.sub, marginBottom: 12, lineHeight: 1.55 }}>A spreadsheet with a <b>Brand</b> (or Item Description), <b>Package</b> and <b>Price</b> column — the header can be on any row, and Was / Type / Format / Store / Quantity / Alt text / Item # are read when they are there. Prices like <i>2/$3</i>, <i>10 for $10</i> and <i>2/$5 or $2.69 each</i> are understood. <a href="#" onClick={(e) => { e.preventDefault(); downloadAuth(ui, "/api/import/template", "tagup-import-template.xlsx"); }} style={{ color: C.navy, fontWeight: 700 }}>Download the template</a>.</div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 14 }}>
        <div>
          <Field ui={ui} label="Spreadsheet"><input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { setFile(e.target.files && e.target.files[0]); setPreview(null); }} style={{ fontSize: 12 }} /></Field>
          <Field ui={ui} label="These tags are for"><Seg value={mode} options={[{ id: "account", label: "One store" }, { id: "chain", label: "Every store of a chain" }, { id: "column", label: "The sheet's Store column" }]} onPick={(v) => { setMode(v); setPreview(null); }} /></Field>
          {mode === "account" && <Field ui={ui} label="Store" hint={acct ? acct.name + " · " + (acct.chainLabel || "Independent") : "Search your stores."}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Stripes #2134" style={inputStyle(ui)} />
            {q && <div style={{ border: `1.5px solid ${C.line}`, borderRadius: 10, marginTop: 4, background: "#fff", maxHeight: 180, overflowY: "auto" }}>{list.map((a) => <button key={a.id} onClick={() => { setAccountId(a.id); setQ(""); setPreview(null); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", border: "none", borderBottom: `1px solid ${C.line}`, background: a.id === storeId ? C.goldSoft : "#fff", cursor: "pointer", fontSize: 13 }}>{a.name} <span style={{ color: C.mute }}>{a.storeNo ? "#" + a.storeNo + " · " : ""}{a.chainLabel}</span></button>)}{!list.length && <div style={{ padding: 8, fontSize: 12, color: C.mute }}>No store matches.</div>}</div>}
          </Field>}
          {mode === "chain" && <Field ui={ui} label="Chain" hint="One set of tags per store of that chain."><select value={chainId} onChange={(e) => { setChainId(e.target.value); setPreview(null); }} style={inputStyle(ui)}><option value="">— pick —</option>{chains.map((c) => <option key={c.id} value={c.id}>{c.label} · {c.stores} store{c.stores === 1 ? "" : "s"}</option>)}</select></Field>}
          {mode === "column" && <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 12 }}>Each row's Store cell is matched to one of your stores by number or name. A row whose store is not found is an error you will see below.</div>}
        </div>
        <div>
          <Field ui={ui} label="Format unless a row says otherwise"><Seg value={format} options={CORE.FORMATS} onPick={setFormat} /></Field>
          <Field ui={ui} label="Tag type unless a row says otherwise" hint="A row with a Was price becomes a promo on its own."><Seg value={contentType} options={CORE.CONTENT_TYPES.filter((t) => t.id !== "operational").map((t) => ({ id: t.id, label: t.label }))} onPick={setContentType} /></Field>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}><Btn ui={ui} kind="navy" disabled={!!busy || !file} onClick={() => run(false)}>{busy === "preview" ? "Reading…" : "Preview"}</Btn></div>
        </div>
      </div>
      {err && <div style={{ color: C.redDeep, fontSize: 13, fontWeight: 600, marginTop: 10 }}>{err}</div>}
      {preview && <div style={{ marginTop: 14 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <Eyebrow ui={ui}>What tagup sees — tab “{preview.sheet}”, header on row {preview.headerRow}</Eyebrow><span style={{ flex: 1 }} />
          <Chip ui={ui} color="#fff" bg={C.win}>{preview.counts.ok || 0} ok</Chip><Chip ui={ui} bg={C.goldSoft}>{preview.counts.adjusted || 0} adjusted</Chip><Chip ui={ui} color="#fff" bg={C.red}>{preview.counts.error || 0} errors</Chip>{preview.counts.skipped ? <Chip ui={ui} color={C.sub} bg={C.line}>{preview.counts.skipped} skipped</Chip> : null}
        </div>
        <div style={{ fontSize: 13, color: C.ink, marginBottom: 8 }}>Columns read: <b>{preview.columns.join(", ")}</b>{preview.targets ? <> · Stores: <b>{preview.targets.length === 1 ? preview.targets[0].name : preview.targets.length + " " + (chains.find((c) => c.id === chainId) || {}).label + " stores"}</b></> : null} · Will make <b>{preview.wouldCreate}</b> request{preview.wouldCreate === 1 ? "" : "s"}.</div>
        <div style={{ border: `1.5px solid ${C.line}`, borderRadius: 12, overflow: "hidden", background: "#fff" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead><tr style={{ background: C.paper, fontFamily: ui.HEAD, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: C.sub }}>{["Row", "Status", "Item", "Package", "Price", "Type", mode === "column" ? "Store" : "Style", "Notes"].map((h) => <th key={h} style={{ textAlign: "left", padding: "7px 8px" }}>{h}</th>)}</tr></thead>
            <tbody>{shown.map((r) => <tr key={r.n} style={{ borderTop: `1px solid ${C.line}`, background: r.status === "error" ? C.redSoft : "#fff" }}>
              <td style={{ padding: "6px 8px", color: C.mute }}>{r.n}</td><td style={{ padding: "6px 8px" }}><St s={r.status} /></td>
              <td style={{ padding: "6px 8px", fontWeight: 600 }}>{r.itemName || r.description || r.brand}{r.itemNo ? <span style={{ color: C.mute, fontWeight: 400 }}> #{r.itemNo}</span> : null}</td>
              <td style={{ padding: "6px 8px" }}>{r.packageSize}</td>
              <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{r.price != null ? (r.wasPrice != null ? "was " + CORE.fmtPrice(r.wasPrice) + " → " : "") + CORE.priceLine(r.price, r.multiQty) : (r.note || "—")}{r.copies > 1 ? " ×" + r.copies : ""}</td>
              <td style={{ padding: "6px 8px" }}>{(CORE.contentType(r.contentType) || {}).short}{r.format === "case_card" ? " · case card" : ""}</td>
              <td style={{ padding: "6px 8px" }}>{mode === "column" ? (r.store ? r.store.name : "—") : r.styleName}</td>
              <td style={{ padding: "6px 8px", color: r.error ? C.redDeep : C.sub, fontSize: 12 }}>{r.error || r.notes.join("; ")}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {rows.length > shown.length && <button onClick={() => setShowAll(true)} style={{ background: "none", border: "none", color: C.navy, fontWeight: 700, fontSize: 12.5, cursor: "pointer", marginTop: 6 }}>Show all {rows.length} rows</button>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14, alignItems: "center" }}>
          {preview.counts.error > 0 && <span style={{ fontSize: 12.5, color: C.sub }}>Rows with errors are skipped; fix the sheet and preview again, or import the rest.</span>}
          <Btn ui={ui} onClick={onClose}>Cancel</Btn>
          <Btn ui={ui} kind="gold" disabled={!!busy || !preview.wouldCreate} onClick={() => { if (window.confirm("Import " + preview.wouldCreate + " request" + (preview.wouldCreate === 1 ? "" : "s") + " into the queue?")) run(true); }}>{busy === "apply" ? "Importing…" : "Import " + preview.wouldCreate + " request" + (preview.wouldCreate === 1 ? "" : "s")}</Btn>
        </div>
      </div>}
    </div>
  </div>, document.body);
}

/* ---------------- batches ---------------- */
function Batches({ ui, branch, bq, setup, canEdit, onChanged, reloadKey, showPrintable }) {
  const C = ui.C;
  const [data, setData] = useState(null);
  useEffect(() => { jget(ui, "/api/batches" + bq).then(setData).catch(() => setData({ batches: [], error: "Couldn't load batches." })); }, [branch, reloadKey]);
  const list = (data && data.batches) || [];
  async function printed(b) { if (!window.confirm("Mark this batch printed? Every rep gets told their tags are ready.")) return; const x = await jpost(ui, "/api/batches/" + encodeURIComponent(b.id) + "/printed"); if (x && x.error) window.alert(x.error); else onChanged(); }
  async function dissolve(b) { if (!window.confirm("Dissolve this batch? Its requests go back to pending.")) return; const x = await jpost(ui, "/api/batches/" + encodeURIComponent(b.id) + "/delete"); if (x && x.error) window.alert(x.error); else onChanged(); }
  function print(b) { if (showPrintable) showPrintable("/api/batches/" + encodeURIComponent(b.id) + "/print", "tagup — " + (b.material ? b.material.name : "print sheet")); else window.open("/api/batches/" + encodeURIComponent(b.id) + "/print", "_blank"); }
  const open = list.filter((b) => b.status !== "printed"), done = list.filter((b) => b.status === "printed");
  const Row = ({ b }) => <Card ui={ui} accent={b.status === "printed" ? C.win : C.gold}>
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontFamily: ui.HEAD, fontWeight: 700, fontSize: 15, color: C.ink, textTransform: "uppercase" }}>{b.material ? b.material.name : b.materialId} <span style={{ color: C.sub, fontWeight: 500 }}>· {b.count} request{b.count === 1 ? "" : "s"}</span></div>
        <div style={{ fontSize: 12.5, color: C.sub, marginTop: 3 }}>{b.status === "printed" ? "Printed " + ago(b.printedAt) : b.status === "generated" ? "Print sheet opened " + ago(b.generatedAt) + " — mark it printed when it's off the printer" : "Not printed yet"} · made by {b.createdBy.name || "—"} {ago(b.createdAt)}</div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Btn ui={ui} kind="navy" small onClick={() => print(b)}>{b.status === "printed" ? "Reprint" : "Print sheet"}</Btn>
        {canEdit && b.status !== "printed" && <Btn ui={ui} kind="gold" small onClick={() => printed(b)}>Mark printed</Btn>}
        {canEdit && b.status !== "printed" && <Btn ui={ui} small onClick={() => dissolve(b)}>Dissolve</Btn>}
      </div>
    </div>
  </Card>;
  return <div>
    {data && data.error && <Card ui={ui} accent={C.red}><div style={{ color: C.red, fontSize: 13 }}>{data.error}</div></Card>}
    {data && !data.error && !list.length && <Card ui={ui}><div style={{ fontFamily: ui.HEAD, fontWeight: 600, fontSize: 16, color: C.navy }}>No print batches yet</div><div style={{ fontSize: 13, color: C.sub, marginTop: 3 }}>Tick requests in the Queue, pick the sheet the printer has loaded, and make a batch. It shows up here to print.</div></Card>}
    {open.length > 0 && <><Eyebrow ui={ui}>To print</Eyebrow><div style={{ height: 8 }} />{open.map((b) => <Row key={b.id} b={b} />)}</>}
    {done.length > 0 && <><Eyebrow ui={ui}>Printed</Eyebrow><div style={{ height: 8 }} />{done.map((b) => <Row key={b.id} b={b} />)}</>}
    <div style={{ fontSize: 12, color: C.mute, marginTop: 8, lineHeight: 1.5 }}>The print sheet opens in the app. Use the browser's Print with margins set to <b>None</b> and scale <b>100%</b>; choose “Save as PDF” there if you want a file.</div>
  </div>;
}

/* ---------------- styles ---------------- */
const SAMPLES = {
  standard_price: Object.assign({}, CORE.SAMPLE_REQUEST),
  promo: Object.assign({}, CORE.SAMPLE_REQUEST, { contentType: "promo", wasPrice: 16.99 }),
  price_drop: Object.assign({}, CORE.SAMPLE_REQUEST, { contentType: "price_drop", wasPrice: 16.99, price: 13.99 }),
  operational: Object.assign({}, CORE.SAMPLE_REQUEST, { contentType: "operational", price: null, note: "Discontinued" }),
};
// A PDF template is rasterized here, in the browser, page 1 at up to 2400px --
// the chain-slides path (pdf.js from cdnjs on demand). The page's own size in
// points gives the printed size for free.
const PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
let _pdfjsLoading = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (_pdfjsLoading) return _pdfjsLoading;
  _pdfjsLoading = new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = PDFJS_CDN; s.async = true;
    s.onload = () => { try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; res(window.pdfjsLib); } catch (e) { rej(e); } };
    s.onerror = () => { _pdfjsLoading = null; rej(new Error("Couldn't load the PDF reader — check the connection and try again.")); };
    document.head.appendChild(s);
  });
  return _pdfjsLoading;
}
const TPL_MAX_PX = 2400;
// One cell out of a sheet of tags: equal grid, 1-based cell number, row-major.
// Returns the cropped tag as a data URL plus its share of the sheet.
function cropCellImage(dataUrl, cols, rows, cell) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const c = Math.max(1, cols | 0), r = Math.max(1, rows | 0), n = Math.min(c * r, Math.max(1, cell | 0)) - 1;
      const cw = img.width / c, ch = img.height / r;
      const cv = document.createElement("canvas"); cv.width = Math.round(cw); cv.height = Math.round(ch);
      cv.getContext("2d").drawImage(img, (n % c) * cw, Math.floor(n / c) * ch, cw, ch, 0, 0, cv.width, cv.height);
      res({ dataUrl: cv.toDataURL("image/png"), fracW: 1 / c, fracH: 1 / r });
    };
    img.onerror = () => rej(new Error("Couldn't read the artwork to crop it."));
    img.src = dataUrl;
  });
}
async function fileToTemplateImage(file) {
  if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
    const lib = await loadPdfJs();
    const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    const page = await doc.getPage(1);
    const vp0 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(4, TPL_MAX_PX / Math.max(vp0.width, vp0.height)) });
    const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    return { dataUrl: c.toDataURL("image/jpeg", 0.92), inW: Math.round(vp0.width / 72 * 100) / 100, inH: Math.round(vp0.height / 72 * 100) / 100, pages: doc.numPages };
  }
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > TPL_MAX_PX || h > TPL_MAX_PX) { if (w >= h) { h = Math.round(h * TPL_MAX_PX / w); w = TPL_MAX_PX; } else { w = Math.round(w * TPL_MAX_PX / h); h = TPL_MAX_PX; } }
      const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      // A PNG keeps its transparency when it is small enough to ship as-is.
      const png = /png$/i.test(file.type) && file.size < 2.5 * 1024 * 1024;
      res({ dataUrl: png ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.92), inW: null, inH: null, pages: 1 });
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Couldn't read that file — use a PNG, JPG or PDF.")); };
    img.src = url;
  });
}
function StylesEditor({ ui, branch, bq, setup, onChanged }) {
  const C = ui.C;
  const [edit, setEdit] = useState(null);
  const styles = (setup && setup.styles) || [];
  const chains = (setup && setup.chains) || [];
  const live = styles.filter((s) => s.active), retired = styles.filter((s) => !s.active);
  const covered = {}; live.forEach((s) => { if (s.chainId) covered[s.chainId + "|" + (s.format || "tag")] = s; });
  const uncovered = CORE.FORMATS.map((fm) => ({ format: fm, chains: chains.filter((c) => !covered[c.id + "|" + fm.id]) })).filter((x) => x.chains.length);
  function newFor(chain, format, kind) {
    const sz = CORE.defaultTemplateSize(format);
    setEdit({ id: null, name: chain ? chain.label : "", chainId: chain ? chain.id : null, format: format || "tag", kind: kind || "composed", templateKey: null, templateW: sz.w, templateH: sz.h, fields: CORE.defaultTemplateFields(format || "tag"), theme: Object.assign({}, CORE.DEFAULT_THEME), logoKey: null, isNew: true });
  }
  async function retire(s, restore) { const x = await jpost(ui, "/api/styles/" + encodeURIComponent(s.id) + "/retire", { branch, restore: !!restore }); if (x && x.error) window.alert(x.error); else onChanged(); }
  const chainLabel = (id) => (chains.find((c) => c.id === id) || {}).label || id;
  return <div>
    <div style={{ fontSize: 13, color: C.sub, marginBottom: 12, lineHeight: 1.55 }}>One look per chain per format. <b>Chain template</b> = the chain's own artwork with the live fields placed on it, for chains that hand down their tag or case card. <b>Layout</b> = a look built from colors and a logo. A store with no chain — or a chain with no style yet — prints in <b>Independent</b>. Materials (the sheet) are separate.</div>
    {uncovered.map((u) => <Card ui={ui} key={u.format.id} accent={C.gold}>
      <Eyebrow ui={ui}>{u.format.label}s — chains with no style yet</Eyebrow>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>{u.chains.map((c) => <span key={c.id} style={{ display: "inline-flex", border: `1.5px solid ${C.line}`, borderRadius: 99, overflow: "hidden", background: "#fff" }}>
        <span style={{ padding: "7px 10px", fontFamily: ui.HEAD, fontWeight: 700, fontSize: 12, color: C.navy }}>{c.label} <span style={{ color: C.mute }}>· {c.stores}</span></span>
        <button onClick={() => newFor(c, u.format.id, "template")} title="Upload the chain's own artwork" style={{ padding: "7px 10px", border: "none", borderLeft: `1px solid ${C.line}`, background: C.goldSoft, fontFamily: ui.HEAD, fontWeight: 700, fontSize: 11.5, color: C.navy, cursor: "pointer" }}>+ Template</button>
        <button onClick={() => newFor(c, u.format.id, "composed")} title="Build a look from colors and a logo" style={{ padding: "7px 10px", border: "none", borderLeft: `1px solid ${C.line}`, background: "#fff", fontFamily: ui.HEAD, fontWeight: 700, fontSize: 11.5, color: C.navy, cursor: "pointer" }}>+ Layout</button>
      </span>)}</div>
      <div style={{ fontSize: 12, color: C.mute, marginTop: 8 }}>Until then they print as Independent.</div>
    </Card>)}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
      {live.map((s) => <Card ui={ui} key={s.id} style={{ marginBottom: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
          <div style={{ minWidth: 0 }}><div style={{ fontFamily: ui.HEAD, fontWeight: 700, fontSize: 15, color: C.ink, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</div><div style={{ fontSize: 12, color: C.sub, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}><span>{s.chainId ? chainLabel(s.chainId) : "Independent — the fallback"}</span><FormatChip ui={ui} format={s.format} />{CORE.isTemplate(s) && <Chip ui={ui} small bg={C.goldSoft}>Chain template</Chip>}{(s.rules || []).length > 0 && <Chip ui={ui} small bg={C.lineCool}>{s.rules.length} rule{s.rules.length === 1 ? "" : "s"}</Chip>}</div></div>
          <Btn ui={ui} small onClick={() => setEdit(Object.assign({}, s))}>Edit</Btn>
        </div>
        <div style={{ display: "grid", placeItems: "center" }}><TagPreview req={Object.assign({}, SAMPLES.standard_price, { format: s.format, chainLabel: s.name })} style={s} widthPx={s.format === "case_card" || CORE.isTemplate(s) ? 200 : 240} /></div>
        {CORE.isTemplate(s) && !s.templateKey && <div style={{ marginTop: 8, background: C.redSoft, color: C.redDeep, borderRadius: 9, padding: "6px 10px", fontSize: 12, fontWeight: 600 }}>No artwork uploaded yet — this style prints blank behind the fields.</div>}
        {s.chainId && <div style={{ textAlign: "right", marginTop: 8 }}><button onClick={() => retire(s)} style={{ background: "none", border: "none", color: C.mute, fontSize: 12, cursor: "pointer" }}>Retire</button></div>}
      </Card>)}
      <div style={{ border: `2px dashed ${C.line}`, borderRadius: 16, minHeight: 120, display: "grid", placeItems: "center", gap: 8, padding: 14 }}>
        <Btn ui={ui} kind="gold" small onClick={() => newFor(null, "tag", "template")}>+ Upload a template</Btn>
        <Btn ui={ui} small onClick={() => newFor(null, "tag", "composed")}>+ Build a layout</Btn>
      </div>
    </div>
    {retired.length > 0 && <div style={{ marginTop: 14, fontSize: 12.5, color: C.sub }}>Retired: {retired.map((s) => <span key={s.id}>{s.name} <button onClick={() => retire(s, true)} style={{ background: "none", border: "none", color: C.navy, fontWeight: 700, cursor: "pointer", fontSize: 12 }}>restore</button> </span>)}</div>}
    {edit && <StyleForm ui={ui} branch={branch} chains={chains} style={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onChanged(); }} />}
  </div>;
}
/* Conditional formatting on a layout style. One row per rule: WHEN a field
   meets a condition, SET colours and/or a line of copy. Rules run top to
   bottom and the sample tag beside the form re-renders through the same
   applyRules the print sheet uses, so what the author sees is what prints. */
const RULE_FIELD_LABELS = { price: "Price", wasPrice: "Was price", multiBuyQty: "Multi-buy qty", contentType: "Tag type", format: "Format", itemName: "Item name", packageSize: "Package" };
const RULE_OP_LABELS = { eq: "is", neq: "is not", gte: "is at least", lte: "is at most", between: "is between", in: "is one of", contains: "contains", exists: "is set" };
function RulesEditor({ ui, rules, onChange }) {
  const C = ui.C;
  const list = rules || [];
  const upd = (i, patch) => onChange(list.map((r, k) => (k === i ? Object.assign({}, r, patch) : r)));
  const updWhen = (i, patch) => upd(i, { when: Object.assign({}, list[i].when, patch) });
  const updSet = (i, patch) => { const set = Object.assign({}, list[i].set, patch); Object.keys(set).forEach((k) => { if (set[k] === undefined || set[k] === null || set[k] === false) delete set[k]; }); upd(i, { set }); };
  const add = () => onChange(list.concat([{ label: "", when: { field: "price", op: "gte", value: 0 }, set: {} }]));
  const preset = (id) => { const p = CORE.RULE_PRESETS.find((x) => x.id === id); if (p) onChange(list.concat(p.rules.map((r) => JSON.parse(JSON.stringify(r))))); };
  const small = Object.assign({}, inputStyle(ui), { padding: "6px 8px", fontSize: 12.5, width: "auto", minWidth: 0 });
  const ColorSet = ({ i, k, label }) => { const on = !!list[i].set[k]; return <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: C.ink, padding: "3px 6px", borderRadius: 8, border: `1.5px solid ${on ? C.gold : C.line}`, background: on ? C.goldSoft : "#fff" }}><input type="checkbox" checked={on} onChange={(e) => updSet(i, { [k]: e.target.checked ? "#FFC20E" : undefined })} />{label}{on && <input type="color" value={list[i].set[k]} onChange={(e) => updSet(i, { [k]: e.target.value })} style={{ width: 24, height: 20, border: "none", background: "none", padding: 0 }} />}</label>; };
  const isNum = (f) => /^(price|wasPrice|multiBuyQty)$/.test(f);
  return <div style={{ marginBottom: 12 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}><span style={ui.lbl}>Rules</span><span style={{ flex: 1 }} /><select value="" onChange={(e) => preset(e.target.value)} style={Object.assign({}, small, { fontWeight: 600 })}><option value="">Start from a preset…</option>{CORE.RULE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
    <div style={{ fontSize: 11.5, color: C.mute, marginBottom: 8, lineHeight: 1.5 }}>When a field meets a condition, change colours or add a line. Rules run top to bottom; a later one wins. In text, <code>{"{price}"}</code> <code>{"{was}"}</code> <code>{"{each}"}</code> fill in from the tag.</div>
    {list.map((r, i) => { const w = r.when || {}; return <div key={i} style={{ background: "#fff", border: `1.5px solid ${C.line}`, borderRadius: 12, padding: 10, marginBottom: 8 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontFamily: ui.HEAD, fontWeight: 700, fontSize: 11, color: C.sub, textTransform: "uppercase" }}>When</span>
        <select value={w.field} onChange={(e) => updWhen(i, { field: e.target.value })} style={small}>{CORE.RULE_FIELDS.map((f) => <option key={f} value={f}>{RULE_FIELD_LABELS[f] || f}</option>)}</select>
        <select value={w.op} onChange={(e) => updWhen(i, { op: e.target.value })} style={small}>{CORE.RULE_OPS.filter((o) => isNum(w.field) ? o !== "contains" : (o !== "gte" && o !== "lte" && o !== "between")).map((o) => <option key={o} value={o}>{RULE_OP_LABELS[o]}</option>)}</select>
        {w.op === "between" && <><input inputMode="decimal" value={w.lo == null ? "" : w.lo} onChange={(e) => updWhen(i, { lo: e.target.value })} placeholder="from" style={Object.assign({}, small, { width: 70 })} /><input inputMode="decimal" value={w.hi == null ? "" : w.hi} onChange={(e) => updWhen(i, { hi: e.target.value })} placeholder="to" style={Object.assign({}, small, { width: 70 })} /></>}
        {w.op === "in" && <input value={Array.isArray(w.values) ? w.values.join(", ") : (w.values || "")} onChange={(e) => updWhen(i, { values: e.target.value })} placeholder="a, b, c" style={Object.assign({}, small, { width: 140 })} />}
        {w.op !== "between" && w.op !== "in" && w.op !== "exists" && (w.field === "contentType" ? <select value={w.value || ""} onChange={(e) => updWhen(i, { value: e.target.value })} style={small}>{CORE.CONTENT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
          : w.field === "format" ? <select value={w.value || ""} onChange={(e) => updWhen(i, { value: e.target.value })} style={small}>{CORE.FORMATS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
          : <input inputMode={isNum(w.field) ? "decimal" : "text"} value={w.value == null ? "" : w.value} onChange={(e) => updWhen(i, { value: e.target.value })} placeholder={isNum(w.field) ? "0.00" : "text"} style={Object.assign({}, small, { width: 90 })} />)}
        <span style={{ flex: 1 }} />
        <input value={r.label || ""} onChange={(e) => upd(i, { label: e.target.value })} placeholder="label (optional)" style={Object.assign({}, small, { width: 120, fontSize: 11.5 })} />
        <button onClick={() => onChange(list.filter((_, k) => k !== i))} title="Remove rule" style={{ background: "none", border: "none", color: C.red, cursor: "pointer", padding: 2 }}><Icon ui={ui} name="X" size={16} color={C.red} /></button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontFamily: ui.HEAD, fontWeight: 700, fontSize: 11, color: C.sub, textTransform: "uppercase" }}>Set</span>
        <ColorSet i={i} k="bg" label="Background" /><ColorSet i={i} k="fg" label="Text" /><ColorSet i={i} k="accent" label="Band" /><ColorSet i={i} k="priceColor" label="Price" />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: C.ink }}><input type="checkbox" checked={!!r.set.hideWas} onChange={(e) => updSet(i, { hideWas: e.target.checked || undefined })} />Hide was-price</label>
        <input value={r.set.note || ""} onChange={(e) => updSet(i, { note: e.target.value || undefined })} placeholder="Second line, e.g. Reg. {was}" style={Object.assign({}, small, { flex: "1 1 160px" })} />
        <input value={r.set.caption || ""} onChange={(e) => updSet(i, { caption: e.target.value || undefined })} placeholder="Caption" style={Object.assign({}, small, { width: 120 })} />
      </div>
    </div>; })}
    <button onClick={add} style={{ padding: "7px 12px", borderRadius: 10, border: `1.5px dashed ${C.line}`, background: "#fff", fontFamily: ui.HEAD, fontWeight: 700, fontSize: 12, color: C.navy, cursor: "pointer" }}>+ Add a rule</button>
  </div>;
}
function StyleForm({ ui, branch, chains, style, onClose, onSaved }) {
  const C = ui.C;
  const [s, setS] = useState(() => Object.assign({ format: "tag", kind: "composed", fields: [] }, style));
  const [sample, setSample] = useState("standard_price");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const [logoData, setLogoData] = useState(null);       // a new logo upload, not yet saved ("" = remove)
  const [tplData, setTplData] = useState(null);         // a new artwork upload, not yet saved
  const [tplBusy, setTplBusy] = useState(false);
  const [tryReq, setTryReq] = useState({ price: "", multi: "", was: "" });   // "try a price" over the sample
  const [crop, setCrop] = useState({ open: false, cols: 3, rows: 6, cell: 1 });   // artwork is a whole sheet: cut one tag out
  const sheetRef = useRef(null);                                              // the uploaded sheet, kept so a re-crop starts from the original
  const th = CORE.themeMerge(s.theme);
  const isTpl = s.kind === "template";
  const setT = (p) => setS((v) => Object.assign({}, v, { theme: Object.assign({}, v.theme, p) }));
  const setF = (fields) => setS((v) => Object.assign({}, v, { fields }));
  function onLogo(e) {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    if (f.size > 1.5 * 1024 * 1024) { setErr("Logo must be under 1.5 MB — a PNG a few hundred pixels wide is plenty."); return; }
    const rd = new FileReader(); rd.onload = () => setLogoData(String(rd.result)); rd.readAsDataURL(f);
  }
  async function onTemplate(e) {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    if (f.size > 12 * 1024 * 1024) { setErr("That file is over 12 MB — export a smaller PDF or PNG."); return; }
    setTplBusy(true); setErr("");
    try {
      const r = await fileToTemplateImage(f);
      setTplData(r.dataUrl);
      sheetRef.current = { dataUrl: r.dataUrl, inW: r.inW, inH: r.inH };
      if (r.inW && r.inH) setS((v) => Object.assign({}, v, { templateW: r.inW, templateH: r.inH }));
      if (r.pages > 1) setErr("That PDF has " + r.pages + " pages — page 1 is the template. Export a single page if that is wrong.");
    } catch (ex) { setErr(String(ex && ex.message || ex)); }
    setTplBusy(false);
  }
  async function cropSheet() {
    let src = sheetRef.current && sheetRef.current.dataUrl;
    if (!src && s.templateKey) {
      // artwork already on file: pull it back as a data URL so the crop starts from the original
      try { const blob = await fetch("/api/assets/ttpl/" + encodeURIComponent(s.templateKey)).then((r) => r.blob()); src = await new Promise((res) => { const rd = new FileReader(); rd.onload = () => res(String(rd.result)); rd.readAsDataURL(blob); }); sheetRef.current = { dataUrl: src, inW: parseFloat(s.templateW) || null, inH: parseFloat(s.templateH) || null }; } catch (e) { setErr("Couldn't load the artwork on file."); return; }
    }
    if (!src) { setErr("Upload the sheet first."); return; }
    setTplBusy(true); setErr("");
    try {
      const out = await cropCellImage(src, crop.cols, crop.rows, crop.cell);
      setTplData(out.dataUrl);
      const sh = sheetRef.current;
      if (sh && sh.inW && sh.inH) setS((v) => Object.assign({}, v, { templateW: Math.round(sh.inW * out.fracW * 1000) / 1000, templateH: Math.round(sh.inH * out.fracH * 1000) / 1000 }));
    } catch (ex) { setErr(String(ex && ex.message || ex)); }
    setTplBusy(false);
  }
  async function save() {
    setBusy(true); setErr("");
    const x = await jpost(ui, "/api/styles", { branch, id: s.id, name: s.name, chainId: s.chainId || null, format: s.format, kind: s.kind, templateW: s.templateW, templateH: s.templateH, fields: s.fields, theme: th, rules: s.rules || [] });
    if (x && x.error) { setErr(x.error); setBusy(false); return; }
    if (logoData !== null) { const y = await jpost(ui, "/api/styles/" + encodeURIComponent(x.style.id) + "/logo", { branch, dataUrl: logoData || null }); if (y && y.error) { setErr(y.error); setBusy(false); return; } }
    if (tplData) { const z = await jpost(ui, "/api/styles/" + encodeURIComponent(x.style.id) + "/template", { branch, dataUrl: tplData, templateW: s.templateW, templateH: s.templateH }); if (z && z.error) { setErr(z.error); setBusy(false); return; } }
    setBusy(false); onSaved();
  }
  // The style as it will print, with any pending uploads swapped in.
  const previewStyle = Object.assign({}, s, { theme: th, logoKey: logoData === "" ? null : s.logoKey, templateSrc: tplData || s.templateSrc || null });
  const sampleReq = Object.assign({}, SAMPLES[sample], { format: s.format, chainLabel: s.name },
    CORE.toPrice(tryReq.price) != null ? { price: CORE.toPrice(tryReq.price) } : {},
    tryReq.multi ? { multiBuyQty: parseInt(tryReq.multi, 10) || null } : {},
    CORE.toPrice(tryReq.was) != null ? { wasPrice: CORE.toPrice(tryReq.was) } : {});
  const rulesHit = !isTpl ? CORE.applyRules(s.rules || [], th, sampleReq).hit : [];
  const Color = ({ k, label }) => <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.ink }}><input type="color" value={th[k]} onChange={(e) => setT({ [k]: e.target.value })} style={{ width: 34, height: 28, border: "none", background: "none", padding: 0 }} />{label}</label>;
  const Toggle = ({ k, label }) => <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.ink }}><input type="checkbox" checked={!!th[k]} onChange={(e) => setT({ [k]: e.target.checked })} />{label}</label>;
  const Seg = ({ value, options, onPick }) => <div style={{ display: "flex", gap: 6 }}>{options.map((o) => <button key={o.id} onClick={() => onPick(o.id)} title={o.sub} style={{ flex: 1, padding: "8px 6px", borderRadius: 10, border: `2px solid ${value === o.id ? C.gold : C.line}`, background: value === o.id ? C.goldSoft : "#fff", fontFamily: ui.HEAD, fontWeight: 700, fontSize: 12, textTransform: "uppercase", cursor: "pointer" }}>{o.label}</button>)}</div>;
  return createPortal(<div style={{ position: "fixed", inset: 0, zIndex: 8000, background: "rgba(11,30,57,.6)", display: "grid", placeItems: "center", padding: 16 }} onClick={onClose}>
    <div onClick={(e) => e.stopPropagation()} style={{ background: C.paper, borderRadius: 18, padding: 18, width: "min(1080px, 100%)", maxHeight: "94vh", overflowY: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}><div style={{ fontFamily: ui.HEAD, fontWeight: 700, fontSize: 18, color: C.navy, textTransform: "uppercase" }}>{s.isNew ? "New style" : "Edit style"}</div><button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><Icon ui={ui} name="X" size={20} color={C.sub} /></button></div>
      <div style={{ display: "grid", gridTemplateColumns: isTpl ? "minmax(0, 300px) minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 1fr)", gap: 18 }}>
        <div>
          <Field ui={ui} label="Name"><input value={s.name} onChange={(e) => setS((v) => Object.assign({}, v, { name: e.target.value }))} placeholder="Stripes / 7-Eleven" style={inputStyle(ui)} /></Field>
          <Field ui={ui} label="Chain" hint="Every store of this chain prints in this style.">
            <select value={s.chainId || ""} onChange={(e) => setS((v) => Object.assign({}, v, { chainId: e.target.value || null }))} disabled={!s.isNew && !s.chainId} style={inputStyle(ui)}>
              <option value="">Independent (no chain)</option>
              {chains.map((c) => <option key={c.id} value={c.id}>{c.label} · {c.stores} store{c.stores === 1 ? "" : "s"}</option>)}
            </select>
          </Field>
          <Field ui={ui} label="Format"><Seg value={s.format} options={CORE.FORMATS} onPick={(id) => setS((v) => { const sz = CORE.defaultTemplateSize(id); const fresh = v.isNew && !tplData; return Object.assign({}, v, { format: id, templateW: fresh ? sz.w : v.templateW, templateH: fresh ? sz.h : v.templateH, fields: fresh ? CORE.defaultTemplateFields(id) : v.fields }); })} /></Field>
          <Field ui={ui} label="Made from"><Seg value={s.kind} options={[{ id: "template", label: "Chain template", sub: "The chain's own artwork" }, { id: "composed", label: "Layout", sub: "Colors, font, logo" }]} onPick={(id) => setS((v) => Object.assign({}, v, { kind: id, fields: v.fields && v.fields.length ? v.fields : CORE.defaultTemplateFields(v.format) }))} /></Field>
          {isTpl && <>
            <Field ui={ui} label="Artwork" hint="PNG, JPG or a one-page PDF of ONE blank tag or sign -- the live price, package and brand logo go on top of it. Got a whole sheet of sample tags instead? Crop one out below.">
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input type="file" accept="image/*,application/pdf,.pdf" onChange={onTemplate} style={{ fontSize: 12 }} />
                {tplBusy && <span style={{ fontSize: 12, color: C.sub }}>Reading…</span>}
                {(s.templateKey || tplData) && !tplBusy && <span style={{ fontSize: 12, color: C.win, fontWeight: 700 }}>{tplData ? "New artwork ready" : "Artwork on file"}</span>}
              </div>
              {(s.templateKey || tplData) && <div style={{ marginTop: 8 }}>
                <button type="button" onClick={() => setCrop(Object.assign({}, crop, { open: !crop.open }))} style={{ background: "none", border: "none", padding: 0, color: C.navy, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{crop.open ? "▾" : "▸"} The artwork is a whole sheet of tags — crop one</button>
                {crop.open && <div style={{ marginTop: 6, background: "#fff", border: `1.5px solid ${C.line}`, borderRadius: 10, padding: 10 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                    {[["cols", "Columns"], ["rows", "Rows"], ["cell", "Take tag #"]].map(([k, label]) => <label key={k} style={{ fontSize: 11, fontFamily: ui.HEAD, fontWeight: 600, letterSpacing: 0.6, textTransform: "uppercase", color: C.sub }}>{label}<input inputMode="numeric" value={crop[k]} onChange={(e) => setCrop(Object.assign({}, crop, { [k]: e.target.value.replace(/[^0-9]/g, "") }))} style={Object.assign({}, inputStyle(ui), { width: 70, padding: "6px 8px", fontSize: 13, display: "block", marginTop: 3 })} /></label>)}
                    <Btn ui={ui} kind="navy" small disabled={tplBusy} onClick={cropSheet}>Crop</Btn>
                  </div>
                  <div style={{ fontSize: 11.5, color: C.mute, marginTop: 6, lineHeight: 1.5 }}>An equal grid, counted left to right then down. The printed size becomes the sheet's size divided by the grid; adjust it after if the sheet has margins. Sample text printed on the artwork ($4.99, a placeholder logo) stays in the picture — place the live field over it and give the field a <b>Fill</b> so it covers what is underneath.</div>
                </div>}
              </div>}
            </Field>
            <div style={{ display: "flex", gap: 10 }}>
              <Field ui={ui} label="Printed width (in)"><input inputMode="decimal" value={s.templateW || ""} onChange={(e) => setS((v) => Object.assign({}, v, { templateW: e.target.value }))} style={inputStyle(ui)} /></Field>
              <Field ui={ui} label="Printed height (in)"><input inputMode="decimal" value={s.templateH || ""} onChange={(e) => setS((v) => Object.assign({}, v, { templateH: e.target.value }))} style={inputStyle(ui)} /></Field>
            </div>
            <div style={{ fontSize: 11.5, color: C.mute, marginTop: -6, marginBottom: 12, lineHeight: 1.5 }}>The artwork keeps this shape on every material — it is fitted and centred, never stretched. A PDF fills these in from its page size.</div>
          </>}
          {!isTpl && <>
            <Field ui={ui} label="Layout"><Seg value={th.layout} options={CORE.LAYOUTS} onPick={(id) => setT({ layout: id })} /></Field>
            <Field ui={ui} label="Font"><select value={th.font} onChange={(e) => setT({ font: e.target.value })} style={inputStyle(ui)}>{Object.keys(CORE.FONTS).map((k) => <option key={k} value={k}>{CORE.FONTS[k].label}</option>)}</select></Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
              <Color k="accent" label="Band / accent" /><Color k="accentFg" label="Text on band" />
              <Color k="bg" label="Tag background" /><Color k="fg" label="Tag text" />
              <Color k="priceColor" label="Price" /><Color k="promoColor" label="Promo accent" />
              <Color k="dropColor" label="Price-drop accent" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
              <Toggle k="showLogo" label="Show logo" /><Toggle k="showSize" label="Show package size" /><Toggle k="showWas" label="Show was-price" /><Toggle k="showItemNo" label="Show item #" />
            </div>
            <Field ui={ui} label="Standing caption" hint="Prints on every standard-price tag, e.g. EVERYDAY LOW PRICE."><input value={th.caption} onChange={(e) => setT({ caption: e.target.value })} style={inputStyle(ui)} /></Field>
            <Field ui={ui} label="Logo" hint="PNG with a transparent background looks best. Replaces the chain name in the band.">
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="file" accept="image/*" onChange={onLogo} style={{ fontSize: 12 }} />
                {(s.logoKey || logoData) && <button onClick={() => setLogoData("")} style={{ background: "none", border: "none", color: C.red, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Remove</button>}
              </div>
            </Field>
            <RulesEditor ui={ui} rules={s.rules || []} onChange={(rules) => setS((v) => Object.assign({}, v, { rules }))} />
          </>}
        </div>
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Eyebrow ui={ui}>{isTpl ? "Place the fields" : "Preview"}</Eyebrow><span style={{ flex: 1 }} />
            {CORE.CONTENT_TYPES.map((t) => <button key={t.id} onClick={() => setSample(t.id)} style={{ padding: "5px 10px", borderRadius: 99, border: `1.5px solid ${sample === t.id ? C.navy : C.line}`, background: sample === t.id ? C.navy : "#fff", color: sample === t.id ? C.cream : C.navy, fontSize: 11, fontWeight: 700, fontFamily: ui.HEAD, cursor: "pointer" }}>{t.short}</button>)}
          </div>
          {isTpl
            ? <PlacementEditor ui={ui} style={previewStyle} fields={CORE.normalizeFields(s.fields)} onChange={setF} sample={sampleReq} />
            : <div style={{ display: "grid", gap: 14, placeItems: "center", background: "#e9e4d6", borderRadius: 12, padding: 14 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "center", fontSize: 12, color: C.sub }}>
                  <span style={{ fontFamily: ui.HEAD, fontWeight: 700, fontSize: 11, textTransform: "uppercase" }}>Try</span>
                  <input inputMode="decimal" value={tryReq.price} onChange={(e) => setTryReq(Object.assign({}, tryReq, { price: e.target.value.replace(/[^0-9.]/g, "") }))} placeholder="price" style={Object.assign({}, inputStyle(ui), { width: 76, padding: "5px 8px", fontSize: 12.5 })} />
                  <select value={tryReq.multi} onChange={(e) => setTryReq(Object.assign({}, tryReq, { multi: e.target.value }))} style={Object.assign({}, inputStyle(ui), { width: 70, padding: "5px 6px", fontSize: 12.5 })}><option value="">1</option><option value="2">2/</option><option value="3">3/</option><option value="4">4/</option></select>
                  <input inputMode="decimal" value={tryReq.was} onChange={(e) => setTryReq(Object.assign({}, tryReq, { was: e.target.value.replace(/[^0-9.]/g, "") }))} placeholder="was" style={Object.assign({}, inputStyle(ui), { width: 70, padding: "5px 8px", fontSize: 12.5 })} />
                  {(s.rules || []).length > 0 && <span style={{ color: rulesHit.length ? C.win : C.mute, fontWeight: 600 }}>{rulesHit.length ? rulesHit.map((r) => r.label || "rule").join(", ") + " applied" : "no rule applies"}</span>}
                </div>
                <PreviewWithLogo req={sampleReq} style={previewStyle} logoData={logoData} material={s.format === "case_card" ? CASE_MAT : { tagW: 3, tagH: 2 }} widthPx={s.format === "case_card" ? 260 : 320} />
                {s.format !== "case_card" && <PreviewWithLogo req={sampleReq} style={previewStyle} logoData={logoData} material={{ tagW: 2, tagH: 1 }} widthPx={220} />}
                <div style={{ fontSize: 11.5, color: C.mute }}>{s.format === "case_card" ? "Shown on a letter page." : "Shown on a 3×2 and a 2×1 tag. Every size scales the same design."}</div>
              </div>}
        </div>
      </div>
      {err && <div style={{ color: C.redDeep, fontSize: 13, fontWeight: 600, marginTop: 10 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}><Btn ui={ui} onClick={onClose}>Cancel</Btn><Btn ui={ui} kind="gold" disabled={busy || tplBusy || !s.name.trim()} onClick={save}>{busy ? "Saving…" : "Save style"}</Btn></div>
    </div>
  </div>, document.body);
}
/* The placement canvas: the artwork at a fixed width, every placed field a
   draggable / resizable box (pointer events, so a finger works too), and a
   property strip for the selected one. Positions are kept as PERCENTAGES of
   the artwork the whole time, which is what the renderer stores and prints.
   Underneath, the real renderer draws the same fields, so "what I placed" and
   "what prints" sit one above the other. */
function PlacementEditor({ ui, style, fields, onChange, sample }) {
  const C = ui.C;
  const tw = parseFloat(style.templateW) > 0 ? parseFloat(style.templateW) : 3, thh = parseFloat(style.templateH) > 0 ? parseFloat(style.templateH) : 2;
  let W = 520, H = Math.round(W * thh / tw);
  if (H > 560) { H = 560; W = Math.round(H * tw / thh); }
  const ref = useRef(null);
  const drag = useRef(null);
  const [sel, setSel] = useState(0);
  const cur = fields[sel] || null;
  const src = style.templateSrc || (style.templateKey ? "/api/assets/ttpl/" + encodeURIComponent(style.templateKey) : null);
  function upd(i, patch) { onChange(fields.map((f, k) => (k === i ? Object.assign({}, f, patch) : f))); }
  function pct(e) { const r = ref.current.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * 100, y: (e.clientY - r.top) / r.height * 100 }; }
  function down(e, i, mode) {
    e.preventDefault(); e.stopPropagation();
    setSel(i);
    drag.current = { i, mode, start: pct(e), orig: Object.assign({}, fields[i]) };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (x) {}
  }
  function move(e) {
    const d = drag.current; if (!d) return;
    const p = pct(e), dx = p.x - d.start.x, dy = p.y - d.start.y, o = d.orig;
    const r2 = (n) => Math.round(n * 10) / 10;
    if (d.mode === "move") upd(d.i, { x: r2(Math.max(0, Math.min(100 - o.w, o.x + dx))), y: r2(Math.max(0, Math.min(100 - o.h, o.y + dy))) });
    else upd(d.i, { w: r2(Math.max(2, Math.min(100 - o.x, o.w + dx))), h: r2(Math.max(2, Math.min(100 - o.y, o.h + dy))) });
  }
  function up() { drag.current = null; }
  const present = {}; fields.forEach((f) => { present[f.key] = 1; });
  const addable = CORE.TEMPLATE_FIELDS.filter((t) => t.repeatable || !present[t.key]);
  function add(key) {
    const base = key === "price" ? { x: 30, y: 60, w: 65, h: 30, size: 24 } : key === "item" ? { x: 5, y: 20, w: 90, h: 20, size: 14 } : { x: 5, y: 5, w: 60, h: 10, size: 7 };
    const nf = CORE.normalizeFields(fields.concat([Object.assign({ key, text: key === "text" ? "SALE" : "" }, base)]));
    onChange(nf); setSel(nf.length - 1);
  }
  function remove(i) { const nf = fields.filter((_, k) => k !== i); onChange(nf); setSel(Math.max(0, Math.min(sel, nf.length - 1))); }
  const specOf = (k) => CORE.TEMPLATE_FIELDS.find((t) => t.key === k) || { label: k };
  const Prop = ({ label, children }) => <label style={{ display: "block", fontSize: 11, fontFamily: ui.HEAD, fontWeight: 600, letterSpacing: 0.6, textTransform: "uppercase", color: C.sub }}>{label}<div style={{ marginTop: 3 }}>{children}</div></label>;
  const small = (extra) => Object.assign({}, inputStyle(ui), { padding: "6px 8px", fontSize: 13 }, extra || {});
  const SegB = ({ value, options, onPick }) => <div style={{ display: "flex", gap: 4 }}>{options.map((o) => <button key={o} onClick={() => onPick(o)} style={{ flex: 1, padding: "6px 4px", borderRadius: 8, border: `1.5px solid ${value === o ? C.gold : C.line}`, background: value === o ? C.goldSoft : "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: ui.HEAD, textTransform: "uppercase" }}>{o}</button>)}</div>;
  return <div>
    <div ref={ref} onPointerMove={move} onPointerUp={up} onPointerCancel={up} style={{ position: "relative", width: W, height: H, maxWidth: "100%", background: "#fff", border: `1px solid ${C.line}`, boxShadow: "0 4px 18px rgba(0,0,0,.15)", overflow: "hidden", userSelect: "none", touchAction: "none" }}>
      {src ? <img src={src} alt="" draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} /> : <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: C.mute, fontSize: 13, textAlign: "center", padding: 20 }}><div><TagUpMark size={44} ink={TB.kraft} hole={TB.paper} /><div style={{ fontFamily: ui.HEAD, fontWeight: 700, fontSize: 15, color: TB.ink, marginTop: 8 }}>No template chosen</div><div style={{ marginTop: 3 }}>Pick a template to start making tags — upload the chain's artwork on the left.</div></div></div>}
      {fields.map((f, i) => {
        const spec = specOf(f.key);
        const val = spec.image ? (sample.brandLogoSrc ? "" : "(" + spec.label + ")") : (CORE.fieldValue(f, sample, style) || (f.on ? "(" + spec.label + ")" : ""));
        const on = f.on !== false, isSel = i === sel;
        const font = CORE.FONTS[f.font] || CORE.FONTS.oswald;
        return <div key={i} onPointerDown={(e) => down(e, i, "move")} style={{ position: "absolute", left: f.x + "%", top: f.y + "%", width: f.w + "%", height: f.h + "%", border: `${isSel ? 2 : 1.5}px ${isSel ? "solid" : "dashed"} ${isSel ? C.gold : on ? "rgba(16,42,76,.6)" : "rgba(0,0,0,.25)"}`, background: f.fill ? f.fill : (isSel ? "rgba(224,178,60,.12)" : "rgba(255,255,255,.04)"), cursor: "move", display: "flex", alignItems: f.valign === "top" ? "flex-start" : f.valign === "bottom" ? "flex-end" : "center", justifyContent: f.align === "center" ? "center" : f.align === "right" ? "flex-end" : "flex-start", overflow: "hidden", boxSizing: "border-box", opacity: on ? 1 : 0.45 }}>
          {spec.image && sample.brandLogoSrc && <img src={sample.brandLogoSrc} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }} />}
          <span style={{ fontSize: spec.image ? 11 : Math.max(6, f.size / 100 * H), lineHeight: 1, color: spec.image ? C.sub : f.color, fontFamily: f.weight === "bold" ? font.head : font.css, fontWeight: f.weight === "bold" ? 700 : 400, textTransform: f.upper ? "uppercase" : "none", whiteSpace: specOf(f.key).wrap ? "normal" : "nowrap", textDecoration: f.key === "was" ? "line-through" : "none", textAlign: f.align, padding: "0 2px" }}>{val}</span>
          <span style={{ position: "absolute", left: 0, top: 0, fontSize: 9, background: isSel ? C.gold : "rgba(16,42,76,.7)", color: isSel ? C.navy : "#fff", padding: "1px 5px", fontFamily: ui.HEAD, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", pointerEvents: "none" }}>{specOf(f.key).label.split(" (")[0]}</span>
          <span onPointerDown={(e) => down(e, i, "resize")} style={{ position: "absolute", right: -1, bottom: -1, width: 14, height: 14, background: isSel ? C.gold : "rgba(16,42,76,.6)", cursor: "nwse-resize", borderRadius: "3px 0 0 0" }} />
        </div>;
      })}
    </div>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0" }}>
      <span style={{ fontSize: 12, color: C.sub, alignSelf: "center" }}>Add:</span>
      {addable.map((t) => <button key={t.key} onClick={() => add(t.key)} style={{ padding: "5px 10px", borderRadius: 99, border: `1.5px solid ${C.line}`, background: "#fff", fontSize: 11.5, fontWeight: 700, fontFamily: ui.HEAD, color: C.navy, cursor: "pointer" }}>+ {t.label.split(" (")[0]}</button>)}
      <span style={{ flex: 1 }} />
      <button onClick={() => { onChange(CORE.defaultTemplateFields(style.format)); setSel(0); }} style={{ background: "none", border: "none", color: C.mute, fontSize: 12, cursor: "pointer" }}>Reset placement</button>
    </div>
    {cur && <div style={{ background: "#fff", border: `2px solid ${C.gold}`, borderRadius: 12, padding: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontFamily: ui.HEAD, fontWeight: 700, fontSize: 13, color: C.navy, textTransform: "uppercase" }}>{specOf(cur.key).label}</span>
        <label style={{ fontSize: 12, color: C.sub, display: "flex", gap: 5, alignItems: "center" }}><input type="checkbox" checked={cur.on !== false} onChange={(e) => upd(sel, { on: e.target.checked })} /> prints</label>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: C.mute }}>{cur.x}%, {cur.y}% · {cur.w}% × {cur.h}%</span>
        <button onClick={() => remove(sel)} style={{ background: "none", border: "none", color: C.red, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Remove</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
        {!specOf(cur.key).image && <Prop label={"Size · " + cur.size + "% of height"}><input type="range" min="1" max="60" step="0.5" value={cur.size} onChange={(e) => upd(sel, { size: parseFloat(e.target.value) })} style={{ width: "100%" }} /></Prop>}
        <Prop label="Align"><SegB value={cur.align} options={["left", "center", "right"]} onPick={(v) => upd(sel, { align: v })} /></Prop>
        <Prop label="Vertical"><SegB value={cur.valign} options={["top", "middle", "bottom"]} onPick={(v) => upd(sel, { valign: v })} /></Prop>
        {!specOf(cur.key).image && <Prop label="Font"><select value={cur.font} onChange={(e) => upd(sel, { font: e.target.value })} style={small()}>{Object.keys(CORE.FONTS).map((k) => <option key={k} value={k}>{CORE.FONTS[k].label}</option>)}</select></Prop>}
        {!specOf(cur.key).image && <Prop label="Weight"><SegB value={cur.weight} options={["bold", "normal"]} onPick={(v) => upd(sel, { weight: v })} /></Prop>}
        {!specOf(cur.key).image && <Prop label="Color"><div style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="color" value={cur.color} onChange={(e) => upd(sel, { color: e.target.value })} style={{ width: 34, height: 28, border: "none", background: "none", padding: 0 }} /><label style={{ fontSize: 12, color: C.sub, display: "flex", gap: 4, alignItems: "center" }}><input type="checkbox" checked={cur.upper} onChange={(e) => upd(sel, { upper: e.target.checked })} /> CAPS</label></div></Prop>}
        {specOf(cur.key).image && <div style={{ fontSize: 12, color: C.sub, alignSelf: "center" }}>The approved brand logo fills this box, kept in proportion. No approved logo, no box.</div>}
        <Prop label="Fill"><div style={{ display: "flex", gap: 6, alignItems: "center" }}><label style={{ fontSize: 12, color: C.sub, display: "flex", gap: 4, alignItems: "center" }}><input type="checkbox" checked={!!cur.fill} onChange={(e) => upd(sel, { fill: e.target.checked ? "#FFFFFF" : null })} /> box behind</label>{cur.fill && <input type="color" value={cur.fill} onChange={(e) => upd(sel, { fill: e.target.value })} style={{ width: 34, height: 28, border: "none", background: "none", padding: 0 }} />}</div></Prop>
        {cur.key === "price" && <Prop label="Cents"><SegB value={cur.cents || "super"} options={["super", "plain"]} onPick={(v) => upd(sel, { cents: v })} /></Prop>}
        {cur.key === "text" && <Prop label="Text"><input value={cur.text || ""} onChange={(e) => upd(sel, { text: e.target.value })} style={small()} /></Prop>}
      </div>
    </div>}
    <div style={{ marginTop: 12 }}>
      <Eyebrow ui={ui}>What prints</Eyebrow>
      <div style={{ display: "grid", placeItems: "center", background: "#e9e4d6", borderRadius: 12, padding: 12, marginTop: 6 }}>
        <TagPreview req={sample} style={Object.assign({}, style, { fields })} widthPx={Math.min(W, 360)} />
      </div>
    </div>
  </div>;
}
// A logo that is still only in memory (not yet uploaded) has no asset key, so
// the preview swaps the img src for the data URL after rendering.
function PreviewWithLogo({ req, style, logoData, material, widthPx }) {
  const ref = useRef(null);
  const st = logoData ? Object.assign({}, style, { logoKey: "tl_pending" }) : style;
  useEffect(() => { if (!ref.current) return; const img = ref.current.querySelector("img.logo"); if (img && logoData) img.src = logoData; });
  return <div ref={ref}><TagPreview req={req} style={st} material={material} widthPx={widthPx} /></div>;
}

/* ---------------- brand logos ---------------- */
/* Three buttons, in the order the work happens: Recognize (the catalog's
   abbreviations become brand names), Find logos (Wikimedia + the model), and
   Approve. A logo prints ONLY once approved -- the sign shop's eye is the last
   gate, because a wrong logo on a shelf is worse than none. */
function BrandsPanel({ ui }) {
  const C = ui.C;
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(null);
  const [q, setQ] = useState("");
  function load() { jget(ui, "/api/brands").then(setData).catch(() => setData({ brands: [], unmatched: [], error: "Couldn't load brands." })); }
  useEffect(() => { load(); }, []);
  async function run(label, url, body) {
    setBusy(label); setMsg("");
    try {
      const r = await jpost(ui, url, body || {});
      if (r && r.error) setMsg(r.error);
      else if (label === "recognize") setMsg(`Recognized ${r.names} spelling${r.names === 1 ? "" : "s"}: ${r.created} new brand${r.created === 1 ? "" : "s"}, ${r.aliased} alias${r.aliased === 1 ? "" : "es"} added${r.skipped ? ", " + r.skipped + " skipped" : ""}${r.ai ? "" : " (no AI key on the server -- names were title-cased, not recognized)"}.`);
      else if (label === "find") setMsg(`Searched ${r.tried} brand${r.tried === 1 ? "" : "s"}: ${r.found} logo${r.found === 1 ? "" : "s"} found, ${r.none} with nothing usable${r.errors.length ? ", " + r.errors.length + " errors" : ""}${r.ai ? " -- each pick was checked by the model; approve the ones that look right." : " -- no AI key on the server, so these are the top search hits UNVERIFIED. Look at each one."}`);
      else if (label === "approve-confident") setMsg(`Approved ${r.approved} logo${r.approved === 1 ? "" : "s"} at ${Math.round(r.min * 100)}% confidence or better.`);
      load();
    } catch (e) { setMsg("Couldn't reach the server."); }
    setBusy("");
  }
  // VIP Brand Builder: the distributor's public catalog, one logo per brand.
  async function importVip() {
    const saved = (data && data.vipDistributorId) || "";
    const id = window.prompt("Your VIP distributor id -- the number in your Brand Builder / Retailer Portal link (products.vtinfo.com/brandbuilder/XXXXX). Logos land only on brands that have none yet.", saved);
    if (id == null || !String(id).trim()) return;
    setBusy("vip"); setMsg("");
    try {
      const r = await jpost(ui, "/api/brands/import-vip", { distributorId: String(id).trim() });
      if (r && r.error) setMsg(r.error);
      else setMsg(`VIP lists ${r.vipBrands} brands, ${r.vipWithLogo} with a logo. Imported ${r.matched.length} onto your ${r.orgBrands} brands${r.matched.length ? " (" + r.matched.slice(0, 8).map((m) => m.brand).join(", ") + (r.matched.length > 8 ? "…" : "") + ")" : ""}.` + (r.unmatched.length ? ` ${r.unmatched.length} still without one -- VIP spells them differently or has no logo; Upload logos or Find logos covers the rest.` : "") + (r.failed.length ? ` ${r.failed.length} failed (${r.failed[0].why}).` : ""));
      load();
    } catch (ex) { setMsg("Couldn't reach the server."); }
    setBusy("");
  }
  // The supplier's asset library, dropped in whole: filenames name the brands.
  async function bulkUpload(e) {
    const files = Array.from(e.target.files || []); e.target.value = "";
    if (!files.length) return;
    setBusy("upload"); setMsg("");
    try {
      const fd = new FormData(); files.forEach((f) => fd.append("files", f, f.name));
      const h = ui.H(); delete h["Content-Type"];
      const r = await fetch("/api/brands/upload", { method: "POST", headers: h, body: fd }).then(j);
      if (r && r.error) setMsg(r.error);
      else setMsg(`Uploaded ${r.matched.length} logo${r.matched.length === 1 ? "" : "s"}${r.matched.length ? ": " + r.matched.slice(0, 8).map((m) => m.brand).join(", ") + (r.matched.length > 8 ? "…" : "") : ""}.` + (r.unmatched.length ? ` ${r.unmatched.length} file${r.unmatched.length === 1 ? "" : "s"} named no brand here: ${r.unmatched.slice(0, 6).join(", ")}${r.unmatched.length > 6 ? "…" : ""} -- rename to the brand, or Recognize first so the brand exists.` : "") + (r.failed.length ? ` ${r.failed.length} failed (${r.failed[0].why}).` : ""));
      load();
    } catch (ex) { setMsg("Couldn't reach the server."); }
    setBusy("");
  }
  async function act(b, action, body) {
    const r = await jpost(ui, "/api/brands/" + encodeURIComponent(b.key) + "/" + action, body || {});
    if (r && r.error) window.alert(r.error); else load();
  }
  function upload(b, e) {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    if (f.size > 2 * 1024 * 1024) { window.alert("Keep a logo under 2 MB."); return; }
    const rd = new FileReader(); rd.onload = async () => { const r = await jpost(ui, "/api/brands/" + encodeURIComponent(b.id) + "/override", { dataUrl: String(rd.result) }); if (r && r.error) window.alert(r.error); else load(); }; rd.readAsDataURL(f);
  }
  const brands = (data && data.brands) || [];
  const shown = brands.filter((b) => filter === "all" || (filter === "approved" ? (b.status === "approved" || b.status === "manual") : b.status === filter)).filter((b) => !q || (b.label + " " + (b.aliases || []).join(" ")).toLowerCase().includes(q.toLowerCase()));
  const counts = (data && data.counts) || { approved: 0, found: 0, missing: 0 };
  const St = ({ b }) => { const m = { approved: ["Approved", "#fff", C.win], manual: ["Uploaded", "#fff", C.win], found: [b.confidence == null ? "Found · unverified" : "Found · " + Math.round(b.confidence * 100) + "%", C.navy, C.goldSoft], none: ["No logo", C.sub, C.line], rejected: ["Rejected", "#fff", C.red] }[b.status] || [b.status, C.sub, C.line]; return <Chip ui={ui} color={m[1]} bg={m[2]}>{m[0]}</Chip>; };
  const Filter = ({ id, label, n }) => <button onClick={() => setFilter(id)} style={{ padding: "6px 12px", borderRadius: 99, cursor: "pointer", border: `1.5px solid ${filter === id ? C.gold : "rgba(0,0,0,.14)"}`, background: filter === id ? C.goldSoft : "#fff", color: C.navy, fontFamily: ui.HEAD, fontWeight: 700, fontSize: 11.5, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}{n != null ? " · " + n : ""}</button>;
  return <div>
    <div style={{ fontSize: 13, color: C.sub, marginBottom: 12, lineHeight: 1.55 }}>The brands in our portfolio, with the supplier's logo for the tags. <b>Recognize</b> turns the catalog's abbreviations (MICH ULT, BUD LT) into brand names; <b>Find logos</b> searches the web and has the AI check each match; <b>Approve</b> is what lets a logo print. Nothing prints until it is approved. Shared across every tagup workspace: a logo approved anywhere prints everywhere, and your own upload stays yours.</div>
    {data && data.pending && <Card ui={ui}><div style={{ fontSize: 13, color: C.sub }}>The brand library is still being set up. Reload in a minute.</div></Card>}
    {data && data.error && <Card ui={ui} accent={C.red}><div style={{ color: C.red, fontSize: 13 }}>{data.error}</div></Card>}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
      <Btn ui={ui} kind="navy" small disabled={!!busy} onClick={() => run("recognize", "/api/brands/recognize", { fromCatalog: true })}>{busy === "recognize" ? "Recognizing…" : "1 · Recognize brands"}</Btn>
      <Btn ui={ui} kind="navy" small disabled={!!busy} onClick={() => run("find", "/api/brands/find", { limit: 15 })}>{busy === "find" ? "Searching…" : "2 · Find logos (15 at a time)"}</Btn>
      <Btn ui={ui} kind="gold" small disabled={!!busy || !counts.found} onClick={() => { if (window.confirm("Approve every found logo the AI rated 90% or better?")) run("approve-confident", "/api/brands/approve-confident", { min: 0.9 }); }}>3 · Approve all ≥ 90%</Btn>
      <Btn ui={ui} kind="navy" small disabled={!!busy} onClick={importVip} title="Your distributor catalog on VIP Brand Builder carries a logo for most brands -- pull them all in one go">{busy === "vip" ? "Importing from VIP…" : "Import from VIP"}</Btn>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 9, border: `2px solid ${C.navy}`, fontFamily: ui.HEAD, fontWeight: 700, fontSize: 12, textTransform: "uppercase", color: C.navy, cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1 }} title="Pick many logo files at once -- each lands on the brand its filename names (Bud Light.png, michelob-ultra.svg, BUD_LT.png)">
        Upload logos<input type="file" accept="image/*,.svg" multiple disabled={!!busy} onChange={bulkUpload} style={{ display: "none" }} />
      </label>
      {data && data.aiOn === false && <span style={{ fontSize: 12, color: C.redDeep, fontWeight: 600 }}>No ANTHROPIC_API_KEY on the server: recognition and logo checks run without the AI.</span>}
    </div>
    {msg && <div style={{ marginBottom: 10, background: C.winSoft, color: C.win, borderRadius: 10, padding: "9px 12px", fontSize: 13, fontWeight: 600 }}>{msg}</div>}
    {data && data.unmatched && data.unmatched.length > 0 && <Card ui={ui} accent={C.gold}>
      <Eyebrow ui={ui}>Catalog spellings not on any brand yet ({data.unmatched.length})</Eyebrow>
      <div style={{ fontSize: 12.5, color: C.sub, marginTop: 6, lineHeight: 1.6 }}>{data.unmatched.slice(0, 40).map((u) => u.raw).join(" · ")}{data.unmatched.length > 40 ? " · …" : ""}</div>
      <div style={{ fontSize: 12, color: C.mute, marginTop: 6 }}>Press Recognize brands — these become brand names and aliases. A request for one of these items carries no logo until then.</div>
    </Card>}
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
      <Filter id="all" label="All" n={brands.length} /><Filter id="approved" label="Approved" n={counts.approved} /><Filter id="found" label="Found — review" n={counts.found} /><Filter id="none" label="No logo" n={counts.missing} /><Filter id="rejected" label="Rejected" />
      <span style={{ flex: 1 }} />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search brands" style={Object.assign(inputStyle(ui), { width: 200, padding: "7px 10px", fontSize: 13 })} />
    </div>
    {data && !data.pending && !brands.length && <Card ui={ui}><div style={{ fontFamily: ui.HEAD, fontWeight: 600, fontSize: 16, color: C.navy }}>No brands yet</div><div style={{ fontSize: 13, color: C.sub, marginTop: 3 }}>Load your item list under Catalog, then press Recognize brands.</div></Card>}
    {shown.map((b) => <div key={b.key} style={{ display: "flex", gap: 14, alignItems: "center", background: "#fff", border: `2px solid ${C.line}`, borderLeft: `5px solid ${b.status === "approved" || b.status === "manual" ? C.win : b.status === "found" ? C.gold : b.status === "rejected" ? C.red : C.line}`, borderRadius: 14, padding: 12, marginBottom: 8 }}>
      <div style={{ width: 120, height: 56, display: "grid", placeItems: "center", background: "#f5f2ea", borderRadius: 8, flexShrink: 0 }}>{(b.orgLogoKey || b.logoKey) ? <img src={"/api/assets/blogo/" + encodeURIComponent(b.orgLogoKey || b.logoKey)} alt="" style={{ maxWidth: 110, maxHeight: 48, objectFit: "contain" }} /> : <span style={{ fontSize: 11, color: C.mute }}>no logo</span>}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><span style={{ fontFamily: ui.HEAD, fontWeight: 700, fontSize: 15, color: C.ink, textTransform: "uppercase" }}>{b.label}</span><St b={b} />{b.overridden && <Chip ui={ui} small bg={C.goldSoft}>Your upload</Chip>}{b.items > 0 && <span style={{ fontSize: 12, color: C.mute }}>{b.items} item{b.items === 1 ? "" : "s"}</span>}</div>
        <div style={{ fontSize: 12, color: C.sub, marginTop: 3 }}>{(b.aliases || []).length ? "Also: " + b.aliases.join(", ") : "No catalog aliases yet"}{b.note ? " · " + b.note : ""}</div>
        {b.sourceUrl && <a href={b.sourceUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: C.navy }}>source</a>}
        {open === b.key && b.candidates && b.candidates.length > 0 && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>{b.candidates.map((c) => <button key={c.i} onClick={() => act(b, "pick", { index: c.i })} title={c.title} style={{ width: 96, height: 64, background: "#f5f2ea", border: `1.5px solid ${C.line}`, borderRadius: 8, cursor: "pointer", display: "grid", placeItems: "center", overflow: "hidden" }}><img src={c.url} alt="" style={{ maxWidth: 88, maxHeight: 56, objectFit: "contain" }} /></button>)}<div style={{ fontSize: 11.5, color: C.mute, alignSelf: "center" }}>Tap the right one — it is approved on pick.</div></div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {b.logoKey && b.status !== "approved" && b.status !== "manual" && <Btn ui={ui} kind="gold" small onClick={() => act(b, "approve")}>Approve</Btn>}
        {b.status !== "rejected" && b.status !== "none" && <Btn ui={ui} small onClick={() => act(b, "reject")}>Reject</Btn>}
        {b.candidates && b.candidates.length > 1 && <Btn ui={ui} small onClick={() => setOpen(open === b.key ? null : b.key)}>{open === b.key ? "Hide" : "Other matches"}</Btn>}
        {(b.status === "none" || b.status === "rejected") && <Btn ui={ui} small onClick={() => run("find", "/api/brands/find", { keys: [b.key], retry: true })}>Search again</Btn>}
        <label style={{ fontSize: 11.5, color: C.navy, fontWeight: 700, cursor: "pointer", textAlign: "center" }}>Upload<input type="file" accept="image/*" onChange={(e) => upload(b, e)} style={{ display: "none" }} /></label>
      </div>
    </div>)}
  </div>;
}

/* ---------------- materials ---------------- */
function MaterialsEditor({ ui, branch, bq, setup, onChanged }) {
  const C = ui.C;
  const [edit, setEdit] = useState(null);
  const mats = (setup && setup.materials) || [];
  const live = mats.filter((m) => m.active), retired = mats.filter((m) => !m.active);
  async function retire(m, restore) { const x = await jpost(ui, "/api/materials/" + encodeURIComponent(m.id) + "/retire", { branch, restore: !!restore }); if (x && x.error) window.alert(x.error); else onChanged(); }
  const Sheet = ({ m, w }) => { const sc = w / (m.sheetW * 96); return <div style={{ width: w, height: m.sheetH * 96 * sc, background: "#fff", border: `1px solid ${C.line}`, position: "relative", boxShadow: "0 2px 8px rgba(0,0,0,.12)" }}>
    {Array.from({ length: m.cols * m.rows }).map((_, i) => { const c = i % m.cols, r = Math.floor(i / m.cols); const gx = (m.sheetW - m.cols * m.tagW) / (m.cols + 1), gy = (m.sheetH - m.rows * m.tagH) / (m.rows + 1); return <div key={i} style={{ position: "absolute", left: (gx + c * (m.tagW + gx)) * 96 * sc, top: (gy + r * (m.tagH + gy)) * 96 * sc, width: m.tagW * 96 * sc, height: m.tagH * 96 * sc, background: C.goldSoft, border: `1px solid ${C.gold}`, boxSizing: "border-box" }} />; })}
  </div>; };
  return <div>
    <div style={{ fontSize: 13, color: C.sub, marginBottom: 12, lineHeight: 1.55 }}>A material is what the printer has loaded: tag size, sheet size and how many fit. Any chain style prints on any material.</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
      {live.map((m) => <Card ui={ui} key={m.id} style={{ marginBottom: 0 }}>
        <div style={{ display: "flex", gap: 12 }}>
          <Sheet m={m} w={80} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: ui.HEAD, fontWeight: 700, fontSize: 14, color: C.ink, textTransform: "uppercase" }}>{m.name}</div>
            <div style={{ fontSize: 12.5, color: C.sub, marginTop: 3, lineHeight: 1.5 }}>{m.tagW}″ × {m.tagH}″ tags<br />{m.cols} × {m.rows} = <b>{m.perSheet}</b> per {m.sheetW}″ × {m.sheetH}″ sheet{m.averySku ? <><br />Avery {m.averySku}</> : null}</div>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}><Btn ui={ui} small onClick={() => setEdit(Object.assign({}, m))}>Edit</Btn><button onClick={() => retire(m)} style={{ background: "none", border: "none", color: C.mute, fontSize: 12, cursor: "pointer" }}>Retire</button></div>
          </div>
        </div>
      </Card>)}
      <button onClick={() => setEdit({ id: null, name: "", tagW: 2, tagH: 1, sheetW: 8.5, sheetH: 11, cols: 4, rows: 10, averySku: "", isNew: true })} style={{ border: `2px dashed ${C.line}`, borderRadius: 16, background: "transparent", minHeight: 120, cursor: "pointer", fontFamily: ui.HEAD, fontWeight: 700, color: C.navy, fontSize: 14, textTransform: "uppercase" }}>+ New material</button>
    </div>
    {retired.length > 0 && <div style={{ marginTop: 14, fontSize: 12.5, color: C.sub }}>Retired: {retired.map((m) => <span key={m.id}>{m.name} <button onClick={() => retire(m, true)} style={{ background: "none", border: "none", color: C.navy, fontWeight: 700, cursor: "pointer", fontSize: 12 }}>restore</button> </span>)}</div>}
    {edit && <MaterialForm ui={ui} branch={branch} m={edit} Sheet={Sheet} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onChanged(); }} />}
  </div>;
}
function MaterialForm({ ui, branch, m, Sheet, onClose, onSaved }) {
  const C = ui.C;
  const [f, setF] = useState(m);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const set = (p) => setF((v) => Object.assign({}, v, p));
  const n = CORE.normalizeMaterial(f);
  async function save() { setBusy(true); setErr(""); const x = await jpost(ui, "/api/materials", Object.assign({ branch, id: f.id }, f)); setBusy(false); if (x && x.error) setErr(x.error); else onSaved(); }
  const Num = ({ k, label, step }) => <Field ui={ui} label={label}><input inputMode="decimal" value={f[k]} onChange={(e) => set({ [k]: e.target.value })} style={inputStyle(ui)} /></Field>;
  return createPortal(<div style={{ position: "fixed", inset: 0, zIndex: 8000, background: "rgba(11,30,57,.6)", display: "grid", placeItems: "center", padding: 16 }} onClick={onClose}>
    <div onClick={(e) => e.stopPropagation()} style={{ background: C.paper, borderRadius: 18, padding: 18, width: "min(640px, 100%)", maxHeight: "92vh", overflowY: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}><div style={{ fontFamily: ui.HEAD, fontWeight: 700, fontSize: 18, color: C.navy, textTransform: "uppercase" }}>{m.isNew ? "New material" : "Edit material"}</div><button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><Icon ui={ui} name="X" size={20} color={C.sub} /></button></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 18 }}>
        <div>
          <Field ui={ui} label="Name"><input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Shelf talker 3x2" style={inputStyle(ui)} /></Field>
          <div style={{ display: "flex", gap: 10 }}><Num k="tagW" label="Tag width (in)" /><Num k="tagH" label="Tag height (in)" /></div>
          <div style={{ display: "flex", gap: 10 }}><Num k="cols" label="Columns" /><Num k="rows" label="Rows" /></div>
          <div style={{ display: "flex", gap: 10 }}><Num k="sheetW" label="Sheet width (in)" /><Num k="sheetH" label="Sheet height (in)" /></div>
          <Field ui={ui} label="Avery / stock number" hint="Optional — helps reorder the stock."><input value={f.averySku || ""} onChange={(e) => set({ averySku: e.target.value })} style={inputStyle(ui)} /></Field>
        </div>
        <div style={{ textAlign: "center" }}><Eyebrow ui={ui}>Sheet</Eyebrow><div style={{ height: 8 }} />{n.ok ? <Sheet m={n} w={150} /> : <div style={{ width: 150, fontSize: 12, color: C.redDeep }}>{n.error}</div>}{n.ok && <div style={{ fontSize: 12, color: C.sub, marginTop: 6 }}>{n.cols * n.rows} per sheet</div>}</div>
      </div>
      {err && <div style={{ color: C.redDeep, fontSize: 13, fontWeight: 600, marginTop: 10 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}><Btn ui={ui} onClick={onClose}>Cancel</Btn><Btn ui={ui} kind="gold" disabled={busy || !n.ok} onClick={save}>{busy ? "Saving…" : "Save material"}</Btn></div>
    </div>
  </div>, document.body);
}

export { RepScreen, Section, Queue, Batches, StylesEditor, StyleForm, MaterialsEditor, BrandsPanel, ImportModal, TagPreview, CORE, TagUpMark, Wordmark, TB, TAGLINE, TABULAR, Card, Btn, Eyebrow, Chip, Field, inputStyle, StatusChip, EmptyState, Icon, jget, jpost, jput, qs, ago, downloadAuth };
