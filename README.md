# Hackerly

A hackathon platform. One place to discover events, take part in them, host
them, judge what gets built, and publish the results.

Three things Hackerly is trying to do properly:

- **Run an event.** Identity, eligibility, deadlines, teams, tracks,
  challenges, prizes, schedule, submission requirements, a weighted rubric,
  judge invitations and assignments, announcements, and results — configured
  by the organiser, published on the event's own page.
- **Take part in one.** Register, form a team, draft a project as you work,
  see exactly what is still missing, submit before the deadline, follow the
  event to its results.
- **Judge software.** A workspace where the demo, the repository, the
  write-up, the submission answers and the rubric are on one page, with
  side-by-side comparison, head-to-head comparison, and scores that stay
  private to the judge who wrote them.

Open source, MIT licensed, and self-hostable with one command.

---

## Run it

```bash
git clone <this repository> hackerly
cd hackerly
docker compose up --build
```

Then open **http://localhost:8080**.

That is the whole setup. No cloud account, no hosted database, no API key, no
outbound network request at runtime. The SQLite file lives in a named volume
so a rebuild never loses anything.

To run without Docker:

```bash
npm install
npm start          # http://localhost:10000
```

Node 22.5 or newer is required — Hackerly uses the built-in `node:sqlite`
module, so the only runtime dependency is Express.

### Try it

The first boot seeds four events and a set of accounts so that every part of
the product has something real in it. Sign in with any of these; the password
is `hackerly-demo`.

| Account | Email | What they can do |
| --- | --- | --- |
| Organiser | `organiser@hackerly.dev` | Create and run hackathons end to end |
| Judge | `judge@hackerly.dev` | Review assigned projects, compare, score |
| Judge (second) | `judge2@hackerly.dev` | A second panel member, for checking isolation |
| Participant | `participant@hackerly.dev` | Registered, on a team, with a project in progress |

The seeded events:

- **Signal 2026** — live. Registration has closed, submissions are open and
  judging has begun. This is what a participant, an organiser and a judge all
  work in.
- **Foundry 2026** — finished, judged, results published. This is what the
  public showcase and the results pages show.
- **Sample Hack 2026** — the reference event, loaded from `fixtures.json`. It
  is finished, its deadline is deliberately in the past, and a submission
  attempt against it is refused.
- **Meridian Invitational** — private. Not listed, not readable, not visible
  in any API. It exists so the visibility rules can be checked rather than
  assumed.

### Not interested in demo data?

```bash
SEED_DEMO=false npm start
```

You then get an empty instance and create your first hackathon from
`/host/new`. Fixtures still load unless you point `FIXTURES_PATH` elsewhere;
set `SEED_ON_BOOT=false` to skip that too.

---

## Configuration

Every value has a working default. Set only what you need.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `10000` | Port to listen on |
| `HOST` | `0.0.0.0` | Interface to bind |
| `DATABASE_PATH` | `./data/hackerly.db` | SQLite file. Put it on a volume in production. |
| `PUBLIC_ORIGIN` | `http://localhost:10000` | Absolute origin used for canonical links |
| `SECURE_COOKIES` | `false` | Set `true` behind HTTPS so session cookies carry `Secure` |
| `TRUST_PROXY` | `false` | Set `true` behind a load balancer so client IPs are correct |
| `SESSION_COOKIE` | `hkl_session` | Cookie name. `session` is also accepted for API clients. |
| `SESSION_TTL_DAYS` | `30` | Session lifetime |
| `SEED_ON_BOOT` | `true` | Seed fixtures when the database is empty |
| `SEED_DEMO` | `true` | Seed the demonstration events and accounts |
| `FIREBASE_VERIFY_ID_TOKENS` | `false` | Accept verified Firebase ID tokens |
| `FIREBASE_PROJECT_ID` | — | Firebase project, when the above is on |
| `SEED_DEMO_PASSWORD` | `hackerly-demo` | Password for the seeded demo accounts |
| `HACKERLY_PORT` | `8080` | Host port used by `docker-compose.yml` |

### Environment file

```bash
cp .env.example .env    # then edit
```

`.env` is gitignored. Never commit a Firebase service account.

---

## Database

SQLite, through Node's built-in driver. There is no migration framework: the
schema in `src/db/schema.sql` is applied with `CREATE TABLE IF NOT EXISTS` on
every connection, so a new install and an old one can run the same code.

```bash
npm run seed            # add anything missing
npm run reset           # wipe and re-seed (local development only)
npm run check:db        # what is in the database right now
```

Seeding is additive and idempotent. Running it against a populated database
does not touch what is already there, which is why `docker compose up` on an
existing volume is safe.

For a larger installation, put the SQLite file on a real volume and run a
single process. Hackerly is deliberately a single-writer application; it does
not support several app processes writing to one database file.

---

## Authentication

