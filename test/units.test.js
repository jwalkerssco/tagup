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
t("parseStoreSheet refuses a sheet with no name column", () => {
  const r = parseStoreSheet([{ name: "s", rows: [["City", "Chain"], ["Odessa", "Stripes"]] }]);
  ok(r.error && /Name/.test(r.error));
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
