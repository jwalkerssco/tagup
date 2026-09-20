"use strict";
/* Second server pass: what the app shell needs that the API did not yet
   answer. Anchored, single-match-or-abort, sentinel per file. */
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

/* ---- auth.js: members, invites list, org rename, remove member ---- */
patch("lib/auth.js", "async function listMembers", [
  [`  async function acceptInvite(body, currentUserId) {`,
`  async function listMembers(session) {
    const m = await pool().query("SELECT u.id, u.email, u.name, m.role, m.team_id, m.joined_at, u.last_login_at FROM org_members m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1 ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, u.name", [session.org.id]);
    const inv = await pool().query("SELECT id, email, role, team_id, created_at, expires_at FROM org_invites WHERE org_id = $1 AND accepted_at IS NULL AND expires_at > now() ORDER BY created_at DESC", [session.org.id]);
    return { ok: true, members: m.rows.map((r) => ({ id: r.id, email: r.email, name: r.name, role: r.role, teamId: r.team_id, joinedAt: r.joined_at, lastLoginAt: r.last_login_at })),
             invites: inv.rows.map((r) => ({ id: r.id, email: r.email, role: r.role, teamId: r.team_id, createdAt: r.created_at, expiresAt: r.expires_at })) };
  }
  async function setMember(session, userId, body) {
    if (!requireRole(session, ["owner", "admin"])) return { error: "only an owner or admin changes roles" };
    const b = body || {};
    const cur = await pool().query("SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2", [session.org.id, userId]);
    if (!cur.rows.length) return { error: "not a member" };
    if (cur.rows[0].role === "owner" && session.membership.role !== "owner") return { error: "only the owner changes the owner" };
    if (b.remove) {
      if (cur.rows[0].role === "owner") return { error: "the owner cannot be removed -- transfer ownership first" };
      await pool().query("DELETE FROM org_members WHERE org_id = $1 AND user_id = $2", [session.org.id, userId]);
      return { ok: true, removed: true };
    }
    const role = ["owner", "admin", "manager", "rep"].indexOf(b.role) !== -1 ? b.role : cur.rows[0].role;
    if (role === "owner" && session.membership.role !== "owner") return { error: "only the owner transfers ownership" };
    await pool().query("UPDATE org_members SET role = $3, team_id = $4 WHERE org_id = $1 AND user_id = $2", [session.org.id, userId, role, b.teamId === undefined ? cur.rows[0].team_id || null : (b.teamId || null)]);
    if (role === "owner" && userId !== session.user.id) await pool().query("UPDATE org_members SET role = 'admin' WHERE org_id = $1 AND user_id = $2", [session.org.id, session.user.id]);
    return { ok: true };
  }
  async function revokeInvite(session, inviteId) {
    if (!requireRole(session, ["owner", "admin"])) return { error: "forbidden" };
    await pool().query("DELETE FROM org_invites WHERE org_id = $1 AND id = $2 AND accepted_at IS NULL", [session.org.id, inviteId]);
    return { ok: true };
  }
  async function updateOrg(session, body) {
    if (!requireRole(session, ["owner", "admin"])) return { error: "only an owner or admin renames the workspace" };
    const name = clip((body || {}).name, 80);
    if (!name) return { error: "workspace needs a name" };
    const r = await pool().query("UPDATE orgs SET name = $2 WHERE id = $1 RETURNING id, slug, name, plan, trial_ends_at", [session.org.id, name]);
    return { ok: true, org: r.rows[0] };
  }
  async function acceptInvite(body, currentUserId) {`, "members"],
  [`  return { signup, verifyEmail, login, orgsFor, requestReset, resetPassword, issueSession, verifySession, membershipFor, isMember, requireRole, inviteMember, acceptInvite, uniqueSlug, slugify };`,
   `  return { signup, verifyEmail, login, orgsFor, requestReset, resetPassword, issueSession, verifySession, membershipFor, isMember, requireRole, inviteMember, acceptInvite, uniqueSlug, slugify, listMembers, setMember, revokeInvite, updateOrg };`, "exports"],
  // orgsFor carries the trial date so the app can show it
  [`"SELECT o.id, o.slug, o.name, o.plan, m.role FROM orgs o JOIN org_members m ON m.org_id = o.id WHERE m.user_id = $1 ORDER BY m.joined_at"`,
   `"SELECT o.id, o.slug, o.name, o.plan, o.trial_ends_at, m.role FROM orgs o JOIN org_members m ON m.org_id = o.id WHERE m.user_id = $1 ORDER BY m.joined_at"`, "orgsFor trial"],
]);

