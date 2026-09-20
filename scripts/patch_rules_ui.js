"use strict";
/* Adds the Rules editor to the style form and {was}/{each}/{price} tokens to
   the rules engine. Anchored, single-match-or-abort, sentinel per file. */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
function patch(file, sentinel, edits) {
  const p = path.join(ROOT, file);
  let src = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  if (src.indexOf(sentinel) !== -1) { console.log(file + ": already applied"); return; }
  edits.forEach(([a, b, label]) => { const n = src.split(a).length - 1; if (n !== 1) { console.error("ABORT " + file + " / " + label + " matched " + n); process.exit(1); } src = src.replace(a, () => b); });
  fs.writeFileSync(p, src);
  console.log(file + ": " + edits.length + " edits");
}

/* ---- core: tokens in rule text ---- */
patch("lib/tagup-core.js", "function ruleText", [
  [`  // Returns { theme, req } with every matching rule applied, originals untouched.
  function applyRules(rules, theme, req) {`,
`  // {price} {was} {each} {qty} in a rule's note resolve against the request,
  // so "Reg. {was}" reads "Reg. $24.99" and "Single retail at {each}" divides
  // a 2-for price by two. An unresolvable token is dropped, never printed raw.
  function ruleText(s, req) {
    const qty = req.multiBuyQty > 1 ? req.multiBuyQty : 1;
    const price = toPrice(req.price), was = toPrice(req.wasPrice);
    return String(s || "").replace(/\\{(price|was|each|qty)\\}/g, function (_, k) {
      if (k === "price") return price != null ? fmtPrice(price) : "";
      if (k === "was") return was != null ? fmtPrice(was) : "";
      if (k === "each") return price != null ? fmtPrice(Math.ceil(price / qty * 100) / 100) : "";
      return String(qty);
    }).replace(/\\s{2,}/g, " ").trim();
  }
  // Returns { theme, req } with every matching rule applied, originals untouched.
  function applyRules(rules, theme, req) {`, "ruleText"],
  [`        if (k === "note") rq.note = v;
        else if (k === "notePrefix") rq.note = (v + " " + (rq.note || "")).trim();`,
   `        if (k === "note") rq.note = ruleText(v, rq);
        else if (k === "notePrefix") rq.note = (ruleText(v, rq) + " " + (rq.note || "")).trim();
        else if (k === "caption") th.caption = ruleText(v, rq);`, "apply tokens"],
  // presets use the tokens
  [`set: { notePrefix: "Reg." } }] },`, `set: { note: "Reg. {was}" } }] },`, "preset reg"],
  [`set: { notePrefix: "Single retail at" } }] },`, `set: { note: "Single retail at {each}" } }] },`, "preset single"],
  [`normalizeRule: normalizeRule, normalizeRules: normalizeRules, ruleMatches: ruleMatches, applyRules: applyRules,`,
   `normalizeRule: normalizeRule, normalizeRules: normalizeRules, ruleMatches: ruleMatches, applyRules: applyRules, ruleText: ruleText,`, "export"],
]);

