/* brands.js -- the SHARED brand logo library (multi-tenant).

   Ported from the embedded product's tagup-brands.js, with one deliberate
   architecture change: brands are GLOBAL, not per-org. "Michelob Ultra" is
   the same brand and the same logo for every tenant, so once one org's
   admin approves it, every other org gets it for free. That shared,
   growing library is a real moat a single-tenant tool cannot build --
   Tagify's own package graphics are uploaded per customer with no such
   sharing. An org that disagrees with the shared pick can override it
   privately (brand_overrides) without touching the shared row.

   Same three steps as the embedded version: Recognize (Claude normalizes
   catalog abbreviations into brand names), Find (Wikimedia + Claude vision
   picks a logo), Approve (nothing prints until approved -- a wrong logo
   is worse than none, and it is now everyone's wrong logo if skipped). */
"use strict";

const WIKI_API = "https://commons.wikimedia.org/w/api.php";
const UA = "tagup/1.0 (https://tagup.app)";
const MODEL = "claude-opus-5";
const TIMEOUT_MS = 45000;
const MAX_CANDIDATES = 6;

function newId() { return require("crypto").randomUUID(); }
function normBrand(s) { return String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, "-"); }
function titleCase(s) { return String(s || "").toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()); }
function clip(v, n) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n); }
function stripFences(t) { return String(t || "").replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, ""); }

function rowOut(r) {
  return { id: r.id, key: r.brand_key, label: r.label, aliases: Array.isArray(r.aliases) ? r.aliases : [], logoKey: r.logo_key || null,
           source: r.source || null, sourceUrl: r.source_url || null, candidates: Array.isArray(r.candidates) ? r.candidates : [],
           status: r.status || "none", confidence: r.confidence == null ? null : Number(r.confidence), note: r.note || "", updatedAt: r.updated_at };
}

