"use strict";
/* Accounts stand on their own: address + sales rep + rep # on every store,
   rep # on every member/invite, and a rep's picker scoped to their accounts.
   Anchored, single-match-or-abort, sentinel per file. */
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

/* ---- schema ---- */
patch("schema.sql", "stores ADD COLUMN IF NOT EXISTS address", [
  [`CREATE INDEX IF NOT EXISTS stores_org_idx ON stores (org_id, active);`,
`-- Added 2026-09-20: an account list stands on its own -- address, and the
-- sales rep who owns the account (name + number, as the org's system prints
-- them). A member's rep_no is what maps a login to those accounts.
ALTER TABLE stores ADD COLUMN IF NOT EXISTS address  text;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS rep_name text;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS rep_no   text;
ALTER TABLE org_members ADD COLUMN IF NOT EXISTS rep_no text;
ALTER TABLE org_invites ADD COLUMN IF NOT EXISTS rep_no text;
CREATE INDEX IF NOT EXISTS stores_org_rep_idx ON stores (org_id, rep_no);
CREATE INDEX IF NOT EXISTS stores_org_idx ON stores (org_id, active);`, "columns"],
]);

/* ---- tagup.js ---- */
patch("lib/tagup.js", "repScopeOf", [
  [`const STORE_COLS = {
  name: ["name", "store", "store name", "account", "account name", "customer", "customer name", "location", "dba"],
  storeNo: ["store #", "store no", "store number", "#", "number", "account #", "account no", "account number", "customer #", "customer no", "id", "store id", "cust #"],
  city: ["city", "town", "market"],
  chain: ["chain", "banner", "parent", "call point", "chain name", "group", "customer group"],
  team: ["team", "route", "territory", "district"],
};`,
`const STORE_COLS = {
  name: ["name", "store", "store name", "account", "account name", "customer", "customer name", "location", "dba", "retailer", "retail account"],
  storeNo: ["store #", "store no", "store number", "#", "number", "account #", "account no", "account number", "acct #", "acct no", "acct", "customer #", "customer no", "id", "store id", "cust #", "cust no"],
  address: ["address", "street", "street address", "address 1", "address1", "addr", "location address", "ship to address", "shipping address"],
  city: ["city", "town", "market"],
  chain: ["chain", "banner", "parent", "call point", "chain name", "group", "customer group"],
  repName: ["sales rep", "rep", "rep name", "sales rep name", "salesman", "salesperson", "sales person", "account rep", "sales representative", "representative", "seller"],
  repNo: ["sales rep #", "sales rep no", "sales rep number", "rep #", "rep no", "rep number", "rep id", "salesman #", "salesman no", "salesman number", "route", "route #", "route no", "route number", "sales rep id", "rep code", "sales rep code"],
  team: ["team", "territory", "district", "branch", "region"],
};`, "columns"],
  [`        out.push({ name, storeNo: storeNo || null, city: clip(get("city"), 60), chain: clip(get("chain"), 80), team: clip(get("team"), 60) });`,
   `        let repNo = clip(get("repNo"), 40);
        if (repNo && /^\\d+(\\.0+)?$/.test(repNo)) repNo = String(parseInt(repNo, 10));   // 21060.0 from a numeric cell -> 21060
        out.push({ name, storeNo: storeNo || null, address: clip(get("address"), 160), city: clip(get("city"), 60), chain: clip(get("chain"), 80), repName: clip(get("repName"), 80), repNo: repNo || null, team: clip(get("team"), 60) });`, "parse row"],
  [`  return { error: "no header row found -- the sheet needs a Name (or Store / Account) column; Store #, City and Chain are read when present", sheets: (sheets || []).map((s) => s.name) };`,
   `  return { error: "no header row found -- the sheet needs an Account Name (or Store / Customer) column; Account #, Address, City, Chain, Sales Rep and Sales Rep # are read when present", sheets: (sheets || []).map((s) => s.name) };`, "parse error copy"],
  [`function storeOut(r) {
  return { id: r.id, teamId: r.team_id || null, name: r.name, storeNo: r.store_no || null, city: r.city || "",
           chainId: r.chain_id || null, chainRaw: r.chain_raw || "", active: r.active !== false };
}`,
`function storeOut(r) {
  return { id: r.id, teamId: r.team_id || null, name: r.name, storeNo: r.store_no || null, address: r.address || "", city: r.city || "",
           chainId: r.chain_id || null, chainRaw: r.chain_raw || "", repName: r.rep_name || "", repNo: r.rep_no || null, active: r.active !== false };
}
const normRep = (s) => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// A rep sees THEIR accounts: the stores whose rep_no is the member's rep_no,
// else (no number on the member) the stores whose rep_name reads as their
// own name. If neither names anything, they see every store -- a login the
// account list does not know yet must never see an empty picker.
function repScopeOf(session, stores) {
  const m = session.membership || {};
  if ((m.role || "") !== "rep") return { stores, scope: "all" };
  const hasReps = stores.some((s) => s.repNo || s.repName);
  if (!hasReps) return { stores, scope: "all", reason: "no-reps-on-list" };
  if (m.rep_no) { const mine = stores.filter((s) => s.repNo === String(m.rep_no)); if (mine.length) return { stores: mine, scope: "mine", repNo: m.rep_no }; }
  const nm = normRep(session.user && session.user.name);
  if (nm) { const mine = stores.filter((s) => normRep(s.repName) === nm); if (mine.length) return { stores: mine, scope: "mine", byName: true }; }
  return { stores, scope: "all", reason: m.rep_no ? "rep-no-unmatched" : "unassigned" };
}`, "storeOut + repScope"],
  [`    const r = await pool().query("SELECT s.*, c.label AS chain_label FROM stores s LEFT JOIN chains c ON c.id = s.chain_id WHERE " + w + " ORDER BY s.name LIMIT 2000", params);
    const stores = r.rows.map((x) => Object.assign(storeOut(x), { chainLabel: x.chain_label || x.chain_raw || "" }));
    if (o.withStyles) {
      const styles = await stylesFor(session.org.id).catch(() => []);
      stores.forEach((s) => { const t = resolveStyle(styles, s.chainId, null, "tag"); const c = resolveStyle(styles, s.chainId, null, "case_card"); s.styleId = t.id; s.styleName = t.name; s.caseCardStyleId = c.id; s.caseCardStyleName = c.name; });
    }
    return { ok: true, stores };`,
`    const r = await pool().query("SELECT s.*, c.label AS chain_label FROM stores s LEFT JOIN chains c ON c.id = s.chain_id WHERE " + w + " ORDER BY s.name LIMIT 5000", params);
    let stores = r.rows.map((x) => Object.assign(storeOut(x), { chainLabel: x.chain_label || x.chain_raw || "" }));
    const sc = o.all ? { stores, scope: "all" } : repScopeOf(session, stores);
    stores = sc.stores;
    if (o.withStyles) {
      const styles = await stylesFor(session.org.id).catch(() => []);
      stores.forEach((s) => { const t = resolveStyle(styles, s.chainId, null, "tag"); const c = resolveStyle(styles, s.chainId, null, "case_card"); s.styleId = t.id; s.styleName = t.name; s.caseCardStyleId = c.id; s.caseCardStyleName = c.name; });
    }
    return { ok: true, stores, scope: sc.scope, scopeReason: sc.reason || null, repNo: sc.repNo || null };`, "listStores scope"],
  [`      const r = await pool().query("UPDATE stores SET name=$3, store_no=$4, city=$5, chain_id=$6, chain_raw=$7, team_id=$8, updated_at=now() WHERE id=$1 AND org_id=$2 RETURNING *",
        [b.id, session.org.id, name, clip(b.storeNo, 40) || null, clip(b.city, 60), chainId, clip(b.chain, 80), b.teamId || null]);`,
   `      const r = await pool().query("UPDATE stores SET name=$3, store_no=$4, city=$5, chain_id=$6, chain_raw=$7, team_id=$8, address=$9, rep_name=$10, rep_no=$11, updated_at=now() WHERE id=$1 AND org_id=$2 RETURNING *",
        [b.id, session.org.id, name, clip(b.storeNo, 40) || null, clip(b.city, 60), chainId, clip(b.chain, 80), b.teamId || null, clip(b.address, 160), clip(b.repName, 80), clip(b.repNo, 40) || null]);`, "upsert update"],
  [`    const r = await pool().query("INSERT INTO stores (id, org_id, team_id, name, store_no, city, chain_id, chain_raw) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [newId(), session.org.id, b.teamId || null, name, clip(b.storeNo, 40) || null, clip(b.city, 60), chainId, clip(b.chain, 80)]);`,
   `    const r = await pool().query("INSERT INTO stores (id, org_id, team_id, name, store_no, city, chain_id, chain_raw, address, rep_name, rep_no) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
      [newId(), session.org.id, b.teamId || null, name, clip(b.storeNo, 40) || null, clip(b.city, 60), chainId, clip(b.chain, 80), clip(b.address, 160), clip(b.repName, 80), clip(b.repNo, 40) || null]);`, "upsert insert"],
  [`      if (existing.rows.length) { await pool().query("UPDATE stores SET name=$3, city=$4, chain_id=$5, chain_raw=$6, team_id=coalesce($7, team_id), active=true, updated_at=now() WHERE id=$1 AND org_id=$2", [existing.rows[0].id, session.org.id, name, clip(row.city, 60), chainId, clip(row.chain, 80), teamId]); updated++; }
      else { await pool().query("INSERT INTO stores (id, org_id, name, store_no, city, chain_id, chain_raw, team_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [newId(), session.org.id, name, storeNo, clip(row.city, 60), chainId, clip(row.chain, 80), teamId]); created++; }`,
   `      const address = clip(row.address, 160), repName = clip(row.repName, 80), repNo = clip(row.repNo, 40) || null;
      if (existing.rows.length) { await pool().query("UPDATE stores SET name=$3, city=$4, chain_id=$5, chain_raw=$6, team_id=coalesce($7, team_id), address=$8, rep_name=$9, rep_no=$10, active=true, updated_at=now() WHERE id=$1 AND org_id=$2", [existing.rows[0].id, session.org.id, name, clip(row.city, 60), chainId, clip(row.chain, 80), teamId, address, repName, repNo]); updated++; }
      else { await pool().query("INSERT INTO stores (id, org_id, name, store_no, city, chain_id, chain_raw, team_id, address, rep_name, rep_no) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [newId(), session.org.id, name, storeNo, clip(row.city, 60), chainId, clip(row.chain, 80), teamId, address, repName, repNo]); created++; }`, "import rows"],
  // the reps the account list names, matched to members
  [`  async function retireStore(session, id, restore) {`,
`  // The sales reps the account list names -- number, name, how many
  // accounts -- and which member each maps to. Drives Team's "not yet
  // invited" card and the Rep # picker on a member.
  async function repsOnList(session) {
    const r = await pool().query("SELECT rep_no, rep_name, count(*)::int AS n FROM stores WHERE org_id = $1 AND active AND (rep_no IS NOT NULL OR (rep_name IS NOT NULL AND rep_name <> '')) GROUP BY rep_no, rep_name ORDER BY n DESC", [session.org.id]);
    const m = await pool().query("SELECT m.user_id, m.rep_no, u.name FROM org_members m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1", [session.org.id]);
    const byNo = {}, byName = {};
    m.rows.forEach((x) => { if (x.rep_no) byNo[String(x.rep_no)] = x; byName[normRep(x.name)] = x; });
    const reps = r.rows.map((x) => {
      const hit = (x.rep_no && byNo[String(x.rep_no)]) || (x.rep_name && byName[normRep(x.rep_name)]) || null;
      return { repNo: x.rep_no || null, repName: x.rep_name || "", accounts: x.n, memberId: hit ? hit.user_id : null, memberName: hit ? hit.name : null };
    });
    return { ok: true, reps, unmatched: reps.filter((x) => !x.memberId) };
  }
  async function retireStore(session, id, restore) {`, "repsOnList"],
  [`  return { listTeams, createTeam, chainsForOrg, listStores, upsertStore, importStores, retireStore,`,
   `  return { listTeams, createTeam, chainsForOrg, listStores, upsertStore, importStores, retireStore, repsOnList,`, "export"],
]);