/* ---- brands.js: recognize from the catalog, unmatched + counts on list ---- */
patch("lib/brands.js", "fromCatalog", [
  [`    let names = Array.isArray(b.names) ? b.names.map(String) : [];
    names = Array.from(new Set(names.map((s) => clip(s, 60)).filter(Boolean))).slice(0, 200);`,
`    let names = Array.isArray(b.names) ? b.names.map(String) : [];
    if (!names.length && b.fromCatalog) names = await catalogBrandStrings(session.org.id);
    names = Array.from(new Set(names.map((s) => clip(s, 60)).filter(Boolean))).slice(0, 200);`, "recognize source"],
  [`  async function list(session) {
    const org = session.org.id;
    const [brands, overrides] = await Promise.all([
      rows(),
      pool().query("SELECT brand_id, logo_key FROM brand_overrides WHERE org_id = $1", [org]),
    ]);
    const ov = {}; overrides.rows.forEach((r) => { ov[r.brand_id] = r.logo_key; });
    brands.forEach((b) => { if (ov[b.id]) { b.orgLogoKey = ov[b.id]; b.overridden = true; } });
    return { ok: true, brands, canWrite: true, aiOn: !!env.ANTHROPIC_API_KEY };
  }`,
`  // The org's own brand spellings: the catalog's Brand column, else the
  // leading word(s) of the item name -- what Recognize turns into brands.
  async function catalogBrandStrings(orgId) {
    const r = await pool().query("SELECT brand, name FROM catalog_items WHERE org_id = $1 AND active", [orgId]);
    const seen = {};
    r.rows.forEach((x) => { const s = clip(x.brand || String(x.name || "").split(/\\s+\\d|\\s+-\\s+|\\s{2,}/)[0].split(/\\s+/).slice(0, 2).join(" "), 60); if (s) seen[normBrand(s)] = seen[normBrand(s)] || s; });
    return Object.values(seen);
  }
  async function list(session) {
    const org = session.org.id;
    const [brands, overrides, catStrings] = await Promise.all([
      rows(),
      pool().query("SELECT brand_id, logo_key FROM brand_overrides WHERE org_id = $1", [org]),
      catalogBrandStrings(org),
    ]);
    const ov = {}; overrides.rows.forEach((r) => { ov[r.brand_id] = r.logo_key; });
    brands.forEach((b) => { if (ov[b.id]) { b.orgLogoKey = ov[b.id]; b.overridden = true; } });
    const idx = indexOf(brands);
    const itemCounts = await pool().query("SELECT brand, count(*)::int AS n FROM catalog_items WHERE org_id = $1 AND active AND brand IS NOT NULL GROUP BY brand", [org]);
    const nItems = {}; itemCounts.rows.forEach((x) => { const hit = idx[normBrand(x.brand)]; if (hit) nItems[hit.key] = (nItems[hit.key] || 0) + x.n; });
    brands.forEach((b) => { b.items = nItems[b.key] || 0; });
    const unmatched = catStrings.filter((s) => !idx[normBrand(s)]).map((raw) => ({ raw }));
    const counts = { approved: 0, found: 0, missing: 0, rejected: 0 };
    brands.forEach((b) => { if (b.status === "approved" || b.status === "manual" || b.overridden) counts.approved++; else if (b.status === "found") counts.found++; else if (b.status === "rejected") counts.rejected++; else counts.missing++; });
    return { ok: true, brands, unmatched, counts, canWrite: true, aiOn: !!env.ANTHROPIC_API_KEY };
  }`, "list unmatched"],
]);