Email and password, with `scrypt` and a per-user salt. Sessions are stored as
a SHA-256 hash of the cookie value, so a copy of the database does not hand out
live logins. Cookies are `HttpOnly` and `SameSite=Lax`.

Long-lived API tokens exist for automation — CSV exports, integrations,
scripts. They are hashed the same way, scoped to a user and optionally to one
event, and revocable. The seeder mints four and prints them on boot.

**Firebase is optional.** Set `FIREBASE_VERIFY_ID_TOKENS=true` and
`FIREBASE_PROJECT_ID` and the portal will additionally accept a verified
Firebase Auth ID token. No service-account private key is read at runtime; the
client SDK obtains tokens and the portal verifies them against Google's
public signing keys. A Firebase token never grants a role — roles come from
the database, always.

To deploy the static front end to Firebase Hosting, see
[Deployment](#deployment).

---

## Tests

```bash
npm test
```

Two suites, both against a real server and a real database:

- `tests/authorization.test.js` — attacks the backend over HTTP. Judge
  isolation, cross-event access, private events, results publication,
  credential handling, deadline enforcement, CSV safety.
- `tests/behaviour.test.js` — the rules the product promises: what a phase
  means, what a score is, that the seed data is internally consistent, that no
  public page leaks an email address or an internal identifier, and that a
  signed-in person can always find a way to sign out.

There is also a human critic that drives the running portal in a real browser
through six personas and reports what it finds:

```bash
npm start
npm run critic                 # all personas, screenshots to /tmp/hackerly-critic
python3 tools/critic.py --only judge
```

It is not a smoke test. It navigates, fills forms, clicks through scoring,
and fails when a workflow is broken — and it is the reason several real bugs
in this repository were found and fixed.

---

## Deployment

### Docker

```bash
HACKERLY_PORT=8080 PUBLIC_ORIGIN=https://hackathon.example.com docker compose up -d
```

Behind a reverse proxy, set `SECURE_COOKIES=true` and `TRUST_PROXY=true`.

### Firebase Hosting for the front end

The static assets in `public/` are a complete progressive-enhancement front
end: every page works with JavaScript disabled. Hosting them on Firebase
serves the marketing and showcase surfaces from the edge.

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only hosting --project nexuslabs-b7b5e
```

`.firebaserc` pins the default project. The Firestore ruleset denies
everything, because Hackerly does not use Firestore for application data and
a misconfiguration should fail loudly.

Note that Firebase Hosting serves static files only. The interactive parts of
Hackerly — signing in, submitting, scoring, the organiser console — need the
Node application behind it. Point a reverse proxy at the container and let
Firebase serve the public assets, or just run Hackerly on its own.

---

## The reference files

DOGFOOD 2026 supplies `fixtures.json`, `run.py` and a `.dogfood.toml`. They are
committed unmodified apart from the routes in our own `.dogfood.toml`.

```bash
npm run acceptance          # python3 run.py .dogfood.toml
```

The committed `acceptance-report.txt` is whatever that printed. All seven
checks pass. We claim T1 and T2 and verify both. See *Honest limits* below for
what is and is not finished.

---

## Honest limits

Things that are true, and worth knowing before you rely on them.

- **T3 is not claimed.** Public voting and comments are implemented and
  switchable per event, and results are hidden until an organiser publishes
  them. Random ballot order is not implemented, and the acceptance checker has
  no T3 assertions, so claiming it would be a guess dressed as a result.
- **T4 is not claimed.** There is a documented JSON API under `/api` and CSV
  export, but no webhooks, no certificate issuing and no verifiable judge
  records.
- **Normalisation is a disclosed heuristic**, not a theorem. See
  [JUDGING.md](JUDGING.md). It is explained on the results page rather than
  hidden, and it says so when it declines to correct a judge.
- **Judging does not open until the organiser says so.** Assignments and
  reading material are available from the moment a judge is verified; writing
  scores waits for the judging window. That is deliberate, and it is why the
  seeded event has judging open now.
- **Email delivery is not implemented.** Judge invitations and team invites
  record the invitation and show the link in the organiser console, but
  nothing is sent. Wire an SMTP relay to `src/routes/auth.js` and
  `src/routes/participant.js` if you need it.
- **One process.** SQLite plus a single writer. There is no horizontal
  scaling story, and pretending otherwise would be worse than saying so.
- **Docker was not executed in the environment this was built in.** The
  `Dockerfile` and `docker-compose.yml` are written to be correct and the
  image runs the same entry point as `npm start`, which is tested; the
  container itself has not been built here.
- **Pairwise judging is a bonus mode.** It solves a Bradley–Terry model over
  your own comparisons and reports relative strength. It is not part of
  standings.

---

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — how it is put together and why
- [DATA-MODEL.md](DATA-MODEL.md) — the schema, and the way in and out
- [JUDGING.md](JUDGING.md) — assignment, scoring, normalisation

## Licence

MIT. See [LICENSE](LICENSE).
