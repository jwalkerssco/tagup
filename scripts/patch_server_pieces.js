"use strict";
/* Server-side additions the frontend needs. Anchored, single-match-or-abort,
   idempotent (sentinel per file). */
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

/* ---- schema: idempotent ---- */
{
  const p = path.join(ROOT, "schema.sql");
  let s = fs.readFileSync(p, "utf8");
  s = s.replace(/CREATE TABLE (?!IF NOT EXISTS)/g, "CREATE TABLE IF NOT EXISTS ")
       .replace(/CREATE INDEX (?!IF NOT EXISTS)/g, "CREATE INDEX IF NOT EXISTS ")
       .replace(/CREATE UNIQUE INDEX (?!IF NOT EXISTS)/g, "CREATE UNIQUE INDEX IF NOT EXISTS ")
       .replace("ALTER TABLE org_members ADD CONSTRAINT org_members_team_fk", "ALTER TABLE org_members DROP CONSTRAINT IF EXISTS org_members_team_fk;\nALTER TABLE org_members ADD CONSTRAINT org_members_team_fk");
  fs.writeFileSync(p, s);
  console.log("schema.sql: IF NOT EXISTS everywhere");
}

/* ---- assets: style logos ---- */
patch("lib/assets.js", "tlogo:", [
  ['const PREFIX = { blogo: "bl_", clogo: "cl_", ttpl: "tt_" };', 'const PREFIX = { blogo: "bl_", clogo: "cl_", ttpl: "tt_", tlogo: "tl_" };', "prefix"],
]);