/* ---- tagup.js: store spreadsheet parse (pure) ---- */
patch("lib/tagup.js", "parseStoreSheet", [
  [`function create(deps) {
  const D = deps; // pool, brands (module), putAsset`,
`// A store list off a spreadsheet: header anywhere in the first 40 rows,
// synonym column names, Name required. Pure -- the route reads the workbook.
const STORE_COLS = {
  name: ["name", "store", "store name", "account", "account name", "customer", "customer name", "location", "dba"],
  storeNo: ["store #", "store no", "store number", "#", "number", "account #", "account no", "account number", "customer #", "customer no", "id", "store id", "cust #"],
  city: ["city", "town", "market"],
  chain: ["chain", "banner", "parent", "call point", "chain name", "group", "customer group"],
  team: ["team", "route", "territory", "district"],
};
function parseStoreSheet(sheets) {
  const norm = (s) => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9#]+/g, " ").trim();
  const colOf = (h) => { const n = norm(h); if (!n) return null; for (const k of Object.keys(STORE_COLS)) if (STORE_COLS[k].indexOf(n) !== -1) return k; return null; };
  for (const sh of sheets || []) {
    const rows = sh.rows || [];
    for (let r = 0; r < Math.min(rows.length, 40); r++) {
      const map = {}; let hits = 0;
      (rows[r] || []).forEach((c, i) => { const k = colOf(c); if (k && map[k] == null) { map[k] = i; hits++; } });
      if (map.name == null || hits < 1) continue;
      const out = [];
      for (let i = r + 1; i < rows.length; i++) {
        const cells = rows[i] || []; const get = (k) => (map[k] == null ? "" : cells[map[k]]);
        const name = clip(get("name"), 120); if (!name) continue;
        let storeNo = clip(get("storeNo"), 40);
        if (storeNo && /^\\d+$/.test(storeNo) && typeof get("storeNo") === "number" && storeNo.length < 5) storeNo = storeNo.padStart(5, "0");
        out.push({ name, storeNo: storeNo || null, city: clip(get("city"), 60), chain: clip(get("chain"), 80), team: clip(get("team"), 60) });
      }
      return { ok: true, sheet: sh.name, headerRow: r + 1, columns: Object.keys(map), rows: out };
    }
  }
  return { error: "no header row found -- the sheet needs a Name (or Store / Account) column; Store #, City and Chain are read when present", sheets: (sheets || []).map((s) => s.name) };
}

function create(deps) {
  const D = deps; // pool, brands (module), putAsset`, "parseStoreSheet"],
  [`module.exports = { create };`, `module.exports = { create, parseStoreSheet };`, "export parse"],
  // importStores learns the team column (a team named in the sheet is created on the fly)
  [`    let created = 0, updated = 0;
    for (const row of rows || []) {
      const name = clip(row.name, 120); if (!name) continue;
      const storeNo = clip(row.storeNo, 40) || null;
      const chainId = await chainKeyFor(row.chain);
      const existing = storeNo ? await pool().query("SELECT id FROM stores WHERE org_id = $1 AND store_no = $2", [session.org.id, storeNo]) : { rows: [] };
      if (existing.rows.length) { await pool().query("UPDATE stores SET name=$3, city=$4, chain_id=$5, chain_raw=$6, active=true, updated_at=now() WHERE id=$1 AND org_id=$2", [existing.rows[0].id, session.org.id, name, clip(row.city, 60), chainId, clip(row.chain, 80)]); updated++; }
      else { await pool().query("INSERT INTO stores (id, org_id, name, store_no, city, chain_id, chain_raw) VALUES ($1,$2,$3,$4,$5,$6,$7)", [newId(), session.org.id, name, storeNo, clip(row.city, 60), chainId, clip(row.chain, 80)]); created++; }
    }`,
`    let created = 0, updated = 0;
    const teamsR = await pool().query("SELECT id, name FROM teams WHERE org_id = $1", [session.org.id]);
    const teamByName = {}; teamsR.rows.forEach((t) => { teamByName[t.name.toLowerCase()] = t.id; });
    async function teamIdFor(label) {
      const nm = clip(label, 60); if (!nm) return null;
      const k = nm.toLowerCase(); if (teamByName[k]) return teamByName[k];
      const t = await pool().query("INSERT INTO teams (id, org_id, name) VALUES ($1,$2,$3) RETURNING id", [newId(), session.org.id, nm]);
      teamByName[k] = t.rows[0].id; return t.rows[0].id;
    }
    for (const row of rows || []) {
      const name = clip(row.name, 120); if (!name) continue;
      const storeNo = clip(row.storeNo, 40) || null;
      const chainId = await chainKeyFor(row.chain);
      const teamId = await teamIdFor(row.team);
      const existing = storeNo ? await pool().query("SELECT id FROM stores WHERE org_id = $1 AND store_no = $2", [session.org.id, storeNo]) : await pool().query("SELECT id FROM stores WHERE org_id = $1 AND store_no IS NULL AND lower(name) = lower($2)", [session.org.id, name]);
      if (existing.rows.length) { await pool().query("UPDATE stores SET name=$3, city=$4, chain_id=$5, chain_raw=$6, team_id=coalesce($7, team_id), active=true, updated_at=now() WHERE id=$1 AND org_id=$2", [existing.rows[0].id, session.org.id, name, clip(row.city, 60), chainId, clip(row.chain, 80), teamId]); updated++; }
      else { await pool().query("INSERT INTO stores (id, org_id, name, store_no, city, chain_id, chain_raw, team_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [newId(), session.org.id, name, storeNo, clip(row.city, 60), chainId, clip(row.chain, 80), teamId]); created++; }
    }`, "importStores teams"],
]);