/* ---- auth.js: rep_no on members + invites ---- */
patch("lib/auth.js", "rep_no", [
  [`    const r = await pool().query("SELECT role, team_id FROM org_members WHERE org_id = $1 AND user_id = $2", [orgId, userId]);`,
   `    const r = await pool().query("SELECT role, team_id, rep_no FROM org_members WHERE org_id = $1 AND user_id = $2", [orgId, userId]);`, "membershipFor"],
  [`    const m = await pool().query("SELECT u.id, u.email, u.name, m.role, m.team_id, m.joined_at, u.last_login_at FROM org_members m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1 ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, u.name", [session.org.id]);
    const inv = await pool().query("SELECT id, email, role, team_id, created_at, expires_at FROM org_invites WHERE org_id = $1 AND accepted_at IS NULL AND expires_at > now() ORDER BY created_at DESC", [session.org.id]);
    return { ok: true, members: m.rows.map((r) => ({ id: r.id, email: r.email, name: r.name, role: r.role, teamId: r.team_id, joinedAt: r.joined_at, lastLoginAt: r.last_login_at })),
             invites: inv.rows.map((r) => ({ id: r.id, email: r.email, role: r.role, teamId: r.team_id, createdAt: r.created_at, expiresAt: r.expires_at })) };`,
   `    const m = await pool().query("SELECT u.id, u.email, u.name, m.role, m.team_id, m.rep_no, m.joined_at, u.last_login_at FROM org_members m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1 ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, u.name", [session.org.id]);
    const inv = await pool().query("SELECT id, email, role, team_id, rep_no, created_at, expires_at FROM org_invites WHERE org_id = $1 AND accepted_at IS NULL AND expires_at > now() ORDER BY created_at DESC", [session.org.id]);
    return { ok: true, members: m.rows.map((r) => ({ id: r.id, email: r.email, name: r.name, role: r.role, teamId: r.team_id, repNo: r.rep_no || null, joinedAt: r.joined_at, lastLoginAt: r.last_login_at })),
             invites: inv.rows.map((r) => ({ id: r.id, email: r.email, role: r.role, teamId: r.team_id, repNo: r.rep_no || null, createdAt: r.created_at, expiresAt: r.expires_at })) };`, "listMembers"],
  [`    await pool().query("UPDATE org_members SET role = $3, team_id = $4 WHERE org_id = $1 AND user_id = $2", [session.org.id, userId, role, b.teamId === undefined ? cur.rows[0].team_id || null : (b.teamId || null)]);`,
   `    const curRow = (await pool().query("SELECT team_id, rep_no FROM org_members WHERE org_id = $1 AND user_id = $2", [session.org.id, userId])).rows[0] || {};
    await pool().query("UPDATE org_members SET role = $3, team_id = $4, rep_no = $5 WHERE org_id = $1 AND user_id = $2", [session.org.id, userId, role, b.teamId === undefined ? curRow.team_id || null : (b.teamId || null), b.repNo === undefined ? curRow.rep_no || null : (clip(b.repNo, 40) || null)]);`, "setMember repNo"],
  [`      "INSERT INTO org_invites (id, org_id, email, role, team_id, token, invited_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [newId(), session.org.id, email, role, b.teamId || null, token, session.user.id]);`,
   `      "INSERT INTO org_invites (id, org_id, email, role, team_id, token, invited_by, rep_no) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
      [newId(), session.org.id, email, role, b.teamId || null, token, session.user.id, clip(b.repNo, 40) || null]);`, "invite repNo"],
  [`    await pool().query("INSERT INTO org_members (org_id, user_id, role, team_id, invited_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (org_id, user_id) DO NOTHING",
      [inv.org_id, userId, inv.role, inv.team_id, inv.invited_by]);`,
   `    await pool().query("INSERT INTO org_members (org_id, user_id, role, team_id, invited_by, rep_no) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (org_id, user_id) DO NOTHING",
      [inv.org_id, userId, inv.role, inv.team_id, inv.invited_by, inv.rep_no || null]);`, "accept repNo"],
]);

