"use strict";
/* Import brand logos from VIP's Brand Builder (2026-09-24). The distributor's
   public catalog at products.vtinfo.com/bbs/v1/distributor/<id>/brands carries
   507 brands / 483 logos for Standard Sales (02308) at the same grain the
   catalog's Brand column uses ("Michelob Ultra", "Bud Light"), hosted on
   images.vtinfo.com. No auth. Each VIP brand is matched to this org's brands
   by name (label or alias, words as a contiguous run in either direction,
   common VIP abbreviations expanded), the logo is downloaded and stored as
   the org's override. Sentinel-guarded per file. */
const fs = require("fs");
function patch(file, sentinel, edits) {
  let s = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  if (s.indexOf(sentinel) !== -1) { console.log(file + ": already applied"); return; }
  for (const [a, b, l] of edits) { if (s.split(a).length !== 2) { console.error("ABORT " + file + " / " + l + " matched " + (s.split(a).length - 1)); process.exit(1); } s = s.replace(a, () => b); }
  fs.writeFileSync(file, s); console.log(file + ": " + edits.length + " edits");
}

patch("schema.sql", "vip_distributor_id", [
  [`CREATE TABLE IF NOT EXISTS users (`,
   `-- The org's VIP Brand Builder distributor id (e.g. 02308), remembered after
-- the first logo import so a re-import is one click.
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS vip_distributor_id text;

CREATE TABLE IF NOT EXISTS users (`, "column"],
]);

patch("lib/brands.js", "importVip", [
  [`  // Many logo files at once; each lands as this org's override on the brand`,
`  /* ---------------- VIP Brand Builder ---------------- */
  const VIP_API = "https://products.vtinfo.com/bbs/v1";
  // VIP's item-catalog abbreviations, expanded on both sides before matching.
  const VIP_ABBR = { mich: "michelob", lt: "light", ult: "ultra", sltz: "seltzer", wc: "white claw", si: "sparkling ice", nat: "natural", bl: "bud light", n: "", a: "" };
  function expandWords(words) {
    const out = [];
    words.forEach((w) => { const e = VIP_ABBR[w]; if (e === undefined) out.push(w); else if (e) e.split(" ").forEach((x) => out.push(x)); });
    return out;
  }
  // The best VIP brand for one of ours: exact name first, then the longest
  // VIP name whose words run inside ours (Michelob Ultra Pure Gold <- Michelob
  // Ultra) or ours inside theirs (Bud <- Bud Light is NOT allowed: a shorter
  // brand must not inherit a longer one's logo), across label and aliases.
  function matchVipBrand(brand, vipBrands) {
    const names = [brand.label].concat(brand.aliases || []);
    let best = null;
    for (const nm of names) {
      const ours = expandWords(wordsOf(nm)); if (!ours.length) continue;
      for (const v of vipBrands) {
        if (!v.brand_logo) continue;
        const theirs = expandWords(wordsOf(v.brand_name)); if (!theirs.length) continue;
        const exact = ours.length === theirs.length && containsRun(ours, theirs);
        const family = !exact && containsRun(ours, theirs);   // theirs is a prefix/run of ours
        if (!exact && !family) continue;
        const score = (exact ? 1000 : 0) + theirs.length * 10 + theirs.join(" ").length;
        if (!best || score > best.score) best = { vip: v, via: nm, exact, score };
      }
    }
    return best;
  }
  async function fetchVipBrands(distributorId) {
    const id = String(distributorId || "").replace(/[^0-9A-Za-z-]/g, "");
    if (!id) return { error: "enter your VIP distributor id (the number in your Brand Builder link, e.g. 02308)" };
    const r = await fetchFn(VIP_API + "/distributor/" + encodeURIComponent(id) + "/brands", { headers: { "user-agent": UA, accept: "application/json" } });
    if (r.status === 404) return { error: "VIP has no Brand Builder for distributor " + id };
    if (!r.ok) return { error: "VIP answered http " + r.status };
    const j = await r.json();
    const seen = {}; const list = [];
    ((j && j.data) || []).forEach((g) => (g.brands || []).forEach((b) => { if (b && b.brand_id && !seen[b.brand_id]) { seen[b.brand_id] = 1; list.push({ brand_id: String(b.brand_id), brand_name: String(b.brand_name || ""), brand_logo: b.brand_logo || null }); } }));
    return { ok: true, id, brands: list };
  }
  // Import every logo VIP has for a brand this org knows. Dry run reports the
  // matches without downloading anything.
  async function importVip(session, body) {
    const b = body || {};
    const feed = await fetchVipBrands(b.distributorId);
    if (feed.error) return feed;
    const brands = await rows();
    const ov = await pool().query("SELECT brand_id FROM brand_overrides WHERE org_id = $1", [session.org.id]);
    const has = {}; ov.rows.forEach((r) => { has[r.brand_id] = 1; });
    const plan = [];
    for (const br of brands) {
      if (!b.replace && has[br.id]) continue;   // keep a logo the org already uploaded
      const m = matchVipBrand(br, feed.brands);
      if (m) plan.push({ brand: br, vip: m.vip, via: m.via, exact: m.exact });
    }
    const out = { ok: true, distributorId: feed.id, vipBrands: feed.brands.length, vipWithLogo: feed.brands.filter((v) => v.brand_logo).length, orgBrands: brands.length, matched: [], unmatched: [], failed: [], dryRun: !!b.dryRun };
    const matchedIds = {};
    for (const p of plan) {
      matchedIds[p.brand.id] = 1;
      if (b.dryRun) { out.matched.push({ brand: p.brand.label, vip: p.vip.brand_name, exact: p.exact }); continue; }
      try {
        const dataUrl = await download(p.vip.brand_logo);
        const r = await setOverride(session, p.brand.id, dataUrl);
        if (r && r.error) out.failed.push({ brand: p.brand.label, why: r.error }); else out.matched.push({ brand: p.brand.label, vip: p.vip.brand_name, exact: p.exact });
      } catch (e) { out.failed.push({ brand: p.brand.label, why: String((e && e.message) || e) }); }
    }
    brands.forEach((br) => { if (!matchedIds[br.id] && !has[br.id]) out.unmatched.push(br.label); });
    if (!b.dryRun) { try { await pool().query("UPDATE orgs SET vip_distributor_id = $2 WHERE id = $1", [session.org.id, feed.id]); } catch (e) { /* column arrives with the schema */ } }
    return out;
  }
  // Many logo files at once; each lands as this org's override on the brand`, "importVip"],
  [`    return { ok: true, brands, unmatched, counts, canWrite: true, aiOn: !!env.ANTHROPIC_API_KEY };`,
   `    let vipDistributorId = null;
    try { const o = await pool().query("SELECT vip_distributor_id FROM orgs WHERE id = $1", [org]); vipDistributorId = (o.rows[0] && o.rows[0].vip_distributor_id) || null; } catch (e) { /* pre-column */ }
    return { ok: true, brands, unmatched, counts, canWrite: true, aiOn: !!env.ANTHROPIC_API_KEY, vipDistributorId };`, "list vip id"],
  [`  return { list, recognize, find, pick, setStatus, approveConfident, setOverride, scoreCandidates, brandWords, matchFilename, bulkUpload, wikipediaArticleImages,`,
   `  return { list, recognize, find, pick, setStatus, approveConfident, setOverride, scoreCandidates, brandWords, matchFilename, bulkUpload, wikipediaArticleImages, matchVipBrand, expandWords, fetchVipBrands, importVip,`, "export"],
]);

