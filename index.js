/* index.js -- production entry point. Real Postgres, real secrets from the
   environment. server.js stays pool-agnostic so tests can hand it pg-mem
   instead of this. */
"use strict";
require("dotenv").config();
const { Pool } = require("pg");
const path = require("path");
const express = require("express");
const { createApp } = require("./server");

if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required"); process.exit(1); }
if (!process.env.SESSION_SECRET) { console.error("SESSION_SECRET is required (openssl rand -hex 32)"); process.exit(1); }

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("tagup listening on " + PORT));
