"use strict";
const fs = require("fs");
let u = fs.readFileSync("test/units.test.js", "utf8");
if (u.indexOf("matchVipBrand") === -1) {
  const anchor = `/* ---------------- email ---------------- */`;
  if (u.split(anchor).length !== 2) { console.error("unit anchor"); process.exit(1); }
  u = u.replace(anchor, `t("matchVipBrand: exact beats family, a family logo reaches its variants, a shorter brand never inherits a longer one, VIP abbreviations expand", () => {
  const vip = [{ brand_id: "1", brand_name: "Bud Light", brand_logo: "u1" }, { brand_id: "2", brand_name: "Michelob Ultra", brand_logo: "u2" }, { brand_id: "3", brand_name: "Modelo Ranch Water", brand_logo: "u3" }, { brand_id: "4", brand_name: "Bud", brand_logo: null }, { brand_id: "5", brand_name: "White Claw", brand_logo: "u5" }];
  const m = (label, aliases) => { const r = BR.matchVipBrand({ label, aliases: aliases || [] }, vip); return r ? r.vip.brand_name + (r.exact ? "!" : "") : null; };
  eq(m("Bud Light"), "Bud Light!"); eq(m("Bud Light Platinum"), "Bud Light", "variant takes the family logo");
  eq(m("Mich Ultra Pure Gold"), "Michelob Ultra", "Mich -> Michelob, then family"); eq(m("Bud Lt", ["BUD LT"]), "Bud Light!", "Lt -> Light");
  eq(m("WC Sltz Peach"), "White Claw"); eq(m("Modelo"), null, "our shorter brand does not inherit Modelo Ranch Water's logo");
  eq(m("Bud"), null, "VIP's Bud has no logo"); eq(m("Coors Light"), null);
  eq(BR.expandWords(["mich", "ult", "n", "a"]), ["michelob", "ultra"]);
});

` + anchor);
  fs.writeFileSync("test/units.test.js", u); console.log("unit test added");
}
let t = fs.readFileSync("test/integration.test.js", "utf8");
if (t.indexOf("import-vip") === -1) {
  const anchor = `(async () => {
  for (const [n, f] of queue) {`;
  if (t.split(anchor).length !== 2) { console.error("int anchor"); process.exit(1); }
  t = t.replace(anchor, `ta("VIP Brand Builder import: logos land as the org's overrides, dry run writes nothing, the distributor id is remembered", async () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  const feed = { code: 200, data: [{ group_name: "All", brands: [{ brand_id: "1", brand_name: "Bud Light", brand_logo: "https://images.vtinfo.com/budlight.png" }, { brand_id: "2", brand_name: "Nobody Brewing", brand_logo: "https://images.vtinfo.com/nobody.png" }] }] };
  const calls = [];
  const fakeFetch = async (url) => { calls.push(String(url)); if (/\\/distributor\\/02308\\/brands$/.test(url)) return { ok: true, status: 200, json: async () => feed, headers: { get: () => "application/json" } }; if (/\\/distributor\\//.test(url)) return { ok: false, status: 404, json: async () => ({}), headers: { get: () => "" } }; return { ok: true, status: 200, arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength), headers: { get: () => "image/png" } }; };
  const pool = freshPool();
  const app = createApp(pool, { sendEmail: async () => {}, fetch: fakeFetch });
  const server = http.createServer(app); await new Promise((res) => server.listen(0, res));
  try {
    const client = makeClient(server, server.address().port);
    const a = await signupOrg(client, "VIP Co", "own@vip.com");
    const A = client.as(a.token, a.org.id);
    await A.post("/api/brands/recognize", { names: ["BUD LT", "Coors Light"] });
    const dry = await A.post("/api/brands/import-vip", { distributorId: "02308", dryRun: true });
    ok(dry.body.ok, JSON.stringify(dry.body)); ok(dry.body.dryRun); eq(dry.body.vipBrands, 2); eq(dry.body.matched.map((m) => m.brand), ["Bud Lt"]); eq(dry.body.unmatched, ["Coors Light"]);
    ok(!calls.some((c) => /budlight\\.png/.test(c)), "dry run downloads nothing");
    eq((await A.get("/api/brands")).body.brands.filter((b) => b.overridden).length, 0);
    const real = await A.post("/api/brands/import-vip", { distributorId: "02308" });
    eq(real.body.matched.length, 1); eq(real.body.failed.length, 0);
    const list = await A.get("/api/brands");
    const bl = list.body.brands.find((b) => b.key === "bud-lt"); ok(bl.overridden && bl.orgLogoKey, "the VIP logo is this org's override");
    eq(list.body.vipDistributorId, "02308", "remembered for next time");
    const again = await A.post("/api/brands/import-vip", { distributorId: "02308" });
    eq(again.body.matched.length, 0, "a brand that already has a logo is left alone unless replace is asked");
    eq((await A.post("/api/brands/import-vip", { distributorId: "02308", replace: true })).body.matched.length, 1);
    eq((await A.post("/api/brands/import-vip", { distributorId: "99999" })).status, 400, "unknown distributor is a clean refusal");
    // private to the org: another workspace sees no logo on the shared brand
    const b2 = await signupOrg(client, "Other Co", "own@other.com");
    const B2 = client.as(b2.token, b2.org.id);
    ok(!(await B2.get("/api/brands")).body.brands.find((b) => b.key === "bud-lt").overridden);
  } finally { await new Promise((res) => server.close(res)); }
});

` + anchor);
  fs.writeFileSync("test/integration.test.js", t); console.log("integration test added");
}
