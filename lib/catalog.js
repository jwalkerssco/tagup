/* catalog.js -- an org's own item list (price file), the thing the rep's
   item picker searches and the price-book import matches against.

   Upload is a spreadsheet with synonym headers -- the same forgiving
   header resolver the import uses, because an org's price file and a
   chain's price book are usually exports from the same systems. Merge
   semantics: an item is keyed by item number when it has one, else by
   name+pack; re-uploading updates rather than duplicates, and nothing is
   ever deleted (requests reference item names, and a "replace" that
   emptied the list would blank every picker mid-shift). `active=false`
   is the retirement path.                                                */
"use strict";
const crypto = require("crypto");
const IMP = require("./tagup-import");

const COLS = {
  itemNo: ["item #", "item no", "item number", "item", "item id", "sku", "vin", "item code", "number", "no", "#"],
  name: ["name", "item name", "description", "item description", "product", "product name", "desc"],
  brand: ["brand", "brand name", "brand family", "family", "supplier"],
  pack: ["pack", "package", "pkg", "package size", "pack size", "size", "packaging", "container"],
};
function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9#]+/g, " ").trim(); }
function colOf(h) { const n = norm(h); if (!n) return null; for (const k of Object.keys(COLS)) if (COLS[k].indexOf(n) !== -1) return k; return null; }
function findHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const map = {}; let hits = 0;
    (rows[r] || []).forEach((c, i) => { const k = colOf(c); if (k && map[k] == null) { map[k] = i; hits++; } });
    if (map.name != null && hits >= 2) return { row: r, map };
  }
  return null;
}
function clip(v, n) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n); }
// Pure: sheets -> normalized item rows + what was read.
function parseCatalog(sheets) {
  for (const sh of sheets || []) {
    const h = findHeader(sh.rows || []);
    if (!h) continue;
    const items = [];
    for (let r = h.row + 1; r < sh.rows.length; r++) {
      const cells = sh.rows[r] || [];
      const get = (k) => (h.map[k] == null ? "" : cells[h.map[k]]);
      const name = clip(get("name"), 120);
      if (!name) continue;
      let itemNo = clip(get("itemNo"), 20);
      // A numeric cell lost its leading zeros in the spreadsheet; pad to 5 the
      // way The Standard's price file does. A string is kept verbatim.
      if (itemNo && /^\d+$/.test(itemNo) && typeof get("itemNo") === "number") itemNo = itemNo.padStart(5, "0");
      items.push({ itemNo: itemNo || null, name, brand: clip(get("brand"), 60) || null, pack: clip(get("pack"), 40) || null });
    }
    return { ok: true, sheet: sh.name, headerRow: h.row + 1, columns: Object.keys(h.map), items };
  }
  return { error: "no header row found -- the sheet needs at least a Name (or Description) column plus one of Item #, Brand, Package", sheets: (sheets || []).map((s) => s.name) };
}

function create(deps) {
  const pool = () => deps.pool;
  function keyOf(it) { return it.itemNo ? "no:" + it.itemNo : "nm:" + norm(it.name) + "|" + norm(it.pack || ""); }
  async function list(session, opts) {
    const o = opts || {};
    const q = String(o.q || "").toLowerCase().trim();
    const r = await pool().query("SELECT id, item_no, name, brand, pack FROM catalog_items WHERE org_id = $1 AND active ORDER BY brand NULLS LAST, name LIMIT 5000", [session.org.id]);
    let items = r.rows.map((x) => ({ id: x.id, itemNo: x.item_no || "", name: x.name, brand: x.brand || "", pack: x.pack || "" }));
    const total = items.length;
    if (q) { const words = q.split(/\s+/).filter(Boolean); items = items.filter((it) => { const t = (it.name + " " + it.brand + " " + it.itemNo + " " + it.pack).toLowerCase(); return words.every((w) => t.indexOf(w) !== -1); }); }
    return { ok: true, source: total ? "catalog" : "none", total, items: items.slice(0, parseInt(o.limit, 10) || 40) };
  }
  async function importItems(session, sheets, opts) {
    const o = opts || {};
    const parsed = parseCatalog(sheets);
    if (parsed.error) return parsed;
    if (o.preview) return { ok: true, preview: true, sheet: parsed.sheet, headerRow: parsed.headerRow, columns: parsed.columns, count: parsed.items.length, sample: parsed.items.slice(0, 10) };
    const existing = await pool().query("SELECT id, item_no, name, pack FROM catalog_items WHERE org_id = $1", [session.org.id]);
    const byKey = {}; existing.rows.forEach((x) => { byKey[keyOf({ itemNo: x.item_no, name: x.name, pack: x.pack })] = x.id; });
    let created = 0, updated = 0;
    for (const it of parsed.items) {
      const k = keyOf(it);
      if (byKey[k]) { await pool().query("UPDATE catalog_items SET name=$3, brand=$4, pack=$5, item_no=$6, active=true WHERE id=$1 AND org_id=$2", [byKey[k], session.org.id, it.name, it.brand, it.pack, it.itemNo]); updated++; }
      else { const id = crypto.randomUUID(); await pool().query("INSERT INTO catalog_items (id, org_id, item_no, name, brand, pack) VALUES ($1,$2,$3,$4,$5,$6)", [id, session.org.id, it.itemNo, it.name, it.brand, it.pack]); byKey[k] = id; created++; }
    }
    return { ok: true, sheet: parsed.sheet, columns: parsed.columns, created, updated, total: parsed.items.length };
  }
  return { list, importItems, parseCatalog };
}
module.exports = { create, parseCatalog, colOf, findHeader };
