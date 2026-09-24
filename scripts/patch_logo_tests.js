"use strict";
const fs = require("fs");
const p = "test/units.test.js";
let t = fs.readFileSync(p, "utf8");
if (t.indexOf("matchFilename") !== -1) { console.log("already applied"); process.exit(0); }
const anchor = `/* ---------------- email ---------------- */`;
if (t.split(anchor).length !== 2) { console.error("anchor"); process.exit(1); }
const add = `/* ---------------- brand logos ---------------- */
const BR = require("../lib/brands").create({ pool: null, putAsset: null, env: {}, fetch: null });
t("scoreCandidates: a title naming the brand + 'logo' beats a can photo; titles naming no brand word are dropped when one does", () => {
  const c = BR.scoreCandidates("Bud Light", [
    { title: "Jawaharlal Nehru University Logo vectorized.svg", idx: 1 },
    { title: "Bud Light in the environment, Lexington MA.jpg", idx: 2 },
    { title: "Bud Light logo.svg", idx: 3 },
    { title: "Starr-180505 Schiedea globosa with Bud Light beer can.jpg", idx: 4 },
  ]);
  eq(c.map((x) => x.title)[0], "Bud Light logo.svg"); ok(!c.some((x) => /Nehru/.test(x.title)), "unrelated glyph dropped");
  ok(c[0].score > c[1].score);
  const none = BR.scoreCandidates("Modelo", [{ title: "Continente Modelo logo.jpg", idx: 1 }, { title: "Modelo Especial logo.png", idx: 2 }]);
  eq(none[0].title, "Modelo Especial logo.png");
});
t("matchFilename: exact, contained, alias, and ambiguous filenames land on the right brand or on nothing", () => {
  const brands = [{ id: "1", label: "Bud Light", aliases: ["BUD LT"] }, { id: "2", label: "Bud", aliases: [] }, { id: "3", label: "Michelob Ultra", aliases: ["MICH ULT"] }, { id: "4", label: "Modelo", aliases: [] }];
  eq(BR.matchFilename("Bud Light.png", brands).brand.id, "1");
  eq(BR.matchFilename("bud-light-logo-2024.svg", brands).brand.id, "1", "noise words and a year stripped");
  eq(BR.matchFilename("BUD_LT.png", brands).brand.id, "1", "alias");
  eq(BR.matchFilename("Bud.png", brands).brand.id, "2", "the shorter brand only when it is the whole stem");
  eq(BR.matchFilename("michelob ultra wordmark.jpg", brands).brand.id, "3");
  eq(BR.matchFilename("Modelo Especial logo.png", brands).brand.id, "4", "a longer stem still contains the brand");
  eq(BR.matchFilename("IMG_2231.jpg", brands), null); eq(BR.matchFilename("", brands), null);
});

`;
fs.writeFileSync(p, t.replace(anchor, add + anchor));
console.log("tests added");
