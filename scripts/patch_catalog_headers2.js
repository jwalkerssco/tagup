"use strict";
/* Second pass on the catalog parser against the real VIP export:
   - derivePack tolerates VIP's glued spellings ("2x12oz Cn", "Marg2x12 12z C",
     "13.2 Gallon Keg", "1x8 1.5LBt");
   - when the pack was derived from the name, the stored name is the name
     WITHOUT the pack, and if that remainder is just a fragment of the brand
     ("Ultra" under brand "Michelob Ultra") the brand is the name -- that is
     what prints on the tag, beside the pack as the size line. */
const fs = require("fs");
const p = "lib/catalog.js";
let s = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
if (s.indexOf("displayName(") !== -1) { console.log("already applied"); process.exit(0); }
const edits = [
  [`  const m = s.match(/\\b(\\d+\\s*[xX\\/]\\s*\\d+\\b.*|\\d+\\s*(?:pk|pack)\\b.*|\\d+(?:\\.\\d+)?\\s*(?:oz|ml|l|ltr|liter|gal)\\b.*|(?:1\\/2|1\\/4|1\\/6)\\s*(?:bbl|barrel|keg)\\b.*)$/i);
  return m ? m[1].replace(/\\s+/g, " ").trim().slice(0, 40) : "";
}`,
`  const m = s.match(/(?<![.\\d])(\\d+\\s*[xX\\/]\\s*\\d+(?![.\\d]).*|\\d+\\s*(?:pk|pack)\\b.*|\\d+(?:\\.\\d+)?\\s*(?:oz|z|ml|l|ltr|liter|gal|gallon)\\b.*|(?:1\\/2|1\\/4|1\\/6)\\s*(?:bbl|barrel|keg)\\b.*)$/i);
  return m ? m[1].replace(/\\s+/g, " ").trim().slice(0, 40) : "";
}
// The name as it should print once the pack has been split off: "Ultra 1x30
// 12oz Can" under brand "Michelob Ultra" -> "Michelob Ultra"; "Modelo Especial
// 24oz Can" under "Modelo" -> "Modelo Especial"; a name that was ALL pack
// falls back to the brand, then the original.
function displayName(name, pack, brand) {
  if (!pack) return name;
  let rest = String(name).replace(pack, "").replace(/\\s+/g, " ").replace(/[\\s\\-\\/,]+$/, "").trim();
  const b = String(brand || "").trim();
  if (!rest) return b || name;
  if (b && b.toLowerCase().indexOf(rest.toLowerCase()) !== -1) return b;
  return rest;
}`, "regex + displayName"],
  [`      const pack = clip(get("pack"), 40) || (h.map.pack == null ? derivePack(name) : "") || null;
      items.push({ itemNo: itemNo || null, name, brand: clip(get("brand"), 60) || null, pack });`,
   `      const brand = clip(get("brand"), 60) || null;
      const derived = h.map.pack == null ? derivePack(name) : "";
      const pack = clip(get("pack"), 40) || derived || null;
      items.push({ itemNo: itemNo || null, name: derived ? clip(displayName(name, derived, brand), 120) : name, brand, pack });`, "use displayName"],
  [`module.exports = { create, parseCatalog, colOf, findHeader, derivePack };`, `module.exports = { create, parseCatalog, colOf, findHeader, derivePack, displayName };`, "export"],
];
for (const [a, b, l] of edits) { if (s.split(a).length !== 2) { console.error("ABORT " + l); process.exit(1); } s = s.replace(a, () => b); }
fs.writeFileSync(p, s);

// tests: "Nme" is a known synonym now (not a guess); a guessed header is "Descr"
const tp = "test/units.test.js";
let t = fs.readFileSync(tp, "utf8");
const old = `  ok(r.ok, r.error); eq(r.columns.sort(), ["brand", "itemNo", "name"]); eq(r.nameHeader, "Nme"); ok(r.packDerived);
  eq(r.items[0], { itemNo: "18030", name: "Ultra 1x30 12oz Can", brand: "Michelob Ultra", pack: "1x30 12oz Can" });
  eq(r.items[2].pack, "24oz Can"); eq(r.items[3].pack, "1/2 Bbl Keg");
  eq(CAT.derivePack("Bud Lt 24pk 12oz Cn"), "24pk 12oz Cn"); eq(CAT.derivePack("Cutwater Lime Marg 4PK 12OZ CN"), "4PK 12OZ CN"); eq(CAT.derivePack("Just A Brand"), "");`;
const neu = `  ok(r.ok, r.error); eq(r.columns.sort(), ["brand", "itemNo", "name"]); eq(r.nameHeader, null, "Nme is a known synonym, not a guess"); ok(r.packDerived);
  eq(r.items[0], { itemNo: "18030", name: "Michelob Ultra", brand: "Michelob Ultra", pack: "1x30 12oz Can" }, "the name fragment 'Ultra' is inside the brand, so the brand prints");
  eq(r.items[2].name, "Modelo Especial"); eq(r.items[2].pack, "24oz Can"); eq(r.items[3].pack, "1/2 Bbl Keg"); eq(r.items[3].name, "Stella Artois");
  eq(CAT.derivePack("Bud Lt 24pk 12oz Cn"), "24pk 12oz Cn"); eq(CAT.derivePack("Cutwater Lime Marg 4PK 12OZ CN"), "4PK 12OZ CN"); eq(CAT.derivePack("Just A Brand"), "");
  eq(CAT.derivePack("Hoop Tea Original 2x12oz Can"), "2x12oz Can"); eq(CAT.derivePack("Clubtails Suny Marg2x12 12z C"), "2x12 12z C"); eq(CAT.derivePack("Stella Artois 13.2 Gallon Keg"), "13.2 Gallon Keg"); eq(CAT.derivePack("Jarritos Sidral Mun1x8 1.5LBt"), "1x8 1.5LBt");
  const g = CAT.parseCatalog([{ name: "s", rows: [["Brand", "Descr", "Item Number"], ["Modelo", "Modelo Negra 12pk Btl", "1"]] }]);
  eq(g.nameHeader, "Descr", "an unknown header beside Brand + Item Number is taken as the name"); eq(g.items[0].name, "Modelo Negra"); eq(g.items[0].pack, "12pk Btl");`;
if (t.split(old).length !== 2) { console.error("ABORT test anchor"); process.exit(1); }
fs.writeFileSync(tp, t.replace(old, neu));
console.log("patched + tests");
