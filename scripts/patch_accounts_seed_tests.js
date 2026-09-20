"use strict";
/* Seed + tests for rep-owned accounts. Sentinel-guarded. */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
function patch(file, sentinel, edits) {
  const p = path.join(ROOT, file);
  let src = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  if (src.indexOf(sentinel) !== -1) { console.log(file + ": already applied"); return; }
  edits.forEach(([a, b, label]) => { const n = src.split(a).length - 1; if (n !== 1) { console.error("ABORT " + file + " / " + label + " matched " + n); process.exit(1); } src = src.replace(a, () => b); });
  fs.writeFileSync(p, src);
  console.log(file + ": " + edits.length + " edits");
}

patch("scripts/seed-demo.js", "Sales Rep #", [
  [`  const stores = [
    ["Store", "Store #", "City", "Chain", "Team"],
    ["Stripes #2134", "2134", "Odessa", "Stripes", "West"], ["Stripes #2201", "2201", "Odessa", "Stripes", "West"], ["Stripes #2290", "2290", "Midland", "Stripes", "East"],
    ["7-Eleven #35521", "35521", "Odessa", "7-Eleven", "West"], ["7-Eleven #35544", "35544", "Midland", "7-Eleven", "East"],
    ["Kent Kwik #206", "206", "Odessa", "Kent Kwik", "West"], ["Kent Kwik #214", "214", "Andrews", "Kent Kwik", "East"],
    ["H-E-B #591", "591", "Odessa", "HEB", "West"], ["Market Street #521", "521", "Odessa", "United", "West"],
    ["Hops Scotch & Vinery", "10412", "Odessa", "", "West"], ["Jumburrito Grandview", "10877", "Odessa", "", "East"], ["Rusty Bucket Saloon", "11020", "Odessa", "", "West"],
  ];`,
`  // The shape a VIP / route-accounting export actually has: a title row,
  // then the header, then accounts with the sales rep who owns each.
  const stores = [
    ["Retail Accounts -- Odessa -- 09/20/2026"], [],
    ["Account Name", "Account #", "Address", "City", "Chain", "Sales Rep", "Sales Rep #"],
    ["Stripes #2134", "2134", "4210 N Grandview Ave", "Odessa", "Stripes", "Jose Esquivel", 21063], ["Stripes #2201", "2201", "1800 E 8th St", "Odessa", "Stripes", "Jose Esquivel", 21063], ["Stripes #2290", "2290", "3100 W Wadley Ave", "Midland", "Stripes", "Maria Delgado", 21071],
    ["7-Eleven #35521", "35521", "2201 E 42nd St", "Odessa", "7-Eleven", "Jose Esquivel", 21063], ["7-Eleven #35544", "35544", "4400 N Midkiff Rd", "Midland", "7-Eleven", "Maria Delgado", 21071],
    ["Kent Kwik #206", "206", "1301 E University Blvd", "Odessa", "Kent Kwik", "Jose Esquivel", 21063], ["Kent Kwik #214", "214", "700 N Main St", "Andrews", "Kent Kwik", "Maria Delgado", 21071],
    ["H-E-B #591", "591", "3801 E 42nd St", "Odessa", "HEB", "Cody Courtney", 21075], ["Market Street #521", "521", "2200 N Loop 250 W", "Odessa", "United", "Jose Esquivel", 21063],
    ["Hops Scotch & Vinery", "10412", "4330 E 52nd St", "Odessa", "", "Jose Esquivel", 21063], ["Jumburrito Grandview", "10877", "4400 N Grandview Ave", "Odessa", "", "Cody Courtney", 21075], ["Rusty Bucket Saloon", "11020", "9800 W University Blvd", "Odessa", "", "Maria Delgado", 21071],
  ];`, "stores sheet"],
  [`  const inv = await post("/api/orgs/" + org + "/invite", { email: "jose@standardsales.example", role: "rep" });`,
   `  const inv = await post("/api/orgs/" + org + "/invite", { email: "jose@standardsales.example", role: "rep", repNo: "21063" });`, "invite repNo"],
]);

