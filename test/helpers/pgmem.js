/* A real in-memory Postgres (pg-mem) running the ACTUAL schema.sql, so
   integration tests exercise real SQL -- real JOINs, real jsonb, real
   constraints -- not a hand-rolled stub that only proves the mock agrees
   with itself. Falls back gracefully: if pg-mem chokes on a Postgres
   feature it doesn't emulate, that failure is real information, not noise
   to route around. */
"use strict";
const { newDb } = require("pg-mem");
const fs = require("fs");
const path = require("path");

function freshPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({ name: "gen_random_uuid", returns: "uuid", implementation: () => require("crypto").randomUUID() });
  const schema = fs.readFileSync(path.join(__dirname, "..", "..", "schema.sql"), "utf8")
    .replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;/, ""); // pg-mem has no extension system; the function above covers what pgcrypto provided
  db.public.none(schema);
  const { Pool } = db.adapters.createPg();
  return new Pool();
}

module.exports = { freshPool };
