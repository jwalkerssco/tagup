"use strict";
/* Unit tests for the pure pieces added on top of the ported core: the rules
   engine (conditions, tokens, colour precedence), the catalog and store
   sheet parsers, and the mail transport's console fallback.

   Run: node test/units.test.js   (no DB, no network)                        */
const CORE = require("../lib/tagup-core");
const CAT = require("../lib/catalog");
const { parseStoreSheet } = require("../lib/tagup");
const EMAIL = require("../lib/email");

let pass = 0, fail = 0;
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || "") + " got " + JSON.stringify(a) + " want " + JSON.stringify(b)); };
const ok = (v, m) => { if (!v) throw new Error(m || "expected truthy, got " + JSON.stringify(v)); };
const queue = [];
function t(n, f) { queue.push([n, f]); }
async function run() {
  for (const [n, f] of queue) { try { await f(); console.log("  ok   " + n); pass++; } catch (e) { console.log("  FAIL " + n + " -- " + (e && e.message)); fail++; } }
  console.log("\n" + pass + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0);
}

const th = CORE.themeMerge({ layout: "classic", accent: "#0A6E3F", bg: "#FFFFFF", fg: "#111111" });
const base = { contentType: "standard_price", format: "tag", itemName: "Modelo", packageSize: "24oz", price: 5, multiBuyQty: 2 };

/* ---------------- rules: normalize ---------------- */
t("normalizeRules drops a rule with an unknown field, op or empty set, keeps at most 20", () => {
  eq(CORE.normalizeRules([{ when: { field: "nope", op: "eq", value: 1 }, set: { bg: "#FF0000" } }]).length, 0);
  eq(CORE.normalizeRules([{ when: { field: "price", op: "zzz", value: 1 }, set: { bg: "#FF0000" } }]).length, 0);
  eq(CORE.normalizeRules([{ when: { field: "price", op: "gte", value: 1 }, set: {} }]).length, 0, "empty set");
  eq(CORE.normalizeRules([{ when: { field: "price", op: "gte", value: 1 }, set: { bg: "red" } }]).length, 0, "bad colour = empty set");
  const many = Array.from({ length: 30 }, (_, i) => ({ when: { field: "price", op: "gte", value: i }, set: { note: "x" } }));
  eq(CORE.normalizeRules(many).length, 20);
});
t("normalizeRules: between needs both bounds, in needs values, exists needs no value", () => {
  eq(CORE.normalizeRules([{ when: { field: "price", op: "between", lo: 1 }, set: { note: "x" } }]).length, 0);
  const r = CORE.normalizeRules([{ when: { field: "contentType", op: "in", values: "promo, price_drop" }, set: { note: "x" } }])[0];
  eq(r.when.values, ["promo", "price_drop"]);
  eq(CORE.normalizeRules([{ when: { field: "contentType", op: "in", values: "" }, set: { note: "x" } }]).length, 0);
  ok(CORE.normalizeRules([{ when: { field: "wasPrice", op: "exists" }, set: { note: "Reg. {was}" } }])[0]);
});

/* ---------------- rules: matching ---------------- */
t("numeric ops match with a cent of tolerance; between is inclusive", () => {
  const m = (op, extra, req) => CORE.ruleMatches(CORE.normalizeRules([{ when: Object.assign({ field: "price", op }, extra), set: { note: "x" } }])[0], req);
  ok(m("eq", { value: 5 }, { price: 5.004 })); ok(!m("eq", { value: 5 }, { price: 5.01 }));
  ok(m("gte", { value: 5 }, { price: 5 })); ok(!m("gte", { value: 5 }, { price: 4.98 }));
  ok(m("lte", { value: 5 }, { price: 5 })); ok(!m("lte", { value: 5 }, { price: 5.02 }));
  ok(m("between", { lo: 4.9, hi: 5.1 }, { price: 5 })); ok(m("between", { lo: 4.9, hi: 5.1 }, { price: 4.9 })); ok(!m("between", { lo: 4.9, hi: 5.1 }, { price: 5.2 }));
  ok(m("in", { values: [2.5, 5] }, { price: 5 })); ok(!m("in", { values: [2.5] }, { price: 5 }));
  ok(!m("gte", { value: 5 }, { price: null }), "missing value never matches");
});
t("text ops are case-insensitive; exists is false for null, empty and zero", () => {
  const m = (field, op, extra, req) => CORE.ruleMatches(CORE.normalizeRules([{ when: Object.assign({ field, op }, extra), set: { note: "x" } }])[0], req);
  ok(m("contentType", "eq", { value: "PROMO" }, { contentType: "promo" }));
  ok(m("itemName", "contains", { value: "ultra" }, { itemName: "Michelob ULTRA" }));
  ok(m("format", "in", { values: ["case_card"] }, { format: "case_card" }));
  ok(m("wasPrice", "exists", {}, { wasPrice: 9.99 }));
  ok(!m("wasPrice", "exists", {}, { wasPrice: null })); ok(!m("multiBuyQty", "exists", {}, { multiBuyQty: 0 })); ok(!m("packageSize", "exists", {}, { packageSize: "" }));
});

