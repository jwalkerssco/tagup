"use strict";
/* Logo sources, after probing the web for a real beer portfolio (2026-09-24):
   Commons hosts almost no trademarked beer logos, Clearbit's logo API is
   gone, Brandfetch needs a key. What does exist: English Wikipedia's article
   images (Twisted Tea, Kona Brewing) and the supplier's own asset library,
   which the distributor already has. So: (1) Wikipedia article images and
   file search join the candidate pool; (2) BULK UPLOAD -- many files at
   once, each matched to a brand by its filename -- becomes the primary path.
   Sentinel-guarded per file. */
const fs = require("fs");
function patch(file, sentinel, edits) {
  let s = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  if (s.indexOf(sentinel) !== -1) { console.log(file + ": already applied"); return; }
  for (const [a, b, l] of edits) { if (s.split(a).length !== 2) { console.error("ABORT " + file + " / " + l + " matched " + (s.split(a).length - 1)); process.exit(1); } s = s.replace(a, () => b); }
  fs.writeFileSync(file, s); console.log(file + ": " + edits.length + " edits");
}

patch("lib/brands.js", "wikipediaArticleImages", [
  [`  async function wikiSearch(label) {
    const seen = {}; const all = [];
    for (const q of ['intitle:"' + label + '" logo', '"' + label + '" logo', label + " logo"]) {
      let hits = []; try { hits = await wikiQuery(q); } catch (e) { if (!all.length) throw e; }
      hits.forEach((c) => { if (!seen[c.title]) { seen[c.title] = 1; all.push(c); } });
      if (all.length >= MAX_CANDIDATES * 2) break;
    }
    return scoreCandidates(label, all).slice(0, MAX_CANDIDATES).map((c, i) => ({ i, title: c.title, url: c.url, page: c.page, score: c.score }));
  }`,
`  const WP_API = "https://en.wikipedia.org/w/api.php";
  // The lead image of the brand's own Wikipedia article -- for a brand with
  // an article, that is usually the logo (Twisted Tea, Kona Brewing). Only
  // articles whose TITLE names the brand count; "Anheuser-Busch brands" does not.
  async function wikipediaArticleImages(label) {
    const u = WP_API + "?action=query&format=json&generator=search&gsrsearch=" + encodeURIComponent(label + " beer") + "&gsrlimit=4&prop=pageimages&piprop=original|name&pilicense=any&redirects=1";
    const r = await fetchFn(u, { headers: { "user-agent": UA, accept: "application/json" } });
    if (!r.ok) return [];
    const j = await r.json();
    const words = brandWords(label);
    return Object.values((j.query && j.query.pages) || {})
      .filter((p) => p.original && p.original.source && p.pageimage)
      .filter((p) => { const t = normBrand(p.title); return words.length && words.every((w) => t.indexOf(w) !== -1); })
      .map((p) => ({ title: p.pageimage.replace(/_/g, " "), url: p.original.source, page: "https://en.wikipedia.org/wiki/" + encodeURIComponent(p.title.replace(/ /g, "_")), mime: /\\.png$/i.test(p.pageimage) ? "image/png" : /\\.svg$/i.test(p.pageimage) ? "image/svg+xml" : "image/jpeg", idx: p.index || 99, source: "wikipedia" }))
      .filter((c) => /^image\\/(png|jpeg|svg\\+xml|gif|webp)$/.test(c.mime));
  }
  async function wikiSearch(label) {
    const seen = {}; const all = [];
    const add = (hits) => hits.forEach((c) => { if (!seen[c.title]) { seen[c.title] = 1; all.push(c); } });
    try { add(await wikipediaArticleImages(label)); } catch (e) { /* optional source */ }
    for (const q of ['intitle:"' + label + '" logo', '"' + label + '" logo', label + " logo"]) {
      let hits = []; try { hits = await wikiQuery(q); } catch (e) { if (!all.length) throw e; }
      add(hits);
      if (all.length >= MAX_CANDIDATES * 2) break;
    }
    return scoreCandidates(label, all).slice(0, MAX_CANDIDATES).map((c, i) => ({ i, title: c.title, url: c.url, page: c.page, score: c.score }));
  }
  // A filename -> the brand it names. "Bud Light.png", "bud-light-logo.svg",
  // "BUD_LT_2024.png" (an alias) all land on Bud Light; a stem that names two
  // brands' words picks the one with more words matched, ties = the longer
  // key (Bud Light over Bud). Nothing matched = the file is reported, not guessed.
  function matchFilename(filename, brands) {
    const stem = normBrand(String(filename || "").replace(/\\.[a-z0-9]+$/i, "").replace(/\\b(logo|logos|brand|mark|wordmark|icon|final|new|v\\d+|\\d{4})\\b/gi, " "));
    if (!stem) return null;
    let best = null;
    for (const b of brands) {
      const names = [b.label].concat(b.aliases || []);
      for (const nm of names) {
        const k = normBrand(nm); if (!k) continue;
        const words = k.split(" ").filter(Boolean);
        const exact = stem === k;
        const contained = (" " + stem + " ").indexOf(" " + k + " ") !== -1;
        if (!exact && !contained) continue;
        const score = (exact ? 100 : 0) + words.length * 10 + k.length;
        if (!best || score > best.score) best = { brand: b, via: nm, score };
      }
    }
    return best;
  }
  // Many logo files at once; each lands as this org's override on the brand
  // its filename names (private to the org, exactly like the per-brand Upload).
  async function bulkUpload(session, files) {
    const brands = await rows();
    const out = { ok: true, matched: [], unmatched: [], failed: [] };
    for (const f of files || []) {
      const m = matchFilename(f.name, brands);
      if (!m) { out.unmatched.push(f.name); continue; }
      const mime = String(f.mime || "").split(";")[0];
      if (!/^image\\/(png|jpeg|gif|webp|svg\\+xml)$/.test(mime)) { out.failed.push({ file: f.name, why: "not an image" }); continue; }
      if (f.buf.length > 4 * 1024 * 1024) { out.failed.push({ file: f.name, why: "over 4 MB" }); continue; }
      try {
        const r = await setOverride(session, m.brand.id, "data:" + mime + ";base64," + f.buf.toString("base64"));
        if (r && r.error) out.failed.push({ file: f.name, why: r.error }); else out.matched.push({ file: f.name, brand: m.brand.label, via: m.via });
      } catch (e) { out.failed.push({ file: f.name, why: String((e && e.message) || e) }); }
    }
    return out;
  }`, "sources + bulk"],
  [`  return { list, recognize, find, pick, setStatus, approveConfident, setOverride, scoreCandidates, brandWords,`,
   `  return { list, recognize, find, pick, setStatus, approveConfident, setOverride, scoreCandidates, brandWords, matchFilename, bulkUpload, wikipediaArticleImages,`, "export"],
]);