/* ---- tagup.js: missing endpoints + store enrichment + mine counts ---- */
patch("lib/tagup.js", "async function unbatchRequest", [
  // stores carry their chain label + resolved styles, so the rep picker shows the chip
  [`  async function listStores(session, opts) {
    const o = opts || {};
    const params = [session.org.id]; let w = "org_id = $1 AND active";
    const tm = teamScope(session);
    if (tm) { params.push(tm); w += " AND team_id = $" + params.length; }
    const r = await pool().query("SELECT * FROM stores WHERE " + w + " ORDER BY name LIMIT 2000", params);
    return { ok: true, stores: r.rows.map(storeOut) };
  }`,
`  async function listStores(session, opts) {
    const o = opts || {};
    const params = [session.org.id]; let w = "s.org_id = $1 AND s.active";
    const tm = teamScope(session);
    if (tm) { params.push(tm); w += " AND s.team_id = $" + params.length; }
    const r = await pool().query("SELECT s.*, c.label AS chain_label FROM stores s LEFT JOIN chains c ON c.id = s.chain_id WHERE " + w + " ORDER BY s.name LIMIT 2000", params);
    const stores = r.rows.map((x) => Object.assign(storeOut(x), { chainLabel: x.chain_label || x.chain_raw || "" }));
    if (o.withStyles) {
      const styles = await stylesFor(session.org.id).catch(() => []);
      stores.forEach((s) => { const t = resolveStyle(styles, s.chainId, null, "tag"); const c = resolveStyle(styles, s.chainId, null, "case_card"); s.styleId = t.id; s.styleName = t.name; s.caseCardStyleId = c.id; s.caseCardStyleName = c.name; });
    }
    return { ok: true, stores };
  }
  async function retireStore(session, id, restore) {
    if (!canAdmin(session)) return forbidden();
    const r = await pool().query("UPDATE stores SET active=$3, updated_at=now() WHERE id=$1 AND org_id=$2 RETURNING *", [id, session.org.id, !!restore]);
    if (!r.rows.length) return { error: "store not found" };
    return { ok: true, store: storeOut(r.rows[0]) };
  }`, "listStores"],
  [`  async function retireStyle(session, id, restore) {`,
`  async function setStyleLogo(session, id, body) {
    if (!canAdmin(session)) return forbidden();
    const b = body || {};
    let key = null;
    if (b.dataUrl) { key = await D.putAsset("tlogo", b.dataUrl, { style: id }); if (!key) return { error: "logo must be an image" }; }
    const r = await pool().query("UPDATE tagup_styles SET logo_key=$3, updated_at=now() WHERE id=$1 AND org_id=$2 RETURNING *", [id, session.org.id, key]);
    if (!r.rows.length) return { error: "style not found" };
    return { ok: true, style: styleOut(r.rows[0]) };
  }
  async function retireMaterial(session, id, restore) {
    if (!canAdmin(session)) return forbidden();
    if (!restore) { const live = await pool().query("SELECT count(*)::int AS n FROM tagup_materials WHERE org_id = $1 AND active AND id <> $2", [session.org.id, id]); if (!(live.rows[0] && live.rows[0].n > 0)) return { error: "keep at least one material -- a batch has to print onto something" }; }
    const r = await pool().query("UPDATE tagup_materials SET active=$3, updated_at=now() WHERE id=$1 AND org_id=$2 RETURNING *", [id, session.org.id, !!restore]);
    if (!r.rows.length) return { error: "material not found" };
    return { ok: true, material: materialOut(r.rows[0]) };
  }
  async function retireStyle(session, id, restore) {`, "setStyleLogo + retireMaterial"],
  [`  /* ---------------- batches / print ---------------- */`,
`  async function unbatchRequest(session, id) {
    if (!canManage(session)) return forbidden();
    const cur = await pool().query("SELECT * FROM tagup_requests WHERE id=$1 AND org_id=$2", [id, session.org.id]);
    if (!cur.rows.length) return { error: "not found" };
    const q = requestOut(cur.rows[0]);
    if (!CORE.canTransition(q.status, "pending")) return { error: "a " + q.status + " request is not in a batch" };
    const r = await pool().query("UPDATE tagup_requests SET status='pending', batch_id=NULL, updated_at=now() WHERE id=$1 RETURNING *", [id]);
    if (q.batchId) await pruneFromBatch(q.batchId, id);
    return { ok: true, request: requestOut(r.rows[0]) };
  }
  async function pruneFromBatch(batchId, reqId) {
    const b = await pool().query("SELECT request_ids, status FROM tagup_batches WHERE id = $1", [batchId]);
    if (!b.rows.length) return;
    const ids = (Array.isArray(b.rows[0].request_ids) ? b.rows[0].request_ids : []).filter((x) => x !== reqId);
    if (!ids.length && b.rows[0].status !== "printed") await pool().query("DELETE FROM tagup_batches WHERE id = $1", [batchId]);
    else await pool().query("UPDATE tagup_batches SET request_ids = $2::jsonb WHERE id = $1", [batchId, JSON.stringify(ids)]);
  }
  async function deleteBatch(session, id) {
    if (!canManage(session)) return forbidden();
    const b = await pool().query("SELECT * FROM tagup_batches WHERE id=$1 AND org_id=$2", [id, session.org.id]);
    if (!b.rows.length) return { error: "not found" };
    if (b.rows[0].status === "printed") return { error: "a printed batch is history -- it stays" };
    await pool().query("UPDATE tagup_requests SET status='pending', batch_id=NULL, updated_at=now() WHERE batch_id=$1 AND status='reviewed'", [id]);
    await pool().query("DELETE FROM tagup_batches WHERE id=$1", [id]);
    return { ok: true, released: (b.rows[0].request_ids || []).length };
  }
  // The rep's badge: what is waiting, what printed this week, what came back.
  async function mineCounts(session) {
    const r = await pool().query("SELECT status, count(*)::int AS n FROM tagup_requests WHERE org_id = $1 AND user_id = $2 AND (status IN ('pending','reviewed') OR (status IN ('printed','rejected') AND updated_at > now() - interval '7 days')) GROUP BY status", [session.org.id, session.user.id]);
    const c = { pending: 0, printed: 0, rejected: 0 };
    r.rows.forEach((x) => { if (x.status === "pending" || x.status === "reviewed") c.pending += x.n; else c[x.status] = x.n; });
    return Object.assign({ ok: true }, c);
  }

  /* ---------------- batches / print ---------------- */`, "unbatch/deleteBatch/mineCounts"],
  // the rejected request also leaves its batch
  [`    const r = await pool().query("UPDATE tagup_requests SET status='rejected', reject_reason=$2, batch_id=NULL, updated_at=now() WHERE id=$1 AND org_id=$3 RETURNING *", [id, clip(reason, 200), session.org.id]);
    if (!r.rows.length) return { error: "not found" };
    return { ok: true, request: requestOut(r.rows[0]) };`,
`    const cur = await pool().query("SELECT batch_id FROM tagup_requests WHERE id=$1 AND org_id=$2", [id, session.org.id]);
    if (!cur.rows.length) return { error: "not found" };
    const r = await pool().query("UPDATE tagup_requests SET status='rejected', reject_reason=$2, reviewed_by=$4, batch_id=NULL, updated_at=now() WHERE id=$1 AND org_id=$3 RETURNING *", [id, clip(reason, 200), session.org.id, session.user.id]);
    if (cur.rows[0].batch_id) await pruneFromBatch(cur.rows[0].batch_id, id);
    return { ok: true, request: requestOut(r.rows[0]) };`, "reject prunes batch"],
  // mark printed: also flag onboarding
  [`    const r = await pool().query("UPDATE tagup_requests SET status='printed', printed_at=now(), updated_at=now() WHERE batch_id=$1 AND status='reviewed' RETURNING *", [id]);
    return { ok: true, printed: r.rows.length };`,
`    const r = await pool().query("UPDATE tagup_requests SET status='printed', printed_at=now(), updated_at=now() WHERE batch_id=$1 AND status='reviewed' RETURNING *", [id]);
    await pool().query("UPDATE org_onboarding SET printed_one = true WHERE org_id = $1", [session.org.id]);
    return { ok: true, printed: r.rows.length };`, "printed onboarding"],
  // catalog index reads the pack column it has
  [`    const r = await pool().query("SELECT item_no, name, brand FROM catalog_items WHERE org_id = $1 AND active", [orgId]);`,
   `    const r = await pool().query("SELECT item_no, name, brand, pack FROM catalog_items WHERE org_id = $1 AND active", [orgId]);`, "catalog pack"],
  // request stores brand key on import (brandKey already resolved) -- and createRequest accepts itemNo from the picker
  [`  return { listTeams, createTeam, chainsForOrg, listStores, upsertStore, importStores, setup, saveStyle, setStyleTemplate, retireStyle, saveMaterial,
           list, createRequest, updateRequest, cancelRequest, rejectRequest, createBatch, listBatches, printHtml, markPrinted,`,
   `  return { listTeams, createTeam, chainsForOrg, listStores, upsertStore, importStores, retireStore, setup, saveStyle, setStyleTemplate, setStyleLogo, retireStyle, saveMaterial, retireMaterial,
           list, createRequest, updateRequest, cancelRequest, rejectRequest, unbatchRequest, createBatch, listBatches, printHtml, markPrinted, deleteBatch, mineCounts,`, "exports"],
]);

