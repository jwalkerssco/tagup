"use strict";
/* Appends integration tests for the second server pass (members, org
   rename, store upload parse, catalog import, trial gate, ?t= token door)
   before the runner block. Sentinel-guarded. */
const fs = require("fs");
const path = require("path");
const p = path.join(__dirname, "..", "test", "integration.test.js");
let s = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
if (s.indexOf("trial gate") !== -1) { console.log("already applied"); process.exit(0); }
const anchor = `(async () => {
  for (const [n, f] of queue) {`;
if (s.split(anchor).length !== 2) { console.error("ABORT anchor"); process.exit(1); }
const add = `
ta("team: members + pending invites are listed, roles change, a non-admin cannot, the owner cannot be removed", async () => {
  await withServer(async (client, pool) => {
    const a = await signupOrg(client, "Team Co", "own@team.com");
    const A = client.as(a.token, a.org.id);
    const inv = await A.post("/api/orgs/" + a.org.id + "/invite", { email: "rep@team.com", role: "rep" });
    ok(inv.body.ok);
    const tok = (await pool.query("SELECT token FROM org_invites WHERE email = 'rep@team.com'")).rows[0].token;
    const acc = await client.raw("POST", "/api/invites/accept", { token: tok, name: "Rep One", password: "hunter22" });
    ok(acc.body.ok);
    const list = await A.get("/api/orgs/" + a.org.id + "/members");
    eq(list.body.members.map((m) => m.role), ["owner", "rep"]); eq(list.body.invites.length, 0, "accepted invite leaves the pending list");
    const repId = list.body.members[1].id;
    ok((await A.post("/api/orgs/" + a.org.id + "/members/" + repId, { role: "manager" })).body.ok);
    eq((await A.get("/api/orgs/" + a.org.id + "/members")).body.members[1].role, "manager");
    const R = client.as(acc.body.token, a.org.id);
    eq((await R.post("/api/orgs/" + a.org.id + "/members/" + a.user.id, { role: "rep" })).status, 400, "a manager cannot change roles");
    ok(/owner cannot be removed/.test((await A.post("/api/orgs/" + a.org.id + "/members/" + a.user.id, { remove: true })).body.error));
    ok((await A.post("/api/orgs/" + a.org.id + "/members/" + repId, { remove: true })).body.removed);
    eq((await R.get("/api/stores")).status, 403, "removed member is out");
  });
});
ta("workspace rename is admin-only and orgsFor carries the trial end date", async () => {
  await withServer(async (client) => {
    const a = await signupOrg(client, "Rename Co", "own@ren.com");
    const A = client.as(a.token, a.org.id);
    eq((await A.put("/api/orgs/" + a.org.id, { name: "Renamed" })).body.org.name, "Renamed");
    const me = await client.me(a.token);
    eq(me.body.orgs[0].name, "Renamed"); ok(me.body.orgs[0].trial_ends_at, "trial end travels with the org list");
  });
});
ta("trial gate: an expired trial still READS everything and answers 402 to any write", async () => {
  await withServer(async (client, pool) => {
    const a = await signupOrg(client, "Old Trial", "own@old.com");
    const A = client.as(a.token, a.org.id);
    ok((await A.post("/api/stores", { name: "Before" })).body.ok);
    await pool.query("UPDATE orgs SET trial_ends_at = now() - interval '1 day' WHERE id = $1", [a.org.id]);
    const r = await A.get("/api/stores"); eq(r.status, 200); eq(r.body.stores.length, 1, "reads keep working");
    const w = await A.post("/api/stores", { name: "After" }); eq(w.status, 402); ok(w.body.trialEnded);
    ok((await A.get("/api/orgs/" + a.org.id)).body.trialOver);
    await pool.query("UPDATE orgs SET plan = 'team' WHERE id = $1", [a.org.id]);
    ok((await A.post("/api/stores", { name: "After" })).body.ok, "a paid plan lifts the gate whatever the date says");
  });
});
ta("?t= and ?org= open a page the way the header does -- the print sheet in a new tab", async () => {
  await withServer(async (client) => {
    const a = await signupOrg(client, "Query Co", "own@q.com");
    const A = client.as(a.token, a.org.id);
    const store = (await A.post("/api/stores", { name: "S1" })).body.store;
    const req = (await A.post("/api/requests", { storeId: store.id, contentType: "standard_price", itemName: "Bud Light", price: 9.99 })).body.request;
    const mats = (await A.get("/api/setup")).body.materials;
    const b = (await A.post("/api/batches", { materialId: mats[0].id, requestIds: [req.id] })).body.batch;
    const r = await client.raw("GET", "/api/batches/" + b.id + "/print?t=" + a.token + "&org=" + a.org.id);
    eq(r.status, 200); ok(/Bud Light/i.test(r.body));
    eq((await client.raw("GET", "/api/batches/" + b.id + "/print?org=" + a.org.id)).status, 401, "org alone is not a session");
  });
});
ta("catalog: list is empty-by-source, and the rep item picker searches it", async () => {
  await withServer(async (client, pool) => {
    const a = await signupOrg(client, "Cat Co", "own@cat.com");
    const A = client.as(a.token, a.org.id);
    eq((await A.get("/api/catalog?q=bud")).body.source, "none");
    const CAT = require("../lib/catalog").create({ pool });
    const session = { org: { id: a.org.id }, user: a.user, membership: { role: "owner" } };
    const r = await CAT.importItems(session, [{ name: "s", rows: [["Item #", "Name", "Brand", "Package"], ["10101", "BUD LT 12PK", "BUD LT", "12pk"], ["10023", "MICH ULT 12PK", "MICH ULT", "12pk"]] }]);
    eq([r.created, r.updated], [2, 0]);
    const again = await CAT.importItems(session, [{ name: "s", rows: [["Item #", "Name", "Brand", "Package"], ["10101", "BUD LT 12PK CN", "BUD LT", "12pk"]] }]);
    eq([again.created, again.updated], [0, 1], "re-upload updates by item number");
    const hit = await A.get("/api/catalog?q=bud%2012pk");
    eq(hit.body.source, "catalog"); eq(hit.body.items.length, 1); eq(hit.body.items[0].name, "BUD LT 12PK CN");
    const brands = await A.get("/api/brands");
    eq(brands.body.unmatched.map((u) => u.raw).sort(), ["BUD LT", "MICH ULT"], "catalog spellings show as unmatched until recognized");
    ok((await A.post("/api/brands/recognize", { fromCatalog: true })).body.names === 2);
    eq((await A.get("/api/brands")).body.unmatched.length, 0);
  });
});
ta("a request on a style with rules prints the rule's colour on the sheet", async () => {
  await withServer(async (client) => {
    const a = await signupOrg(client, "Rules Co", "own@rules.com");
    const A = client.as(a.token, a.org.id);
    const store = (await A.post("/api/stores", { name: "7-Eleven #1", chain: "7-Eleven" })).body.store;
    const chains = (await A.get("/api/chains")).body.chains;
    const st = await A.post("/api/styles", { name: "7-Eleven", chainId: chains[0].id, format: "tag", kind: "composed", theme: {}, rules: [{ when: { field: "price", op: "between", lo: 4.9, hi: 5.1 }, set: { bg: "#F7941D" } }, { when: { field: "price", op: "gte", value: 0 }, set: { bg: "nope" } }] });
    eq(st.body.style.rules.length, 1, "the bad rule was dropped on write, not stored");
    const req = (await A.post("/api/requests", { storeId: store.id, contentType: "standard_price", itemName: "Modelo", price: 5, multiBuyQty: 2 })).body.request;
    const mats = (await A.get("/api/setup")).body.materials;
    const b = (await A.post("/api/batches", { materialId: mats[0].id, requestIds: [req.id] })).body.batch;
    const html = (await A.get("/api/batches/" + b.id + "/print")).body;
    ok(/#F7941D/i.test(html), "tier colour on the print sheet");
  });
});

`;
s = s.replace(anchor, add + anchor);
fs.writeFileSync(p, s);
console.log("added 6 integration tests");