/* ---------------- rules: apply ---------------- */
t("applyRules leaves the originals untouched and reports which rules hit", () => {
  const rules = [{ label: "tier", when: { field: "price", op: "between", lo: 4.9, hi: 5.1 }, set: { bg: "#F7941D" } }];
  const out = CORE.applyRules(rules, th, base);
  eq(out.theme.bg, "#F7941D"); eq(th.bg, "#FFFFFF", "input theme untouched"); eq(out.hit.map((r) => r.label), ["tier"]);
  eq(CORE.applyRules(rules, th, Object.assign({}, base, { price: 7 })).hit.length, 0);
});
t("rules run top to bottom and the later one wins", () => {
  const rules = [
    { when: { field: "price", op: "gte", value: 0 }, set: { bg: "#111111" } },
    { when: { field: "price", op: "gte", value: 4 }, set: { bg: "#222222" } },
  ];
  eq(CORE.applyRules(rules, th, base).theme.bg, "#222222");
});
t("{was} {each} {price} {qty} resolve; an unresolvable token is dropped, never printed raw", () => {
  eq(CORE.ruleText("Reg. {was}", { wasPrice: 24.99 }), "Reg. $24.99");
  eq(CORE.ruleText("Single retail at {each}", { price: 5, multiBuyQty: 2 }), "Single retail at $2.50");
  eq(CORE.ruleText("{qty} for {price}", { price: 5, multiBuyQty: 3 }), "3 for $5.00");
  eq(CORE.ruleText("Reg. {was}", { wasPrice: null }), "Reg.");
  eq(CORE.ruleText("{each}", { price: 5, multiBuyQty: 3 }), "$1.67", "each rounds UP so the single never undercuts the deal");
});
t("note replaces, notePrefix prepends, caption sets the theme caption, hideWas flips showWas", () => {
  const req = Object.assign({}, base, { note: "typed", wasPrice: 6 });
  eq(CORE.applyRules([{ when: { field: "price", op: "exists" }, set: { note: "Reg. {was}" } }], th, req).req.note, "Reg. $6.00");
  eq(CORE.applyRules([{ when: { field: "price", op: "exists" }, set: { notePrefix: "Reg. {was} ·" } }], th, req).req.note, "Reg. $6.00 · typed");
  eq(CORE.applyRules([{ when: { field: "price", op: "exists" }, set: { caption: "{qty} FOR" } }], th, req).theme.caption, "2 FOR");
  eq(CORE.applyRules([{ when: { field: "price", op: "exists" }, set: { hideWas: true } }], th, req).theme.showWas, false);
});
t("renderTag honours a rule's bg/fg on a bold layout (the rule wins over the layout's own colours)", () => {
  const bold = Object.assign({}, th, { layout: "bold" });
  const style = { id: "s", name: "X", kind: "composed", theme: bold, rules: [{ when: { field: "price", op: "between", lo: 4.9, hi: 5.1 }, set: { bg: "#F7941D", fg: "#123456" } }] };
  const html = CORE.renderTag(base, style, { tagW: 3, tagH: 2 });
  ok(/#F7941D/i.test(html), "tier background reached the tag"); ok(/#123456/i.test(html), "tier text colour reached the tag");
  const off = CORE.renderTag(Object.assign({}, base, { price: 7 }), style, { tagW: 3, tagH: 2 });
  ok(!/#F7941D/i.test(off), "no rule, no tier colour");
});
t("the presets normalize clean and the tier preset colours a 2/$5 tag orange", () => {
  CORE.RULE_PRESETS.forEach((p) => eq(CORE.normalizeRules(p.rules).length, p.rules.length, p.id));
  const tier = CORE.RULE_PRESETS.find((p) => p.id === "tier_colors");
  eq(CORE.applyRules(tier.rules, th, base).theme.bg, "#F7941D");
  const reg = CORE.RULE_PRESETS.find((p) => p.id === "reg_price");
  eq(CORE.applyRules(reg.rules, th, Object.assign({}, base, { contentType: "promo", wasPrice: 6.49 })).req.note, "Reg. $6.49");
});

/* ---------------- catalog sheet ---------------- */
t("parseCatalog finds the header anywhere, maps synonyms, pads a numeric item number", () => {
  const sheets = [{ name: "junk", rows: [["nothing here"]] }, { name: "Price File", rows: [["Standard Sales price file"], [], ["Item #", "Description", "Brand", "Pkg"], [23, "MICH ULT 12PK", "MICH ULT", "12pk"], ["A1234", "Glazer thing", "", ""], ["99", "", "no name -> skipped", ""]] }];
  const r = CAT.parseCatalog(sheets);
  ok(r.ok); eq(r.sheet, "Price File"); eq(r.headerRow, 3); eq(r.columns, ["itemNo", "name", "brand", "pack"]);
  eq(r.items.length, 2); eq(r.items[0].itemNo, "00023", "numeric cell padded to 5"); eq(r.items[1].itemNo, "A1234", "string kept verbatim"); eq(r.items[1].brand, null);
});
t("parseCatalog reads VIP's item export: 'Nme' is the name, 'Product Classes' is ignored, the pack comes off the name", () => {
  const r = CAT.parseCatalog([{ name: "Sheet0", rows: [["Brand", "Nme", "Item Number", "Product Classes", ""], ["Michelob Ultra", "Ultra 1x30 12oz Can", "18030", "Beer", ""], ["Michelob Ultra", "Ultra 4x6 12oz Btl", "18036", "Beer", ""], ["Modelo", "Modelo Especial 24oz Can", "10401", "Beer", ""], ["Stella", "Stella Artois 1/2 Bbl Keg", "10399", "Beer", ""]] }]);
  ok(r.ok, r.error); eq(r.columns.sort(), ["brand", "itemNo", "name"]); eq(r.nameHeader, null, "Nme is a known synonym, not a guess"); ok(r.packDerived);
  eq(r.items[0], { itemNo: "18030", name: "Michelob Ultra", brand: "Michelob Ultra", pack: "1x30 12oz Can" }, "the name fragment 'Ultra' is inside the brand, so the brand prints");
  eq(r.items[2].name, "Modelo Especial"); eq(r.items[2].pack, "24oz Can"); eq(r.items[3].pack, "1/2 Bbl Keg"); eq(r.items[3].name, "Stella Artois");
  eq(CAT.derivePack("Bud Lt 24pk 12oz Cn"), "24pk 12oz Cn"); eq(CAT.derivePack("Cutwater Lime Marg 4PK 12OZ CN"), "4PK 12OZ CN"); eq(CAT.derivePack("Just A Brand"), "");
  eq(CAT.derivePack("Hoop Tea Original 2x12oz Can"), "2x12oz Can"); eq(CAT.derivePack("Clubtails Suny Marg2x12 12z C"), "2x12 12z C"); eq(CAT.derivePack("Stella Artois 13.2 Gallon Keg"), "13.2 Gallon Keg"); eq(CAT.derivePack("Jarritos Sidral Mun1x8 1.5LBt"), "1x8 1.5LBt");
  const g = CAT.parseCatalog([{ name: "s", rows: [["Brand", "Descr", "Item Number"], ["Modelo", "Modelo Negra 12pk Btl", "1"]] }]);
  eq(g.nameHeader, "Descr", "an unknown header beside Brand + Item Number is taken as the name"); eq(g.items[0].name, "Modelo Negra"); eq(g.items[0].pack, "12pk Btl");
  // an explicit package column always wins over the derived one
  const r2 = CAT.parseCatalog([{ name: "s", rows: [["Item #", "Name", "Package"], ["1", "Ultra 1x30 12oz Can", "30pk Cans"]] }]);
  eq(r2.items[0].pack, "30pk Cans"); ok(!r2.packDerived);
  // two unmapped text columns = ambiguous, no guess
  const r3 = CAT.parseCatalog([{ name: "s", rows: [["Brand", "Foo", "Bar"], ["A", "x", "y"]] }]);
  ok(r3.error);
});
t("parseCatalog needs a Name column plus one more, and says so", () => {
  const r = CAT.parseCatalog([{ name: "s", rows: [["Price", "Cost"], [1, 2]] }]);
  ok(r.error && /Name/.test(r.error)); eq(r.sheets, ["s"]);
});

/* ---------------- store sheet ---------------- */
t("parseStoreSheet reads Store/Store #/City/Chain/Team with synonyms and skips blank names", () => {
  const r = parseStoreSheet([{ name: "Accounts", rows: [["Customer", "Account #", "Town", "Banner", "Territory"], ["Stripes #2134", 2134, "Odessa", "Stripes", "West"], ["", 1, "x", "y", "z"], ["Hops Scotch", "", "Odessa", "", ""]] }]);
  ok(r.ok); eq(r.columns, ["name", "storeNo", "city", "chain", "team"]);
  eq(r.rows.length, 2); eq(r.rows[0], { name: "Stripes #2134", storeNo: "02134", address: "", city: "Odessa", chain: "Stripes", repName: "", repNo: null, team: "West" }); eq(r.rows[1].storeNo, null);
});
t("parseStoreSheet reads Address, Sales Rep and Sales Rep # (a route number, even from a numeric cell) with the header under a title row", () => {
  const r = parseStoreSheet([{ name: "Accounts", rows: [["Retail Accounts -- Odessa"], [], ["Account Name", "Account #", "Address", "City", "Sales Rep", "Sales Rep #"], ["Stripes #2134", 2134, "4210 N Grandview Ave", "Odessa", "Jose Esquivel", 21063], ["Hops Scotch", "", "4330 E 52nd St", "Odessa", "", ""]] }]);
  ok(r.ok); eq(r.headerRow, 3); eq(r.columns, ["name", "storeNo", "address", "city", "repName", "repNo"]);
  eq(r.rows[0].address, "4210 N Grandview Ave"); eq(r.rows[0].repName, "Jose Esquivel"); eq(r.rows[0].repNo, "21063", "numeric rep # comes back as a clean string"); eq(r.rows[1].repNo, null);
  const alt = parseStoreSheet([{ name: "s", rows: [["Customer", "Route", "Salesman", "Street"], ["A", "21063.0", "J E", "1 Main"]] }]);
  eq(alt.rows[0], { name: "A", storeNo: null, address: "1 Main", city: "", chain: "", repName: "J E", repNo: "21063", team: "" }, "Route -> rep #, Salesman -> rep, Street -> address, and 21063.0 -> 21063");
});
t("parseStoreSheet reads VIP's PLURAL headers (Chains, Sales Reps) and treats *INDEPENDENT as no chain", () => {
  const r = parseStoreSheet([{ name: "Sheet0", rows: [["Chains", "Account Name", "Address", "City", "Account #", "Sales Reps", "Sales Rep #", "Market Types", ""], ["Wal Mart East", "Quality Lic-Walmart #3645", "200 Ih 20 West", "MIDLAND", "02195", "T Polito", "21075", "Supercenter", ""], ["*INDEPENDENT", "AAA Liquor", "207 W 42nd Street", "Odessa", "01011", "J Esquivel", "21062", "Pkg Lqr", ""]] }]);
  ok(r.ok); eq(r.columns, ["chain", "name", "address", "city", "storeNo", "repName", "repNo"]);
  eq(r.rows[0].chain, "Wal Mart East"); eq(r.rows[0].repName, "T Polito"); eq(r.rows[0].repNo, "21075"); eq(r.rows[0].storeNo, "02195", "a string account # keeps its zero");
  eq(r.rows[1].chain, "*INDEPENDENT", "the raw cell is kept; chainKeyFor treats it as no chain");
  const TAGUP = require("../lib/tagup");
  ok(TAGUP.isChainNoise("*INDEPENDENT") && TAGUP.isChainNoise("Independent") && TAGUP.isChainNoise("indy") && TAGUP.isChainNoise(" * Independent "));
  ok(!TAGUP.isChainNoise("Kent") && !TAGUP.isChainNoise("Pilot Travel C"));
});
t("parseStoreSheet refuses a sheet with no name column", () => {
  const r = parseStoreSheet([{ name: "s", rows: [["City", "Chain"], ["Odessa", "Stripes"]] }]);
  ok(r.error && /Name/.test(r.error));
});

/* ---------------- brand logos ---------------- */
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
  eq(none.length, 2, "both name the brand; the model chooses between them");
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

/* ---------------- email ---------------- */
t("email: no POSTMARK_TOKEN means console mode, reported as such, and send still resolves ok", async () => {
  const m = EMAIL.create({});
  eq(m.mode, "console");
  const orig = console.log; let logged = ""; console.log = (s) => { logged += s; };
  try { const r = await m.send("a@b.c", "Verify your tagup account", "http://x/verify?token=1"); eq(r, { ok: true, mode: "console" }); } finally { console.log = orig; }
  ok(/token=1/.test(logged), "the link is in the log so a developer can use it");
});
t("email: with a token it POSTs to Postmark with the server-token header and the html body", async () => {
  let seen = null;
  const m = EMAIL.create({ POSTMARK_TOKEN: "pm-x", MAIL_FROM: "tagup <hi@tagup.app>" }, async (url, opts) => { seen = { url, opts }; return { ok: true, json: async () => ({}) }; });
  eq(m.mode, "postmark");
  const r = await m.send("a@b.c", "Reset your tagup password", "http://x/reset?token=2");
  eq(r, { ok: true, mode: "postmark" });
  ok(/postmarkapp/.test(seen.url)); eq(seen.opts.headers["X-Postmark-Server-Token"], "pm-x");
  const body = JSON.parse(seen.opts.body);
  eq(body.To, "a@b.c"); eq(body.From, "tagup <hi@tagup.app>"); ok(/expires in an hour/.test(body.HtmlBody)); ok(/token=2/.test(body.TextBody));
});

run();