/* ---- brands.js: approve-confident ---- */
patch("lib/brands.js", "approveConfident", [
  [`  async function setOverride(session, brandId, dataUrl) {`,
`  async function approveConfident(session, body) {
    const min = Math.max(0.5, Math.min(1, parseFloat(body && body.min) || 0.9));
    const r = await pool().query("UPDATE brands SET status = 'approved', updated_at = now() WHERE status = 'found' AND logo_key IS NOT NULL AND confidence >= $1 RETURNING brand_key", [min]);
    return { ok: true, approved: r.rowCount, min };
  }
  async function setOverride(session, brandId, dataUrl) {`, "approveConfident"],
  [`  return { list, recognize, find, pick, setStatus, setOverride,`, `  return { list, recognize, find, pick, setStatus, approveConfident, setOverride,`, "export"],
]);

/* ---- server.js: routes ---- */
patch("server.js", "/api/catalog", [
  [`const TAGUP = require("./lib/tagup");`, `const TAGUP = require("./lib/tagup");
const CATALOG = require("./lib/catalog");
const EMAIL = require("./lib/email");`, "requires"],
  [`  const sendEmail = o.sendEmail || (async (to, subject, url) => { console.log("[email]", to, subject, url); });`,
   `  const mailer = EMAIL.create(o.env || process.env, o.fetch);
  const sendEmail = o.sendEmail || mailer.send;`, "mailer"],
  [`  const tagupMod = TAGUP.create({ pool, brands: brandsMod, putAsset: assetsMod.putAsset });`,
   `  const tagupMod = TAGUP.create({ pool, brands: brandsMod, putAsset: assetsMod.putAsset });
  const catalogMod = CATALOG.create({ pool });`, "catalog create"],
  [`  app.get("/api/stores", requireOrg, wrap(async (req) => tagupMod.listStores(req.session)));`,
   `  app.get("/api/health", (req, res) => res.json({ ok: true, mail: mailer.mode, ai: !!(o.env || process.env).ANTHROPIC_API_KEY, at: new Date().toISOString() }));
  app.get("/api/stores", requireOrg, wrap(async (req) => tagupMod.listStores(req.session, { withStyles: req.query.styles === "1" })));
  app.post("/api/stores/:id/retire", requireOrg, wrap(async (req) => tagupMod.retireStore(req.session, req.params.id, req.body && req.body.restore)));
  app.get("/api/catalog", requireOrg, wrap(async (req) => catalogMod.list(req.session, { q: req.query.q, limit: req.query.limit })));
  app.post("/api/catalog/import", requireOrg, upload.single("file"), wrap(async (req) => {
    if (!tagupMod.canAdmin(req.session)) return { error: "only an owner or admin loads the item list", status: 403 };
    if (!req.file) return { error: "no file uploaded" };
    let sheets; try { sheets = readWorkbook(req.file.buffer); } catch (e) { return { error: "could not read the workbook: " + e.message }; }
    return catalogMod.importItems(req.session, sheets, { preview: (req.body || {}).preview === "1" });
  }));
  app.get("/api/requests/mine", requireOrg, wrap(async (req) => tagupMod.mineCounts(req.session)));`, "stores/catalog/health routes"],
  [`  app.post("/api/styles/:id/retire", requireOrg, wrap(async (req) => tagupMod.retireStyle(req.session, req.params.id, req.body && req.body.restore)));
  app.post("/api/materials", requireOrg, wrap(async (req) => tagupMod.saveMaterial(req.session, req.body)));`,
   `  app.post("/api/styles/:id/retire", requireOrg, wrap(async (req) => tagupMod.retireStyle(req.session, req.params.id, req.body && req.body.restore)));
  app.post("/api/styles/:id/logo", requireOrg, wrap(async (req) => tagupMod.setStyleLogo(req.session, req.params.id, req.body)));
  app.post("/api/materials", requireOrg, wrap(async (req) => tagupMod.saveMaterial(req.session, req.body)));
  app.post("/api/materials/:id/retire", requireOrg, wrap(async (req) => tagupMod.retireMaterial(req.session, req.params.id, req.body && req.body.restore)));`, "style logo / material retire"],
  [`  app.post("/api/brands/:key/pick", requireOrg,`, `  app.post("/api/brands/approve-confident", requireOrg, wrap(async (req) => { if (!tagupMod.canAdmin(req.session)) return { error: "forbidden", status: 403 }; return brandsMod.approveConfident(req.session, req.body); }));
  app.post("/api/brands/:key/pick", requireOrg,`, "approve-confident"],
  [`  app.post("/api/requests/:id/reject", requireOrg, wrap(async (req) => tagupMod.rejectRequest(req.session, req.params.id, req.body && req.body.reason)));`,
   `  app.post("/api/requests/:id/reject", requireOrg, wrap(async (req) => tagupMod.rejectRequest(req.session, req.params.id, req.body && req.body.reason)));
  app.post("/api/requests/:id/unbatch", requireOrg, wrap(async (req) => tagupMod.unbatchRequest(req.session, req.params.id)));
  app.post("/api/batches/:id/delete", requireOrg, wrap(async (req) => tagupMod.deleteBatch(req.session, req.params.id)));`, "unbatch/delete routes"],
  // the workbook reader is defined after the routes that now use it -- hoist it
  [`  /* ---- import / export ---- */
  function readWorkbook(buffer) {
    const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
    return wb.SheetNames.map((name) => ({ name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" }) }));
  }`, `  /* ---- import / export ---- */`, "remove late readWorkbook"],
  [`  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });`,
   `  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
  function readWorkbook(buffer) {
    const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
    return wb.SheetNames.map((name) => ({ name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" }) }));
  }`, "hoist readWorkbook"],
  // brand write routes: admin only (the shared library is everyone's)
  [`  app.post("/api/brands/recognize", requireOrg, wrap(async (req) => brandsMod.recognize(req.session, req.body)));
  app.post("/api/brands/find", requireOrg, wrap(async (req) => brandsMod.find(req.session, req.body)));`,
   `  const adminOnly = (fn) => wrap(async (req) => (tagupMod.canAdmin(req.session) ? fn(req) : { error: "forbidden", status: 403 }));
  app.post("/api/brands/recognize", requireOrg, adminOnly((req) => brandsMod.recognize(req.session, req.body)));
  app.post("/api/brands/find", requireOrg, adminOnly((req) => brandsMod.find(req.session, req.body)));`, "brand admin gate"],
]);

