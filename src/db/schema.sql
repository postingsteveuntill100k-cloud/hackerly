-- =====================================================================
-- Hackerly — relational schema
--
-- Design notes
--   * Every tenant-scoped table carries event_id. Cross-event access is
--     refused in the query layer, never by the client.
--   * Submissions are versioned. Teams can iterate a draft right up to the
--     deadline; each submitted version is frozen for judging.
--   * Judge review content is private to the authoring judge and to
--     organisers of that event. There is no code path that returns one
--     judge's notes to another judge.
--   * Result rows carry their own published flag, so "released" is a
--     decision an organiser makes, not something inferred from a clock.
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- people

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL,
  email_key      TEXT NOT NULL UNIQUE,          -- lowercased, for case-insensitive lookup
  name           TEXT NOT NULL,
  headline       TEXT NOT NULL DEFAULT '',
  organisation   TEXT NOT NULL DEFAULT '',
  bio            TEXT NOT NULL DEFAULT '',
  avatar_hue     INTEGER NOT NULL DEFAULT 24,   -- deterministic avatar tint
  password_hash  TEXT NOT NULL DEFAULT '',
  password_salt  TEXT NOT NULL DEFAULT '',
  auth_provider  TEXT NOT NULL DEFAULT 'password',
  created_at     TEXT NOT NULL,
  last_login_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email_key);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,             -- sha256 of the cookie value; raw token never stored
  user_agent  TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

-- Long-lived credentials for automation: CSV exports, integrations and the
-- acceptance checker. Hashed and revocable, exactly like a password.
CREATE TABLE IF NOT EXISTS api_tokens (
  id           TEXT PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id     TEXT REFERENCES events(id) ON DELETE CASCADE,  -- NULL = account-wide
  label        TEXT NOT NULL DEFAULT '',
  scopes       TEXT NOT NULL DEFAULT '[]',      -- JSON array: ["read","export",...]
  created_at   TEXT NOT NULL,
  expires_at   TEXT,
  revoked_at   TEXT,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);

-- ---------------------------------------------------------------- events

CREATE TABLE IF NOT EXISTS events (
  id                 TEXT PRIMARY KEY,
  slug               TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  tagline            TEXT NOT NULL DEFAULT '',
  about              TEXT NOT NULL DEFAULT '',   -- long-form markdown
  cover_hue          INTEGER NOT NULL DEFAULT 24,
  organiser_name     TEXT NOT NULL DEFAULT '',
  organiser_id       TEXT REFERENCES users(id) ON DELETE SET NULL,

  visibility         TEXT NOT NULL DEFAULT 'public'
                     CHECK(visibility IN ('public','unlisted','private')),
  status             TEXT NOT NULL DEFAULT 'draft'
                     CHECK(status IN ('draft','published','archived')),
  results_released   INTEGER NOT NULL DEFAULT 0,

  format             TEXT NOT NULL DEFAULT 'online'
                     CHECK(format IN ('online','in_person','hybrid')),
  venue              TEXT NOT NULL DEFAULT '',
  city               TEXT NOT NULL DEFAULT '',
  country            TEXT NOT NULL DEFAULT '',
  timezone           TEXT NOT NULL DEFAULT 'UTC',
  topics             TEXT NOT NULL DEFAULT '[]',  -- JSON array of tags

  -- lifecycle timestamps
  registration_opens_at  TEXT,
  registration_closes_at TEXT,
  starts_at              TEXT NOT NULL,
  ends_at                TEXT NOT NULL,
  submissions_open_at    TEXT,
  submissions_close_at   TEXT NOT NULL,
  judging_opens_at       TEXT,
  judging_closes_at      TEXT,
  results_at             TEXT,

  -- participation rules
  eligibility           TEXT NOT NULL DEFAULT '',
  min_team_size         INTEGER NOT NULL DEFAULT 1,
  max_team_size         INTEGER NOT NULL DEFAULT 4,
  allow_solo            INTEGER NOT NULL DEFAULT 1,
  allow_team_invites    INTEGER NOT NULL DEFAULT 1,
  participation_fee     TEXT NOT NULL DEFAULT '',
  max_participants      INTEGER NOT NULL DEFAULT 0,   -- 0 = unlimited
  require_approval      INTEGER NOT NULL DEFAULT 0,

  -- submission rules
  require_repo          INTEGER NOT NULL DEFAULT 0,
  require_demo          INTEGER NOT NULL DEFAULT 0,
  require_video         INTEGER NOT NULL DEFAULT 0,
  require_screenshots   INTEGER NOT NULL DEFAULT 0,
  submission_checklist  TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  code_of_conduct       TEXT NOT NULL DEFAULT '',
  rules                 TEXT NOT NULL DEFAULT '',

  -- presentation
  show_projects         INTEGER NOT NULL DEFAULT 1,
  allow_public_voting   INTEGER NOT NULL DEFAULT 0,
  allow_comments        INTEGER NOT NULL DEFAULT 0,

  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status, visibility);

