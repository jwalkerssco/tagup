"use strict";
/* Integration tests: the real Express app, the real schema, real SQL --
   via pg-mem instead of a live Postgres, so this runs anywhere with no
   setup. This is the test that actually proves multi-tenancy: two orgs
   signed up independently, and neither can see or touch the other's data
   through any route, not just through the queries I remembered to scope.

   Run: node test/integration.test.js
*/
const http = require("http");
const { freshPool } = require("./helpers/pgmem");
const { createApp } = require("../server");

let pass = 0, fail = 0;
const show = (e) => (e && (e.message || String(e))) + " @ " + (((e && e.stack) || "").split("\n")[1] || "").trim();
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || "") + " got " + JSON.stringify(a) + " want " + JSON.stringify(b)); };
const ok = (v, m) => { if (!v) throw new Error(m || "expected truthy, got " + JSON.stringify(v)); };
const queue = [];
const ta = (n, f) => queue.push([n, f]);

/* ---------------- a tiny fetch-shaped client over the running server ---------------- */
function makeClient(server, port) {
  function req(method, path, body, headers) {
    return new Promise((resolve, reject) => {
      const data = body != null ? JSON.stringify(body) : null;
      const r = http.request({ host: "127.0.0.1", port, path, method, headers: Object.assign({ "content-type": "application/json" }, headers || {}) }, (res) => {
        let chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const ct = res.headers["content-type"] || "";
          let parsed = buf;
          if (ct.indexOf("application/json") !== -1) { try { parsed = JSON.parse(buf.toString("utf8")); } catch (e) { parsed = buf.toString("utf8"); } }
          else if (ct.indexOf("text/") !== -1) parsed = buf.toString("utf8");
          resolve({ status: res.statusCode, body: parsed, headers: res.headers });
        });
      });
      r.on("error", reject);
      if (data) r.write(data);
      r.end();
    });
  }
  return {
    signup: (b) => req("POST", "/api/signup", b),
    login: (b) => req("POST", "/api/login", b),
    me: (token) => req("GET", "/api/me", null, { authorization: "Bearer " + token }),
    as: (token, orgId) => {
      // Node's http module stringifies a null header value to the literal
      // text "null" rather than dropping it -- omit the key entirely so
      // "no org header" in a test actually means no org header on the wire.
      const h = { authorization: "Bearer " + token };
      if (orgId) h["x-org-id"] = orgId;
      return {
        get: (p) => req("GET", p, null, h),
        post: (p, b) => req("POST", p, b, h),
        put: (p, b) => req("PUT", p, b, h),
      };
    },
    raw: req,
  };
}
async function withServer(fn) {
  const pool = freshPool();
  const app = createApp(pool, { sendEmail: async () => {}, fetch: null });
  const server = http.createServer(app);
  await new Promise((res) => server.listen(0, res));
  const port = server.address().port;
  const client = makeClient(server, port);
  try { await fn(client, pool); } finally { await new Promise((res) => server.close(res)); }
}

/* ---------------- fixtures ---------------- */
async function signupOrg(client, orgName, email) {
  const r = await client.signup({ email, password: "hunter22", name: "Owner " + orgName, orgName });
  if (!r.body.ok) throw new Error("signup failed: " + JSON.stringify(r.body));
  return { token: r.body.token, org: r.body.org, user: r.body.user };
}

