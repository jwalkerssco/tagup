-- tagup: multi-tenant schema.
-- Every business table carries org_id. Nothing here assumes one company's
-- data the way the embedded module did (no midUniverse, no branch, no
-- comms/rep/admin roles baked into sessions) -- an org defines its own
-- teams and invites its own users into roles.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------- accounts ----------------

CREATE TABLE IF NOT EXISTS orgs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text UNIQUE NOT NULL,          -- yourorg.tagup.app, and the signup handle
  name          text NOT NULL,
  plan          text NOT NULL DEFAULT 'trial', -- trial | starter | pro | enterprise (billing wires in later)
  trial_ends_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- The org's VIP Brand Builder distributor id (e.g. 02308), remembered after
-- the first logo import so a re-import is one click.
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS vip_distributor_id text;

CREATE TABLE IF NOT EXISTS users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text UNIQUE NOT NULL,
  password_hash  text NOT NULL,
  name           text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  verify_token   text,
  reset_token    text,
  reset_expires  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);

-- A user can belong to more than one org (an agency signing tags for two
-- clients, a rep who moves companies) -- role is per membership, not per user.
CREATE TABLE IF NOT EXISTS org_members (
  org_id     uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner','admin','manager','rep')),
  team_id    uuid,                              -- set once teams exist; a rep's own team
  invited_by uuid REFERENCES users(id),
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS org_invites (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  email      text NOT NULL,
  role       text NOT NULL CHECK (role IN ('admin','manager','rep')),
  team_id    uuid,
  token      text UNIQUE NOT NULL,
  invited_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '14 days',
  accepted_at timestamptz
);

-- Teams replace "branch": an org's own locations/regions. A team is optional
-- -- a small org with one location never needs to create one.
CREATE TABLE IF NOT EXISTS teams (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE org_members DROP CONSTRAINT IF EXISTS org_members_team_fk;
ALTER TABLE org_members DROP CONSTRAINT IF EXISTS org_members_team_fk;
ALTER TABLE org_members ADD CONSTRAINT org_members_team_fk FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;

-- ---------------- stores ----------------
-- Replaces midUniverse/accounts: the org's OWN store list, uploaded or typed
-- in, not borrowed from a parent app's account universe. chain is a free
-- string the org types (or a chain row it picked), same "raw spelling"
-- looseness the embedded version had, resolved through chain_aliases below.
CREATE TABLE IF NOT EXISTS stores (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  team_id    uuid REFERENCES teams(id) ON DELETE SET NULL,
  name       text NOT NULL,
  store_no   text,                              -- the org's own store number, for import matching
  city       text,
  chain_id   uuid,                              -- set once matched to a chains row
  chain_raw  text,                              -- what the org's own file called it
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Added 2026-09-20: an account list stands on its own -- address, and the
-- sales rep who owns the account (name + number, as the org's system prints
-- them). A member's rep_no is what maps a login to those accounts.
ALTER TABLE stores ADD COLUMN IF NOT EXISTS address  text;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS rep_name text;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS rep_no   text;
ALTER TABLE org_members ADD COLUMN IF NOT EXISTS rep_no text;
ALTER TABLE org_invites ADD COLUMN IF NOT EXISTS rep_no text;
CREATE INDEX IF NOT EXISTS stores_org_rep_idx ON stores (org_id, rep_no);
CREATE INDEX IF NOT EXISTS stores_org_idx ON stores (org_id, active);
CREATE UNIQUE INDEX IF NOT EXISTS stores_org_storeno_uq ON stores (org_id, store_no) WHERE store_no IS NOT NULL;

-- ---------------- chains (global, cross-tenant) ----------------
-- Retail chain identity is not private to one org -- "Stripes" means the
-- same thing to every distributor selling into it. A shared registry is
-- the product's actual moat: the aliases and styles other tenants have
-- already resolved benefit every new signup. An org's OWN style for a
-- chain stays private (tagup_styles.org_id); the chain identity and its
-- spelling aliases are shared.
CREATE TABLE IF NOT EXISTS chains (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text UNIQUE NOT NULL,
  label      text NOT NULL,
  aliases    jsonb NOT NULL DEFAULT '[]'::jsonb,
  logo_key   text,                              -- kv-style asset, see assets table
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------- brand logos (global, cross-tenant) ----------------
-- Same reasoning as chains: "Michelob Ultra" is one brand for every
-- customer. A shared, AI-assisted, human-approved library grows for
-- everyone as more orgs use the product -- the harder Tagify would be to
-- catch up to the more this fills in. An org may still override with its
-- own upload (brand_overrides), same escape hatch tagup always had.
CREATE TABLE IF NOT EXISTS brands (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_key   text UNIQUE NOT NULL,
  label       text NOT NULL,
  aliases     jsonb NOT NULL DEFAULT '[]'::jsonb,
  logo_key    text,
  source      text,
  source_url  text,
  candidates  jsonb NOT NULL DEFAULT '[]'::jsonb,
  status      text NOT NULL DEFAULT 'none' CHECK (status IN ('none','found','approved','rejected','manual')),
  confidence  numeric(4,2),
  note        text,
  approved_by uuid REFERENCES users(id),         -- which org's admin approved it first -- informational only
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS brand_overrides (
  org_id    uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  brand_id  uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  logo_key  text NOT NULL,
  PRIMARY KEY (org_id, brand_id)
);

-- ---------------- item catalog (per org) ----------------
-- An org's own price file / product list, the thing import matches
-- against. Optional -- an org with no catalog still imports, every row
-- just carries item_free_text.
CREATE TABLE IF NOT EXISTS catalog_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  item_no    text,
  name       text NOT NULL,
  brand      text,
  pack       text,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS catalog_items_org_idx ON catalog_items (org_id, active);

-- ---------------- styles / materials (per org, format + kind axes unchanged) ----------------
CREATE TABLE IF NOT EXISTS tagup_styles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  chain_id     uuid REFERENCES chains(id),       -- NULL = this org's Independent/default style
  name         text NOT NULL,
  format       text NOT NULL DEFAULT 'tag' CHECK (format IN ('tag','case_card')),
  kind         text NOT NULL DEFAULT 'composed' CHECK (kind IN ('composed','template')),
  logo_key     text,
  template_key text,
  template_w   numeric(6,3),
  template_h   numeric(6,3),
  fields       jsonb NOT NULL DEFAULT '[]'::jsonb,
  theme        jsonb NOT NULL DEFAULT '{}'::jsonb,
  rules        jsonb NOT NULL DEFAULT '[]'::jsonb,   -- NEW: conditional formatting (price tier -> color/text), the gap vs Tagify
  active       boolean NOT NULL DEFAULT true,
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tagup_styles_org_chain_fmt_uq ON tagup_styles (org_id, chain_id, format) WHERE chain_id IS NOT NULL AND active;

CREATE TABLE IF NOT EXISTS tagup_materials (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name       text NOT NULL,
  tag_w      numeric(6,3) NOT NULL,
  tag_h      numeric(6,3) NOT NULL,
  sheet_w    numeric(6,3) NOT NULL DEFAULT 8.5,
  sheet_h    numeric(6,3) NOT NULL DEFAULT 11,
  cols       int NOT NULL,
  rows       int NOT NULL,
  avery_sku  text,
  active     boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------- requests / batches / imports (per org) ----------------
CREATE TABLE IF NOT EXISTS tagup_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES users(id),
  user_name         text,
  team_id           uuid REFERENCES teams(id),
  store_id          uuid NOT NULL REFERENCES stores(id),
  store_name        text,
  chain_id          uuid REFERENCES chains(id),
  chain_label       text,
  content_type      text NOT NULL CHECK (content_type IN ('standard_price','promo','price_drop','operational')),
  format            text NOT NULL DEFAULT 'tag' CHECK (format IN ('tag','case_card')),
  item_no           text,
  item_name         text NOT NULL,
  item_free_text    boolean NOT NULL DEFAULT false,
  brand_id          uuid REFERENCES brands(id),
  package_size      text,
  price             numeric(10,2),
  was_price         numeric(10,2),
  multi_buy_qty     int,
  note              text,
  copies            int NOT NULL DEFAULT 1,
  style_id_override uuid REFERENCES tagup_styles(id),
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewed','printed','rejected','cancelled')),
  batch_id          uuid,
  import_id         uuid,
  reject_reason     text,
  reviewed_by       uuid REFERENCES users(id),
  edited_by         uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  printed_at        timestamptz
);
CREATE INDEX IF NOT EXISTS tagup_requests_org_queue_idx ON tagup_requests (org_id, status, created_at);

CREATE TABLE IF NOT EXISTS tagup_batches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  material_id     uuid NOT NULL REFERENCES tagup_materials(id),
  created_by      uuid REFERENCES users(id),
  request_ids     jsonb NOT NULL DEFAULT '[]'::jsonb,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','generated','printed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  generated_at    timestamptz,
  printed_at      timestamptz
);

CREATE TABLE IF NOT EXISTS tagup_imports (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  file_name  text,
  by_id      uuid REFERENCES users(id),
  sheet      text,
  mode       text,
  counts     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created    int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------- binary assets ----------------
-- One table for every uploaded/found image (chain logos, brand logos,
-- template artwork), namespaced the way the embedded kv rows were.
CREATE TABLE IF NOT EXISTS assets (
  id         text PRIMARY KEY,          -- ns_<random>, the credential
  ns         text NOT NULL,             -- ttpl | blogo | clogo
  mime       text NOT NULL,
  data       text NOT NULL,             -- base64
  meta       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------- onboarding ----------------
-- Drives the guided first-run: which steps an org has completed, so the
-- empty-state wizard knows what to show next and a returning admin who
-- finished onboarding never sees it again.
CREATE TABLE IF NOT EXISTS org_onboarding (
  org_id       uuid PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
  added_store  boolean NOT NULL DEFAULT false,
  picked_style boolean NOT NULL DEFAULT false,
  made_request boolean NOT NULL DEFAULT false,
  printed_one  boolean NOT NULL DEFAULT false,
  invited_team boolean NOT NULL DEFAULT false,
  dismissed    boolean NOT NULL DEFAULT false
);
