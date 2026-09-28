# Data model

SQLite, through Node's built-in driver. The whole schema is in
[`src/db/schema.sql`](src/db/schema.sql) and is applied with
`CREATE TABLE IF NOT EXISTS` on every connection, so there is no migration
history to carry.

## Principles

**Every tenant-scoped table carries `event_id`.** Cross-event access is
refused by the query layer, not by the client. A query that wants data
without an `event_id` is a bug, and a reviewer's job is to notice.

**Identifiers are opaque.** `prj_9k2…`, `trk_1a…`. Prefixes make logs
readable and carry no meaning — nothing branches on a prefix. The acceptance
fixtures keep their original ids so that the checker and any external
reference agree.

**Timestamps are ISO 8601 in UTC.** The event's own timezone is a display
concern, applied in `lib/lifecycle.js`. Storage never carries a local offset.

**Flags are integers with a CHECK constraint.** SQLite has no boolean type and
pretending otherwise in the schema would only hide the constraint.

## The shape

### People

| Table | Holds |
| --- | --- |
| `users` | name, email (stored twice: as written and lowercased for lookup), headline, organisation, scrypt hash and salt, avatar hue |
| `sessions` | a SHA-256 hash of the cookie value, expiry, revocation. The raw value is never stored. |
| `api_tokens` | the same, for automation. Optionally scoped to one event, with a scope list. |

### Events

| Table | Holds |
| --- | --- |
| `events` | identity, format, venue, timezone, visibility, status, every milestone, participation rules, submission requirements, presentation switches |
| `event_roles` | who organises, coordinates, judges or takes part in this event |
| `registrations` | one row per person, with a state and a note to the organisers |

`events` is wide on purpose. Every one of those columns is something an
organiser has to decide before a hackathon runs, and hiding them behind a
settings table would only move the decision, not remove it.

### Event content

`tracks`, `challenges`, `schedule_items`, `announcements`, `prizes`, `faqs`,
`submission_fields`.

All are optional. A section renders only when the event actually has content
for it, because an empty "Prizes" heading is worse than no heading.

`submission_fields` is the interesting one: it is the event's own intake form.
Each field has a `judges_see` flag, because most events ask more questions
than the panel needs to read.

### Teams and projects

| Table | Holds |
| --- | --- |
| `teams` | name, tagline, invite code |
| `team_members` | lead or member, one row per person |
| `team_invitations` | an email, a hashed token, a state |
| `projects` | everything a team wrote, plus status and showcase opt-in |
| `project_submissions` | a frozen JSON snapshot per submit |

`project_submissions` exists for one reason: a project must not be able to
change underneath a judge. Each submit writes an immutable copy. The
participant editor says how many versions exist, and an organiser can see the
history.

A project belongs to exactly one team, and a person belongs to one team per
event. The seeder asserts both.

### Judging

| Table | Holds |
| --- | --- |
| `rubric_criteria` | name, description, weight, maximum |
| `judges` | the panel for this event, with an access code, a state, and a link to a user account |
| `judge_tracks` | which tracks a judge covers |
| `judge_assignments` | who reviews what, and whether it is done |
| `judge_conflicts` | a declared conflict, which withdraws the assignment |
| `reviews` | the prose and the state |
| `review_scores` | one row per criterion per review, with an optional note |
| `pairwise_comparisons` | head-to-head wins and losses |

A judge is admitted by an organiser sending a one-time code. Verifying it
attaches the code to the account that matches the judge's email, and only
then does that account see anything. Until then the account cannot read a
single project — not the list, not a project page, not the API.

`reviews` has a unique constraint on `(project_id, judge_id)`. One judge, one
review per project, and re-saving updates rather than duplicating.

### Results and public surface

`results` carries its own `published` flag alongside `events.results_released`.
Publishing sets both. Unpublishing clears both. Nothing else touches them.

`votes` and `comments` are the two switchable public features; both are off
unless the organiser turns them on for their event.

### Audit

`audit_log` is append-only and never read by a user-facing page except the
organiser's activity tab. Denials are recorded as well as grants, because a
judge repeatedly asking for a peer's scores is a fact worth having.

## Reading it

All reads go through [`src/lib/queries.js`](src/lib/queries.js). Views never
build SQL. Each function is event-scoped and returns only the fields the
calling surface is allowed to see — a judge's record never carries an email
address, because nothing renders one.

## Writing it

Named columns, always. `src/db/seed/insert.js` takes a table name and an object
and derives the statement, which removes the entire class of off-by-one
placeholder mistakes that a long hand-written `VALUES` clause invites.

## Getting data out

- `GET /api/export.csv?event=<slug>` — one row per submitted review, rubric
  flattened into columns. Organiser only. Cells are quoted, internal quotes
  doubled, and a leading `=`, `+`, `-` or `@` is prefixed so a spreadsheet
  cannot execute a formula that came from a participant.
- `GET /api/export/standings.csv?event=<slug>` — the computed ranking.
- The JSON API under `/api` for everything else.

## Seeding

`npm run seed` is additive. It fills in anything missing and touches nothing
that already exists, which is why it is safe to run on every boot.

`src/db/seed/fixtures.js` loads `fixtures.json` verbatim: the event keeps its
own id and its own close date, the duplicate submission is preserved, reviews
with no comment are kept as drafts, and every supplied score is stored. The
fixtures supply no descriptions, taglines or technology, so the adapter adds
presentation copy for the showcase and leaves every judged value alone.

`src/db/seed/demo.js` adds the live and finished events with hand-written
project write-ups, rosters, reviews and results. It is example content and is
labelled as such throughout the interface.
