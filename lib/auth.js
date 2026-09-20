/* auth.js -- tagup's own signup/login. No PIN pad, no borrowed sessions:
   this is a real product a stranger can sign up for, so it needs email +
   password, verification, reset, and a session a browser can hold onto.

   create(deps): { pool, jwt, bcrypt, sign_secret, sendEmail } -- sendEmail is
   injectable so tests never touch a real mail provider, and so the product
   can start with "log the link to the console" before a mail service is
   wired in (which is exactly how a new signup can work on day one without
   waiting on that integration).
*/
"use strict";
const crypto = require("crypto");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function clip(v, n) { return String(v == null ? "" : v).trim().slice(0, n); }
function slugify(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "org";
}
function newToken() { return crypto.randomBytes(24).toString("base64url"); }
function newId() { return crypto.randomUUID(); }

function create(deps) {
  const D = deps;
  const pool = () => D.pool;

  async function uniqueSlug(base) {
    const root = slugify(base);
    let slug = root, n = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const r = await pool().query("SELECT 1 FROM orgs WHERE slug = $1", [slug]);
      if (!r.rows.length) return slug;
      n++; slug = root + "-" + n;
    }
  }

  function issueSession(user) {
    return D.jwt.sign({ uid: user.id, email: user.email }, D.sign_secret, { expiresIn: "30d" });
  }
  async function verifySession(token) {
    try {
      const p = D.jwt.verify(token, D.sign_secret);
      const r = await pool().query("SELECT id, email, name, email_verified FROM users WHERE id = $1", [p.uid]);
      return r.rows[0] || null;
    } catch (e) { return null; }
  }

  /* ---------------- signup ---------------- */
  // One call creates the user, the org, and makes them owner -- the whole
  // "no setup required, start now" promise from a single form. orgName is
  // optional; a bare signup gets "<name>'s Team" and can rename later.
  async function signup(body) {
    const b = body || {};
    const email = clip(b.email, 200).toLowerCase();
    const password = String(b.password || "");
    const name = clip(b.name, 100);
    const orgName = clip(b.orgName, 100);
    if (!EMAIL_RE.test(email)) return { error: "enter a valid email address" };
    if (password.length < 8) return { error: "password must be at least 8 characters" };
    if (!name) return { error: "your name is required" };
    const dup = await pool().query("SELECT 1 FROM users WHERE email = $1", [email]);
    if (dup.rows.length) return { error: "an account with that email already exists -- try signing in, or reset your password" };
    const hash = await D.bcrypt.hash(password, 10);
    const verifyToken = newToken();
    const u = await pool().query(
      "INSERT INTO users (id, email, password_hash, name, verify_token) VALUES ($1,$2,$3,$4,$5) RETURNING id, email, name, email_verified",
      [newId(), email, hash, name, verifyToken]);
    const user = u.rows[0];
    const slug = await uniqueSlug(orgName || name + "s-team");
    const o = await pool().query(
      "INSERT INTO orgs (id, slug, name, plan, trial_ends_at) VALUES ($1,$2,$3,'trial', now() + interval '14 days') RETURNING id, slug, name, plan, trial_ends_at",
      [newId(), slug, orgName || name + "'s Team"]);
    const org = o.rows[0];
    await pool().query("INSERT INTO org_members (org_id, user_id, role) VALUES ($1,$2,'owner')", [org.id, user.id]);
    await pool().query("INSERT INTO org_onboarding (org_id) VALUES ($1)", [org.id]);
    await D.sendEmail(email, "Verify your tagup account", verifyUrl(verifyToken));
    return { ok: true, token: issueSession(user), user, org };
  }
  function verifyUrl(token) { return (D.appUrl || "") + "/verify?token=" + encodeURIComponent(token); }

  async function verifyEmail(token) {
    if (!token) return { error: "missing token" };
    const r = await pool().query("UPDATE users SET email_verified = true, verify_token = NULL WHERE verify_token = $1 RETURNING id", [token]);
    if (!r.rows.length) return { error: "that link has expired or was already used" };
    return { ok: true };
  }

  async function login(body) {
    const b = body || {};
    const email = clip(b.email, 200).toLowerCase();
    const password = String(b.password || "");
    const r = await pool().query("SELECT id, email, name, password_hash, email_verified FROM users WHERE email = $1", [email]);
    if (!r.rows.length) return { error: "invalid email or password" };
    const user = r.rows[0];
    const ok = await D.bcrypt.compare(password, user.password_hash);
    if (!ok) return { error: "invalid email or password" };
    await pool().query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);
    delete user.password_hash;
    const orgs = await orgsFor(user.id);
    return { ok: true, token: issueSession(user), user, orgs };
  }

  async function orgsFor(userId) {
    const r = await pool().query(
      "SELECT o.id, o.slug, o.name, o.plan, o.trial_ends_at, m.role FROM orgs o JOIN org_members m ON m.org_id = o.id WHERE m.user_id = $1 ORDER BY m.joined_at", [userId]);
    return r.rows;
  }

  /* ---------------- password reset ---------------- */
  async function requestReset(body) {
    const email = clip((body || {}).email, 200).toLowerCase();
    // Never reveal whether the address exists -- the same response either way.
    const r = await pool().query("SELECT id FROM users WHERE email = $1", [email]);
    if (r.rows.length) {
      const token = newToken();
      await pool().query("UPDATE users SET reset_token = $2, reset_expires = now() + interval '1 hour' WHERE id = $1", [r.rows[0].id, token]);
      await D.sendEmail(email, "Reset your tagup password", (D.appUrl || "") + "/reset?token=" + encodeURIComponent(token));
    }
    return { ok: true, note: "if that address has an account, a reset link was sent" };
  }
  async function resetPassword(body) {
    const b = body || {};
    const token = clip(b.token, 200);
    const password = String(b.password || "");
    if (password.length < 8) return { error: "password must be at least 8 characters" };
    const r = await pool().query("SELECT id FROM users WHERE reset_token = $1 AND reset_expires > now()", [token]);
    if (!r.rows.length) return { error: "that reset link has expired -- request a new one" };
    const hash = await D.bcrypt.hash(password, 10);
    await pool().query("UPDATE users SET password_hash = $2, reset_token = NULL, reset_expires = NULL WHERE id = $1", [r.rows[0].id, hash]);
    return { ok: true };
  }

  /* ---------------- org membership ---------------- */
  function isMember(session) { return !!(session && session.membership); }
  function requireRole(session, roles) { return !!(session && session.membership && roles.indexOf(session.membership.role) !== -1); }

  // Attaches org membership onto a verified user for one org_id -- the
  // multi-tenant equivalent of req.session.branch: every request scopes to
  // exactly one org, chosen by the caller (subdomain, header, or the UI's
  // org switcher), never inferred.
  async function membershipFor(userId, orgId) {
    const r = await pool().query("SELECT role, team_id, rep_no FROM org_members WHERE org_id = $1 AND user_id = $2", [orgId, userId]);
    return r.rows[0] || null;
  }

  async function inviteMember(session, body) {
    if (!requireRole(session, ["owner", "admin"])) return { error: "only an owner or admin invites teammates" };
    const b = body || {};
    const email = clip(b.email, 200).toLowerCase();
    const role = ["admin", "manager", "rep"].indexOf(b.role) !== -1 ? b.role : "rep";
    if (!EMAIL_RE.test(email)) return { error: "enter a valid email address" };
    const existing = await pool().query("SELECT u.id FROM users u JOIN org_members m ON m.user_id = u.id AND m.org_id = $2 WHERE u.email = $1", [email, session.org.id]);
    if (existing.rows.length) return { error: "already on this team" };
    const token = newToken();
    const r = await pool().query(
      "INSERT INTO org_invites (id, org_id, email, role, team_id, token, invited_by, rep_no) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
      [newId(), session.org.id, email, role, b.teamId || null, token, session.user.id, clip(b.repNo, 40) || null]);
    await D.sendEmail(email, session.org.name + " invited you to tagup", (D.appUrl || "") + "/accept-invite?token=" + encodeURIComponent(token));
    await pool().query("UPDATE org_onboarding SET invited_team = true WHERE org_id = $1", [session.org.id]);
    return { ok: true, inviteId: r.rows[0].id };
  }
  async function listMembers(session) {
    const m = await pool().query("SELECT u.id, u.email, u.name, m.role, m.team_id, m.rep_no, m.joined_at, u.last_login_at FROM org_members m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1 ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, u.name", [session.org.id]);
    const inv = await pool().query("SELECT id, email, role, team_id, rep_no, created_at, expires_at FROM org_invites WHERE org_id = $1 AND accepted_at IS NULL AND expires_at > now() ORDER BY created_at DESC", [session.org.id]);
    return { ok: true, members: m.rows.map((r) => ({ id: r.id, email: r.email, name: r.name, role: r.role, teamId: r.team_id, repNo: r.rep_no || null, joinedAt: r.joined_at, lastLoginAt: r.last_login_at })),
             invites: inv.rows.map((r) => ({ id: r.id, email: r.email, role: r.role, teamId: r.team_id, repNo: r.rep_no || null, createdAt: r.created_at, expiresAt: r.expires_at })) };
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
    const curRow = (await pool().query("SELECT team_id, rep_no FROM org_members WHERE org_id = $1 AND user_id = $2", [session.org.id, userId])).rows[0] || {};
    await pool().query("UPDATE org_members SET role = $3, team_id = $4, rep_no = $5 WHERE org_id = $1 AND user_id = $2", [session.org.id, userId, role, b.teamId === undefined ? curRow.team_id || null : (b.teamId || null), b.repNo === undefined ? curRow.rep_no || null : (clip(b.repNo, 40) || null)]);
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
  async function acceptInvite(body, currentUserId) {
    const token = clip((body || {}).token, 200);
    const r = await pool().query("SELECT * FROM org_invites WHERE token = $1 AND accepted_at IS NULL AND expires_at > now()", [token]);
    if (!r.rows.length) return { error: "that invite has expired or was already used" };
    const inv = r.rows[0];
    let userId = currentUserId;
    if (!userId) {
      // Accepting from a fresh signup: create the account from the invite's own form fields.
      const b = body || {};
      const name = clip(b.name, 100), password = String(b.password || "");
      if (!name) return { error: "your name is required" };
      if (password.length < 8) return { error: "password must be at least 8 characters" };
      const dup = await pool().query("SELECT id FROM users WHERE email = $1", [inv.email]);
      if (dup.rows.length) userId = dup.rows[0].id;
      else {
        const hash = await D.bcrypt.hash(password, 10);
        const u = await pool().query("INSERT INTO users (id, email, password_hash, name, email_verified) VALUES ($1,$2,$3,$4,true) RETURNING id", [newId(), inv.email, hash, name]);
        userId = u.rows[0].id;
      }
    }
    await pool().query("INSERT INTO org_members (org_id, user_id, role, team_id, invited_by, rep_no) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (org_id, user_id) DO NOTHING",
      [inv.org_id, userId, inv.role, inv.team_id, inv.invited_by, inv.rep_no || null]);
    await pool().query("UPDATE org_invites SET accepted_at = now() WHERE id = $1", [inv.id]);
    const u = await pool().query("SELECT id, email, name, email_verified FROM users WHERE id = $1", [userId]);
    return { ok: true, token: issueSession(u.rows[0]), user: u.rows[0] };
  }

  return { signup, verifyEmail, login, orgsFor, requestReset, resetPassword, issueSession, verifySession, membershipFor, isMember, requireRole, inviteMember, acceptInvite, uniqueSlug, slugify, listMembers, setMember, revokeInvite, updateOrg };
}

module.exports = { create, slugify, EMAIL_RE };