/* ---- tagup-core.js: asset paths + the rules engine ---- */
{
  const p = path.join(ROOT, "lib/tagup-core.js");
  const s = fs.readFileSync(p, "utf8");
  const n = s.split('"/api/asset/').length - 1;
  if (n) { fs.writeFileSync(p, s.split('"/api/asset/').join('"/api/assets/')); console.log("tagup-core.js: " + n + " asset paths -> /api/assets/"); }
}
patch("lib/tagup-core.js", "applyRules", [
  [`  /* ---------------- template styles ---------------- */`,
`  /* ---------------- rules ---------------- */
  // Conditional formatting on a style -- the gap against Tagify's chain
  // styles (GPM: a 2/for price tier picks the background colour AND writes
  // "Single retail at $x"; BreakTime: every promo carries "Reg." + the was
  // price). A rule is {when, set}: \`when\` tests ONE request field against a
  // value, \`set\` overrides theme knobs and/or the request's alt text. Rules
  // run in order and later ones win, so a style author reads them top to
  // bottom the way the chain's own sheet is written. Pure and deterministic:
  // the preview, the editor's sample and the print sheet all evaluate the
  // same list the same way.
  const RULE_FIELDS = ["price", "wasPrice", "multiBuyQty", "contentType", "format", "itemName", "packageSize"];
  const RULE_OPS = ["eq", "neq", "gte", "lte", "between", "in", "contains", "exists"];
  const RULE_SETS = ["bg", "fg", "accent", "accentFg", "priceColor", "caption", "note", "notePrefix", "hideWas"];
  function normalizeRule(r) {
    const b = r || {};
    const w = b.when || {};
    if (RULE_FIELDS.indexOf(w.field) === -1 || RULE_OPS.indexOf(w.op) === -1) return null;
    const set = {};
    Object.keys(b.set || {}).forEach(function (k) {
      if (RULE_SETS.indexOf(k) === -1) return;
      const v = b.set[k];
      if (/^(bg|fg|accent|accentFg|priceColor)$/.test(k)) { if (HEX.test(String(v || ""))) set[k] = v; }
      else if (k === "hideWas") set[k] = !!v;
      else set[k] = clip(v, 60);
    });
    if (!Object.keys(set).length) return null;
    const when = { field: w.field, op: w.op };
    if (w.op === "between") { when.lo = toPrice(w.lo); when.hi = toPrice(w.hi); if (when.lo == null || when.hi == null) return null; }
    else if (w.op === "in") { when.values = Array.isArray(w.values) ? w.values.map(function (x) { return String(x); }).slice(0, 40) : String(w.values || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean); if (!when.values.length) return null; }
    else if (w.op !== "exists") { when.value = w.value; }
    return { when: when, set: set, label: clip(b.label, 60) };
  }
  function normalizeRules(list) { return (Array.isArray(list) ? list : []).map(normalizeRule).filter(Boolean).slice(0, 20); }
  function ruleMatches(rule, req) {
    const w = rule.when;
    const raw = req[w.field];
    const isNum = /^(price|wasPrice|multiBuyQty)$/.test(w.field);
    if (w.op === "exists") return raw != null && raw !== "" && raw !== 0;
    if (raw == null) return false;
    if (isNum) {
      const n = Number(raw);
      if (!isFinite(n)) return false;
      if (w.op === "eq") return Math.abs(n - Number(w.value)) < 0.005;
      if (w.op === "neq") return Math.abs(n - Number(w.value)) >= 0.005;
      if (w.op === "gte") return n >= Number(w.value) - 0.005;
      if (w.op === "lte") return n <= Number(w.value) + 0.005;
      if (w.op === "between") return n >= w.lo - 0.005 && n <= w.hi + 0.005;
      if (w.op === "in") return w.values.some(function (v) { return Math.abs(n - Number(v)) < 0.005; });
      return false;
    }
    const s = String(raw).toLowerCase();
    if (w.op === "eq") return s === String(w.value).toLowerCase();
    if (w.op === "neq") return s !== String(w.value).toLowerCase();
    if (w.op === "in") return w.values.some(function (v) { return String(v).toLowerCase() === s; });
    if (w.op === "contains") return s.indexOf(String(w.value).toLowerCase()) !== -1;
    return false;
  }
  // Returns { theme, req } with every matching rule applied, originals untouched.
  function applyRules(rules, theme, req) {
    const list = normalizeRules(rules);
    let th = theme, rq = req, hit = [];
    list.forEach(function (rule) {
      if (!ruleMatches(rule, rq)) return;
      hit.push(rule);
      th = Object.assign({}, th); rq = Object.assign({}, rq);
      Object.keys(rule.set).forEach(function (k) {
        const v = rule.set[k];
        if (k === "note") rq.note = v;
        else if (k === "notePrefix") rq.note = (v + " " + (rq.note || "")).trim();
        else if (k === "hideWas") th.showWas = !v;
        else th[k] = v;
      });
    });
    return { theme: th, req: rq, hit: hit };
  }
  // Tagify-shaped presets a style author can start from.
  const RULE_PRESETS = [
    { id: "reg_price", label: "Promo shows \\"Reg. $x\\" under the price", rules: [{ label: "Reg. line", when: { field: "wasPrice", op: "exists" }, set: { notePrefix: "Reg." } }] },
    { id: "single_retail", label: "2-for price adds \\"Single retail at\\"", rules: [{ label: "Single retail", when: { field: "multiBuyQty", op: "gte", value: 2 }, set: { notePrefix: "Single retail at" } }] },
    { id: "tier_colors", label: "Colour by 2-for price tier (GPM style)", rules: [
      { label: "2/$2.50", when: { field: "price", op: "between", lo: 2.4, hi: 2.6 }, set: { accent: "#7AC943", bg: "#7AC943", fg: "#111111" } },
      { label: "2/$3.50", when: { field: "price", op: "between", lo: 3.4, hi: 3.6 }, set: { accent: "#FFC20E", bg: "#FFC20E", fg: "#111111" } },
      { label: "2/$5.00", when: { field: "price", op: "between", lo: 4.9, hi: 5.1 }, set: { accent: "#F7941D", bg: "#F7941D", fg: "#111111" } },
      { label: "2/$6.50", when: { field: "price", op: "between", lo: 6.4, hi: 6.6 }, set: { accent: "#ED1C24", bg: "#ED1C24", fg: "#FFFFFF", priceColor: "#FFFFFF" } },
      { label: "2/$8.50", when: { field: "price", op: "between", lo: 8.4, hi: 8.6 }, set: { accent: "#6B7A2A", bg: "#6B7A2A", fg: "#FFFFFF", priceColor: "#FFFFFF" } },
    ] },
  ];

  /* ---------------- template styles ---------------- */`, "rules engine"],
  // wire rules into both renderers: composed reads theme+req through applyRules; template gets the req (note) + theme accent
  [`  function renderTag(req, style, material, opts) {
    if (isTemplate(style)) return renderTemplateTag(req, style, material, opts);
    const o = opts || {};
    const th = themeMerge(style && style.theme);
    const ct = req.contentType || "standard_price";`,
`  function renderTag(req0, style, material, opts) {
    const applied = applyRules(style && style.rules, themeMerge(style && style.theme), req0 || {});
    const req = applied.req;
    if (isTemplate(style)) return renderTemplateTag(req, style, material, opts);
    const o = opts || {};
    const th = applied.theme;
    const ct = req.contentType || "standard_price";`, "renderTag rules"],
  [`    const bold = th.layout === "bold", minimal = th.layout === "minimal";
    const bg = bold ? accent : th.bg, fg = bold ? th.accentFg : th.fg, priceColor = bold ? th.accentFg : (ct === "standard_price" ? th.priceColor : accent);`,
   `    const bold = th.layout === "bold", minimal = th.layout === "minimal";
    // A rule that set bg/fg wins over the layout's own choice (a tier colour
    // must show on a bold layout too); otherwise the layout decides.
    const ruleBg = applied.hit.some(function (r) { return r.set.bg; }), ruleFg = applied.hit.some(function (r) { return r.set.fg; });
    const bg = ruleBg ? th.bg : (bold ? accent : th.bg), fg = ruleFg ? th.fg : (bold ? th.accentFg : th.fg), priceColor = applied.hit.some(function (r) { return r.set.priceColor; }) ? th.priceColor : (bold ? th.accentFg : (ct === "standard_price" ? th.priceColor : accent));`, "rule colours"],
  [`    normalizeRequest: normalizeRequest, ITEM_MAX: ITEM_MAX, NOTE_MAX: NOTE_MAX,`,
   `    normalizeRequest: normalizeRequest, ITEM_MAX: ITEM_MAX, NOTE_MAX: NOTE_MAX,
    RULE_FIELDS: RULE_FIELDS, RULE_OPS: RULE_OPS, RULE_SETS: RULE_SETS, RULE_PRESETS: RULE_PRESETS, normalizeRule: normalizeRule, normalizeRules: normalizeRules, ruleMatches: ruleMatches, applyRules: applyRules,`, "exports"],
]);
// saveStyle validates rules through the core, not slice()
patch("lib/tagup.js", "CORE.normalizeRules(b.rules", [
  [`    const rules = Array.isArray(b.rules) ? b.rules.slice(0, 20) : [];`, `    const rules = CORE.normalizeRules(b.rules || []);`, "rules normalize"],
  [`rules: Array.isArray(r.rules) ? r.rules : [],`, `rules: CORE.normalizeRules(r.rules || []),`, "styleOut rules"],
]);
console.log("done");
