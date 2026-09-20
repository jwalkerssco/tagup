/* migrate.js -- apply schema.sql to DATABASE_URL, idempotently.

   schema.sql is written with IF NOT EXISTS throughout, so running this on
   every deploy is safe: a fresh database gets every table, an existing one
   gets nothing it already has. Additive changes (a new column, a new table)
   go in schema.sql as further IF NOT EXISTS statements; nothing here ever
   DROPs.

     node migrate.js            # against DATABASE_URL
     node migrate.js --check    # print which tables exist, change nothing   */
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

async function main() {
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required"); process.exit(1); }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === "false" ? false : { rejectUnauthorized: false } });
  const check = process.argv.includes("--check");
  try {
    if (!check) {
      const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
      await pool.query(sql);
      console.log("schema applied");
    }
    const r = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
    console.log("tables: " + r.rows.map((x) => x.table_name).join(", "));
  } finally { await pool.end(); }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
