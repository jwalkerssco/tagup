/* scripts/seed-demo.js -- a realistic demo workspace through the PUBLIC API
   (never SQL), so the seed exercises the same doors a customer walks through.
   Used by `node dev.js --seed` and the screenshot run. */
"use strict";
const XLSX = require("xlsx");

async function seed(base) {
  const j = (r) => r.json();
  let token = "", org = "";
  const H = () => Object.assign({ "content-type": "application/json" }, token ? { authorization: "Bearer " + token } : {}, org ? { "x-org-id": org } : {});
  const post = (u, b) => fetch(base + u, { method: "POST", headers: H(), body: JSON.stringify(b || {}) }).then(j);
  const get = (u) => fetch(base + u, { headers: H() }).then(j);
  const upload = (u, name, buf, fields) => { const fd = new FormData(); fd.append("file", new Blob([buf]), name); Object.keys(fields || {}).forEach((k) => fd.append(k, fields[k])); const h = H(); delete h["content-type"]; return fetch(base + u, { method: "POST", headers: h, body: fd }).then(j); };

  const su = await post("/api/signup", { name: "Ann-Michelle Ortiz", orgName: "Standard Sales — Odessa", email: "ann@standardsales.example", password: "tagup-demo-1" });
  if (su.error) throw new Error("signup: " + su.error);
  token = su.token; org = su.org.id;

  // Stores off a spreadsheet, the way a customer would.
  // The shape a VIP / route-accounting export actually has: a title row,
  // then the header, then accounts with the sales rep who owns each.
  const stores = [
    ["Retail Accounts -- Odessa -- 09/20/2026"], [],
    ["Account Name", "Account #", "Address", "City", "Chain", "Sales Rep", "Sales Rep #"],
    ["Stripes #2134", "2134", "4210 N Grandview Ave", "Odessa", "Stripes", "Jose Esquivel", 21063], ["Stripes #2201", "2201", "1800 E 8th St", "Odessa", "Stripes", "Jose Esquivel", 21063], ["Stripes #2290", "2290", "3100 W Wadley Ave", "Midland", "Stripes", "Maria Delgado", 21071],
    ["7-Eleven #35521", "35521", "2201 E 42nd St", "Odessa", "7-Eleven", "Jose Esquivel", 21063], ["7-Eleven #35544", "35544", "4400 N Midkiff Rd", "Midland", "7-Eleven", "Maria Delgado", 21071],
    ["Kent Kwik #206", "206", "1301 E University Blvd", "Odessa", "Kent Kwik", "Jose Esquivel", 21063], ["Kent Kwik #214", "214", "700 N Main St", "Andrews", "Kent Kwik", "Maria Delgado", 21071],
    ["H-E-B #591", "591", "3801 E 42nd St", "Odessa", "HEB", "Cody Courtney", 21075], ["Market Street #521", "521", "2200 N Loop 250 W", "Odessa", "United", "Jose Esquivel", 21063],
    ["Hops Scotch & Vinery", "10412", "4330 E 52nd St", "Odessa", "", "Jose Esquivel", 21063], ["Jumburrito Grandview", "10877", "4400 N Grandview Ave", "Odessa", "", "Cody Courtney", 21075], ["Rusty Bucket Saloon", "11020", "9800 W University Blvd", "Odessa", "", "Maria Delgado", 21071],
  ];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(stores), "Accounts");
  const st = await upload("/api/stores/upload", "accounts.xlsx", XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  if (st.error) throw new Error("stores: " + st.error);

  // Catalog
  const cat = [["Item #", "Description", "Brand", "Package"],
    ["10023", "MICH ULT 12PK 12OZ CN", "MICH ULT", "12pk 12oz Cans"], ["10024", "MICH ULT 24PK 12OZ CN", "MICH ULT", "24pk 12oz Cans"], ["10101", "BUD LT 12PK 12OZ CN", "BUD LT", "12pk 12oz Cans"], ["10102", "BUD LT 24PK 12OZ CN", "BUD LT", "24pk 12oz Cans"], ["10103", "BUD LT 30PK 12OZ CN", "BUD LT", "30pk 12oz Cans"],
    ["10201", "BUDWEISER 12PK 12OZ BTL", "BUDWEISER", "12pk 12oz Bottles"], ["10301", "STELLA ARTOIS 12PK 11.2OZ BTL", "STELLA ARTOIS", "12pk 11.2oz Bottles"], ["10401", "MODELO ESP 24OZ CN", "MODELO", "24oz Can"], ["10402", "MODELO ESP 12PK 12OZ BTL", "MODELO", "12pk 12oz Bottles"],
    ["10501", "CUTWATER LIME MARG 4PK 12OZ CN", "CUTWATER", "4pk 12oz Cans"], ["10601", "NUTRL VODKA SLTZ VAR 8PK", "NUTRL", "8pk 12oz Cans"], ["10701", "KONA BIG WAVE 6PK 12OZ BTL", "KONA", "6pk 12oz Bottles"], ["10801", "SHOCK TOP 6PK 12OZ BTL", "SHOCK TOP", "6pk 12oz Bottles"], ["10901", "BUSCH LT 30PK 12OZ CN", "BUSCH LT", "30pk 12oz Cans"], ["11001", "NATURAL LT 30PK 12OZ CN", "NATURAL LT", "30pk 12oz Cans"]];
  const wb2 = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet(cat), "Price File");
  const ct = await upload("/api/catalog/import", "pricefile.xlsx", XLSX.write(wb2, { type: "buffer", bookType: "xlsx" }));
  if (ct.error) throw new Error("catalog: " + ct.error);

  // Brands (no AI key locally -> title-cased)
  await post("/api/brands/recognize", { fromCatalog: true });

  // Styles: one composed per chain, with rules on 7-Eleven
  const setup = await get("/api/setup");
  const chainId = (label) => (setup.chains.find((c) => c.label === label) || {}).id || null;
  const styles = [
    { name: "Stripes", chainId: chainId("Stripes"), format: "tag", kind: "composed", theme: { layout: "bold", accent: "#C8102E", accentFg: "#FFFFFF", font: "oswald", caption: "EVERYDAY LOW PRICE" } },
    { name: "7-Eleven", chainId: chainId("7-Eleven"), format: "tag", kind: "composed", theme: { layout: "classic", accent: "#0A6E3F", accentFg: "#FFFFFF", font: "bebas", priceColor: "#0A6E3F" },
      rules: [{ label: "Reg. line", when: { field: "wasPrice", op: "exists" }, set: { note: "Reg. {was}" } }, { label: "2/$5", when: { field: "price", op: "between", lo: 4.9, hi: 5.1 }, set: { accent: "#F7941D", bg: "#F7941D", fg: "#111111" } }] },
    { name: "Kent Kwik", chainId: chainId("Kent Kwik"), format: "tag", kind: "composed", theme: { layout: "modern", accent: "#1D4ED8", accentFg: "#FFFFFF", font: "oswald" } },
    { name: "Stripes case card", chainId: chainId("Stripes"), format: "case_card", kind: "composed", theme: { layout: "bold", accent: "#C8102E", accentFg: "#FFFFFF", font: "oswald" } },
  ];
  for (const s of styles) { const r = await post("/api/styles", s); if (r.error) throw new Error("style " + s.name + ": " + r.error); }

  // Team: a rep and a manager (invites; accept the rep's so there is a real rep)
  const inv = await post("/api/orgs/" + org + "/invite", { email: "jose@standardsales.example", role: "rep", repNo: "21063" });
  await post("/api/orgs/" + org + "/invite", { email: "maria@standardsales.example", role: "manager" });
  // Accept the rep invite -- the invite token is only in the (console) email, so look it up the way the mail would carry it.
  const inviteToken = inv.ok ? await tokenForInvite(base, org, "jose@standardsales.example") : null;
  let repToken = null;
  if (inviteToken) { const acc = await fetch(base + "/api/invites/accept", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: inviteToken, name: "Jose Esquivel", password: "tagup-demo-1" }) }).then(j); repToken = acc.token || null; }

  // Requests, as the rep where possible
  const list = await get("/api/stores");
  const S = (name) => (list.stores.find((s) => s.name === name) || {}).id;
  const reqs = [
    { storeId: S("Stripes #2134"), contentType: "standard_price", itemNo: "10023", itemName: "Michelob Ultra", brand: "MICH ULT", packageSize: "12pk 12oz Cans", price: 14.99, copies: 2 },
    { storeId: S("Stripes #2134"), contentType: "promo", itemNo: "10102", itemName: "Bud Light", brand: "BUD LT", packageSize: "24pk 12oz Cans", price: 19.99, wasPrice: 24.99, note: "Reg. $24.99" },
    { storeId: S("7-Eleven #35521"), contentType: "standard_price", itemNo: "10401", itemName: "Modelo Especial", brand: "MODELO", packageSize: "24oz Can", price: 5.00, multiBuyQty: 2, note: "Single retail at $2.79" },
    { storeId: S("7-Eleven #35521"), contentType: "price_drop", itemNo: "10301", itemName: "Stella Artois", brand: "STELLA ARTOIS", packageSize: "12pk 11.2oz Bottles", price: 15.99, wasPrice: 18.49 },
    { storeId: S("Kent Kwik #206"), contentType: "standard_price", itemNo: "10501", itemName: "Cutwater Lime Margarita", brand: "CUTWATER", packageSize: "4pk 12oz Cans", price: 12.99 },
    { storeId: S("Hops Scotch & Vinery"), contentType: "operational", itemName: "Kona Big Wave", packageSize: "6pk 12oz Bottles", note: "Discontinued" },
    { storeId: S("Stripes #2201"), contentType: "standard_price", format: "case_card", itemNo: "10103", itemName: "Bud Light", brand: "BUD LT", packageSize: "30pk 12oz Cans", price: 24.99 },
    { storeId: S("Market Street #521"), contentType: "standard_price", itemNo: "10601", itemName: "NÜTRL Vodka Seltzer Variety", brand: "NUTRL", packageSize: "8pk 12oz Cans", price: 17.99 },
  ];
  const made = [];
  for (const q of reqs) {
    const h = Object.assign({}, H()); if (repToken) h.authorization = "Bearer " + repToken;
    const r = await fetch(base + "/api/requests", { method: "POST", headers: h, body: JSON.stringify(q) }).then(j);
    if (r.error) throw new Error("request " + q.itemName + ": " + r.error);
    made.push(r.request.id);
  }
  // One printed batch so the history has something in it
  const mats = setup.materials.filter((m) => m.active);
  const b = await post("/api/batches", { materialId: mats[0].id, requestIds: made.slice(0, 2) });
  if (b.ok) await post("/api/batches/" + b.batch.id + "/printed");
  // and one sent back
  await post("/api/requests/" + made[5] + "/reject", { reason: "Kona is still listed as active in VIP -- confirm with Ann before we pull it." });

  return { base, org, ownerEmail: "ann@standardsales.example", password: "tagup-demo-1", token, repToken, urls: { owner: base + "/app?t=" + token + "&o=" + org, rep: repToken ? base + "/app?t=" + repToken + "&o=" + org : null } };
}
// The invite token lives only in the email; in dev the mailer logs it. We
// read it back through the one door the server has: none. So the seed
// reaches for the pool directly ONLY when running in-process with dev.js.
async function tokenForInvite(base, org, email) {
  try { const r = await fetch(base + "/api/_dev/invite-token?email=" + encodeURIComponent(email)).then((x) => x.json()); return r.token || null; } catch (e) { return null; }
}
module.exports = { seed };
if (require.main === module) seed(process.argv[2] || "http://localhost:3000").then((o) => console.log(JSON.stringify(o, null, 2))).catch((e) => { console.error(e.message); process.exit(1); });
