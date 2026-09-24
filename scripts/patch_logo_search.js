"use strict";
/* Logo search, two fixes seen on the first live run (Bud Light, 2026-09-24):
   1. The model was handed Wikimedia image URLs; Wikimedia refuses Anthropic's
      fetcher ("http 400: Unable to download the file"), so every pick fell
      back to "top hit, unverified". The server already downloads with a
      User-Agent -- candidates are now fetched here and sent as base64.
   2. The top hit for "Bud Light logo" was an unrelated glyph. Commons search
      ranks by text relevance over the whole file page; candidates are now
      scored by how many brand words the FILE TITLE carries (+ "logo"), and a
      title that names none of them is dropped when a better one exists. */
const fs = require("fs");
const p = "lib/brands.js";
let s = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
if (s.indexOf("scoreCandidates") !== -1) { console.log("already applied"); process.exit(0); }
const edits = [
  [`  async function wikiSearch(label) {
    const q = WIKI_API + "?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=" + (MAX_CANDIDATES + 4) + "&gsrsearch=" + encodeURIComponent(label + " logo") + "&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=600";
    const r = await fetchFn(q, { headers: { "user-agent": UA, accept: "application/json" } });
    if (!r.ok) throw new Error("wikimedia http " + r.status);
    const j = await r.json();
    const pages = (j.query && j.query.pages) || {};
    return Object.keys(pages).map((k) => pages[k])
      .map((p) => { const ii = (p.imageinfo || [])[0] || {}; return { title: String(p.title || "").replace(/^File:/, ""), url: ii.thumburl || ii.url || null, page: ii.descriptionurl || null, mime: ii.mime || "", idx: p.index || 99 }; })
      .filter((c) => c.url && /^image\\/(png|jpeg|svg\\+xml|gif|webp)$/.test(c.mime))
      .sort((a, b) => a.idx - b.idx).slice(0, MAX_CANDIDATES)
      .map((c, i) => ({ i, title: c.title, url: c.url, page: c.page }));
  }`,
`  // Brand words worth matching in a file title: "Bud Light" -> [bud, light];
  // one-letter tokens and pure numbers are noise.
  function brandWords(label) { return normBrand(label).split(" ").filter((w) => w.length >= 2 && !/^\\d+$/.test(w)); }
  // Rank Commons hits by the file TITLE, not Commons's own text relevance:
  // every brand word in the title counts, "logo" counts, a photo/can/bottle/
  // beer-glass title counts against, and a title naming NO brand word is
  // dropped when any candidate names one.
  function scoreCandidates(label, cands) {
    const words = brandWords(label);
    const scored = cands.map((c) => {
      const t = normBrand(c.title);
      const hits = words.filter((w) => t.indexOf(w) !== -1).length;
      let score = hits * 10 + (/\\blogo\\b/.test(t) ? 5 : 0) + (/\\b(wordmark|brand|emblem)\\b/.test(t) ? 2 : 0) - (/\\b(can|cans|bottle|bottles|glass|truck|store|sign|photo|img|dsc|billboard|stadium|advert|ad)\\b/.test(t) ? 6 : 0) - (c.idx || 0) * 0.1;
      return Object.assign({}, c, { hits, score });
    });
    const any = scored.some((c) => c.hits > 0);
    return scored.filter((c) => !any || c.hits > 0).sort((a, b) => b.score - a.score);
  }
  async function wikiQuery(search) {
    const q = WIKI_API + "?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=20&gsrsearch=" + encodeURIComponent(search) + "&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=600";
    const r = await fetchFn(q, { headers: { "user-agent": UA, accept: "application/json" } });
    if (!r.ok) throw new Error("wikimedia http " + r.status);
    const j = await r.json();
    const pages = (j.query && j.query.pages) || {};
    return Object.keys(pages).map((k) => pages[k])
      .map((p) => { const ii = (p.imageinfo || [])[0] || {}; return { title: String(p.title || "").replace(/^File:/, ""), url: ii.thumburl || ii.url || null, page: ii.descriptionurl || null, mime: ii.mime || "", idx: p.index || 99 }; })
      .filter((c) => c.url && /^image\\/(png|jpeg|svg\\+xml|gif|webp)$/.test(c.mime));
  }
  // Two searches -- the exact phrase first, then the loose one -- merged by
  // title and ranked by scoreCandidates. \`thumburl\` is a PNG rendering even
  // for an SVG source, which is what makes the model call possible.
  async function wikiSearch(label) {
    const seen = {}; const all = [];
    for (const q of ['intitle:"' + label + '" logo', '"' + label + '" logo', label + " logo"]) {
      let hits = []; try { hits = await wikiQuery(q); } catch (e) { if (!all.length) throw e; }
      hits.forEach((c) => { if (!seen[c.title]) { seen[c.title] = 1; all.push(c); } });
      if (all.length >= MAX_CANDIDATES * 2) break;
    }
    return scoreCandidates(label, all).slice(0, MAX_CANDIDATES).map((c, i) => ({ i, title: c.title, url: c.url, page: c.page, score: c.score }));
  }`, "search + rank"],
  [`    const content = [{ type: "text", text: "Brand: " + label }];
    cands.forEach((c) => { content.push({ type: "text", text: "Candidate " + c.i }); content.push({ type: "image", source: { type: "url", url: c.url } }); });
    const r = await callModel([{ role: "user", content }], PICK_SYSTEM, 300);`,
`    // Fetch the bytes here: Wikimedia refuses the API's own URL fetcher
    // (no User-Agent), so a url source came back "Unable to download the file".
    const content = [{ type: "text", text: "Brand: " + label }];
    let shown = 0;
    for (const c of cands) {
      try {
        const r = await fetchFn(c.url, { headers: { "user-agent": UA } });
        if (!r.ok) continue;
        const mime = String(r.headers.get("content-type") || "").split(";")[0];
        if (!/^image\\/(png|jpeg|gif|webp)$/.test(mime)) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 3 * 1024 * 1024) continue;
        content.push({ type: "text", text: "Candidate " + c.i + ": " + c.title });
        content.push({ type: "image", source: { type: "base64", media_type: mime, data: buf.toString("base64") } });
        shown++;
      } catch (e) { /* skip this candidate */ }
    }
    if (!shown) return { error: "no candidate image could be downloaded" };
    const r = await callModel([{ role: "user", content }], PICK_SYSTEM, 300);`, "base64 images"],
  [`  return { list, recognize, find, pick, setStatus, approveConfident, setOverride,`, `  return { list, recognize, find, pick, setStatus, approveConfident, setOverride, scoreCandidates, brandWords,`, "export"],
];
for (const [a, b, l] of edits) { if (s.split(a).length !== 2) { console.error("ABORT " + l); process.exit(1); } s = s.replace(a, () => b); }
fs.writeFileSync(p, s);
console.log("patched");