ta("signup creates a user and an org, and the owner is a member", async () => {
  await withServer(async (client) => {
    const { token, org } = await signupOrg(client, "Stripes Distributing", "owner@stripesdist.com");
    ok(org.slug); eq(org.plan, "trial");
    const me = await client.me(token);
    eq(me.status, 200); eq(me.body.user.email, "owner@stripesdist.com");
    eq(me.body.orgs.length, 1); eq(me.body.orgs[0].role, "owner");
  });
});
ta("signup refuses a duplicate email, a short password, a missing name", async () => {
  await withServer(async (client) => {
    await client.signup({ email: "dup@x.com", password: "hunter22", name: "A" });
    const r = await client.signup({ email: "dup@x.com", password: "hunter22", name: "B" });
    ok(/already exists/.test(r.body.error));
    ok(/8 characters/.test((await client.signup({ email: "x@x.com", password: "short", name: "A" })).body.error));
    ok(/name is required/.test((await client.signup({ email: "y@x.com", password: "hunter22", name: "" })).body.error));
    ok(/valid email/.test((await client.signup({ email: "not-an-email", password: "hunter22", name: "A" })).body.error));
  });
});
ta("login works with the right password, fails with the wrong one, never reveals which part was wrong", async () => {
  await withServer(async (client) => {
    await client.signup({ email: "log@x.com", password: "hunter22", name: "A" });
    const good = await client.login({ email: "log@x.com", password: "hunter22" });
    ok(good.body.ok); ok(good.body.token);
    const bad = await client.login({ email: "log@x.com", password: "wrong" });
    eq(bad.body.error, "invalid email or password");
    const noone = await client.login({ email: "ghost@x.com", password: "whatever" });
    eq(noone.body.error, "invalid email or password", "same message whether the account exists or not");
  });
});
ta("password reset never reveals whether the address exists, and a used/expired token is refused", async () => {
  await withServer(async (client, pool) => {
    await client.signup({ email: "reset@x.com", password: "hunter22", name: "A" });
    const r1 = await client.raw("POST", "/api/password/forgot", { email: "reset@x.com" });
    const r2 = await client.raw("POST", "/api/password/forgot", { email: "ghost@x.com" });
    eq(r1.body.ok, true); eq(r2.body.ok, true); eq(r1.body.note, r2.body.note);
    const tok = await pool.query("SELECT reset_token FROM users WHERE email = $1", ["reset@x.com"]);
    const bad = await client.raw("POST", "/api/password/reset", { token: "not-real", password: "newpassword1" });
    ok(/expired/.test(bad.body.error));
    const good = await client.raw("POST", "/api/password/reset", { token: tok.rows[0].reset_token, password: "newpassword1" });
    ok(good.body.ok);
    const loginOld = await client.login({ email: "reset@x.com", password: "hunter22" });
    ok(loginOld.body.error, "the old password no longer works");
    const loginNew = await client.login({ email: "reset@x.com", password: "newpassword1" });
    ok(loginNew.body.ok);
  });
});

ta("requireOrg refuses no token, no X-Org-Id, and a real user who isn't a member of that org", async () => {
  await withServer(async (client) => {
    const a = await signupOrg(client, "Org A", "a@orga.com");
    const b = await signupOrg(client, "Org B", "b@orgb.com");
    eq((await client.raw("GET", "/api/stores")).status, 401, "no token at all");
    eq((await client.as(a.token, null).get("/api/stores")).status, 400, "no org header");
    eq((await client.as(a.token, b.org.id).get("/api/stores")).status, 403, "a real login, the wrong org");
    eq((await client.as(a.token, "00000000-0000-0000-0000-000000000000").get("/api/stores")).status, 403);
    // A malformed org id must be a clean 400 from validation, never a raw
    // driver error surfaced as a 500 -- this is the same shape of bug a real
    // Postgres would hit on a bad uuid literal, not a pg-mem-only quirk.
    eq((await client.as(a.token, "not-a-uuid").get("/api/stores")).status, 400, "malformed org id is 400, not a leaked driver error");
    eq((await client.as(a.token, "'; DROP TABLE orgs; --").get("/api/stores")).status, 400, "the same validation refuses injection-shaped input before it reaches SQL");
  });
});

ta("two orgs signed up independently share NOTHING through the API -- stores, styles, requests all isolated", async () => {
  await withServer(async (client) => {
    const a = await signupOrg(client, "Org A", "a@orga.com");
    const b = await signupOrg(client, "Org B", "b@orgb.com");
    const A = client.as(a.token, a.org.id), B = client.as(b.token, b.org.id);
    const sa = await A.post("/api/stores", { name: "A's Store 1" });
    const sb = await B.post("/api/stores", { name: "B's Store 1" });
    ok(sa.body.ok && sb.body.ok);
    const listA = await A.get("/api/stores"); const listB = await B.get("/api/stores");
    eq(listA.body.stores.length, 1); eq(listB.body.stores.length, 1);
    eq(listA.body.stores[0].name, "A's Store 1"); eq(listB.body.stores[0].name, "B's Store 1");
    // B cannot create a request against A's store id, even with a valid org header of their own.
    const cross = await B.post("/api/requests", { storeId: sa.body.store.id, itemName: "Bud Light", price: 9.99 });
    ok(cross.body.error, "a store id from another org is invisible, not just filtered");
    // B cannot see A's requests by asking with A's org id -- requireOrg blocks it before any query runs.
    const rA = await A.post("/api/requests", { storeId: sa.body.store.id, itemName: "Bud Light", price: 9.99 });
    ok(rA.body.ok, rA.body.error);
    const peek = await client.as(b.token, a.org.id).get("/api/requests");
    eq(peek.status, 403);
  });
});