function create(deps) {
  const D = deps;
  const pool = () => D.pool;
  const env = D.env || process.env;
  const fetchFn = D.fetch || (typeof fetch === "function" ? fetch : null);

  async function rows() { const r = await pool().query("SELECT * FROM brands ORDER BY label"); return r.rows.map(rowOut); }
  function indexOf(list) { const idx = {}; list.forEach((b) => { idx[b.key] = b; (b.aliases || []).forEach((a) => { idx[normBrand(a)] = b; }); }); return idx; }

  // The org's own brand spellings: the catalog's Brand column, else the
  // leading word(s) of the item name -- what Recognize turns into brands.
  async function catalogBrandStrings(orgId) {
    const r = await pool().query("SELECT brand, name FROM catalog_items WHERE org_id = $1 AND active", [orgId]);
    const seen = {};
    r.rows.forEach((x) => { const s = clip(x.brand || String(x.name || "").split(/\s+\d|\s+-\s+|\s{2,}/)[0].split(/\s+/).slice(0, 2).join(" "), 60); if (s) seen[normBrand(s)] = seen[normBrand(s)] || s; });
    return Object.values(seen);
  }
  async function list(session) {
    const org = session.org.id;
    const [brands, overrides, catStrings] = await Promise.all([
      rows(),
      pool().query("SELECT brand_id, logo_key FROM brand_overrides WHERE org_id = $1", [org]),
      catalogBrandStrings(org),
    ]);
    const ov = {}; overrides.rows.forEach((r) => { ov[r.brand_id] = r.logo_key; });
    brands.forEach((b) => { if (ov[b.id]) { b.orgLogoKey = ov[b.id]; b.overridden = true; } });
    const idx = indexOf(brands);
    const itemCounts = await pool().query("SELECT brand, count(*)::int AS n FROM catalog_items WHERE org_id = $1 AND active AND brand IS NOT NULL GROUP BY brand", [org]);
    const nItems = {}; itemCounts.rows.forEach((x) => { const hit = idx[normBrand(x.brand)]; if (hit) nItems[hit.key] = (nItems[hit.key] || 0) + x.n; });
    brands.forEach((b) => { b.items = nItems[b.key] || 0; });
    const unmatched = catStrings.filter((s) => !idx[normBrand(s)]).map((raw) => ({ raw }));
    const counts = { approved: 0, found: 0, missing: 0, rejected: 0 };
    brands.forEach((b) => { if (b.status === "approved" || b.status === "manual" || b.overridden) counts.approved++; else if (b.status === "found") counts.found++; else if (b.status === "rejected") counts.rejected++; else counts.missing++; });
    return { ok: true, brands, unmatched, counts, canWrite: true, aiOn: !!env.ANTHROPIC_API_KEY };
  }

  async function callModel(messages, system, maxTokens) {
    const key = env.ANTHROPIC_API_KEY;
    if (!key) return { error: "no ANTHROPIC_API_KEY" };
    if (!fetchFn) return { error: "no fetch available" };
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
    try {
      const r = await fetchFn("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        signal: ctl ? ctl.signal : undefined,
        body: JSON.stringify({ model: env.TAGUP_BRAND_MODEL || MODEL, system, max_tokens: maxTokens || 3000, output_config: { effort: "low" }, messages }),
      });
      if (timer) clearTimeout(timer);
      if (!r.ok) { let why = ""; try { const e = await r.json(); why = (e && e.error && (e.error.message || e.error.type)) || ""; } catch (x) {} return { error: "http " + r.status + (why ? ": " + why.slice(0, 160) : "") }; }
      const j = await r.json();
      if (j.stop_reason === "refusal") return { error: "refused" };
      const text = ((j.content || []).find((c) => c.type === "text") || {}).text || "";
      let obj = null; try { obj = JSON.parse(stripFences(text)); } catch (e) { return { error: "unparseable: " + text.slice(0, 120) }; }
      return { result: obj };
    } catch (e) { if (timer) clearTimeout(timer); return { error: (e && e.name === "AbortError") ? "timeout" : (e && e.message) || "call failed" }; }
  }

  const RECOGNIZE_SYSTEM = "You normalize beverage brand strings from retail item catalogs into canonical consumer brand names as printed on packaging. " +
    "Input: a JSON array of raw strings, often abbreviated. Answer ONLY {\"map\": {\"<raw>\": \"<Canonical Brand>\"}}. " +
    "Use the parent brand a shopper would recognize. If a string is not a brand, map it to \"\".";
  async function recognize(session, body) {
    const b = body || {};
    let names = Array.isArray(b.names) ? b.names.map(String) : [];
    if (!names.length && b.fromCatalog) names = await catalogBrandStrings(session.org.id);
    names = Array.from(new Set(names.map((s) => clip(s, 60)).filter(Boolean))).slice(0, 200);
    if (!names.length) return { ok: true, created: 0, aliased: 0, names: 0 };
    const known = indexOf(await rows());
    // aiNote, never `error`: this call still succeeds without a model key
    // (Title Case instead of real recognition), and the generic route
    // wrapper treats a top-level `.error` as a hard failure -- reusing that
    // name for an informational note caused exactly that collision once.
    let map = {}, ai = false, aiNote = null;
    const r = await callModel([{ role: "user", content: JSON.stringify(names) }], RECOGNIZE_SYSTEM, 4000);
    if (r.result && r.result.map) { map = r.result.map; ai = true; } else aiNote = r.error || null;
    let created = 0, aliased = 0, skipped = 0;
    for (const raw of names) {
      const hit = known[normBrand(raw)];
      const canon = clip(hit ? hit.label : (map[raw] != null ? map[raw] : titleCase(raw)), 60);
      const key = normBrand(canon);
      if (!key) { skipped++; continue; }
      const cur = await pool().query("SELECT id, aliases FROM brands WHERE brand_key = $1", [key]);
      const aliases = cur.rows.length ? (cur.rows[0].aliases || []) : [];
      const rawKey = normBrand(raw);
      const addAlias = rawKey && rawKey !== key && aliases.map(normBrand).indexOf(rawKey) === -1;
      if (addAlias) aliases.push(raw);
      if (!cur.rows.length) { await pool().query("INSERT INTO brands (id, brand_key, label, aliases) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (brand_key) DO NOTHING", [newId(), key, canon, JSON.stringify(aliases)]); created++; }
      else if (addAlias) { await pool().query("UPDATE brands SET aliases = $2::jsonb, updated_at = now() WHERE brand_key = $1", [key, JSON.stringify(aliases)]); aliased++; }
    }
    return { ok: true, ai, aiNote, names: names.length, created, aliased, skipped };
  }

  async function wikiSearch(label) {
    const q = WIKI_API + "?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=" + (MAX_CANDIDATES + 4) + "&gsrsearch=" + encodeURIComponent(label + " logo") + "&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=600";
    const r = await fetchFn(q, { headers: { "user-agent": UA, accept: "application/json" } });
    if (!r.ok) throw new Error("wikimedia http " + r.status);
    const j = await r.json();
    const pages = (j.query && j.query.pages) || {};
    return Object.keys(pages).map((k) => pages[k])
      .map((p) => { const ii = (p.imageinfo || [])[0] || {}; return { title: String(p.title || "").replace(/^File:/, ""), url: ii.thumburl || ii.url || null, page: ii.descriptionurl || null, mime: ii.mime || "", idx: p.index || 99 }; })
      .filter((c) => c.url && /^image\/(png|jpeg|svg\+xml|gif|webp)$/.test(c.mime))
      .sort((a, b) => a.idx - b.idx).slice(0, MAX_CANDIDATES)
      .map((c, i) => ({ i, title: c.title, url: c.url, page: c.page }));
  }
  const PICK_SYSTEM = "You are checking candidate images for a beverage brand's OFFICIAL LOGO to print on a retail price tag. " +
    "Answer ONLY {\"pick\": <index or -1>, \"confidence\": 0..1, \"why\": \"<short line>\"}. " +
    "Pick the candidate that is the brand's current wordmark on a clean background, not a can/bottle photo, not a different brand, not a fan recreation.";
  async function pickWithModel(label, cands) {
    if (!env.ANTHROPIC_API_KEY || !cands.length) return null;
    const content = [{ type: "text", text: "Brand: " + label }];
    cands.forEach((c) => { content.push({ type: "text", text: "Candidate " + c.i }); content.push({ type: "image", source: { type: "url", url: c.url } }); });
    const r = await callModel([{ role: "user", content }], PICK_SYSTEM, 300);
    if (!r.result) return { error: r.error };
    return { pick: parseInt(r.result.pick, 10), confidence: Math.max(0, Math.min(1, parseFloat(r.result.confidence) || 0)), why: clip(r.result.why, 160) };
  }
  async function download(url) {
    const r = await fetchFn(url, { headers: { "user-agent": UA } });
    if (!r.ok) throw new Error("download http " + r.status);
    const mime = String(r.headers.get("content-type") || "image/png").split(";")[0];
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 4 * 1024 * 1024) throw new Error("logo over 4 MB");
    return "data:" + (/^image\//.test(mime) ? mime : "image/png") + ";base64," + buf.toString("base64");
  }
  async function storeCandidate(key, c) { const dataUrl = await download(c.url); return D.putAsset("blogo", dataUrl, { brand: key, url: c.url }); }

  async function find(session, body) {
    if (!fetchFn) return { error: "no outbound fetch on this server" };
    const b = body || {};
    let targets = await rows();
    if (Array.isArray(b.keys) && b.keys.length) targets = targets.filter((x) => b.keys.indexOf(x.key) !== -1);
    else targets = targets.filter((x) => x.status === "none" || (b.retry && x.status === "rejected"));
    targets = targets.slice(0, Math.min(parseInt(b.limit, 10) || 15, 40));
    const out = { ok: true, ai: !!env.ANTHROPIC_API_KEY, tried: 0, found: 0, none: 0, errors: [], results: [] };
    for (const br of targets) {
      out.tried++;
      try {
        const cands = await wikiSearch(br.label);
        let pick = -1, conf = null, why = "";
        if (!cands.length) why = "nothing on Wikimedia Commons for \"" + br.label + " logo\"";
        else { const m = await pickWithModel(br.label, cands); if (m && !m.error) { pick = m.pick; conf = m.confidence; why = m.why; } else { pick = 0; why = m && m.error ? "model unavailable (" + m.error + ") -- top hit, unverified" : "no ANTHROPIC_API_KEY -- top hit, unverified"; } }
        let logoKey = null, status = "none";
        if (pick >= 0 && cands[pick]) { logoKey = await storeCandidate(br.key, cands[pick]); status = "found"; }
        await pool().query("UPDATE brands SET logo_key = coalesce($2, logo_key), status = CASE WHEN status IN ('approved','manual') THEN status ELSE $3 END, candidates = $4::jsonb, confidence = $5, note = $6, updated_at = now() WHERE brand_key = $1",
          [br.key, logoKey, status, JSON.stringify(cands), conf, why]);
        if (status === "found") out.found++; else out.none++;
        out.results.push({ key: br.key, status, confidence: conf, why });
      } catch (e) { out.errors.push({ key: br.key, error: String((e && e.message) || e) }); }
    }
    return out;
  }
  async function pick(session, key, body) {
    const r = await pool().query("SELECT * FROM brands WHERE brand_key = $1", [key]);
    if (!r.rows.length) return { error: "brand not found" };
    const br = rowOut(r.rows[0]);
    const c = br.candidates.find((x) => x.i === parseInt(body && body.index, 10));
    if (!c) return { error: "no such candidate" };
    const logoKey = await storeCandidate(key, c);
    const u = await pool().query("UPDATE brands SET logo_key = $2, status = 'approved', confidence = 1, note = 'picked by an admin', updated_at = now() WHERE brand_key = $1 RETURNING *", [key, logoKey]);
    return { ok: true, brand: rowOut(u.rows[0]) };
  }
  async function setStatus(session, key, status) {
    if (["approved", "rejected"].indexOf(status) === -1) return { error: "bad status" };
    const cur = await pool().query("SELECT logo_key FROM brands WHERE brand_key = $1", [key]);
    if (!cur.rows.length) return { error: "brand not found" };
    if (status === "approved" && !cur.rows[0].logo_key) return { error: "nothing to approve yet" };
    const r = await pool().query("UPDATE brands SET status = $2, updated_at = now() WHERE brand_key = $1 RETURNING *", [key, status]);
    return { ok: true, brand: rowOut(r.rows[0]) };
  }
  // An org's private override: this tenant sees its own upload, everyone
  // else keeps seeing the shared pick.
  async function approveConfident(session, body) {
    const min = Math.max(0.5, Math.min(1, parseFloat(body && body.min) || 0.9));
    const r = await pool().query("UPDATE brands SET status = 'approved', updated_at = now() WHERE status = 'found' AND logo_key IS NOT NULL AND confidence >= $1 RETURNING brand_key", [min]);
    return { ok: true, approved: r.rowCount, min };
  }
  async function setOverride(session, brandId, dataUrl) {
    if (!dataUrl) { await pool().query("DELETE FROM brand_overrides WHERE org_id = $1 AND brand_id = $2", [session.org.id, brandId]); return { ok: true, removed: true }; }
    const logoKey = await D.putAsset("blogo", dataUrl, { org: session.org.id, brand: brandId });
    if (!logoKey) return { error: "logo must be an image" };
    await pool().query("INSERT INTO brand_overrides (org_id, brand_id, logo_key) VALUES ($1,$2,$3) ON CONFLICT (org_id, brand_id) DO UPDATE SET logo_key = EXCLUDED.logo_key", [session.org.id, brandId, logoKey]);
    return { ok: true, logoKey };
  }

  function brandKeyFor(itemName, itemBrand, brands) {
    const idx = indexOf(brands || []);
    const bk = normBrand(itemBrand);
    if (bk && idx[bk]) return idx[bk].key;
    const name = " " + normBrand(itemName).replace(/-/g, " ") + " ";
    let best = null, bestLen = 0;
    (brands || []).forEach((b) => { [b.label].concat(b.aliases || []).forEach((s) => { const n = normBrand(s).replace(/-/g, " "); if (n.length > bestLen && name.indexOf(" " + n + " ") !== -1) { best = b.key; bestLen = n.length; } }); });
    return best;
  }
  async function brandKeyForAsync(itemName, itemBrand) { return brandKeyFor(itemName, itemBrand, await rows()); }

  // Resolves logos for a set of requests, honoring an org's private override
  // over the shared pick -- attachLogos never leaks another org's override.
  async function attachLogos(session, reqs) {
    const brands = await rows();
    const byId = {}; brands.forEach((b) => { byId[b.id] = b; });
    const printable = {}; brands.forEach((b) => { if (b.status === "approved" || b.status === "manual") printable[b.id] = b.logoKey; });
    let overrides = {};
    if (session && session.org) {
      const r = await pool().query("SELECT brand_id, logo_key FROM brand_overrides WHERE org_id = $1", [session.org.id]);
      r.rows.forEach((x) => { overrides[x.brand_id] = x.logo_key; });
    }
    (reqs || []).forEach((q) => {
      if (!q.brandId) { q.brandLogoKey = null; return; }
      q.brandLogoKey = overrides[q.brandId] || printable[q.brandId] || null;
      q.brandLabel = (byId[q.brandId] || {}).label || null;
    });
    return reqs;
  }

  return { list, recognize, find, pick, setStatus, approveConfident, setOverride, brandKeyFor, brandKeyForAsync, attachLogos, rows, normBrand, titleCase, callModel, wikiSearch };
}

module.exports = { create, normBrand, titleCase, rowOut };
