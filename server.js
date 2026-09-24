/* server.js -- tagup, standalone. Express, JWT sessions, one Postgres pool.
   createApp(pool, opts) so tests build the app around an in-memory database
   instead of a live one, and index.js wires the real pool for production. */
"use strict";
const express = require("express");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const XLSX = require("xlsx");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const AUTH = require("./lib/auth");
const ASSETS = require("./lib/assets");
const BRANDS = require("./lib/brands");
const TAGUP = require("./lib/tagup");
const CATALOG = require("./lib/catalog");
const EMAIL = require("./lib/email");

function createApp(pool, opts) {
  const o = opts || {};
  const signSecret = o.signSecret || process.env.SESSION_SECRET || "dev-secret-change-me";
  const mailer = EMAIL.create(o.env || process.env, o.fetch);
  const sendEmail = o.sendEmail || mailer.send;
  const fetchFn = o.fetch || (typeof fetch === "function" ? fetch : null);

  const authMod = AUTH.create({ pool, jwt, bcrypt, sign_secret: signSecret, sendEmail, appUrl: o.appUrl || "" });
  const assetsMod = ASSETS.create({ pool });
  const brandsMod = BRANDS.create({ pool, putAsset: assetsMod.putAsset, env: o.env || process.env, fetch: fetchFn });
  const tagupMod = TAGUP.create({ pool, brands: brandsMod, putAsset: assetsMod.putAsset });
  const catalogMod = CATALOG.create({ pool });

  const app = express();
  app.use(express.json({ limit: "15mb" }));
  app.use(cookieParser());
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
  function readWorkbook(buffer) {
    const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
    return wb.SheetNames.map((name) => ({ name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" }) }));
  }

  function tokenFrom(req) {
    const h = req.get("authorization") || "";
    if (h.startsWith("Bearer ")) return h.slice(7);
    // ?t= is the door for a page a browser opens directly (a print sheet
    // in a new tab, a magic link): the bearer's own token, nothing a header
    // could not carry.
    return (req.cookies && req.cookies.tagup_auth) || (req.query && req.query.t) || null;
  }
  // requireAuth: a verified user, no org chosen yet (signup/org endpoints).
  async function requireAuth(req, res, next) {
    const t = tokenFrom(req);
    const user = t ? await authMod.verifySession(t) : null;
    if (!user) return res.status(401).json({ error: "sign in required" });
    req.user = user;
    next();
  }
  // requireOrg: a verified user AND a membership in the org named by
  // X-Org-Id -- the multi-tenant equivalent of the embedded app's branch
  // header, and just as load-bearing: every scoped query reads session.org,
  // never the request body, so a forged org id in a body can never cross
  // a tenant boundary.
  // A UUID shape check before anything touches the database: an org id that
  // is missing, empty, or just wrong-shaped must answer 400 from validation,
  // never fall through to a raw driver error. On a real Postgres a bad uuid
  // literal throws same as it does here against pg-mem -- this guard is what
  // turns that into a clean, predictable 400 instead of an unhandled 500 that
  // leaks a query and a stack trace to the client.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  async function requireOrg(req, res, next) {
    try {
      const t = tokenFrom(req);
      const user = t ? await authMod.verifySession(t) : null;
      if (!user) return res.status(401).json({ error: "sign in required" });
      const orgId = req.get("x-org-id") || (req.query && req.query.org);
      if (!orgId) return res.status(400).json({ error: "missing X-Org-Id" });
      if (!UUID_RE.test(orgId)) return res.status(400).json({ error: "X-Org-Id is not a valid id" });
      const membership = await authMod.membershipFor(user.id, orgId);
      if (!membership) return res.status(403).json({ error: "not a member of this org" });
      const orgR = await pool.query("SELECT id, slug, name, plan, trial_ends_at FROM orgs WHERE id = $1", [orgId]);
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
      next();
    } catch (e) { console.error("requireOrg", e); res.status(500).json({ error: String((e && e.message) || e) }); }
  }
  const wrap = (fn) => async (req, res) => {
    try { const r = await fn(req); if (r == null) return res.status(404).json({ error: "not found" }); if (r.error) return res.status(r.status || 400).json({ error: r.error }); res.json(r); }
    catch (e) { console.error(req.method, req.path, e); res.status(500).json({ error: String((e && e.message) || e) }); }
  };

  /* ---- auth ---- */
  app.post("/api/signup", wrap(async (req) => authMod.signup(req.body)));
  app.get("/api/verify", wrap(async (req) => authMod.verifyEmail(req.query.token)));
  app.post("/api/login", wrap(async (req) => authMod.login(req.body)));
  app.post("/api/password/forgot", wrap(async (req) => authMod.requestReset(req.body)));
  app.post("/api/password/reset", wrap(async (req) => authMod.resetPassword(req.body)));
  app.get("/api/me", requireAuth, wrap(async (req) => ({ ok: true, user: req.user, orgs: await authMod.orgsFor(req.user.id) })));
  app.post("/api/invites/accept", wrap(async (req) => {
    const t = tokenFrom(req);
    const user = t ? await authMod.verifySession(t) : null;
    return authMod.acceptInvite(req.body, user && user.id);
  }));
  app.post("/api/orgs/:id/invite", requireOrg, wrap(async (req) => authMod.inviteMember(req.session, req.body)));
  app.get("/api/orgs/:id/members", requireOrg, wrap(async (req) => authMod.listMembers(req.session)));
  app.get("/api/orgs/:id/reps", requireOrg, wrap(async (req) => (tagupMod.canManage(req.session) ? tagupMod.repsOnList(req.session) : { error: "forbidden", status: 403 })));
  app.post("/api/orgs/:id/members/:userId", requireOrg, wrap(async (req) => authMod.setMember(req.session, req.params.userId, req.body)));
  app.post("/api/orgs/:id/invites/:inviteId/revoke", requireOrg, wrap(async (req) => authMod.revokeInvite(req.session, req.params.inviteId)));
  app.put("/api/orgs/:id", requireOrg, wrap(async (req) => authMod.updateOrg(req.session, req.body)));
  app.get("/api/orgs/:id", requireOrg, wrap(async (req) => ({ ok: true, org: req.session.org, role: req.session.membership.role, teamId: req.session.membership.team_id || null, trialOver: !!req.session.trialOver })));
  app.get("/api/orgs/:id/teams", requireOrg, wrap(async (req) => tagupMod.listTeams(req.session)));
  app.post("/api/orgs/:id/teams", requireOrg, wrap(async (req) => tagupMod.createTeam(req.session, req.body)));

  /* ---- assets ---- */
  app.get("/api/assets/:ns/:key", async (req, res) => {
    try { const a = await assetsMod.getAsset(req.params.ns, req.params.key); if (!a) return res.status(404).end(); res.set("Content-Type", a.mime).set("Cache-Control", "public, max-age=31536000, immutable").end(a.buf); }
    catch (e) { res.status(500).end(); }
  });

  /* ---- stores / teams / chains ---- */
  app.get("/api/health", (req, res) => res.json({ ok: true, mail: mailer.mode, ai: !!(o.env || process.env).ANTHROPIC_API_KEY, at: new Date().toISOString() }));
  app.get("/api/stores", requireOrg, wrap(async (req) => tagupMod.listStores(req.session, { withStyles: req.query.styles === "1", all: req.query.all === "1" && tagupMod.canManage(req.session) })));
  app.post("/api/stores/:id/retire", requireOrg, wrap(async (req) => tagupMod.retireStore(req.session, req.params.id, req.body && req.body.restore)));
  app.get("/api/catalog", requireOrg, wrap(async (req) => catalogMod.list(req.session, { q: req.query.q, limit: req.query.limit })));
  app.post("/api/catalog/import", requireOrg, upload.single("file"), wrap(async (req) => {
    if (!tagupMod.canAdmin(req.session)) return { error: "only an owner or admin loads the item list", status: 403 };
    if (!req.file) return { error: "no file uploaded" };
    let sheets; try { sheets = readWorkbook(req.file.buffer); } catch (e) { return { error: "could not read the workbook: " + e.message }; }
    return catalogMod.importItems(req.session, sheets, { preview: (req.body || {}).preview === "1" });
  }));
  app.get("/api/requests/mine", requireOrg, wrap(async (req) => tagupMod.mineCounts(req.session)));
  app.post("/api/stores", requireOrg, wrap(async (req) => tagupMod.upsertStore(req.session, req.body)));
  app.post("/api/stores/import", requireOrg, wrap(async (req) => tagupMod.importStores(req.session, req.body && req.body.rows)));
  app.post("/api/stores/upload", requireOrg, upload.single("file"), wrap(async (req) => {
    if (!tagupMod.canAdmin(req.session)) return { error: "only an owner or admin loads stores", status: 403 };
    if (!req.file) return { error: "no file uploaded" };
    let sheets; try { sheets = readWorkbook(req.file.buffer); } catch (e) { return { error: "could not read the workbook: " + e.message }; }
    const parsed = TAGUP.parseStoreSheet(sheets);
    if (parsed.error) return parsed;
    if ((req.body || {}).preview === "1") return { ok: true, preview: true, sheet: parsed.sheet, headerRow: parsed.headerRow, columns: parsed.columns, count: parsed.rows.length, sample: parsed.rows.slice(0, 12) };
    const r = await tagupMod.importStores(req.session, parsed.rows);
    return Object.assign({ sheet: parsed.sheet, columns: parsed.columns, total: parsed.rows.length }, r);
  }));
  app.get("/api/chains", requireOrg, wrap(async (req) => ({ ok: true, chains: await tagupMod.chainsForOrg(req.session) })));

  /* ---- setup / styles / materials ---- */
  app.get("/api/setup", requireOrg, wrap(async (req) => tagupMod.setup(req.session)));
  app.post("/api/styles", requireOrg, wrap(async (req) => tagupMod.saveStyle(req.session, req.body)));
  app.post("/api/styles/:id/template", requireOrg, wrap(async (req) => tagupMod.setStyleTemplate(req.session, req.params.id, req.body)));
  app.post("/api/styles/:id/retire", requireOrg, wrap(async (req) => tagupMod.retireStyle(req.session, req.params.id, req.body && req.body.restore)));
  app.post("/api/styles/:id/logo", requireOrg, wrap(async (req) => tagupMod.setStyleLogo(req.session, req.params.id, req.body)));
  app.post("/api/materials", requireOrg, wrap(async (req) => tagupMod.saveMaterial(req.session, req.body)));
  app.post("/api/materials/:id/retire", requireOrg, wrap(async (req) => tagupMod.retireMaterial(req.session, req.params.id, req.body && req.body.restore)));

  /* ---- brands ---- */
  app.get("/api/brands", requireOrg, wrap(async (req) => brandsMod.list(req.session)));
  const adminOnly = (fn) => wrap(async (req) => (tagupMod.canAdmin(req.session) ? fn(req) : { error: "forbidden", status: 403 }));
  app.post("/api/brands/recognize", requireOrg, adminOnly((req) => brandsMod.recognize(req.session, req.body)));
  app.post("/api/brands/find", requireOrg, adminOnly((req) => brandsMod.find(req.session, req.body)));
  app.post("/api/brands/upload", requireOrg, upload.array("files", 200), wrap(async (req) => {
    if (!tagupMod.canAdmin(req.session)) return { error: "forbidden", status: 403 };
    const files = (req.files || []).map((f) => ({ name: f.originalname, mime: f.mimetype, buf: f.buffer }));
    if (!files.length) return { error: "no files" };
    return brandsMod.bulkUpload(req.session, files);
  }));
  app.post("/api/brands/approve-confident", requireOrg, wrap(async (req) => { if (!tagupMod.canAdmin(req.session)) return { error: "forbidden", status: 403 }; return brandsMod.approveConfident(req.session, req.body); }));
  app.post("/api/brands/:key/pick", requireOrg, wrap(async (req) => brandsMod.pick(req.session, req.params.key, req.body)));
  app.post("/api/brands/:key/approve", requireOrg, wrap(async (req) => brandsMod.setStatus(req.session, req.params.key, "approved")));
  app.post("/api/brands/:key/reject", requireOrg, wrap(async (req) => brandsMod.setStatus(req.session, req.params.key, "rejected")));
  app.post("/api/brands/:id/override", requireOrg, wrap(async (req) => brandsMod.setOverride(req.session, req.params.id, req.body && req.body.dataUrl)));

  /* ---- requests / batches / print ---- */
  app.get("/api/requests", requireOrg, wrap(async (req) => tagupMod.list(req.session, { status: req.query.status })));
  app.post("/api/requests", requireOrg, wrap(async (req) => tagupMod.createRequest(req.session, req.body)));
  app.put("/api/requests/:id", requireOrg, wrap(async (req) => tagupMod.updateRequest(req.session, req.params.id, req.body)));
  app.post("/api/requests/:id/cancel", requireOrg, wrap(async (req) => tagupMod.cancelRequest(req.session, req.params.id)));
  app.post("/api/requests/:id/reject", requireOrg, wrap(async (req) => tagupMod.rejectRequest(req.session, req.params.id, req.body && req.body.reason)));
  app.post("/api/requests/:id/unbatch", requireOrg, wrap(async (req) => tagupMod.unbatchRequest(req.session, req.params.id)));
  app.post("/api/batches/:id/delete", requireOrg, wrap(async (req) => tagupMod.deleteBatch(req.session, req.params.id)));
  app.get("/api/batches", requireOrg, wrap(async (req) => tagupMod.listBatches(req.session)));
  app.post("/api/batches", requireOrg, wrap(async (req) => tagupMod.createBatch(req.session, req.body)));
  app.post("/api/batches/:id/printed", requireOrg, wrap(async (req) => tagupMod.markPrinted(req.session, req.params.id)));
  app.get("/api/batches/:id/print", requireOrg, async (req, res) => {
    try {
      const origin = (req.get("x-forwarded-proto") || req.protocol) + "://" + req.get("host");
      const r = await tagupMod.printHtml(req.session, req.params.id, { origin });
      if (r.error) return res.status(r.status || 400).type("text/plain").send(r.error);
      res.type("text/html").send(r.html);
    } catch (e) { res.status(500).type("text/plain").send(String((e && e.message) || e)); }
  });

  /* ---- import / export ---- */
  app.post("/api/import", requireOrg, upload.single("file"), wrap(async (req) => {
    if (!req.file) return { error: "no file uploaded" };
    let sheets; try { sheets = readWorkbook(req.file.buffer); } catch (e) { return { error: "could not read the workbook: " + e.message }; }
    const b = req.body || {};
    return tagupMod.importBook(req.session, sheets, { mode: b.mode, storeId: b.storeId, chainId: b.chainId, format: b.format, contentType: b.contentType, apply: b.apply === "1" || b.apply === "true", fileName: req.file.originalname });
  }));
  function xlsxOut(res, headers, rows, filename) {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers].concat(rows));
    XLSX.utils.book_append_sheet(wb, ws, "Tags");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").set("Content-Disposition", 'attachment; filename="' + filename + '"').end(buf);
  }
  app.get("/api/import/template", (req, res) => { const t = tagupMod.importTemplate(); xlsxOut(res, t.headers, t.rows, t.filename); });
  app.get("/api/export", requireOrg, async (req, res) => {
    try { const r = await tagupMod.exportRows(req.session, { status: req.query.status || "pending" }); if (r.error) return res.status(400).json({ error: r.error }); xlsxOut(res, r.headers, r.rows, r.filename); }
    catch (e) { res.status(500).json({ error: String((e && e.message) || e) }); }
  });

  app.get("/api/onboarding", requireOrg, wrap(async (req) => ({ ok: true, state: await tagupMod.onboarding(req.session) })));
  app.post("/api/onboarding/dismiss", requireOrg, wrap(async (req) => tagupMod.dismissOnboarding(req.session)));

  return app;
}

module.exports = { createApp };
