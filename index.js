/* index.js -- production entry point. Real Postgres, real secrets from the
   environment. server.js stays pool-agnostic so tests can hand it pg-mem
   instead of this.

   Boot does three things a host would otherwise need separate steps for:
   1. builds public/bundle.js (it is a build artifact, gitignored -- a deploy
      straight from the repo has no bundle, and the SPA fallback then serves
      index.html for /bundle.js: a blank page with the right background,
      which is exactly what taguptags.com showed on 2026-09-20);
   2. listens immediately, so the platform healthcheck passes;
   3. applies schema.sql (every statement IF NOT EXISTS) in the background,
      so a fresh database is ready without anyone running migrate.js.       */
"use strict";
require("dotenv").config();
const fs = require("fs");
const { Pool } = require("pg");
const path = require("path");
const express = require("express");
const { createApp } = require("./server");

if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required"); process.exit(1); }
if (!process.env.SESSION_SECRET) { console.error("SESSION_SECRET is required (openssl rand -hex 32)"); process.exit(1); }

// 1. The bundle. ~300 ms; done every boot so a pull is never served stale.
const BUNDLE = path.join(__dirname, "public", "bundle.js");
try {
  require("esbuild").buildSync({
    entryPoints: [path.join(__dirname, "src/app.jsx")], bundle: true, outfile: BUNDLE, jsx: "automatic",
    loader: { ".jsx": "jsx", ".js": "jsx" }, minify: true, target: ["es2019"],
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "warning",
  });
  console.log("built public/bundle.js (" + fs.statSync(BUNDLE).size + " bytes)");
} catch (e) {
  if (fs.existsSync(BUNDLE)) console.error("bundle build failed, serving the existing bundle:", e && e.message);
  else { console.error("bundle build failed and no bundle exists -- the app cannot render:", e && e.message); }
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === "false" ? false : { rejectUnauthorized: false } });

const app = createApp(pool, {
  signSecret: process.env.SESSION_SECRET,
  appUrl: process.env.APP_URL || "",
  env: process.env,
});

// Static frontend. app.listen fires immediately regardless of DB state,
// same rule the embedded product's Cloud Run healthcheck depends on.
app.use(express.static(path.join(__dirname, "public")));
app.use((req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// 2. Listen first ...
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("tagup listening on " + PORT));

// 3. ... then the schema, idempotent, in the background.
pool.query(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"))
  .then(() => console.log("schema applied"))
  .catch((e) => console.error("schema apply failed (signups will fail until fixed):", e && e.message));