patch("server.js", "/api/brands/upload", [
  [`  app.post("/api/brands/approve-confident", requireOrg,`,
   `  app.post("/api/brands/upload", requireOrg, upload.array("files", 200), wrap(async (req) => {
    if (!tagupMod.canAdmin(req.session)) return { error: "forbidden", status: 403 };
    const files = (req.files || []).map((f) => ({ name: f.originalname, mime: f.mimetype, buf: f.buffer }));
    if (!files.length) return { error: "no files" };
    return brandsMod.bulkUpload(req.session, files);
  }));
  app.post("/api/brands/approve-confident", requireOrg,`, "route"],
]);

patch("src/tagup-ui.jsx", "Upload logos", [
  [`3 · Approve all ≥ 90%</Btn>`,
   `3 · Approve all ≥ 90%</Btn>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 9, border: \`2px solid \${C.navy}\`, fontFamily: ui.HEAD, fontWeight: 700, fontSize: 12, textTransform: "uppercase", color: C.navy, cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1 }} title="Pick many logo files at once -- each lands on the brand its filename names (Bud Light.png, michelob-ultra.svg, BUD_LT.png)">
        Upload logos<input type="file" accept="image/*,.svg" multiple disabled={!!busy} onChange={bulkUpload} style={{ display: "none" }} />
      </label>`, "toolbar"],
  [`  async function act(b, action, body) {`,
   `  // The supplier's asset library, dropped in whole: filenames name the brands.
  async function bulkUpload(e) {
    const files = Array.from(e.target.files || []); e.target.value = "";
    if (!files.length) return;
    setBusy("upload"); setMsg("");
    try {
      const fd = new FormData(); files.forEach((f) => fd.append("files", f, f.name));
      const h = ui.H(); delete h["Content-Type"];
      const r = await fetch("/api/brands/upload", { method: "POST", headers: h, body: fd }).then(j);
      if (r && r.error) setMsg(r.error);
      else setMsg(\`Uploaded \${r.matched.length} logo\${r.matched.length === 1 ? "" : "s"}\${r.matched.length ? ": " + r.matched.slice(0, 8).map((m) => m.brand).join(", ") + (r.matched.length > 8 ? "…" : "") : ""}.\` + (r.unmatched.length ? \` \${r.unmatched.length} file\${r.unmatched.length === 1 ? "" : "s"} named no brand here: \${r.unmatched.slice(0, 6).join(", ")}\${r.unmatched.length > 6 ? "…" : ""} -- rename to the brand, or Recognize first so the brand exists.\` : "") + (r.failed.length ? \` \${r.failed.length} failed (\${r.failed[0].why}).\` : ""));
      load();
    } catch (ex) { setMsg("Couldn't reach the server."); }
    setBusy("");
  }
  async function act(b, action, body) {`, "handler"],
]);
console.log("done");
