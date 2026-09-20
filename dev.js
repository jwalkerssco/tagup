/* dev.js -- run tagup with NO database installed: pg-mem in-process, the real
   schema.sql, everything else identical to index.js. State lives for the
   life of the process; restart and it is a fresh workspace.

     node dev.js              # http://localhost:3000, email links print to the console
     node dev.js --seed       # also creates a demo workspace and prints its sign-in

   Not for production -- index.js is. */
"use strict";
require("dotenv").config();
const path = require("path");
const express = require("express");
const { createApp } = require("./server");
const { freshPool } = require("./test/helpers/pgmem");

const pool = freshPool();
const PORT = process.env.PORT || 3000;
const app = createApp(pool, { signSecret: process.env.SESSION_SECRET || "dev-secret", appUrl: process.env.APP_URL || "http://localhost:" + PORT, env: process.env });
// Dev-only: the invite token otherwise lives only in the (console) email.
// Lets the seed accept an invite end to end. Never in server.js.
app.get("/api/_dev/invite-token", async (req, res) => {
  const r = await pool.query("SELECT token FROM org_invites WHERE email = $1 AND accepted_at IS NULL ORDER BY created_at DESC LIMIT 1", [String(req.query.email || "").toLowerCase()]);
  res.json({ token: r.rows[0] ? r.rows[0].token : null });
});
app.use(express.static(path.join(__dirname, "public")));
app.use((req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const server = app.listen(PORT, async () => {
  console.log("tagup dev on http://localhost:" + PORT + " (pg-mem, resets on restart)");
  if (process.argv.includes("--seed")) {
    const { seed } = require("./scripts/seed-demo");
    const out = await seed("http://localhost:" + PORT);
    console.log(JSON.stringify(out, null, 2));
  }
});
process.on("SIGINT", () => { server.close(); process.exit(0); });