patch("test/units.test.js", "Sales Rep #", [
  [`t("parseStoreSheet refuses a sheet with no name column", () => {`,
`t("parseStoreSheet reads Address, Sales Rep and Sales Rep # (a route number, even from a numeric cell) with the header under a title row", () => {
  const r = parseStoreSheet([{ name: "Accounts", rows: [["Retail Accounts -- Odessa"], [], ["Account Name", "Account #", "Address", "City", "Sales Rep", "Sales Rep #"], ["Stripes #2134", 2134, "4210 N Grandview Ave", "Odessa", "Jose Esquivel", 21063], ["Hops Scotch", "", "4330 E 52nd St", "Odessa", "", ""]] }]);
  ok(r.ok); eq(r.headerRow, 3); eq(r.columns, ["name", "storeNo", "address", "city", "repName", "repNo"]);
  eq(r.rows[0].address, "4210 N Grandview Ave"); eq(r.rows[0].repName, "Jose Esquivel"); eq(r.rows[0].repNo, "21063", "numeric rep # comes back as a clean string"); eq(r.rows[1].repNo, null);
  const alt = parseStoreSheet([{ name: "s", rows: [["Customer", "Route", "Salesman", "Street"], ["A", "21063.0", "J E", "1 Main"]] }]);
  eq(alt.rows[0], { name: "A", storeNo: null, address: "1 Main", city: "", chain: "", repName: "J E", repNo: "21063", team: "" }, "Route -> rep #, Salesman -> rep, Street -> address, and 21063.0 -> 21063");
});
t("parseStoreSheet refuses a sheet with no name column", () => {`, "unit"],
]);

patch("test/integration.test.js", "rep-owned accounts", [
  [`(async () => {
  for (const [n, f] of queue) {`,
`ta("rep-owned accounts: a rep's picker shows only their accounts; no match falls back to every account with a reason", async () => {
  await withServer(async (client, pool) => {
    const a = await signupOrg(client, "Route Co", "own@route.com");
    const A = client.as(a.token, a.org.id);
    const rows = [{ name: "Stripes #1", storeNo: "1", address: "1 Main", repName: "Jose Esquivel", repNo: "21063" }, { name: "Stripes #2", storeNo: "2", repName: "Maria Delgado", repNo: "21071" }, { name: "Indie", storeNo: "3", repName: "Jose Esquivel", repNo: "21063" }];
    eq((await A.post("/api/stores/import", { rows })).body.created, 3);
    // the account list names two reps, neither on the team yet
    const reps = await A.get("/api/orgs/" + a.org.id + "/reps");
    eq(reps.body.reps.map((r) => r.repNo + ":" + r.accounts).sort(), ["21063:2", "21071:1"]); eq(reps.body.unmatched.length, 2);
    // invite Jose WITH his rep #; accepting carries it onto the membership
    await A.post("/api/orgs/" + a.org.id + "/invite", { email: "jose@route.com", role: "rep", repNo: "21063" });
    const tok = (await pool.query("SELECT token FROM org_invites WHERE email = 'jose@route.com'")).rows[0].token;
    const acc = await client.raw("POST", "/api/invites/accept", { token: tok, name: "Jose Esquivel", password: "hunter22" });
    const J = client.as(acc.body.token, a.org.id);
    const mine = await J.get("/api/stores");
    eq(mine.body.scope, "mine"); eq(mine.body.stores.map((s) => s.name).sort(), ["Indie", "Stripes #1"]); eq(mine.body.stores[0].address || mine.body.stores[1].address, "1 Main");
    eq((await A.get("/api/orgs/" + a.org.id + "/reps")).body.unmatched.map((r) => r.repNo), ["21071"], "Jose is matched now");
    // the owner sees everything, and ?all=1 is a manager door only
    eq((await A.get("/api/stores")).body.stores.length, 3); eq((await J.get("/api/stores?all=1")).body.stores.length, 2, "a rep cannot widen their own scope");
    // a rep with a rep # that matches nothing sees every account, and is told why
    await A.post("/api/orgs/" + a.org.id + "/members/" + acc.body.user.id, { repNo: "99999" });
    const wide = await J.get("/api/stores");
    eq(wide.body.scope, "all"); eq(wide.body.scopeReason, "rep-no-unmatched"); eq(wide.body.stores.length, 3);
    // no rep # at all, but the list names them -> matched by name
    await A.post("/api/orgs/" + a.org.id + "/members/" + acc.body.user.id, { repNo: "" });
    const byName = await J.get("/api/stores");
    eq(byName.body.scope, "mine"); eq(byName.body.stores.length, 2);
    // a re-upload of the same numbers updates address + rep in place
    eq((await A.post("/api/stores/import", { rows: [{ name: "Stripes #1", storeNo: "1", address: "1 Main St", repName: "Maria Delgado", repNo: "21071" }] })).body.updated, 1);
    eq((await J.get("/api/stores")).body.stores.map((s) => s.name), ["Indie"], "the account moved to Maria and left Jose's picker");
  });
});

(async () => {
  for (const [n, f] of queue) {`, "integration"],
]);
console.log("done");
