"use strict";
const fs = require("fs");
const p = "test/units.test.js";
let t = fs.readFileSync(p, "utf8");
if (t.indexOf("VIP's item export") !== -1) { console.log("already applied"); process.exit(0); }
const anchor = 't("parseCatalog needs a Name column plus one more, and says so", () => {';
if (t.split(anchor).length !== 2) { console.error("anchor"); process.exit(1); }
const add = `t("parseCatalog reads VIP's item export: 'Nme' is the name, 'Product Classes' is ignored, the pack comes off the name", () => {
  const r = CAT.parseCatalog([{ name: "Sheet0", rows: [["Brand", "Nme", "Item Number", "Product Classes", ""], ["Michelob Ultra", "Ultra 1x30 12oz Can", "18030", "Beer", ""], ["Michelob Ultra", "Ultra 4x6 12oz Btl", "18036", "Beer", ""], ["Modelo", "Modelo Especial 24oz Can", "10401", "Beer", ""], ["Stella", "Stella Artois 1/2 Bbl Keg", "10399", "Beer", ""]] }]);
  ok(r.ok, r.error); eq(r.columns.sort(), ["brand", "itemNo", "name"]); eq(r.nameHeader, "Nme"); ok(r.packDerived);
  eq(r.items[0], { itemNo: "18030", name: "Ultra 1x30 12oz Can", brand: "Michelob Ultra", pack: "1x30 12oz Can" });
  eq(r.items[2].pack, "24oz Can"); eq(r.items[3].pack, "1/2 Bbl Keg");
  eq(CAT.derivePack("Bud Lt 24pk 12oz Cn"), "24pk 12oz Cn"); eq(CAT.derivePack("Cutwater Lime Marg 4PK 12OZ CN"), "4PK 12OZ CN"); eq(CAT.derivePack("Just A Brand"), "");
  // an explicit package column always wins over the derived one
  const r2 = CAT.parseCatalog([{ name: "s", rows: [["Item #", "Name", "Package"], ["1", "Ultra 1x30 12oz Can", "30pk Cans"]] }]);
  eq(r2.items[0].pack, "30pk Cans"); ok(!r2.packDerived);
  // two unmapped text columns = ambiguous, no guess
  const r3 = CAT.parseCatalog([{ name: "s", rows: [["Brand", "Foo", "Bar"], ["A", "x", "y"]] }]);
  ok(r3.error);
});
`;
fs.writeFileSync(p, t.replace(anchor, add + anchor));
console.log("test added");
