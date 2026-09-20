# tagup

**Prices today. On shelf tomorrow.**

Reps ask for price tags and shelf signs from their phone. The sign shop prints the day's
requests in every chain's own style, on whatever sheet is in the printer. Multi-tenant,
self-serve signup, 14-day trial.

## Run it

```bash
npm install
node dev.js --seed        # no database needed: pg-mem in-process, a demo workspace, sign-in URLs printed
```

Open http://localhost:3000. Email links (verify, reset, invite) print to the console until
`POSTMARK_TOKEN` is set.

Production:

```bash
cp .env.example .env      # DATABASE_URL, SESSION_SECRET, APP_URL, POSTMARK_TOKEN, ANTHROPIC_API_KEY
node migrate.js           # applies schema.sql, idempotent -- safe on every deploy
node build.js             # bundles src/ -> public/bundle.js
node index.js
```

## Scripts

| | |
|---|---|
| `node test/integration.test.js` | the real Express app on pg-mem with the real schema: tenancy, roles, lifecycle, import, rules, trial gate |
| `node test/units.test.js` | pure pieces: rules engine, sheet parsers, mail transport |
| `node build.js [--watch]` | esbuild, one IIFE, ~440 KB |
| `node scripts/shots.js dev.log` | headless-Chrome screenshots of every screen incl. the rep flow, via DevTools protocol |
| `node migrate.js --check` | list tables, change nothing |

## Shape

- `server.js` — `createApp(pool, opts)`. JWT sessions (Bearer, cookie, or `?t=` for a page a browser opens directly); `X-Org-Id` (or `?org=`) selects the workspace; **every scoped query reads `session.org`, never the body.**
- `lib/auth.js` — signup / login / verify / reset / invites / members. Never reveals whether an email exists.
- `lib/tagup.js` — the org-scoped product: stores, styles, materials, requests, batches, print, Excel import/export.
- `lib/tagup-core.js` — **pure, isomorphic renderer + rules engine.** The rep's preview, the style editor's sample and the print sheet are one function. Bundled into the client.
- `lib/tagup-import.js` — the price-book parser (header anywhere, Tagify price forms).
- `lib/brands.js` — the global brand library (recognize → find on Wikimedia → AI check → human approve). Shared across workspaces; per-org overrides stay private.
- `lib/catalog.js` — an org's item list.
- `lib/email.js` — Postmark over one `fetch`; console fallback, reported on `/api/health`.
- `src/` — React app: `app.jsx` (router, public pages, shell), `tagup-ui.jsx` (tag screens), `admin.jsx` (stores, catalog, team, settings, help), `tutorials.js` (lessons; drop a video URL in and it plays).
- `schema.sql` — every statement `IF NOT EXISTS`. Additive changes go here; nothing ever DROPs.

## Accounts

The account list stands on its own: upload the export you already have -- **Account Name**,
**Account #**, **Address**, **City**, **Chain**, **Sales Rep**, **Sales Rep #** (a route number
works; `Route` / `Salesman` / `Street` are read as synonyms). Header on any row; re-upload
updates by account number. A member carries a **Rep #**; a rep's picker shows the accounts
whose rep # is theirs (else the ones whose Sales Rep reads as their name), and every account
when the list does not know them yet -- with a note saying so. Team lists the reps the file
names who are not on the team, one Invite each, rep # riding along.

## Rules

Since a request is data and a style is data, the styles carry rules: `when` a field meets a
condition, `set` colours or copy. `{price}` `{was}` `{each}` `{qty}` in copy resolve from the
request. Rules run top to bottom; later wins. Presets: "Reg. {was}" under promos, "Single
retail at {each}" for multi-buys, GPM-style colour by 2-for tier.

## Roles

owner / admin (everything) · manager (their team's queue and batches; read-only setup) ·
rep (asks for tags for their stores, sees their own). A rep's whole app is the request flow.

## Trial

14 days at signup. When it ends, reads keep working (queue, batches, print sheets), writes
answer 402. Billing is not built — `plan` is a column; set it to anything but `trial` to lift the gate.