/* ---- server.js ---- */
patch("server.js", "/api/orgs/:id/reps", [
  [`  app.get("/api/orgs/:id/members", requireOrg, wrap(async (req) => authMod.listMembers(req.session)));`,
   `  app.get("/api/orgs/:id/members", requireOrg, wrap(async (req) => authMod.listMembers(req.session)));
  app.get("/api/orgs/:id/reps", requireOrg, wrap(async (req) => (tagupMod.canManage(req.session) ? tagupMod.repsOnList(req.session) : { error: "forbidden", status: 403 })));`, "reps route"],
  [`  app.get("/api/stores", requireOrg, wrap(async (req) => tagupMod.listStores(req.session, { withStyles: req.query.styles === "1" })));`,
   `  app.get("/api/stores", requireOrg, wrap(async (req) => tagupMod.listStores(req.session, { withStyles: req.query.styles === "1", all: req.query.all === "1" && tagupMod.canManage(req.session) })));`, "stores all"],
]);

/* ---- tagup-ui.jsx: the rep's picker shows address + scope note ---- */
patch("src/tagup-ui.jsx", "scopeNote", [
  [`  const [accounts, setAccounts] = useState(null);
  const [styles, setStyles] = useState([]);`,
   `  const [accounts, setAccounts] = useState(null);
  const [scopeNote, setScopeNote] = useState("");
  const [styles, setStyles] = useState([]);`, "state"],
  [`    jget(ui, "/api/stores?styles=1").then((r) => setAccounts((r && r.stores) || [])).catch(() => setAccounts([]));
    jget(ui, "/api/setup").then((r) => setStyles((r && r.styles) || [])).catch(() => {});
  }, []);

  function startNew()`,
   `    jget(ui, "/api/stores?styles=1").then((r) => { setAccounts((r && r.stores) || []); setScopeNote(r && r.scope === "all" && r.scopeReason && r.scopeReason !== "no-reps-on-list" ? (r.scopeReason === "rep-no-unmatched" ? "Your Rep # does not match any account on the list yet, so every store is shown. Ask your admin to check it under Team." : "The account list does not name you yet, so every store is shown. Ask your admin to set your Rep # under Team.") : ""); }).catch(() => setAccounts([]));
    jget(ui, "/api/setup").then((r) => setStyles((r && r.styles) || [])).catch(() => {});
  }, []);

  function startNew()`, "load scope"],
  [`    const list = (accounts || []).filter((a) => !q || (a.name + " " + a.city + " " + a.chainLabel).toLowerCase().includes(q.toLowerCase()));`,
   `    const list = (accounts || []).filter((a) => !q || (a.name + " " + (a.storeNo || "") + " " + (a.address || "") + " " + a.city + " " + a.chainLabel).toLowerCase().includes(q.toLowerCase()));`, "search fields"],
  [`          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your route" style={Object.assign(inputStyle(ui), { paddingLeft: 38 })} />
        </div>`,
   `          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your accounts" style={Object.assign(inputStyle(ui), { paddingLeft: 38 })} />
        </div>
        {scopeNote && <div style={{ background: TB.signalSoft, color: "#8A3A08", borderRadius: 10, padding: "8px 12px", fontSize: 12.5, fontWeight: 600, marginBottom: 10, lineHeight: 1.45 }}>{scopeNote}</div>}`, "scope note"],
  [`<div style={{ fontSize: 12, color: C.sub }}>{a.city}{a.city ? " · " : ""}{a.storeNo ? '#' + a.storeNo : ''}</div></div>`,
   `<div style={{ fontSize: 12, color: C.sub }}>{[a.address, a.city].filter(Boolean).join(", ")}{(a.address || a.city) && a.storeNo ? " · " : ""}{a.storeNo ? '#' + a.storeNo : ''}</div></div>`, "address line"],
  [`title="WHICH STORE?" sub="The chain's tag style follows the store."`, `title="WHICH ACCOUNT?" sub="The chain's tag style follows the account."`, "title"],
]);