patch("server.js", "/api/brands/import-vip", [
  [`  app.post("/api/brands/upload", requireOrg,`,
   `  app.post("/api/brands/import-vip", requireOrg, wrap(async (req) => (tagupMod.canAdmin(req.session) ? brandsMod.importVip(req.session, req.body) : { error: "forbidden", status: 403 })));
  app.post("/api/brands/upload", requireOrg,`, "route"],
]);

patch("src/tagup-ui.jsx", "importVip", [
  [`      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 9, border: \`2px solid \${C.navy}\`, fontFamily: ui.HEAD, fontWeight: 700, fontSize: 12, textTransform: "uppercase", color: C.navy, cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1 }} title="Pick many logo files at once -- each lands on the brand its filename names (Bud Light.png, michelob-ultra.svg, BUD_LT.png)">`,
   `      <Btn ui={ui} kind="navy" small disabled={!!busy} onClick={importVip} title="Your distributor catalog on VIP Brand Builder carries a logo for most brands -- pull them all in one go">{busy === "vip" ? "Importing from VIP…" : "Import from VIP"}</Btn>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 9, border: \`2px solid \${C.navy}\`, fontFamily: ui.HEAD, fontWeight: 700, fontSize: 12, textTransform: "uppercase", color: C.navy, cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1 }} title="Pick many logo files at once -- each lands on the brand its filename names (Bud Light.png, michelob-ultra.svg, BUD_LT.png)">`, "button"],
  [`  // The supplier's asset library, dropped in whole: filenames name the brands.`,
   `  // VIP Brand Builder: the distributor's public catalog, one logo per brand.
  async function importVip() {
    const saved = (data && data.vipDistributorId) || "";
    const id = window.prompt("Your VIP distributor id -- the number in your Brand Builder / Retailer Portal link (products.vtinfo.com/brandbuilder/XXXXX). Logos land only on brands that have none yet.", saved);
    if (id == null || !String(id).trim()) return;
    setBusy("vip"); setMsg("");
    try {
      const r = await jpost(ui, "/api/brands/import-vip", { distributorId: String(id).trim() });
      if (r && r.error) setMsg(r.error);
      else setMsg(\`VIP lists \${r.vipBrands} brands, \${r.vipWithLogo} with a logo. Imported \${r.matched.length} onto your \${r.orgBrands} brands\${r.matched.length ? " (" + r.matched.slice(0, 8).map((m) => m.brand).join(", ") + (r.matched.length > 8 ? "…" : "") + ")" : ""}.\` + (r.unmatched.length ? \` \${r.unmatched.length} still without one -- VIP spells them differently or has no logo; Upload logos or Find logos covers the rest.\` : "") + (r.failed.length ? \` \${r.failed.length} failed (\${r.failed[0].why}).\` : ""));
      load();
    } catch (ex) { setMsg("Couldn't reach the server."); }
    setBusy("");
  }
  // The supplier's asset library, dropped in whole: filenames name the brands.`, "handler"],
]);
console.log("done");