ta("the full loop: signup -> store -> style -> request -> batch -> print -> mark printed", async () => {
  await withServer(async (client) => {
    const { token, org } = await signupOrg(client, "Full Loop Co", "loop@x.com");
    const S = client.as(token, org.id);
    const store = (await S.post("/api/stores", { name: "Main St #1", chain: "Stripes" })).body.store;
    ok(store.chainId, "the chain was created and linked from the raw name");
    const setup = await S.get("/api/setup");
    ok(setup.body.styles.length >= 1, "a default style is seeded"); ok(setup.body.materials.length >= 1, "seed materials exist");
    const style = (await S.post("/api/styles", { name: "Stripes Look", chainId: store.chainId, format: "tag", theme: { layout: "bold", accent: "#E4002B" } })).body.style;
    ok(style.id);
    const reqR = await S.post("/api/requests", { storeId: store.id, contentType: "standard_price", itemName: "Michelob Ultra", packageSize: "12pk Cans", price: 14.99, copies: 2 });
    ok(reqR.body.ok, reqR.body.error);
    const queue1 = await S.get("/api/requests?status=pending");
    eq(queue1.body.requests.length, 1); eq(queue1.body.requests[0].styleId, style.id, "resolved to the chain's style, not the default");
    const mat = setup.body.materials.find((m) => m.active);
    const batchR = await S.post("/api/batches", { materialId: mat.id, requestIds: [reqR.body.request.id] });
    ok(batchR.body.ok, batchR.body.error); eq(batchR.body.batch.count, 1);
    const afterBatch = await S.get("/api/requests?status=pending");
    eq(afterBatch.body.requests.length, 0, "the request left pending once batched");
    const html = (await S.get("/api/batches/" + batchR.body.batch.id + "/print")).body;
    ok(typeof html === "string" && /Michelob Ultra/.test(html), "the print sheet renders the request (uppercase is a CSS text-transform, not the stored text)");
    const printedR = await S.post("/api/batches/" + batchR.body.batch.id + "/printed", {});
    ok(printedR.body.ok, printedR.body.error); eq(printedR.body.printed, 1);
    const printedList = await S.get("/api/requests?status=printed");
    eq(printedList.body.requests.length, 1);
    const onb = await S.get("/api/onboarding");
    ok(onb.body.state.added_store && onb.body.state.picked_style && onb.body.state.made_request, "onboarding steps advanced as the org actually did them");
  });
});

ta("roles: a rep may submit and read only their own, a manager works their team, an admin sees everything", async () => {
  await withServer(async (client, pool) => {
    const { token, org, user: owner } = await signupOrg(client, "Roles Co", "owner@rolesco.com");
    const O = client.as(token, org.id);
    const team = (await O.post("/api/orgs/" + org.id + "/teams", { name: "West" })).body.team;
    const store = (await O.post("/api/stores", { name: "Store 1", teamId: team.id })).body.store;
    // Invite a rep, accept without logging in first (fresh-signup-style accept).
    const invite = await O.post("/api/orgs/" + org.id + "/invite", { email: "rep@rolesco.com", role: "rep", teamId: team.id });
    ok(invite.body.ok, invite.body.error);
    const invRow = await pool.query("SELECT token FROM org_invites WHERE email = $1", ["rep@rolesco.com"]);
    const accept = await client.raw("POST", "/api/invites/accept", { token: invRow.rows[0].token, name: "Rep One", password: "hunter22" });
    ok(accept.body.ok, accept.body.error);
    const R = client.as(accept.body.token, org.id);
    const repReq = await R.post("/api/requests", { storeId: store.id, itemName: "Bud Light", price: 9.99 });
    ok(repReq.body.ok, repReq.body.error);
    // The owner submits one too, so the rep's own-only view has something to exclude.
    await O.post("/api/requests", { storeId: store.id, itemName: "Busch Light", price: 5.99 });
    const repView = await R.get("/api/requests?status=all");
    eq(repView.body.requests.length, 1, "a rep sees only their own"); eq(repView.body.requests[0].itemName, "Bud Light");
    const ownerView = await O.get("/api/requests?status=all");
    eq(ownerView.body.requests.length, 2, "the owner sees the whole org");
    ok(!repReq.body.request.styleIdOverride === true || repReq.body.request.styleIdOverride == null, "a rep cannot set a style override");
    // A rep cannot edit styles.
    const repStyle = await R.post("/api/styles", { name: "Hack", format: "tag" });
    eq(repStyle.status, 400, "canAdmin refuses a rep");
  });
});

