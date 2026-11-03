-- Tables for pattern P3 (release expired slot holds). Run once in your own database.
-- Shape taken from a table that holds appointment slots while a visitor decides.
-- The columns that only matter to the original product were left out.
CREATE TABLE IF NOT EXISTS clients (
  site_key          text PRIMARY KEY,
  calendar_id       text,
  calendar_provider text
);

CREATE TABLE IF NOT EXISTS slot_holds (
  id                bigserial PRIMARY KEY,
  site_key          text        NOT NULL,
  lead_id           bigint      NOT NULL,
  slot_start        timestamptz NOT NULL,
  slot_end          timestamptz NOT NULL,
  status            text        NOT NULL DEFAULT 'held',
  held_at           timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  confirmed_at      timestamptz,
  released_at       timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  calendar_event_id text
);

-- One active (held or confirmed) hold per slot. The predicate has no now() in it:
-- a partial index predicate must be immutable, so expiry is done by the job below
-- changing status, not by the index.
CREATE UNIQUE INDEX IF NOT EXISTS slot_holds_active_uniq
  ON slot_holds (site_key, slot_start) WHERE status = ANY (ARRAY['held', 'confirmed']);

-- One active hold per lead.
CREATE UNIQUE INDEX IF NOT EXISTS slot_holds_active_per_lead
  ON slot_holds (lead_id) WHERE status = ANY (ARRAY['held', 'confirmed']);

-- The release job only ever looks at held rows, ordered by expiry.
CREATE INDEX IF NOT EXISTS slot_holds_expiry_idx
  ON slot_holds (expires_at) WHERE status = 'held';
