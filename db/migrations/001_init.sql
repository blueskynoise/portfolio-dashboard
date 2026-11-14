-- Access-evaluation storage.
--
-- Data minimisation is part of the schema: no full IP address and no full
-- User-Agent string is stored. Addresses are kept as a keyed hash (for
-- counting) and a truncated prefix (for seeing patterns).

CREATE TABLE policy_versions (
  version      text PRIMARY KEY,
  activated_at timestamptz NOT NULL DEFAULT now(),
  document     jsonb NOT NULL
);

CREATE TABLE assessments (
  id                  text PRIMARY KEY,
  request_id          text NOT NULL,
  created_at          timestamptz NOT NULL,
  policy_version      text NOT NULL,
  decision            text NOT NULL CHECK (decision IN ('ALLOW', 'CHALLENGE', 'DENY')),
  assurance           text NOT NULL CHECK (assurance IN ('standard', 'reduced')),
  reason_codes        text[] NOT NULL,
  -- The visitor-facing report, already redacted.
  report              jsonb NOT NULL,
  ip_hmac             text,
  ip_prefix           text,
  asn                 text,
  as_org              text,
  country             text,
  browser_family      text NOT NULL,
  browser_major       text,
  os_family           text NOT NULL,
  bot_status          text NOT NULL,
  session_continuity  text NOT NULL,
  total_ms            integer NOT NULL,
  signal_status       jsonb NOT NULL,
  -- Organisation that owns the address range, per the enrichment provider. An inference about a network, not a person.
  org_name            text,
  org_type            text,
  max_enrichment_age_seconds integer
);
CREATE INDEX assessments_created_at ON assessments (created_at);

-- Opt-in browser fingerprints. Written only after the visitor agrees.
-- Hashes are keyed with a server secret, so they are useless outside this database.
CREATE TABLE fingerprints (
  assessment_id  text PRIMARY KEY REFERENCES assessments (id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL,
  cookie_hash    text,
  library_hash   text NOT NULL,
  canvas_hash    text,
  webgl_hash     text,
  audio_hash     text,
  ip_prefix      text,
  asn            text,
  browser_family text NOT NULL,
  os_family      text NOT NULL,
  recognition    text NOT NULL,
  report         jsonb NOT NULL
);
CREATE INDEX fingerprints_library ON fingerprints (library_hash);
CREATE INDEX fingerprints_cookie ON fingerprints (cookie_hash) WHERE cookie_hash IS NOT NULL;
CREATE INDEX fingerprints_canvas ON fingerprints (canvas_hash) WHERE canvas_hash IS NOT NULL;

CREATE TABLE provider_calls (
  id             bigserial PRIMARY KEY,
  assessment_id  text NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL,
  provider       text NOT NULL,
  status         text NOT NULL,
  latency_ms     integer NOT NULL,
  age_seconds    integer,
  detail         text
);
CREATE INDEX provider_calls_created_at ON provider_calls (created_at);

CREATE TABLE sessions (
  id             text PRIMARY KEY,
  assessment_id  text NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL,
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  ua_hash        text NOT NULL
);
CREATE INDEX sessions_expires_at ON sessions (expires_at);

CREATE TABLE access_events (
  id          bigserial PRIMARY KEY,
  created_at  timestamptz NOT NULL,
  type        text NOT NULL,
  request_id  text NOT NULL,
  ip_hmac     text,
  detail      text
);
CREATE INDEX access_events_created_at ON access_events (created_at);

CREATE TABLE investigations (
  assessment_id  text PRIMARY KEY REFERENCES assessments (id) ON DELETE CASCADE,
  status         text NOT NULL CHECK (status IN ('open', 'closed')),
  note           text NOT NULL,
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL
);