/* ---- admin.jsx: Stores + Team ---- */
patch("src/admin.jsx", "repsOnList", [
  [`  const [msg, setMsg] = useState("");
  function load() { api.get("/api/stores?styles=1").then((r) => setData(r)).catch(() => setData({ error: "Couldn't load stores." }));`,
   `  const [msg, setMsg] = useState("");
  function load() { api.get("/api/stores?styles=1&all=1").then((r) => setData(r)).catch(() => setData({ error: "Couldn't load stores." }));`, "stores all"],
  [`    <PageTitle title="Stores" sub="Every store a rep can ask for a tag for. The chain decides which style prints; the team decides which manager sees it." right={canAdmin && <><Ghost small onClick={() => setUpload(true)}><L.Upload size={15} /> Upload a list</Ghost><Primary small onClick={() => setEdit({ name: "", storeNo: "", city: "", chain: "", teamId: "" })}><L.Plus size={15} /> Add a store</Primary></>} />`,
   `    <PageTitle title="Accounts" sub="Every account a rep can ask for a tag for. The sales rep on the row is whose picker it shows in; the chain decides which style prints." right={canAdmin && <><Ghost small onClick={() => setUpload(true)}><L.Upload size={15} /> Upload account list</Ghost><Primary small onClick={() => setEdit({ name: "", storeNo: "", address: "", city: "", chain: "", repName: "", repNo: "", teamId: "" })}><L.Plus size={15} /> Add an account</Primary></>} />`, "title"],
  [`      <L.Store size={36} color={TB.kraft} /><div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 17, color: TB.ink, marginTop: 8 }}>No stores yet</div>
      <div style={{ fontSize: 13.5, color: TB.slate, marginTop: 4, maxWidth: 420, margin: "4px auto 0" }}>Upload the account list you already have -- a spreadsheet with a Name column, plus Store #, City and Chain when you have them -- or add one by hand to try it.</div>
      {canAdmin && <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14 }}><Primary small onClick={() => setUpload(true)}><L.Upload size={15} /> Upload a list</Primary><Ghost small onClick={() => setEdit({ name: "", storeNo: "", city: "", chain: "", teamId: "" })}>Add one store</Ghost></div>}`,
   `      <L.Store size={36} color={TB.kraft} /><div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 17, color: TB.ink, marginTop: 8 }}>No accounts yet</div>
      <div style={{ fontSize: 13.5, color: TB.slate, marginTop: 4, maxWidth: 460, margin: "4px auto 0" }}>Upload the account list you already have: <b>Account Name</b>, <b>Account #</b>, <b>Address</b>, <b>Sales Rep</b> and <b>Sales Rep #</b> (City and Chain too, when you have them). The header can be on any row. Or add one by hand to try it.</div>
      {canAdmin && <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14 }}><Primary small onClick={() => setUpload(true)}><L.Upload size={15} /> Upload account list</Primary><Ghost small onClick={() => setEdit({ name: "", storeNo: "", address: "", city: "", chain: "", repName: "", repNo: "", teamId: "" })}>Add one account</Ghost></div>}`, "empty state"],
  [`      <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 360 }}><span style={{ position: "absolute", left: 11, top: 11 }}><L.Search size={16} color={C.mute} /></span><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search stores" style={{ paddingLeft: 34 }} /></div>
      <span style={{ fontSize: 12.5, color: TB.slate }}>{stores.length} store{stores.length === 1 ? "" : "s"} · {chains.length} chain{chains.length === 1 ? "" : "s"}</span>`,
   `      <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 360 }}><span style={{ position: "absolute", left: 11, top: 11 }}><L.Search size={16} color={C.mute} /></span><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search accounts, reps, addresses" style={{ paddingLeft: 34 }} /></div>
      <span style={{ fontSize: 12.5, color: TB.slate }}>{stores.length} account{stores.length === 1 ? "" : "s"} · {chains.length} chain{chains.length === 1 ? "" : "s"} · {new Set(stores.map((s) => s.repNo || s.repName).filter(Boolean)).size} rep{new Set(stores.map((s) => s.repNo || s.repName).filter(Boolean)).size === 1 ? "" : "s"}</span>`, "counts"],
  [`  const shown = stores.filter((s) => !q || (s.name + " " + (s.storeNo || "") + " " + s.city + " " + s.chainLabel).toLowerCase().includes(q.toLowerCase()));`,
   `  const shown = stores.filter((s) => !q || (s.name + " " + (s.storeNo || "") + " " + (s.address || "") + " " + s.city + " " + s.chainLabel + " " + (s.repName || "") + " " + (s.repNo || "")).toLowerCase().includes(q.toLowerCase()));`, "search"],
  [`    {stores.length > 0 && <Table cols={["Store", "#", "City", "Chain", "Team", "Tag style", canAdmin ? "" : null].filter((x) => x != null)} rows={shown.slice(0, 300).map((s) => <tr key={s.id}>
      <td style={td}><b>{s.name}</b></td><td style={Object.assign({ color: C.mute }, td)}>{s.storeNo || "—"}</td><td style={td}>{s.city}</td>
      <td style={td}><Chip ui={ui} small bg={s.chainId ? TB.signalSoft : C.lineCool}>{s.chainLabel || "Independent"}</Chip></td>
      <td style={td}>{teamName(s.teamId) || <span style={{ color: C.mute }}>—</span>}</td>
      <td style={Object.assign({ fontSize: 12.5, color: TB.slate }, td)}>{s.styleName}{s.caseCardStyleName && s.caseCardStyleName !== s.styleName ? " · " + s.caseCardStyleName : ""}</td>
      {canAdmin && <td style={Object.assign({ whiteSpace: "nowrap", textAlign: "right" }, td)}><button onClick={() => setEdit({ id: s.id, name: s.name, storeNo: s.storeNo || "", city: s.city, chain: s.chainRaw || "", teamId: s.teamId || "" })} style={iconBtn}><L.Pencil size={15} /></button><button onClick={() => retire(s)} style={iconBtn} title="Retire"><L.Trash2 size={15} /></button></td>}
    </tr>)} empty={q ? "No store matches." : "No stores yet."} />}`,
   `    {stores.length > 0 && <Table cols={["Account", "Acct #", "Address", "Chain", "Sales rep", "Tag style", canAdmin ? "" : null].filter((x) => x != null)} rows={shown.slice(0, 300).map((s) => <tr key={s.id}>
      <td style={td}><b>{s.name}</b>{teamName(s.teamId) ? <div style={{ fontSize: 11.5, color: C.mute }}>{teamName(s.teamId)}</div> : null}</td><td style={Object.assign({ color: C.mute }, td)}>{s.storeNo || "—"}</td>
      <td style={Object.assign({ fontSize: 12.5, color: TB.slate }, td)}>{s.address}{s.address && s.city ? ", " : ""}{s.city}</td>
      <td style={td}><Chip ui={ui} small bg={s.chainId ? TB.signalSoft : C.lineCool}>{s.chainLabel || "Independent"}</Chip></td>
      <td style={td}>{s.repName || s.repNo ? <><span style={{ fontWeight: 600 }}>{s.repName || "—"}</span>{s.repNo && <span style={{ color: C.mute, fontSize: 12 }}> #{s.repNo}</span>}</> : <span style={{ color: C.mute }}>—</span>}</td>
      <td style={Object.assign({ fontSize: 12.5, color: TB.slate }, td)}>{s.styleName}{s.caseCardStyleName && s.caseCardStyleName !== s.styleName ? " · " + s.caseCardStyleName : ""}</td>
      {canAdmin && <td style={Object.assign({ whiteSpace: "nowrap", textAlign: "right" }, td)}><button onClick={() => setEdit({ id: s.id, name: s.name, storeNo: s.storeNo || "", address: s.address || "", city: s.city, chain: s.chainRaw || "", repName: s.repName || "", repNo: s.repNo || "", teamId: s.teamId || "" })} style={iconBtn}><L.Pencil size={15} /></button><button onClick={() => retire(s)} style={iconBtn} title="Retire"><L.Trash2 size={15} /></button></td>}
    </tr>)} empty={q ? "No account matches." : "No accounts yet."} />}`, "table"],
  [`    {upload && <StoreUpload onClose={() => setUpload(false)} onDone={(r) => { setUpload(false); setMsg("Loaded " + r.created + " new store" + (r.created === 1 ? "" : "s") + ", updated " + r.updated + "."); load(); }} />}`,
   `    {upload && <StoreUpload onClose={() => setUpload(false)} onDone={(r) => { setUpload(false); setMsg("Loaded " + r.created + " new account" + (r.created === 1 ? "" : "s") + ", updated " + r.updated + ". Next: Team shows the sales reps this list names -- invite them and their picker fills in."); load(); }} />}`, "upload done"],
  // form
  [`  return <Modal title={s.id ? "Edit store" : "Add a store"} onClose={onClose} width={520}>
    <form onSubmit={save}>
      <Field ui={ui} label="Store name"><Input autoFocus value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Stripes #2134" /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field ui={ui} label="Store #" hint="Optional. Lets a re-upload find it."><Input value={f.storeNo} onChange={(e) => set({ storeNo: e.target.value })} /></Field>
        <Field ui={ui} label="City"><Input value={f.city} onChange={(e) => set({ city: e.target.value })} /></Field>
      </div>
      <Field ui={ui} label="Chain" hint="Every store of a chain prints in that chain's style. Leave blank for an independent."><Input value={f.chain} onChange={(e) => set({ chain: e.target.value })} placeholder="Stripes" /></Field>`,
   `  return <Modal title={s.id ? "Edit account" : "Add an account"} onClose={onClose} width={560}>
    <form onSubmit={save}>
      <Field ui={ui} label="Account name"><Input autoFocus value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Stripes #2134" /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
        <Field ui={ui} label="Account #" hint="Lets a re-upload find it."><Input value={f.storeNo} onChange={(e) => set({ storeNo: e.target.value })} /></Field>
        <Field ui={ui} label="Address"><Input value={f.address} onChange={(e) => set({ address: e.target.value })} placeholder="4210 N Grandview Ave" /></Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field ui={ui} label="City"><Input value={f.city} onChange={(e) => set({ city: e.target.value })} /></Field>
        <Field ui={ui} label="Chain" hint="Prints in that chain's style. Blank = independent."><Input value={f.chain} onChange={(e) => set({ chain: e.target.value })} placeholder="Stripes" /></Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
        <Field ui={ui} label="Sales rep" hint="Whose picker this account shows in."><Input value={f.repName} onChange={(e) => set({ repName: e.target.value })} placeholder="Jose Esquivel" /></Field>
        <Field ui={ui} label="Sales rep #"><Input value={f.repNo} onChange={(e) => set({ repNo: e.target.value })} placeholder="21063" /></Field>
      </div>`, "form"],
  [`      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><Ghost small onClick={onClose}>Cancel</Ghost><Primary small type="submit" disabled={busy || !f.name.trim()}>{busy ? "Saving…" : "Save store"}</Primary></div>`,
   `      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><Ghost small onClick={onClose}>Cancel</Ghost><Primary small type="submit" disabled={busy || !f.name.trim()}>{busy ? "Saving…" : "Save account"}</Primary></div>`, "form save"],
  // upload modal
  [`  return <Modal title="Upload a store list" onClose={onClose} width={720}>
    <div style={{ fontSize: 13.5, color: TB.slate, marginBottom: 12, lineHeight: 1.55 }}>Any .xlsx or .csv with a <b>Name</b> (or Store / Account) column. <b>Store #</b>, <b>City</b>, <b>Chain</b> and <b>Team</b> are read when they are there; the header can be on any row. A store already here (same number) is updated, never duplicated.</div>`,
   `  return <Modal title="Upload your account list" onClose={onClose} width={860}>
    <div style={{ fontSize: 13.5, color: TB.slate, marginBottom: 12, lineHeight: 1.55 }}>Any .xlsx or .csv straight out of your system. Columns read: <b>Account Name</b> (required), <b>Account #</b>, <b>Address</b>, <b>City</b>, <b>Chain</b>, <b>Sales Rep</b>, <b>Sales Rep #</b> (a route number works), <b>Team</b>. Header on any row; extra columns are ignored. An account already here (same number) is updated, never duplicated -- re-upload whenever the list changes.</div>`, "upload copy"],
  [`      <Notice kind="ok" style={{ marginBottom: 8 }}>Tab “{preview.sheet}”, header on row {preview.headerRow}. Columns read: {preview.columns.join(", ")}. <b>{preview.count}</b> store{preview.count === 1 ? "" : "s"}.</Notice>
      <Table cols={["Name", "#", "City", "Chain", "Team"]} rows={preview.sample.map((r, i) => <tr key={i}><td style={td}>{r.name}</td><td style={td}>{r.storeNo || "—"}</td><td style={td}>{r.city}</td><td style={td}>{r.chain}</td><td style={td}>{r.team}</td></tr>)} />`,
   `      <Notice kind={preview.columns.indexOf("repNo") === -1 && preview.columns.indexOf("repName") === -1 ? "warn" : "ok"} style={{ marginBottom: 8 }}>Tab “{preview.sheet}”, header on row {preview.headerRow}. Columns read: {preview.columns.map((c) => ({ name: "Account Name", storeNo: "Account #", address: "Address", city: "City", chain: "Chain", repName: "Sales Rep", repNo: "Sales Rep #", team: "Team" }[c] || c)).join(", ")}. <b>{preview.count}</b> account{preview.count === 1 ? "" : "s"}.{preview.columns.indexOf("repNo") === -1 && preview.columns.indexOf("repName") === -1 ? " No Sales Rep column found -- every rep will see every account until one is added." : ""}</Notice>
      <Table cols={["Account", "#", "Address", "City", "Chain", "Sales rep", "Rep #"]} rows={preview.sample.map((r, i) => <tr key={i}><td style={td}>{r.name}</td><td style={td}>{r.storeNo || "—"}</td><td style={td}>{r.address}</td><td style={td}>{r.city}</td><td style={td}>{r.chain}</td><td style={td}>{r.repName}</td><td style={td}>{r.repNo || "—"}</td></tr>)} />`, "upload preview"],
  [`      {preview && <Primary small disabled={!!busy} onClick={() => run(true)}>{busy === "apply" ? "Loading…" : "Load " + preview.count + " store" + (preview.count === 1 ? "" : "s")}</Primary>}
    </div>
  </Modal>;
}

/* ================================================================
   CATALOG`,
   `      {preview && <Primary small disabled={!!busy} onClick={() => run(true)}>{busy === "apply" ? "Loading…" : "Load " + preview.count + " account" + (preview.count === 1 ? "" : "s")}</Primary>}
    </div>
  </Modal>;
}

/* ================================================================
   CATALOG`, "upload button"],
  // Team: reps on the list
  [`  const [data, setData] = useState(null); const [teams, setTeams] = useState([]); const [inv, setInv] = useState(false); const [msg, setMsg] = useState(""); const [teamName, setTeamName] = useState("");
  const canAdmin = role === "owner" || role === "admin";
  function load() { api.get("/api/orgs/" + session.org + "/members").then(setData).catch(() => setData({ error: "Couldn't load the team." })); api.get("/api/orgs/" + session.org + "/teams").then((r) => setTeams((r && r.teams) || [])).catch(() => {}); }`,
   `  const [data, setData] = useState(null); const [teams, setTeams] = useState([]); const [inv, setInv] = useState(false); const [msg, setMsg] = useState(""); const [teamName, setTeamName] = useState("");
  const [reps, setReps] = useState(null);
  const canAdmin = role === "owner" || role === "admin";
  function load() { api.get("/api/orgs/" + session.org + "/members").then(setData).catch(() => setData({ error: "Couldn't load the team." })); api.get("/api/orgs/" + session.org + "/teams").then((r) => setTeams((r && r.teams) || [])).catch(() => {}); api.get("/api/orgs/" + session.org + "/reps").then((r) => setReps(r && r.ok ? r : { reps: [], unmatched: [] })).catch(() => setReps({ reps: [], unmatched: [] })); }
  const repOptions = ((reps && reps.reps) || []).filter((r) => r.repNo);
  async function setRepNo(m, repNo) { const x = await api.post("/api/orgs/" + session.org + "/members/" + m.id, { repNo }); if (x.error) window.alert(x.error); else load(); }`, "team state"],
  [`    <Table cols={["Name", "Email", "Role", "Team", "Last seen", canAdmin ? "" : null].filter((x) => x != null)} rows={members.map((m) => <tr key={m.id}>
      <td style={td}><b>{m.name}</b>{m.id === me.id && <span style={{ color: C.mute, fontSize: 12 }}> (you)</span>}</td><td style={Object.assign({ color: TB.slate }, td)}>{m.email}</td>
      <td style={td}>{canAdmin && m.role !== "owner" ? sel(m.role, [["admin", "Admin"], ["manager", "Manager"], ["rep", "Rep"]].concat(role === "owner" ? [["owner", "Owner (transfer)"]] : []), (v) => setRole(m, v)) : <Chip ui={ui} small bg={m.role === "owner" ? TB.signalSoft : C.lineCool}>{roleLabel(m.role)}</Chip>}</td>
      <td style={td}>{canAdmin ? sel(m.teamId, [["", "—"]].concat(teams.map((t) => [t.id, t.name])), (v) => setTeam(m, v)) : (teamNameOf(m.teamId) || "—")}</td>`,
   `    {reps && reps.unmatched && reps.unmatched.length > 0 && canAdmin && <div style={{ background: "#fff", border: \`1.5px solid \${TB.signal}\`, borderRadius: 14, padding: 14, marginBottom: 14 }}>
      <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 15, color: TB.ink }}>Your account list names {reps.unmatched.length} sales rep{reps.unmatched.length === 1 ? "" : "s"} not on the team yet</div>
      <div style={{ fontSize: 13, color: TB.slate, marginTop: 3, marginBottom: 10, lineHeight: 1.5 }}>Invite each one and their Rep # rides along -- the moment they accept, their picker shows their own accounts and nobody else's.</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{reps.unmatched.map((r, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, border: \`1.5px solid \${C.line}\`, borderRadius: 12, padding: "8px 12px", background: TB.paper }}>
        <div><div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 13.5, color: TB.ink }}>{r.repName || "Rep #" + r.repNo}</div><div style={{ fontSize: 12, color: TB.slate }}>{r.repNo ? "#" + r.repNo + " · " : ""}{r.accounts} account{r.accounts === 1 ? "" : "s"}</div></div>
        <Primary small onClick={() => setInv({ repNo: r.repNo || "", repName: r.repName || "" })}><L.Mail size={14} /> Invite</Primary>
      </div>)}</div>
    </div>}
    <Table cols={["Name", "Email", "Role", "Rep #", "Team", "Last seen", canAdmin ? "" : null].filter((x) => x != null)} rows={members.map((m) => <tr key={m.id}>
      <td style={td}><b>{m.name}</b>{m.id === me.id && <span style={{ color: C.mute, fontSize: 12 }}> (you)</span>}</td><td style={Object.assign({ color: TB.slate }, td)}>{m.email}</td>
      <td style={td}>{canAdmin && m.role !== "owner" ? sel(m.role, [["admin", "Admin"], ["manager", "Manager"], ["rep", "Rep"]].concat(role === "owner" ? [["owner", "Owner (transfer)"]] : []), (v) => setRole(m, v)) : <Chip ui={ui} small bg={m.role === "owner" ? TB.signalSoft : C.lineCool}>{roleLabel(m.role)}</Chip>}</td>
      <td style={td}>{canAdmin ? <RepNoPicker value={m.repNo} options={repOptions} onPick={(v) => setRepNo(m, v)} /> : (m.repNo ? "#" + m.repNo : <span style={{ color: C.mute }}>—</span>)}</td>
      <td style={td}>{canAdmin ? sel(m.teamId, [["", "—"]].concat(teams.map((t) => [t.id, t.name])), (v) => setTeam(m, v)) : (teamNameOf(m.teamId) || "—")}</td>`, "members table"],
  [`      <Table cols={["Email", "Role", "Sent", ""]} rows={invites.map((i) => <tr key={i.id}><td style={td}>{i.email}</td><td style={td}>{roleLabel(i.role)}</td>`,
   `      <Table cols={["Email", "Role", "Rep #", "Sent", ""]} rows={invites.map((i) => <tr key={i.id}><td style={td}>{i.email}</td><td style={td}>{roleLabel(i.role)}</td><td style={Object.assign({ color: C.mute }, td)}>{i.repNo ? "#" + i.repNo : "—"}</td>`, "invites table"],
  [`    {inv && <InviteForm teams={teams} onClose={() => setInv(false)} onSent={(email) => { setInv(false); setMsg("Invite sent to " + email + ". They get a link that sets their password and lands them here."); load(); }} />}`,
   `    {inv && <InviteForm teams={teams} reps={repOptions} preset={typeof inv === "object" ? inv : null} onClose={() => setInv(false)} onSent={(email) => { setInv(false); setMsg("Invite sent to " + email + ". They get a link that sets their password and lands them here."); load(); }} />}`, "invite mount"],
  [`function InviteForm({ teams, onClose, onSent }) {
  const [f, setF] = useState({ email: "", role: "rep", teamId: "" }); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");`,
   `// A member's Rep #: pick one of the numbers the account list carries, or
// type one. What links a login to "their" accounts.
function RepNoPicker({ value, options, onPick }) {
  const [typing, setTyping] = useState(false); const [v, setV] = useState(value || "");
  const known = (options || []).some((o) => o.repNo === value);
  if (typing || (value && !known && !options.length)) return <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { setTyping(false); if (v !== (value || "")) onPick(v); }} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} placeholder="21063" style={{ width: 90, padding: "6px 8px", borderRadius: 8, border: \`1.5px solid \${C.line}\`, fontSize: 13, fontFamily: BODY }} />;
  return <select value={known ? value : (value ? "__custom" : "")} onChange={(e) => { if (e.target.value === "__type") { setV(value || ""); setTyping(true); } else onPick(e.target.value); }} style={{ padding: "6px 8px", borderRadius: 8, border: \`1.5px solid \${C.line}\`, background: "#fff", fontSize: 13, fontFamily: BODY, maxWidth: 200 }}>
    <option value="">—</option>
    {(options || []).map((o) => <option key={o.repNo} value={o.repNo}>#{o.repNo}{o.repName ? " · " + o.repName : ""} ({o.accounts})</option>)}
    {value && !known && <option value="__custom">#{value}</option>}
    <option value="__type">Type a number…</option>
  </select>;
}
function InviteForm({ teams, reps, preset, onClose, onSent }) {
  const [f, setF] = useState({ email: "", role: "rep", teamId: "", repNo: (preset && preset.repNo) || "" }); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");`, "invite form state"],
  [`      {teams.length > 0 && <Field ui={ui} label="Team"><select value={f.teamId} onChange={(e) => set({ teamId: e.target.value })} style={inputStyle(ui)}><option value="">— none —</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>}
      {err && <Notice kind="bad" style={{ marginBottom: 10 }}>{err}</Notice>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><Ghost small onClick={onClose}>Cancel</Ghost><Primary small type="submit" disabled={busy || !f.email}>{busy ? "Sending…" : "Send invite"}</Primary></div>`,
   `      {f.role === "rep" && <Field ui={ui} label="Sales rep #" hint={preset && preset.repName ? "The account list calls this rep " + preset.repName + "." : "Which accounts are theirs. From your account list's Sales Rep # column; leave blank and they see every account."}>
        {(reps || []).length ? <select value={f.repNo} onChange={(e) => set({ repNo: e.target.value })} style={inputStyle(ui)}><option value="">— not yet —</option>{reps.map((o) => <option key={o.repNo} value={o.repNo}>#{o.repNo}{o.repName ? " · " + o.repName : ""} · {o.accounts} account{o.accounts === 1 ? "" : "s"}</option>)}</select>
          : <Input value={f.repNo} onChange={(e) => set({ repNo: e.target.value })} placeholder="21063" />}
      </Field>}
      {teams.length > 0 && <Field ui={ui} label="Team"><select value={f.teamId} onChange={(e) => set({ teamId: e.target.value })} style={inputStyle(ui)}><option value="">— none —</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>}
      {err && <Notice kind="bad" style={{ marginBottom: 10 }}>{err}</Notice>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><Ghost small onClick={onClose}>Cancel</Ghost><Primary small type="submit" disabled={busy || !f.email}>{busy ? "Sending…" : "Send invite"}</Primary></div>`, "invite rep field"],
  // Home step copy + nav label
  [`  { k: "added_store", title: "Add your stores", sub: "One at a time, or upload the account list.", to: "/app/stores", icon: L.Store },`,
   `  { k: "added_store", title: "Upload your account list", sub: "Name, number, address, sales rep. Reps see their own.", to: "/app/stores", icon: L.Store },`, "home step"],
]);
patch("src/app.jsx", `label: "Accounts"`, [
  [`  { id: "stores", label: "Stores", icon: L.Store, roles: ["owner", "admin", "manager"], group: "Set up" },`,
   `  { id: "stores", label: "Accounts", icon: L.Store, roles: ["owner", "admin", "manager"], group: "Set up" },`, "nav label"],
  [`        <Feature icon={L.Smartphone} title="Made for a phone in a store aisle"`,
   `        <Feature icon={L.Store} title="Your account list, as it is" body="Upload the export you already have -- account name, number, address, sales rep and rep number. Each rep's phone shows their own accounts; the sign shop sees them all." />
        <Feature icon={L.Smartphone} title="Made for a phone in a store aisle"`, "landing feature"],
]);
patch("src/tutorials.js", "Sales Rep #", [
  [`    steps: ["Stores -> Add a store (or upload your account list).",`, `    steps: ["Accounts -> Upload account list: Account Name, Account #, Address, Sales Rep, Sales Rep #. Or add one by hand.",`, "tut1"],
  [`    steps: ["Team -> Invite. Enter an email and a role.",`, `    steps: ["Team -> the card lists every sales rep your account list names who is not on the team yet. Invite each; their Rep # rides along.", "Or Team -> Invite: an email, a role, and for a rep the Sales Rep # from your list.",`, "tut team"],
]);
console.log("done");