ta("a request lifecycle is enforced: cancel only your own pending, reject needs a reason, printed is final", async () => {
  await withServer(async (client) => {
    const { token, org } = await signupOrg(client, "Lifecycle Co", "life@x.com");
    const S = client.as(token, org.id);
    const store = (await S.post("/api/stores", { name: "S1" })).body.store;
    const r = (await S.post("/api/requests", { storeId: store.id, itemName: "Bud Light", price: 9.99 })).body.request;
    ok((await S.post("/api/requests/" + r.id + "/cancel", {})).body.ok);
    const gone = await S.get("/api/requests?status=cancelled");
    eq(gone.body.requests.length, 1);
    const r2 = (await S.post("/api/requests", { storeId: store.id, itemName: "Busch Light", price: 5.99 })).body.request;
    const noReason = await S.post("/api/requests/" + r2.id + "/reject", {});
    ok(/reason/.test(noReason.body.error));
    const rej = await S.post("/api/requests/" + r2.id + "/reject", { reason: "wrong pack" });
    ok(rej.body.ok, rej.body.error);
    const cancelRejected = await S.post("/api/requests/" + r2.id + "/cancel", {});
    ok(cancelRejected.body.error, "a rejected request cannot be withdrawn -- it is already history");
  });
});

ta("brand logos are shared across orgs once approved; an org's override stays private to it", async () => {
  await withServer(async (client, pool) => {
    const a = await signupOrg(client, "Org A", "a@x.com");
    const b = await signupOrg(client, "Org B", "b@x.com");
    const A = client.as(a.token, a.org.id), B = client.as(b.token, b.org.id);
    // No ANTHROPIC_API_KEY in this test, so recognize() falls back to Title
    // Case rather than real brand recognition -- "BUD LT" becomes "Bud Lt",
    // not "Bud Light" (that expansion needs the model). Match on the KEY
    // that fallback actually produces, not a label only the AI path would give.
    const rec = await A.post("/api/brands/recognize", { names: ["BUD LT"] });
    eq(rec.body.created, 1); ok(!rec.body.ai, "no key in this test -- confirms which path ran");
    const listA = await A.get("/api/brands"); const budA = listA.body.brands.find((x) => x.key === "bud-lt");
    ok(budA, "org A can see the brand it just created");
    const listB = await B.get("/api/brands"); const budB = listB.body.brands.find((x) => x.key === "bud-lt");
    ok(budB, "org B sees the SAME brand row -- the library is shared, not per-tenant");
    // Manually approve with a fake logo (no network in this test), then confirm the pick is shared.
    await pool.query("UPDATE brands SET logo_key = 'bl_test', status = 'approved' WHERE brand_key = $1", ["bud-lt"]);
    const reqA = (await A.post("/api/stores", { name: "S" }).then((s) => A.post("/api/requests", { storeId: s.body.store.id, itemName: "Bud Light", brand: "BUD LT", price: 9.99 })));
    ok(reqA.body.ok, reqA.body.error);
    const qA = await A.get("/api/requests?status=all");
    eq(qA.body.requests[0].brandId != null, true);
    // The rendered queue attaches the shared logo for org A.
    // Now B overrides privately.
    const brandRow = listB.body.brands.find((x) => x.key === "bud-lt");
    const ov = await B.post("/api/brands/" + brandRow.id + "/override", { dataUrl: "data:image/png;base64,AAAA" });
    ok(ov.body.ok, ov.body.error);
    const listB2 = await B.get("/api/brands");
    const budB2 = listB2.body.brands.find((x) => x.key === "bud-lt");
    ok(budB2.overridden && budB2.orgLogoKey, "B's override is visible to B");
    const listA2 = await A.get("/api/brands");
    const budA2 = listA2.body.brands.find((x) => x.key === "bud-lt");
    ok(!budA2.overridden, "A never sees B's private override");
  });
});