/* ---- server.js: routes + trial gate ---- */
patch("server.js", "/api/stores/upload", [
  [`      const orgR = await pool.query("SELECT id, slug, name, plan FROM orgs WHERE id = $1", [orgId]);
      if (!orgR.rows.length) return res.status(404).json({ error: "org not found" });
      req.user = user;
      req.session = { user, org: orgR.rows[0], membership };
      next();`,
`      const orgR = await pool.query("SELECT id, slug, name, plan, trial_ends_at FROM orgs WHERE id = $1", [orgId]);
      if (!orgR.rows.length) return res.status(404).json({ error: "org not found" });
      const org = orgR.rows[0];
      // Trial gate: an expired trial keeps READING (the queue, the batches,
      // every print sheet already made) and loses writes -- nobody's work
      // disappears the morning the trial ends, and a manager can still print
      // what a rep asked for yesterday. 402 is the one status a client can
      // route to "upgrade" without guessing.
      const trialOver = org.plan === "trial" && org.trial_ends_at && new Date(org.trial_ends_at).getTime() < Date.now();
      if (trialOver && req.method !== "GET") return res.status(402).json({ error: "your free trial has ended -- upgrade to keep making tags", trialEnded: true });
      req.user = user;
      req.session = { user, org, membership, trialOver };
      next();`, "trial gate"],
  [`  app.post("/api/orgs/:id/invite", requireOrg, wrap(async (req) => authMod.inviteMember(req.session, req.body)));`,
`  app.post("/api/orgs/:id/invite", requireOrg, wrap(async (req) => authMod.inviteMember(req.session, req.body)));
  app.get("/api/orgs/:id/members", requireOrg, wrap(async (req) => authMod.listMembers(req.session)));
  app.post("/api/orgs/:id/members/:userId", requireOrg, wrap(async (req) => authMod.setMember(req.session, req.params.userId, req.body)));
  app.post("/api/orgs/:id/invites/:inviteId/revoke", requireOrg, wrap(async (req) => authMod.revokeInvite(req.session, req.params.inviteId)));
  app.put("/api/orgs/:id", requireOrg, wrap(async (req) => authMod.updateOrg(req.session, req.body)));
  app.get("/api/orgs/:id", requireOrg, wrap(async (req) => ({ ok: true, org: req.session.org, role: req.session.membership.role, teamId: req.session.membership.team_id || null, trialOver: !!req.session.trialOver })));`, "org routes"],
  [`  app.post("/api/stores/import", requireOrg, wrap(async (req) => tagupMod.importStores(req.session, req.body && req.body.rows)));`,
`  app.post("/api/stores/import", requireOrg, wrap(async (req) => tagupMod.importStores(req.session, req.body && req.body.rows)));
  app.post("/api/stores/upload", requireOrg, upload.single("file"), wrap(async (req) => {
    if (!tagupMod.canAdmin(req.session)) return { error: "only an owner or admin loads stores", status: 403 };
    if (!req.file) return { error: "no file uploaded" };
    let sheets; try { sheets = readWorkbook(req.file.buffer); } catch (e) { return { error: "could not read the workbook: " + e.message }; }
    const parsed = TAGUP.parseStoreSheet(sheets);
    if (parsed.error) return parsed;
    if ((req.body || {}).preview === "1") return { ok: true, preview: true, sheet: parsed.sheet, headerRow: parsed.headerRow, columns: parsed.columns, count: parsed.rows.length, sample: parsed.rows.slice(0, 12) };
    const r = await tagupMod.importStores(req.session, parsed.rows);
    return Object.assign({ sheet: parsed.sheet, columns: parsed.columns, total: parsed.rows.length }, r);
  }));`, "stores upload"],
]);
console.log("done");
