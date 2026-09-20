/* tagup.js -- the org-scoped business logic. Every query is scoped by
   org_id, taken from session.org, never from the request body -- the one
   rule that keeps one tenant from ever touching another's data.

   Roles: owner/admin manage the whole org (stores, styles, materials,
   brand overrides, invites, the full queue). manager works their own
   team's queue and batches, read-only on styles/materials. rep submits
   requests for their own team's stores and reads only their own requests.
   This mirrors the embedded product's admin/dm/rep split, minus the
   comms/chain-manager principals that were specific to The Standard. */
"use strict";
const crypto = require("crypto");
const CORE = require("./tagup-core");
const IMP = require("./tagup-import");

function newId() { return crypto.randomUUID(); }
// A dynamic IN (...) clause instead of = ANY($1::uuid[]): more portable
// across drivers/engines than array-parameter binding, and it sidesteps the
// classic "= ANY() with an empty array silently matches nothing, forever,
// with no error" trap the same way -- callers still check ids.length first.
function inClause(params, values) {
  const start = params.length + 1;
  values.forEach((v) => params.push(v));
  return "(" + values.map((_, i) => "$" + (start + i)).join(",") + ")";
}
function clip(v, n) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n); }
function isChainNoise(raw) { return !raw || /^(independent|unassigned( call point)?|none|n\/a)$/i.test(String(raw).trim()); }

function styleOut(r) {
  return { id: r.id, chainId: r.chain_id || null, name: r.name, logoKey: r.logo_key || null, format: r.format || "tag",
           kind: r.kind === "template" ? "template" : "composed", templateKey: r.template_key || null,
           templateW: r.template_w == null ? null : Number(r.template_w), templateH: r.template_h == null ? null : Number(r.template_h),
           fields: CORE.normalizeFields(r.fields || []), theme: CORE.themeMerge(r.theme || {}), rules: Array.isArray(r.rules) ? r.rules : [],
           active: r.active !== false, updatedAt: r.updated_at };
}
function materialOut(r) {
  return { id: r.id, name: r.name, tagW: Number(r.tag_w), tagH: Number(r.tag_h), sheetW: Number(r.sheet_w), sheetH: Number(r.sheet_h),
           cols: r.cols, rows: r.rows, averySku: r.avery_sku || null, active: r.active !== false, perSheet: r.cols * r.rows };
}
function requestOut(r) {
  return { id: r.id, userId: r.user_id, userName: r.user_name || "", teamId: r.team_id || null,
           storeId: r.store_id, storeName: r.store_name || "", chainId: r.chain_id || null, chainLabel: r.chain_label || "",
           contentType: r.content_type, format: r.format || "tag", itemNo: r.item_no || null, itemName: r.item_name,
           itemFreeText: !!r.item_free_text, brandId: r.brand_id || null, packageSize: r.package_size || "",
           price: r.price == null ? null : Number(r.price), wasPrice: r.was_price == null ? null : Number(r.was_price),
           multiBuyQty: r.multi_buy_qty || null, note: r.note || "", copies: r.copies || 1, styleIdOverride: r.style_id_override || null,
           status: r.status, batchId: r.batch_id || null, importId: r.import_id || null, rejectReason: r.reject_reason || "",
           createdAt: r.created_at, updatedAt: r.updated_at, printedAt: r.printed_at || null };
}
function batchOut(r) {
  return { id: r.id, materialId: r.material_id, createdBy: r.created_by, requestIds: Array.isArray(r.request_ids) ? r.request_ids : [],
           status: r.status, createdAt: r.created_at, generatedAt: r.generated_at || null, printedAt: r.printed_at || null };
}
function storeOut(r) {
  return { id: r.id, teamId: r.team_id || null, name: r.name, storeNo: r.store_no || null, city: r.city || "",
           chainId: r.chain_id || null, chainRaw: r.chain_raw || "", active: r.active !== false };
}