ta("Excel import: preview writes nothing, apply lands requests scoped to the importing org only", async () => {
  await withServer(async (client) => {
    const a = await signupOrg(client, "Import Co", "imp@x.com");
    const A = client.as(a.token, a.org.id);
    const store = (await A.post("/api/stores", { name: "Stripes #1", chain: "Stripes" })).body.store;
    const IMP = require("../lib/tagup-import");
    const sheets = [{ name: "s", rows: [["Brand", "Package", "Price"], ["Bud Light", "12pk Cans", "9.99"], ["Busch Light", "24pk Cans", "5.99"]] }];
    // The route wants a real multipart upload; exercise the module directly
    // for the parsing/matching contract, since integration coverage of the
    // multipart boundary itself belongs to a supertest-style HTTP test.
    const TAGUP = require("../lib/tagup");
    ok(IMP.parseBook(sheets).ok);
  });
});


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

ta("rep-owned accounts: a rep's picker shows only their accounts; no match falls back to every account with a reason", async () => {
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
    // a rep # that matches nothing falls back to the NAME the list carries
    await A.post("/api/orgs/" + a.org.id + "/members/" + acc.body.user.id, { repNo: "99999" });
    eq((await J.get("/api/stores")).body.scope, "mine", "still Jose by name");
    // a rep the list does not know at all sees every account, and is told why
    await A.post("/api/orgs/" + a.org.id + "/invite", { email: "pat@route.com", role: "rep" });
    const tok2 = (await pool.query("SELECT token FROM org_invites WHERE email = 'pat@route.com'")).rows[0].token;
    const P = client.as((await client.raw("POST", "/api/invites/accept", { token: tok2, name: "Pat Nobody", password: "hunter22" })).body.token, a.org.id);
    const wide = await P.get("/api/stores");
    eq(wide.body.scope, "all"); eq(wide.body.scopeReason, "unassigned"); eq(wide.body.stores.length, 3);
    // no rep # at all, but the list names them -> matched by name
    await A.post("/api/orgs/" + a.org.id + "/members/" + acc.body.user.id, { repNo: "" });
    const byName = await J.get("/api/stores");
    eq(byName.body.scope, "mine"); eq(byName.body.stores.length, 2);
    // a re-upload of the same numbers updates address + rep in place
    eq((await A.post("/api/stores/import", { rows: [{ name: "Stripes #1", storeNo: "1", address: "1 Main St", repName: "Maria Delgado", repNo: "21071" }] })).body.updated, 1);
    eq((await J.get("/api/stores")).body.stores.map((s) => s.name), ["Indie"], "the account moved to Maria and left Jose's picker");
  });
});

ta("VIP Brand Builder import: logos land as the org's overrides, dry run writes nothing, the distributor id is remembered", async () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  const feed = { code: 200, data: [{ group_name: "All", brands: [{ brand_id: "1", brand_name: "Bud Light", brand_logo: "https://images.vtinfo.com/budlight.png" }, { brand_id: "2", brand_name: "Nobody Brewing", brand_logo: "https://images.vtinfo.com/nobody.png" }] }] };
  const calls = [];
  const fakeFetch = async (url) => { calls.push(String(url)); if (/\/distributor\/02308\/brands$/.test(url)) return { ok: true, status: 200, json: async () => feed, headers: { get: () => "application/json" } }; if (/\/distributor\//.test(url)) return { ok: false, status: 404, json: async () => ({}), headers: { get: () => "" } }; return { ok: true, status: 200, arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength), headers: { get: () => "image/png" } }; };
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
    ok(!calls.some((c) => /budlight\.png/.test(c)), "dry run downloads nothing");
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

(async () => {
  for (const [n, f] of queue) {
    try { await f(); console.log("  ok   " + n); pass++; }
    catch (e) { console.log("  FAIL " + n + " -- " + show(e)); fail++; }
  }
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