/* ---- ui: rules editor ---- */
patch("src/tagup-ui.jsx", "function RulesEditor", [
  [`function StyleForm({ ui, branch, chains, style, onClose, onSaved }) {`,
`/* Conditional formatting on a layout style. One row per rule: WHEN a field
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
  const ColorSet = ({ i, k, label }) => { const on = !!list[i].set[k]; return <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: C.ink, padding: "3px 6px", borderRadius: 8, border: \`1.5px solid \${on ? C.gold : C.line}\`, background: on ? C.goldSoft : "#fff" }}><input type="checkbox" checked={on} onChange={(e) => updSet(i, { [k]: e.target.checked ? "#FFC20E" : undefined })} />{label}{on && <input type="color" value={list[i].set[k]} onChange={(e) => updSet(i, { [k]: e.target.value })} style={{ width: 24, height: 20, border: "none", background: "none", padding: 0 }} />}</label>; };
  const isNum = (f) => /^(price|wasPrice|multiBuyQty)$/.test(f);
  return <div style={{ marginBottom: 12 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}><span style={ui.lbl}>Rules</span><span style={{ flex: 1 }} /><select value="" onChange={(e) => preset(e.target.value)} style={Object.assign({}, small, { fontWeight: 600 })}><option value="">Start from a preset…</option>{CORE.RULE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
    <div style={{ fontSize: 11.5, color: C.mute, marginBottom: 8, lineHeight: 1.5 }}>When a field meets a condition, change colours or add a line. Rules run top to bottom; a later one wins. In text, <code>{"{price}"}</code> <code>{"{was}"}</code> <code>{"{each}"}</code> fill in from the tag.</div>
    {list.map((r, i) => { const w = r.when || {}; return <div key={i} style={{ background: "#fff", border: \`1.5px solid \${C.line}\`, borderRadius: 12, padding: 10, marginBottom: 8 }}>
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
    <button onClick={add} style={{ padding: "7px 12px", borderRadius: 10, border: \`1.5px dashed \${C.line}\`, background: "#fff", fontFamily: ui.HEAD, fontWeight: 700, fontSize: 12, color: C.navy, cursor: "pointer" }}>+ Add a rule</button>
  </div>;
}
function StyleForm({ ui, branch, chains, style, onClose, onSaved }) {`, "RulesEditor"],
  [`  const [tplBusy, setTplBusy] = useState(false);
  const th = CORE.themeMerge(s.theme);`,
`  const [tplBusy, setTplBusy] = useState(false);
  const [tryReq, setTryReq] = useState({ price: "", multi: "", was: "" });   // "try a price" over the sample
  const th = CORE.themeMerge(s.theme);`, "tryReq state"],
  [`fields: s.fields, theme: th });`, `fields: s.fields, theme: th, rules: s.rules || [] });`, "save rules"],
  [`  const sampleReq = Object.assign({}, SAMPLES[sample], { format: s.format, chainLabel: s.name });`,
`  const sampleReq = Object.assign({}, SAMPLES[sample], { format: s.format, chainLabel: s.name },
    CORE.toPrice(tryReq.price) != null ? { price: CORE.toPrice(tryReq.price) } : {},
    tryReq.multi ? { multiBuyQty: parseInt(tryReq.multi, 10) || null } : {},
    CORE.toPrice(tryReq.was) != null ? { wasPrice: CORE.toPrice(tryReq.was) } : {});
  const rulesHit = !isTpl ? CORE.applyRules(s.rules || [], th, sampleReq).hit : [];`, "sample try"],
  [`            </Field>
          </>}
        </div>
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Eyebrow ui={ui}>{isTpl ? "Place the fields" : "Preview"}</Eyebrow><span style={{ flex: 1 }} />`,
`            </Field>
            <RulesEditor ui={ui} rules={s.rules || []} onChange={(rules) => setS((v) => Object.assign({}, v, { rules }))} />
          </>}
        </div>
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Eyebrow ui={ui}>{isTpl ? "Place the fields" : "Preview"}</Eyebrow><span style={{ flex: 1 }} />`, "mount editor"],
  // "Try" strip over the preview + which rules fired
  [`            : <div style={{ display: "grid", gap: 14, placeItems: "center", background: "#e9e4d6", borderRadius: 12, padding: 14 }}>
                <PreviewWithLogo req={sampleReq} style={previewStyle} logoData={logoData} material={s.format === "case_card" ? CASE_MAT : { tagW: 3, tagH: 2 }} widthPx={s.format === "case_card" ? 260 : 320} />`,
`            : <div style={{ display: "grid", gap: 14, placeItems: "center", background: "#e9e4d6", borderRadius: 12, padding: 14 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "center", fontSize: 12, color: C.sub }}>
                  <span style={{ fontFamily: ui.HEAD, fontWeight: 700, fontSize: 11, textTransform: "uppercase" }}>Try</span>
                  <input inputMode="decimal" value={tryReq.price} onChange={(e) => setTryReq(Object.assign({}, tryReq, { price: e.target.value.replace(/[^0-9.]/g, "") }))} placeholder="price" style={Object.assign({}, inputStyle(ui), { width: 76, padding: "5px 8px", fontSize: 12.5 })} />
                  <select value={tryReq.multi} onChange={(e) => setTryReq(Object.assign({}, tryReq, { multi: e.target.value }))} style={Object.assign({}, inputStyle(ui), { width: 70, padding: "5px 6px", fontSize: 12.5 })}><option value="">1</option><option value="2">2/</option><option value="3">3/</option><option value="4">4/</option></select>
                  <input inputMode="decimal" value={tryReq.was} onChange={(e) => setTryReq(Object.assign({}, tryReq, { was: e.target.value.replace(/[^0-9.]/g, "") }))} placeholder="was" style={Object.assign({}, inputStyle(ui), { width: 70, padding: "5px 8px", fontSize: 12.5 })} />
                  {(s.rules || []).length > 0 && <span style={{ color: rulesHit.length ? C.win : C.mute, fontWeight: 600 }}>{rulesHit.length ? rulesHit.map((r) => r.label || "rule").join(", ") + " applied" : "no rule applies"}</span>}
                </div>
                <PreviewWithLogo req={sampleReq} style={previewStyle} logoData={logoData} material={s.format === "case_card" ? CASE_MAT : { tagW: 3, tagH: 2 }} widthPx={s.format === "case_card" ? 260 : 320} />`, "try strip"],
  // the style card grid shows a rules badge
  [`{CORE.isTemplate(s) && <Chip ui={ui} small bg={C.goldSoft}>Chain template</Chip>}</div></div>`,
   `{CORE.isTemplate(s) && <Chip ui={ui} small bg={C.goldSoft}>Chain template</Chip>}{(s.rules || []).length > 0 && <Chip ui={ui} small bg={C.lineCool}>{s.rules.length} rule{s.rules.length === 1 ? "" : "s"}</Chip>}</div></div>`, "rules badge"],
]);
console.log("done");