function create(deps) {
  const D = deps; // pool, brands (module), putAsset
  const pool = () => D.pool;

  function forbidden(m) { return { error: m || "forbidden" }; }
  function role(session) { return session && session.membership && session.membership.role; }
  function canAdmin(session) { return role(session) === "owner" || role(session) === "admin"; }
  function canManage(session) { return canAdmin(session) || role(session) === "manager"; }
  function teamScope(session) { return role(session) === "manager" ? session.membership.team_id : null; }

  /* ---------------- teams ---------------- */
  async function listTeams(session) {
    const r = await pool().query("SELECT id, name FROM teams WHERE org_id = $1 ORDER BY name", [session.org.id]);
    return { ok: true, teams: r.rows };
  }
  async function createTeam(session, body) {
    if (!canAdmin(session)) return forbidden();
    const name = clip((body || {}).name, 60);
    if (!name) return { error: "team needs a name" };
    const r = await pool().query("INSERT INTO teams (id, org_id, name) VALUES ($1,$2,$3) RETURNING id, name", [newId(), session.org.id, name]);
    return { ok: true, team: r.rows[0] };
  }

  /* ---------------- chains (global identity, resolved per store) ---------------- */
  async function chainKeyFor(chainRaw) {
    if (isChainNoise(chainRaw)) return null;
    const raw = clip(chainRaw, 80);
    const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const existing = await pool().query("SELECT id, aliases FROM chains WHERE slug = $1 OR aliases @> $2::jsonb", [slug, JSON.stringify([raw])]);
    if (existing.rows.length) return existing.rows[0].id;
    const r = await pool().query("INSERT INTO chains (id, slug, label, aliases) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (slug) DO NOTHING RETURNING id", [newId(), slug, raw, JSON.stringify([raw])]);
    if (r.rows.length) return r.rows[0].id;
    const again = await pool().query("SELECT id FROM chains WHERE slug = $1", [slug]);
    return again.rows[0] ? again.rows[0].id : null;
  }
  async function chainsForOrg(session) {
    const r = await pool().query(
      "SELECT c.id, c.label, count(*)::int AS stores FROM stores s JOIN chains c ON c.id = s.chain_id WHERE s.org_id = $1 AND s.active GROUP BY c.id, c.label ORDER BY stores DESC",
      [session.org.id]);
    return r.rows.map((x) => ({ id: x.id, label: x.label, stores: x.stores }));
  }

  /* ---------------- stores ---------------- */
  async function listStores(session, opts) {
    const o = opts || {};
    const params = [session.org.id]; let w = "org_id = $1 AND active";
    const tm = teamScope(session);
    if (tm) { params.push(tm); w += " AND team_id = $" + params.length; }
    const r = await pool().query("SELECT * FROM stores WHERE " + w + " ORDER BY name LIMIT 2000", params);
    return { ok: true, stores: r.rows.map(storeOut) };
  }
  async function upsertStore(session, body) {
    if (!canAdmin(session)) return forbidden("only an owner or admin edits stores");
    const b = body || {};
    const name = clip(b.name, 120);
    if (!name) return { error: "store needs a name" };
    const chainId = await chainKeyFor(b.chain);
    if (b.id) {
      const r = await pool().query("UPDATE stores SET name=$3, store_no=$4, city=$5, chain_id=$6, chain_raw=$7, team_id=$8, updated_at=now() WHERE id=$1 AND org_id=$2 RETURNING *",
        [b.id, session.org.id, name, clip(b.storeNo, 40) || null, clip(b.city, 60), chainId, clip(b.chain, 80), b.teamId || null]);
      if (!r.rows.length) return { error: "store not found" };
      return { ok: true, store: storeOut(r.rows[0]) };
    }
    const r = await pool().query("INSERT INTO stores (id, org_id, team_id, name, store_no, city, chain_id, chain_raw) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [newId(), session.org.id, b.teamId || null, name, clip(b.storeNo, 40) || null, clip(b.city, 60), chainId, clip(b.chain, 80)]);
    await pool().query("UPDATE org_onboarding SET added_store = true WHERE org_id = $1", [session.org.id]);
    return { ok: true, store: storeOut(r.rows[0]) };
  }
  // Reconciling upload: insert/update/close, never delete -- same rule the
  // embedded product's universe upload followed, for the same reason (a
  // closed store keeps its request history intact).
  async function importStores(session, rows) {
    if (!canAdmin(session)) return forbidden();
    let created = 0, updated = 0;
    for (const row of rows || []) {
      const name = clip(row.name, 120); if (!name) continue;
      const storeNo = clip(row.storeNo, 40) || null;
      const chainId = await chainKeyFor(row.chain);
      const existing = storeNo ? await pool().query("SELECT id FROM stores WHERE org_id = $1 AND store_no = $2", [session.org.id, storeNo]) : { rows: [] };
      if (existing.rows.length) { await pool().query("UPDATE stores SET name=$3, city=$4, chain_id=$5, chain_raw=$6, active=true, updated_at=now() WHERE id=$1 AND org_id=$2", [existing.rows[0].id, session.org.id, name, clip(row.city, 60), chainId, clip(row.chain, 80)]); updated++; }
      else { await pool().query("INSERT INTO stores (id, org_id, name, store_no, city, chain_id, chain_raw) VALUES ($1,$2,$3,$4,$5,$6,$7)", [newId(), session.org.id, name, storeNo, clip(row.city, 60), chainId, clip(row.chain, 80)]); created++; }
    }
    if (created || updated) await pool().query("UPDATE org_onboarding SET added_store = true WHERE org_id = $1", [session.org.id]);
    return { ok: true, created, updated };
  }

  /* ---------------- styles ---------------- */
  const DEFAULT_STYLE = { name: "Default", chainId: null, format: "tag", theme: {} };
  const seeded = {};
  function ensureSeeds(orgId) {
    if (seeded[orgId]) return seeded[orgId];
    // A plain existence check then a VALUES insert, not INSERT...SELECT...
    // WHERE NOT EXISTS: the SELECT-projection form leaves every bound
    // parameter typed as text, so a numeric or jsonb column gets a text
    // literal instead of the value VALUES(...) would coerce automatically.
    // A brand-new org hits this exactly once, so the extra round trip costs
    // nothing that matters.
    seeded[orgId] = (async () => {
      const hasStyle = await pool().query("SELECT 1 FROM tagup_styles WHERE org_id = $1 AND chain_id IS NULL AND format = 'tag'", [orgId]);
      if (!hasStyle.rows.length) {
        await pool().query("INSERT INTO tagup_styles (id, org_id, chain_id, name, format, theme) VALUES ($1,$2,NULL,$3,'tag',$4::jsonb)",
          [newId(), orgId, DEFAULT_STYLE.name, JSON.stringify(DEFAULT_STYLE.theme)]);
      }
      for (const m of CORE.DEFAULT_MATERIALS) {
        const hasMat = await pool().query("SELECT 1 FROM tagup_materials WHERE org_id = $1 AND name = $2", [orgId, m.name]);
        if (hasMat.rows.length) continue;
        await pool().query("INSERT INTO tagup_materials (id, org_id, name, tag_w, tag_h, sheet_w, sheet_h, cols, rows, avery_sku) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [newId(), orgId, m.name, m.tagW, m.tagH, m.sheetW, m.sheetH, m.cols, m.rows, m.averySku]);
      }
    })().catch((e) => { delete seeded[orgId]; throw e; });
    return seeded[orgId];
  }
  async function stylesFor(orgId, includeInactive) {
    await ensureSeeds(orgId);
    const r = await pool().query("SELECT * FROM tagup_styles WHERE org_id = $1" + (includeInactive ? "" : " AND active") + " ORDER BY (chain_id IS NULL) DESC, name", [orgId]);
    return r.rows.map(styleOut);
  }
  async function materialsFor(orgId, includeInactive) {
    await ensureSeeds(orgId);
    const r = await pool().query("SELECT * FROM tagup_materials WHERE org_id = $1" + (includeInactive ? "" : " AND active") + " ORDER BY tag_w * tag_h, name", [orgId]);
    return r.rows.map(materialOut);
  }
  async function setup(session) {
    const [styles, materials, chains] = await Promise.all([stylesFor(session.org.id, true), materialsFor(session.org.id, true), chainsForOrg(session)]);
    return { ok: true, canEdit: canAdmin(session), styles, materials, chains, fonts: CORE.FONTS, layouts: CORE.LAYOUTS, defaultTheme: CORE.DEFAULT_THEME };
  }
  async function saveStyle(session, body) {
    if (!canAdmin(session)) return forbidden("only an owner or admin edits styles");
    const b = body || {};
    const name = clip(b.name, 60); if (!name) return { error: "style needs a name" };
    const format = CORE.FORMAT_IDS.indexOf(b.format) !== -1 ? b.format : "tag";
    const kind = b.kind === "template" ? "template" : "composed";
    const theme = CORE.themeMerge(b.theme || {});
    const fields = CORE.normalizeFields(b.fields || []);
    const rules = Array.isArray(b.rules) ? b.rules.slice(0, 20) : [];
    const num = (v) => { const n = parseFloat(v); return isFinite(n) && n > 0 && n <= 30 ? Math.round(n * 1000) / 1000 : null; };
    const templateW = num(b.templateW), templateH = num(b.templateH);
    if (kind === "template" && (!templateW || !templateH)) return { error: "a template needs its printed size in inches" };
    await ensureSeeds(session.org.id);
    if (b.chainId) {
      const dup = await pool().query("SELECT id FROM tagup_styles WHERE org_id = $1 AND chain_id = $2 AND format = $3 AND active AND id <> $4", [session.org.id, b.chainId, format, b.id || newId()]);
      if (dup.rows.length) return { error: "this chain already has a style for this format" };
    }
    if (b.id) {
      const r = await pool().query("UPDATE tagup_styles SET chain_id=$3, name=$4, format=$5, kind=$6, template_w=$7, template_h=$8, fields=$9::jsonb, theme=$10::jsonb, rules=$11::jsonb, updated_at=now() WHERE id=$1 AND org_id=$2 RETURNING *",
        [b.id, session.org.id, b.chainId || null, name, format, kind, templateW, templateH, JSON.stringify(fields), JSON.stringify(theme), JSON.stringify(rules)]);
      if (!r.rows.length) return { error: "style not found" };
      return { ok: true, style: styleOut(r.rows[0]) };
    }
    const r = await pool().query("INSERT INTO tagup_styles (id, org_id, chain_id, name, format, kind, template_w, template_h, fields, theme, rules, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12) RETURNING *",
      [newId(), session.org.id, b.chainId || null, name, format, kind, templateW, templateH, JSON.stringify(fields), JSON.stringify(theme), JSON.stringify(rules), session.user.id]);
    await pool().query("UPDATE org_onboarding SET picked_style = true WHERE org_id = $1", [session.org.id]);
    return { ok: true, style: styleOut(r.rows[0]) };
  }
  async function setStyleTemplate(session, id, body) {
    if (!canAdmin(session)) return forbidden();
    const b = body || {};
    let key = null;
    if (b.dataUrl) { key = await D.putAsset("ttpl", b.dataUrl, { style: id }); if (!key) return { error: "template must be an image" }; }
    const num = (v) => { const n = parseFloat(v); return isFinite(n) && n > 0 && n <= 30 ? Math.round(n * 1000) / 1000 : null; };
    const r = await pool().query("UPDATE tagup_styles SET template_key=$3, kind = CASE WHEN $3 IS NULL THEN kind ELSE 'template' END, template_w=coalesce($4,template_w), template_h=coalesce($5,template_h), updated_at=now() WHERE id=$1 AND org_id=$2 RETURNING *",
      [id, session.org.id, key, num(b.templateW), num(b.templateH)]);
    if (!r.rows.length) return { error: "style not found" };
    return { ok: true, style: styleOut(r.rows[0]) };
  }
  async function retireStyle(session, id, restore) {
    if (!canAdmin(session)) return forbidden();
    const r = await pool().query("UPDATE tagup_styles SET active=$3, updated_at=now() WHERE id=$1 AND org_id=$2 RETURNING *", [id, session.org.id, !!restore]);
    if (!r.rows.length) return { error: "style not found" };
    return { ok: true, style: styleOut(r.rows[0]) };
  }
  async function saveMaterial(session, body) {
    if (!canAdmin(session)) return forbidden();
    const n = CORE.normalizeMaterial(body || {});
    if (n.error) return n;
    await ensureSeeds(session.org.id);
    if ((body || {}).id) {
      const r = await pool().query("UPDATE tagup_materials SET name=$3,tag_w=$4,tag_h=$5,sheet_w=$6,sheet_h=$7,cols=$8,rows=$9,avery_sku=$10,active=true,updated_at=now() WHERE id=$1 AND org_id=$2 RETURNING *",
        [body.id, session.org.id, n.name, n.tagW, n.tagH, n.sheetW, n.sheetH, n.cols, n.rows, n.averySku]);
      if (!r.rows.length) return { error: "material not found" };
      return { ok: true, material: materialOut(r.rows[0]) };
    }
    const r = await pool().query("INSERT INTO tagup_materials (id, org_id, name, tag_w, tag_h, sheet_w, sheet_h, cols, rows, avery_sku) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
      [newId(), session.org.id, n.name, n.tagW, n.tagH, n.sheetW, n.sheetH, n.cols, n.rows, n.averySku]);
    return { ok: true, material: materialOut(r.rows[0]) };
  }

  /* ---------------- requests ---------------- */
  function resolveStyle(styles, chainId, override, format) { return CORE.resolveStyle(styles, chainId, override, format); }
  async function findStore(session, storeId) {
    const r = await pool().query("SELECT * FROM stores WHERE id = $1 AND org_id = $2 AND active", [storeId, session.org.id]);
    return r.rows[0] || null;
  }
  async function createRequest(session, body) {
    const b = body || {};
    const store = await findStore(session, b.storeId);
    if (!store) return { error: "pick a store" };
    if (role(session) === "rep" && teamScope(session) == null) { /* rep with no team may still request; org-wide */ }
    const tm = teamScope(session);
    if (tm && store.team_id && store.team_id !== tm) return { error: "that store is not on your team" };
    const n = CORE.normalizeRequest(b);
    if (n.error) return n;
    const chainLabel = store.chain_raw || "";
    let brandId = null;
    if (D.brands) { const bk = await D.brands.brandKeyForAsync(n.itemName, b.brand); if (bk) { const r = await pool().query("SELECT id FROM brands WHERE brand_key = $1", [bk]); if (r.rows.length) brandId = r.rows[0].id; } }
    const r = await pool().query(
      "INSERT INTO tagup_requests (id, org_id, user_id, user_name, team_id, store_id, store_name, chain_id, chain_label, content_type, format, item_no, item_name, item_free_text, brand_id, package_size, price, was_price, multi_buy_qty, note, copies, style_id_override) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *",
      [newId(), session.org.id, session.user.id, session.user.name, store.team_id, store.id, store.name, store.chain_id, chainLabel, n.contentType, n.format, n.itemNo, n.itemName, n.itemFreeText, brandId, n.packageSize, n.price, n.wasPrice, n.multiBuyQty, n.note, n.copies, canAdmin(session) ? (b.styleIdOverride || null) : null]);
    await pool().query("UPDATE org_onboarding SET made_request = true WHERE org_id = $1", [session.org.id]);
    return { ok: true, request: requestOut(r.rows[0]) };
  }
  async function list(session, opts) {
    const o = opts || {};
    const params = [session.org.id]; let w = "org_id = $1";
    if (role(session) === "rep") { params.push(session.user.id); w += " AND user_id = $" + params.length; }
    else { const tm = teamScope(session); if (tm) { params.push(tm); w += " AND team_id = $" + params.length; } }
    const status = o.status;
    if (status && status !== "all") { if (status === "open") w += " AND status IN ('pending','reviewed')"; else { params.push(status); w += " AND status = $" + params.length; } }
    const r = await pool().query("SELECT * FROM tagup_requests WHERE " + w + " ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'reviewed' THEN 1 ELSE 2 END, created_at DESC LIMIT 500", params);
    const reqs = r.rows.map(requestOut);
    const styles = await stylesFor(session.org.id);
    reqs.forEach((q) => { const st = resolveStyle(styles, q.chainId, q.styleIdOverride, q.format); q.styleId = st.id; q.styleName = st.name; });
    if (D.brands) await D.brands.attachLogos(session, reqs);
    return { ok: true, canAdmin: canManage(session), requests: reqs, styles };
  }
  async function updateRequest(session, id, body) {
    if (!canManage(session)) return forbidden();
    const cur = await pool().query("SELECT * FROM tagup_requests WHERE id=$1 AND org_id=$2", [id, session.org.id]);
    if (!cur.rows.length) return { error: "not found" };
    const q = requestOut(cur.rows[0]);
    if (!CORE.isOpen(q.status)) return { error: "that request is history" };
    const n = CORE.normalizeRequest(Object.assign({}, q, body || {}));
    if (n.error) return n;
    const r = await pool().query("UPDATE tagup_requests SET content_type=$2,item_no=$3,item_name=$4,package_size=$5,price=$6,was_price=$7,multi_buy_qty=$8,note=$9,copies=$10,format=$11,edited_by=$12,updated_at=now() WHERE id=$1 RETURNING *",
      [id, n.contentType, n.itemNo, n.itemName, n.packageSize, n.price, n.wasPrice, n.multiBuyQty, n.note, n.copies, n.format, session.user.id]);
    return { ok: true, request: requestOut(r.rows[0]) };
  }
  async function cancelRequest(session, id) {
    const cur = await pool().query("SELECT * FROM tagup_requests WHERE id=$1 AND org_id=$2", [id, session.org.id]);
    if (!cur.rows.length) return { error: "not found" };
    const q = requestOut(cur.rows[0]);
    const own = q.userId === session.user.id;
    if (!own && !canManage(session)) return forbidden();
    if (!CORE.canTransition(q.status, "cancelled")) return { error: "cannot withdraw a " + q.status + " request" };
    const r = await pool().query("UPDATE tagup_requests SET status='cancelled', updated_at=now() WHERE id=$1 RETURNING *", [id]);
    return { ok: true, request: requestOut(r.rows[0]) };
  }
  async function rejectRequest(session, id, reason) {
    if (!canManage(session)) return forbidden();
    if (!clip(reason, 200)) return { error: "give a reason" };
    const r = await pool().query("UPDATE tagup_requests SET status='rejected', reject_reason=$2, batch_id=NULL, updated_at=now() WHERE id=$1 AND org_id=$3 RETURNING *", [id, clip(reason, 200), session.org.id]);
    if (!r.rows.length) return { error: "not found" };
    return { ok: true, request: requestOut(r.rows[0]) };
  }

  /* ---------------- batches / print ---------------- */
  async function createBatch(session, body) {
    if (!canManage(session)) return forbidden();
    const b = body || {};
    const ids = Array.isArray(b.requestIds) ? b.requestIds : [];
    if (!ids.length) return { error: "pick at least one request" };
    const mats = await materialsFor(session.org.id);
    const mat = mats.find((m) => m.id === b.materialId);
    if (!mat) return { error: "pick the loaded material" };
    const p1 = []; const inIds1 = inClause(p1, ids); p1.push(session.org.id);
    const r = await pool().query("SELECT * FROM tagup_requests WHERE id IN " + inIds1 + " AND org_id = $" + p1.length, p1);
    const found = r.rows.map(requestOut);
    if (found.length !== ids.length) return { error: "some requests were not found" };
    if (found.some((q) => q.status !== "pending")) return { error: "some requests are not pending" };
    const id = newId();
    await pool().query("INSERT INTO tagup_batches (id, org_id, material_id, created_by, request_ids) VALUES ($1,$2,$3,$4,$5::jsonb)", [id, session.org.id, mat.id, session.user.id, JSON.stringify(ids)]);
    const p2 = []; const inIds2 = inClause(p2, ids); p2.push(id);
    await pool().query("UPDATE tagup_requests SET status='reviewed', batch_id=$" + p2.length + ", updated_at=now() WHERE id IN " + inIds2, p2);
    const t = CORE.tile(found, mat);
    return { ok: true, batch: { id, materialId: mat.id, requestIds: ids, status: "open", count: ids.length, sheets: t.sheets.length, cells: t.cells } };
  }
  async function listBatches(session) {
    const r = await pool().query("SELECT * FROM tagup_batches WHERE org_id = $1 ORDER BY (status='printed'), created_at DESC LIMIT 50", [session.org.id]);
    const mats = await materialsFor(session.org.id, true);
    const out = r.rows.map(batchOut);
    out.forEach((b) => { b.material = mats.find((m) => m.id === b.materialId) || null; b.count = b.requestIds.length; });
    return { ok: true, batches: out, materials: mats.filter((m) => m.active) };
  }
  async function printHtml(session, id, opts) {
    const b = await pool().query("SELECT * FROM tagup_batches WHERE id = $1 AND org_id = $2", [id, session.org.id]);
    if (!b.rows.length) return { error: "batch not found", status: 404 };
    const batch = batchOut(b.rows[0]);
    const mats = await materialsFor(session.org.id, true);
    const mat = mats.find((m) => m.id === batch.materialId);
    if (!mat) return { error: "material deleted", status: 409 };
    let r = { rows: [] };
    if (batch.requestIds.length) { const p3 = []; const inIds3 = inClause(p3, batch.requestIds); r = await pool().query("SELECT * FROM tagup_requests WHERE id IN " + inIds3, p3); }
    const byId = {}; r.rows.forEach((x) => { byId[x.id] = requestOut(x); });
    const reqs = batch.requestIds.map((x) => byId[x]).filter(Boolean);
    const styles = await stylesFor(session.org.id, true);
    const stylesById = {}; styles.forEach((s) => { stylesById[s.id] = s; });
    reqs.forEach((q) => { q.styleId = resolveStyle(styles, q.chainId, q.styleIdOverride, q.format).id; });
    if (D.brands) await D.brands.attachLogos(session, reqs);
    if (batch.status === "open" && canManage(session)) await pool().query("UPDATE tagup_batches SET status='generated', generated_at=now() WHERE id=$1 AND status='open'", [id]);
    const o = opts || {};
    const html = CORE.renderSheet(reqs, stylesById, mat, { title: "tagup -- " + mat.name, assetBase: (o.origin || "") + "/api/assets/tlogo/", templateBase: (o.origin || "") + "/api/assets/ttpl/", brandBase: (o.origin || "") + "/api/assets/blogo/" });
    return { ok: true, html, batch, count: reqs.length };
  }
  async function markPrinted(session, id) {
    if (!canManage(session)) return forbidden();
    const b = await pool().query("SELECT * FROM tagup_batches WHERE id=$1 AND org_id=$2", [id, session.org.id]);
    if (!b.rows.length) return { error: "not found" };
    if (b.rows[0].status === "printed") return { ok: true, already: true };
    await pool().query("UPDATE tagup_batches SET status='printed', printed_at=now(), generated_at=coalesce(generated_at, now()) WHERE id=$1", [id]);
    const r = await pool().query("UPDATE tagup_requests SET status='printed', printed_at=now(), updated_at=now() WHERE batch_id=$1 AND status='reviewed' RETURNING *", [id]);
    return { ok: true, printed: r.rows.length };
  }

  /* ---------------- Excel import ---------------- */
  async function catalogIndex(orgId) {
    const r = await pool().query("SELECT item_no, name, brand FROM catalog_items WHERE org_id = $1 AND active", [orgId]);
    return r.rows.map((it) => ({ itemNo: it.item_no, name: it.name, brand: it.brand, pkg: IMP.parsePackage(it.pack || it.name), brandKey: D.brands ? D.brands.normBrand(it.brand || "") : "" }));
  }
  function resolveStoreCell(text, stores) {
    const t = IMP.norm(text); if (!t) return null;
    let hit = stores.find((s) => s.storeNo && IMP.norm(s.storeNo) === t); if (hit) return hit;
    const digits = (t.match(/\d{3,}/g) || []);
    for (const d of digits) {
      const byNo = stores.filter((s) => s.storeNo && s.storeNo.endsWith(d)); if (byNo.length === 1) return byNo[0];
      const byName = stores.filter((s) => new RegExp("(^|[^0-9])" + d + "([^0-9]|$)").test(IMP.norm(s.name))); if (byName.length === 1) return byName[0];
    }
    const exact = stores.filter((s) => IMP.norm(s.name) === t); if (exact.length === 1) return exact[0];
    return null;
  }
  async function importBook(session, sheets, opts) {
    if (!canAdmin(session)) return forbidden("only an owner or admin imports a price book");
    const o = opts || {};
    const parsed = IMP.parseBook(sheets, { contentType: o.contentType, format: o.format });
    if (parsed.error) return parsed;
    const storesR = await pool().query("SELECT * FROM stores WHERE org_id = $1 AND active", [session.org.id]);
    const stores = storesR.rows.map(storeOut);
    const mode = o.mode === "chain" ? "chain" : o.mode === "column" ? "column" : "account";
    let targets = [];
    if (mode === "account") { const s = stores.find((x) => x.id === o.storeId); if (!s) return { error: "pick the store" }; targets = [s]; }
    else if (mode === "chain") { targets = stores.filter((x) => x.chainId === o.chainId); if (!targets.length) return { error: "no stores of that chain" }; }
    else if (parsed.columns.indexOf("store") === -1) return { error: "the sheet has no Store column" };
    const cat = await catalogIndex(session.org.id);
    const brands = D.brands ? await D.brands.rows() : [];
    const styles = await stylesFor(session.org.id);
    parsed.rows.forEach((row) => {
      if (row.status === "error" || row.status === "skipped") return;
      if (mode === "column") { const s = resolveStoreCell(row.storeText, stores); if (!s) { row.status = "error"; row.error = "store not found"; return; } row.target = s; }
      const bk = D.brands ? D.brands.brandKeyFor(row.description || row.brand, row.brand, brands) : null;
      const br = bk ? brands.find((b) => b.key === bk) : null;
      const want = IMP.parsePackage(row.packageText || row.description);
      let best = null, bestScore = 0;
      cat.forEach((it) => { if (bk && it.brandKey !== bk) return; const s = IMP.packageScore(want, it.pkg); if (s > bestScore) { best = it; bestScore = s; } });
      if (best) { row.itemName = best.name; row.itemNo = best.itemNo; row.packageSize = row.packageText || ""; row.itemFreeText = false; }
      else { row.itemName = (br ? br.label : "") || row.description || row.brand; row.itemNo = row.itemKey || null; row.packageSize = row.packageText; row.itemFreeText = true; row.notes.push("no catalog item matched"); }
      row.brandKey = bk;
      if (!row.itemName) { row.status = "error"; row.error = "no brand or item"; return; }
      const n = CORE.normalizeRequest({ contentType: row.contentType, format: row.format, itemName: row.itemName, packageSize: row.packageSize, price: row.price, wasPrice: row.wasPrice, multiBuyQty: row.multiQty, note: row.note, copies: row.copies, itemNo: row.itemNo, itemFreeText: row.itemFreeText });
      if (n.error) { row.status = "error"; row.error = n.error; return; }
      row.normalized = n;
      if (row.status === "ok" && row.notes.length) row.status = "adjusted";
      row.styleName = resolveStyle(styles, mode === "column" ? row.target.chainId : targets[0] && targets[0].chainId, null, row.format).name;
    });
    const counts = IMP.count(parsed.rows);
    const good = parsed.rows.filter((r) => r.status === "ok" || r.status === "adjusted");
    const wouldCreate = good.length * (mode === "column" ? 1 : targets.length);
    const out = { ok: true, preview: !o.apply, sheet: parsed.sheet, headerRow: parsed.headerRow, columns: parsed.columns, counts, mode,
                  targets: mode === "column" ? null : targets.map((t) => ({ id: t.id, name: t.name })), wouldCreate,
                  rows: parsed.rows.slice(0, 400) };
    if (!o.apply) return out;
    if (!good.length) return { error: "nothing to import" };
    const importId = newId();
    await pool().query("INSERT INTO tagup_imports (id, org_id, file_name, by_id, sheet, mode, counts) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)", [importId, session.org.id, clip(o.fileName, 120), session.user.id, parsed.sheet, mode, JSON.stringify(counts)]);
    let created = 0;
    let brandIdCache = {};
    for (const row of good) {
      const targetsForRow = mode === "column" ? [row.target] : targets;
      for (const t of targetsForRow) {
        let brandId = null;
        if (row.brandKey) { if (!(row.brandKey in brandIdCache)) { const r = await pool().query("SELECT id FROM brands WHERE brand_key = $1", [row.brandKey]); brandIdCache[row.brandKey] = r.rows[0] ? r.rows[0].id : null; } brandId = brandIdCache[row.brandKey]; }
        await pool().query(
          "INSERT INTO tagup_requests (id, org_id, user_id, user_name, team_id, store_id, store_name, chain_id, chain_label, content_type, format, item_no, item_name, item_free_text, brand_id, package_size, price, was_price, multi_buy_qty, note, copies, import_id) " +
          "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)",
          [newId(), session.org.id, session.user.id, session.user.name, t.teamId, t.id, t.name, t.chainId, t.chainRaw, row.normalized.contentType, row.normalized.format, row.normalized.itemNo, row.normalized.itemName, row.normalized.itemFreeText, brandId, row.normalized.packageSize, row.normalized.price, row.normalized.wasPrice, row.normalized.multiBuyQty, row.normalized.note, row.normalized.copies, importId]);
        created++;
      }
    }
    await pool().query("UPDATE tagup_imports SET created = $2 WHERE id = $1", [importId, created]);
    await pool().query("UPDATE org_onboarding SET made_request = true WHERE org_id = $1", [session.org.id]);
    return Object.assign(out, { preview: false, importId, created });
  }
  function importTemplate() { return { headers: IMP.TEMPLATE_HEADERS, rows: IMP.TEMPLATE_ROWS, filename: "tagup-import-template.xlsx" }; }
  async function exportRows(session, opts) {
    const r = await list(session, opts);
    if (r.error) return r;
    return { ok: true, headers: IMP.EXPORT_HEADERS, rows: r.requests.map((q) => IMP.exportRow(Object.assign({}, q, { accountName: q.storeName, accountId: q.storeId, repName: q.userName }))), filename: "tagup-export.xlsx" };
  }

  async function onboarding(session) {
    const r = await pool().query("SELECT * FROM org_onboarding WHERE org_id = $1", [session.org.id]);
    return r.rows[0] || { added_store: false, picked_style: false, made_request: false, printed_one: false, invited_team: false, dismissed: false };
  }
  async function dismissOnboarding(session) { await pool().query("UPDATE org_onboarding SET dismissed = true WHERE org_id = $1", [session.org.id]); return { ok: true }; }

  return { listTeams, createTeam, chainsForOrg, listStores, upsertStore, importStores, setup, saveStyle, setStyleTemplate, retireStyle, saveMaterial,
           list, createRequest, updateRequest, cancelRequest, rejectRequest, createBatch, listBatches, printHtml, markPrinted,
           importBook, importTemplate, exportRows, onboarding, dismissOnboarding, canAdmin, canManage, role };
}
module.exports = { create };