CREATE TABLE IF NOT EXISTS event_roles (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK(role IN ('organiser','coordinator','judge','participant')),
  granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE(event_id, user_id, role)
);
CREATE INDEX IF NOT EXISTS idx_event_roles_lookup ON event_roles(event_id, user_id);

CREATE TABLE IF NOT EXISTS registrations (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state         TEXT NOT NULL DEFAULT 'pending'
                CHECK(state IN ('pending','confirmed','waitlisted','declined','withdrawn')),
  note          TEXT NOT NULL DEFAULT '',
  registered_at TEXT NOT NULL,
  reviewed_at   TEXT,
  reviewed_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_registrations_event ON registrations(event_id, state);

-- -------------------------------------------------------- event content

CREATE TABLE IF NOT EXISTS tracks (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  brief       TEXT NOT NULL DEFAULT '',    -- the long problem statement
  sponsor     TEXT NOT NULL DEFAULT '',
  colour      TEXT NOT NULL DEFAULT 'ink',
  position    INTEGER NOT NULL DEFAULT 0,
  UNIQUE(event_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_tracks_event ON tracks(event_id, position);

CREATE TABLE IF NOT EXISTS challenges (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  track_id    TEXT REFERENCES tracks(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sponsor     TEXT NOT NULL DEFAULT '',
  prize_label TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_challenges_event ON challenges(event_id, position);

CREATE TABLE IF NOT EXISTS schedule_items (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT 'session',
  location    TEXT NOT NULL DEFAULT '',
  starts_at   TEXT NOT NULL,
  ends_at     TEXT,
  position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_schedule_event ON schedule_items(event_id, starts_at);

CREATE TABLE IF NOT EXISTS announcements (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  kind       TEXT NOT NULL DEFAULT 'update',
  pinned     INTEGER NOT NULL DEFAULT 0,
  author_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_announcements_event ON announcements(event_id, created_at);

CREATE TABLE IF NOT EXISTS prizes (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  track_id    TEXT REFERENCES tracks(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  place_label TEXT NOT NULL DEFAULT '',
  value       TEXT NOT NULL DEFAULT '',
  sponsor     TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_prizes_event ON prizes(event_id, position);

CREATE TABLE IF NOT EXISTS faqs (
  id       TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer   TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_faqs_event ON faqs(event_id, position);

-- --------------------------------------------------- submission intake

CREATE TABLE IF NOT EXISTS submission_fields (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  field_key  TEXT NOT NULL,
  label      TEXT NOT NULL,
  help       TEXT NOT NULL DEFAULT '',
  kind       TEXT NOT NULL DEFAULT 'text',   -- text | longtext | url | select
  options    TEXT NOT NULL DEFAULT '[]',
  required   INTEGER NOT NULL DEFAULT 0,
  judges_see INTEGER NOT NULL DEFAULT 1,    -- does the judging panel read the answer?
  position   INTEGER NOT NULL DEFAULT 0,
  UNIQUE(event_id, field_key)
);
CREATE INDEX IF NOT EXISTS idx_submission_fields_event ON submission_fields(event_id, position);

-- --------------------------------------------------------------- teams

CREATE TABLE IF NOT EXISTS teams (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  tagline     TEXT NOT NULL DEFAULT '',
  invite_code TEXT NOT NULL,
  is_final    INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE(event_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_teams_event ON teams(event_id);

CREATE TABLE IF NOT EXISTS team_members (
  team_id   TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('lead','member')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);

CREATE TABLE IF NOT EXISTS team_invitations (
  id          TEXT PRIMARY KEY,
  team_id     TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'member',
  token_hash  TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','revoked')),
  invited_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  accepted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_team_invitations_team ON team_invitations(team_id, state);

-- ------------------------------------------------------------ projects

CREATE TABLE IF NOT EXISTS projects (
  id                TEXT PRIMARY KEY,
  event_id          TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id           TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  track_id          TEXT REFERENCES tracks(id) ON DELETE SET NULL,
  slug              TEXT NOT NULL,
  name              TEXT NOT NULL,
  tagline           TEXT NOT NULL DEFAULT '',
  description       TEXT NOT NULL DEFAULT '',
  tech_stack        TEXT NOT NULL DEFAULT '[]',
  repo_url          TEXT NOT NULL DEFAULT '',
  demo_url          TEXT NOT NULL DEFAULT '',
  video_url         TEXT NOT NULL DEFAULT '',
  cover_hue         INTEGER NOT NULL DEFAULT 24,
  screenshots       TEXT NOT NULL DEFAULT '[]',
  answers           TEXT NOT NULL DEFAULT '{}',  -- JSON keyed by submission_fields.field_key
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK(status IN ('draft','submitted','withdrawn','disqualified')),
  is_public         INTEGER NOT NULL DEFAULT 0,  -- opt-in to the public showcase
  submitted_at      TEXT,
  withdrawn_reason  TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE(event_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_projects_event ON projects(event_id, status);
CREATE INDEX IF NOT EXISTS idx_projects_team ON projects(team_id);

-- One frozen copy per submission, so judging is never affected by later edits.
CREATE TABLE IF NOT EXISTS project_submissions (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  snapshot     TEXT NOT NULL,    -- JSON snapshot of the project at submit time
  submitted_at TEXT NOT NULL,
  UNIQUE(project_id, version)
);
CREATE INDEX IF NOT EXISTS idx_project_submissions_project ON project_submissions(project_id);

-- -------------------------------------------------------------- judging

CREATE TABLE IF NOT EXISTS rubric_criteria (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  field_key   TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  weight      REAL NOT NULL DEFAULT 1,
  max_score   REAL NOT NULL DEFAULT 5,
  position    INTEGER NOT NULL DEFAULT 0,
  UNIQUE(event_id, field_key)
);
CREATE INDEX IF NOT EXISTS idx_rubric_event ON rubric_criteria(event_id, position);

CREATE TABLE IF NOT EXISTS judges (
  id                TEXT PRIMARY KEY,
  event_id          TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id           TEXT REFERENCES users(id) ON DELETE SET NULL,
  name              TEXT NOT NULL,
  email_key         TEXT NOT NULL,
  headline          TEXT NOT NULL DEFAULT '',
  organisation      TEXT NOT NULL DEFAULT '',
  bio               TEXT NOT NULL DEFAULT '',
  state             TEXT NOT NULL DEFAULT 'invited'
                    CHECK(state IN ('invited','verified','declined','removed')),
  access_code_hash  TEXT NOT NULL DEFAULT '',
  access_code_salt  TEXT NOT NULL DEFAULT '',
  invite_code       TEXT NOT NULL DEFAULT '',
  invited_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  invited_at        TEXT NOT NULL,
  verified_at       TEXT,
  last_active_at    TEXT,
  UNIQUE(event_id, email_key)
);
CREATE INDEX IF NOT EXISTS idx_judges_event ON judges(event_id, state);

CREATE TABLE IF NOT EXISTS judge_tracks (
  judge_id TEXT NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  PRIMARY KEY (judge_id, track_id)
);
CREATE INDEX IF NOT EXISTS idx_judge_tracks_track ON judge_tracks(track_id);

CREATE TABLE IF NOT EXISTS judge_assignments (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  judge_id     TEXT NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  state        TEXT NOT NULL DEFAULT 'assigned'
               CHECK(state IN ('assigned','in_progress','completed','revoked')),
  assigned_at  TEXT NOT NULL,
  due_at       TEXT,
  completed_at TEXT,
  UNIQUE(judge_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_assignments_judge ON judge_assignments(judge_id, state);
CREATE INDEX IF NOT EXISTS idx_assignments_project ON judge_assignments(project_id);
CREATE INDEX IF NOT EXISTS idx_assignments_event ON judge_assignments(event_id);

CREATE TABLE IF NOT EXISTS judge_conflicts (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  judge_id    TEXT NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL DEFAULT '',
  declared_at TEXT NOT NULL,
  UNIQUE(judge_id, project_id)
);

CREATE TABLE IF NOT EXISTS reviews (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  judge_id     TEXT NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
  state        TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','submitted')),
  summary      TEXT NOT NULL DEFAULT '',
  strengths    TEXT NOT NULL DEFAULT '',
  improvements TEXT NOT NULL DEFAULT '',
  concerns     TEXT NOT NULL DEFAULT '',
  recommend    TEXT NOT NULL DEFAULT '',    -- shortlist | discuss | pass
  total_score  REAL NOT NULL DEFAULT 0,
  submitted_at TEXT,
  updated_at   TEXT NOT NULL,
  UNIQUE(project_id, judge_id)
);
CREATE INDEX IF NOT EXISTS idx_reviews_judge ON reviews(judge_id, state);
CREATE INDEX IF NOT EXISTS idx_reviews_project ON reviews(project_id, state);
CREATE INDEX IF NOT EXISTS idx_reviews_event ON reviews(event_id);

CREATE TABLE IF NOT EXISTS review_scores (
  review_id    TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  criterion_id TEXT NOT NULL REFERENCES rubric_criteria(id) ON DELETE CASCADE,
  score        REAL NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (review_id, criterion_id)
);

CREATE TABLE IF NOT EXISTS pairwise_comparisons (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  judge_id   TEXT NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
  project_a  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  project_b  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  winner     TEXT NOT NULL DEFAULT '' CHECK(winner IN ('a','b','tie','')),
  rationale  TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(judge_id, project_a, project_b)
);
CREATE INDEX IF NOT EXISTS idx_pairwise_judge ON pairwise_comparisons(judge_id);

-- --------------------------------------------------------------- results

CREATE TABLE IF NOT EXISTS results (
  id               TEXT PRIMARY KEY,
  event_id         TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rank             INTEGER NOT NULL DEFAULT 0,
  track_rank       INTEGER NOT NULL DEFAULT 0,
  weighted_score   REAL NOT NULL DEFAULT 0,
  normalised_score REAL NOT NULL DEFAULT 0,
  public_votes     INTEGER NOT NULL DEFAULT 0,
  award            TEXT NOT NULL DEFAULT '',
  published        INTEGER NOT NULL DEFAULT 0,
  published_at     TEXT,
  computed_at      TEXT NOT NULL,
  UNIQUE(event_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_results_event ON results(event_id, published, rank);

CREATE TABLE IF NOT EXISTS votes (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_votes_project ON votes(project_id);

CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  state      TEXT NOT NULL DEFAULT 'visible' CHECK(state IN ('visible','hidden')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_project ON comments(project_id, state);

-- ---------------------------------------------------------------- audit

CREATE TABLE IF NOT EXISTS audit_log (
  id            TEXT PRIMARY KEY,
  event_id      TEXT,
  actor_id      TEXT,
  actor_role    TEXT NOT NULL DEFAULT 'visitor',
  action        TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id   TEXT,
  outcome       TEXT NOT NULL DEFAULT 'ok',
  detail        TEXT NOT NULL DEFAULT '',
  at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_log(event_id, at);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id, at);
