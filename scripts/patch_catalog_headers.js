"use strict";
/* Catalog upload: VIP's item export heads its columns "Brand | Nme | Item
   Number | Product Classes" -- "Nme" is VIP's own typo -- and carries no
   package column, the pack living inside the name ("Ultra 1x30 12oz Can").
   (1) more name synonyms + a fallback: when no name header matches, the one
   unmapped text column becomes the name; (2) pack derived from the name when
   the file has no package column. Sentinel-guarded. */
const fs = require("fs");
const p = "lib/catalog.js";
let s = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
if (s.indexOf("derivePack") !== -1) { console.log("already applied"); process.exit(0); }
const edits = [
  [`  name: ["name", "item name", "description", "item description", "product", "product name", "desc"],`,
   `  name: ["name", "item name", "description", "item description", "product", "product name", "desc", "item desc", "nme", "item nme", "prod name", "product desc", "item text", "label", "title"],`, "name syns"],
  [`  pack: ["pack", "package", "pkg", "package size", "pack size", "size", "packaging", "container"],
};`,
   `  pack: ["pack", "package", "pkg", "package size", "pack size", "size", "packaging", "container", "pkg size", "unit size"],
};
// Ignored on purpose (never taken as the name by the fallback below).
const CAT_IGNORE = ["product class", "product classes", "class", "category", "segment", "supplier", "vendor", "upc", "status", "active", "price", "cost", "retail", "ptr"];
// "Ultra 1x30 12oz Can" -> "1x30 12oz Can"; "Bud Lt 24pk 12oz Cn" -> "24pk 12oz Cn"; "Modelo 24oz Can" -> "24oz Can".
function derivePack(name) {
  const s = String(name || "");
  const m = s.match(/\\b(\\d+\\s*[xX\\/]\\s*\\d+\\b.*|\\d+\\s*(?:pk|pack)\\b.*|\\d+(?:\\.\\d+)?\\s*(?:oz|ml|l|ltr|liter|gal)\\b.*|(?:1\\/2|1\\/4|1\\/6)\\s*(?:bbl|barrel|keg)\\b.*)$/i);
  return m ? m[1].replace(/\\s+/g, " ").trim().slice(0, 40) : "";
}`, "pack syns + derivePack"],
  [`    (rows[r] || []).forEach((c, i) => { const k = colOf(c); if (k && map[k] == null) { map[k] = i; hits++; } });
    if (map.name != null && hits >= 2) return { row: r, map };`,
   `    (rows[r] || []).forEach((c, i) => { const k = colOf(c); if (k && map[k] == null) { map[k] = i; hits++; } });
    // No name header, but a brand or item-number header on this row: the one
    // remaining text column that is not on the ignore list is the name. VIP
    // spells it "Nme"; the next export will spell it something else.
    if (map.name == null && hits >= 1 && (map.brand != null || map.itemNo != null)) {
      const used = new Set(Object.values(map));
      const free = (rows[r] || []).map((c, i) => ({ c: norm(c), i })).filter((x) => x.c && !used.has(x.i) && CAT_IGNORE.indexOf(x.c) === -1 && !CAT_IGNORE.some((g) => x.c.indexOf(g) !== -1));
      if (free.length === 1) { map.name = free[0].i; map.nameGuessed = true; hits++; }
    }
    if (map.name != null && hits >= 2) return { row: r, map };`, "name fallback"],
  [`      items.push({ itemNo: itemNo || null, name, brand: clip(get("brand"), 60) || null, pack: clip(get("pack"), 40) || null });
    }
    return { ok: true, sheet: sh.name, headerRow: h.row + 1, columns: Object.keys(h.map), items };`,
   `      const pack = clip(get("pack"), 40) || (h.map.pack == null ? derivePack(name) : "") || null;
      items.push({ itemNo: itemNo || null, name, brand: clip(get("brand"), 60) || null, pack });
    }
    const columns = Object.keys(h.map).filter((k) => k !== "nameGuessed");
    return { ok: true, sheet: sh.name, headerRow: h.row + 1, columns, nameHeader: h.nameGuessed ? String((sh.rows[h.row] || [])[h.map.name]) : null, packDerived: h.map.pack == null, items };`, "derive + report"],
  [`      const get = (k) => (h.map[k] == null ? "" : cells[h.map[k]]);`,
   `      const get = (k) => (h.map[k] == null || k === "nameGuessed" ? "" : cells[h.map[k]]);`, "get guard"],
  [`module.exports = { create, parseCatalog, colOf, findHeader };`, `module.exports = { create, parseCatalog, colOf, findHeader, derivePack };`, "export"],
];
for (const [a, b, l] of edits) { if (s.split(a).length !== 2) { console.error("ABORT " + l); process.exit(1); } s = s.replace(a, () => b); }
// findHeader returns {row, map}; carry the guess flag out of the map
s = s.replace(`    if (map.name != null && hits >= 2) return { row: r, map };`, `    if (map.name != null && hits >= 2) { const g = !!map.nameGuessed; delete map.nameGuessed; return { row: r, map, nameGuessed: g }; }`);
fs.writeFileSync(p, s);
console.log("patched");
