/* assets.js -- binary asset storage (chain logos, brand logos, template
   artwork). Same shape the embedded product used (a random key is the
   credential, anonymous GET), backed by its own table here instead of a kv
   row shared with everything else, since this product owns its whole DB. */
"use strict";
const crypto = require("crypto");

const PREFIX = { blogo: "bl_", clogo: "cl_", ttpl: "tt_", tlogo: "tl_" };

function create(deps) {
  const pool = () => deps.pool;
  function key(ns) { if (!PREFIX[ns]) return null; return PREFIX[ns] + crypto.randomBytes(18).toString("base64url"); }
  async function putAsset(ns, dataUrl, meta) {
    if (!PREFIX[ns]) return null;
    if (typeof dataUrl !== "string" || dataUrl.indexOf("data:image") !== 0) return null;
    const ci = dataUrl.indexOf(","); if (ci === -1) return null;
    const mime = dataUrl.slice(5, dataUrl.indexOf(";")) || "image/jpeg";
    const body = dataUrl.slice(ci + 1);
    if (!body) return null;
    const id = key(ns);
    await pool().query("INSERT INTO assets (id, ns, mime, data, meta) VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (id) DO NOTHING", [id, ns, mime, body, JSON.stringify(meta || {})]);
    return id;
  }
  async function getAsset(ns, id) {
    if (!PREFIX[ns] || !id || id.indexOf(PREFIX[ns]) !== 0) return null;
    const r = await pool().query("SELECT mime, data FROM assets WHERE id = $1 AND ns = $2", [id, ns]);
    if (!r.rows.length) return null;
    return { mime: r.rows[0].mime, buf: Buffer.from(r.rows[0].data, "base64") };
  }
  return { putAsset, getAsset };
}
module.exports = { create };
