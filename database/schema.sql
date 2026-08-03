-- Speed skating results database schema

CREATE TABLE IF NOT EXISTS competitions (
    id          SERIAL PRIMARY KEY,
    name        TEXT        NOT NULL,
    date        DATE        NOT NULL,
    season      VARCHAR(9)  NOT NULL,   -- e.g. '2024-2025'
    track_type  CHAR(2)     NOT NULL CHECK (track_type IN ('ST', 'LT')),
    imported_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (name, date)
);

CREATE TABLE IF NOT EXISTS skaters (
    id          SERIAL PRIMARY KEY,
    code_pat    VARCHAR(30) NOT NULL UNIQUE,
    first_name  TEXT        NOT NULL,
    last_name   TEXT        NOT NULL,
    dob         DATE,
    gender      CHAR(1)     CHECK (gender IN ('M', 'F')),
    club_name   TEXT,
    club_abbrev VARCHAR(15),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS results (
    id              SERIAL PRIMARY KEY,
    competition_id  INT         NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    skater_id       INT         NOT NULL REFERENCES skaters(id),
    distance        TEXT        NOT NULL,
    qual_or_fin     TEXT        NOT NULL,   -- 'Qual' or 'Fin'
    heat            TEXT,
    lane            TEXT,
    time_ms         INT,                    -- milliseconds; NULL for DNS/DNF etc.
    time_display    TEXT,                   -- formatted string e.g. '1:02.34'
    place           INT,
    age_class       TEXT,                   -- category name at competition time
    finish_code     TEXT,                   -- NULL = clean finish; else DNF/DNS/P-xxx etc.
    points          NUMERIC(8,2),
    is_valid_time   BOOLEAN     NOT NULL DEFAULT FALSE,
    UNIQUE (competition_id, skater_id, distance, heat)
);

-- Indexes for the common query patterns
CREATE INDEX IF NOT EXISTS idx_results_skater       ON results(skater_id);
CREATE INDEX IF NOT EXISTS idx_results_competition  ON results(competition_id);
CREATE INDEX IF NOT EXISTS idx_results_distance     ON results(distance);
CREATE INDEX IF NOT EXISTS idx_results_valid        ON results(skater_id, distance, time_ms) WHERE is_valid_time = TRUE;
CREATE INDEX IF NOT EXISTS idx_skaters_name         ON skaters(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_competitions_season  ON competitions(season);

-- API keys for programmatic access (30-day expiry)
CREATE TABLE IF NOT EXISTS api_keys (
    id          SERIAL PRIMARY KEY,
    key_hash    VARCHAR(64) NOT NULL UNIQUE,  -- SHA-256 hex of raw key
    label       TEXT,
    created_by  TEXT        NOT NULL,         -- admin email
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash    ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_expires ON api_keys(expires_at);

-- View: best valid time per skater per distance (career)
-- Distance normalization: "400 (100) Round A" → "400 (100)" etc.
CREATE OR REPLACE VIEW best_times_career AS
WITH norm AS (
  SELECT
    r.skater_id,
    REGEXP_REPLACE(r.distance, ' Round [A-Za-z0-9]+$', '') AS distance,
    c.track_type,
    c.date   AS comp_date,
    c.name   AS comp_name,
    r.time_ms,
    r.time_display
  FROM results r
  JOIN competitions c ON r.competition_id = c.id
  WHERE r.is_valid_time = TRUE
),
ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY skater_id, distance, track_type
      ORDER BY time_ms ASC
    ) AS rn
  FROM norm
)
SELECT
  s.id            AS skater_id,
  s.code_pat,
  s.first_name,
  s.last_name,
  s.gender,
  s.club_name,
  s.club_abbrev,
  r.distance,
  r.track_type,
  r.time_ms       AS best_time_ms,
  r.time_display  AS best_time_display,
  r.comp_date     AS achieved_on,
  r.comp_name     AS achieved_at
FROM ranked r
JOIN skaters s ON r.skater_id = s.id
WHERE r.rn = 1;

-- View: best valid time per skater per distance per season
CREATE OR REPLACE VIEW best_times_by_season AS
WITH norm AS (
  SELECT
    r.skater_id,
    REGEXP_REPLACE(r.distance, ' Round [A-Za-z0-9]+$', '') AS distance,
    c.track_type,
    c.season,
    c.date   AS comp_date,
    c.name   AS comp_name,
    r.time_ms,
    r.time_display
  FROM results r
  JOIN competitions c ON r.competition_id = c.id
  WHERE r.is_valid_time = TRUE
),
ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY skater_id, distance, track_type, season
      ORDER BY time_ms ASC
    ) AS rn
  FROM norm
)
SELECT
  s.id            AS skater_id,
  s.code_pat,
  s.first_name,
  s.last_name,
  s.gender,
  s.club_name,
  s.club_abbrev,
  r.distance,
  r.track_type,
  r.season,
  r.time_ms       AS best_time_ms,
  r.time_display  AS best_time_display,
  r.comp_date     AS achieved_on,
  r.comp_name     AS achieved_at
FROM ranked r
JOIN skaters s ON r.skater_id = s.id
WHERE r.rn = 1;
