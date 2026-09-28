# Architecture

Hackerly is one Node process and one SQLite file. There is no build step, no
bundler, and no client framework. The reasons are worth stating before the
structure, because every structural decision follows from them.

## Why server-rendered

The primary surfaces — a public event page, a project write-up, a judging
workspace — are documents. They should arrive complete, be linkable, be
readable by anything, and be fast on a bad connection. Rendering them on the
server means the browser receives the answer, not a plan for how to get it.

Progressive enhancement covers the rest. `public/js/app.js` adds autosave, the
comparison tray, head-to-head picking, keyboard shortcuts between media
panels and a live score total. Every one of those has a server-side equivalent:
a form posts, a selection is a query string, a score is a number in the
database. Disabling JavaScript costs convenience, not function.

## Why SQLite

A hackathon platform is a small number of people working on a small number of
events. The write volume is a few thousand rows. SQLite in WAL mode handles
that comfortably, removes an entire class of operational problem, and makes
`docker compose up` a complete deployment.

`node:sqlite` ships with Node 22, so the only runtime dependency in the whole
application is Express.

## Layout

```
src/
  config.js            every knob, with a working default
  server.js            middleware chain, static files, error handling, boot
  db/
    schema.sql         the whole schema
    index.js           connection, pragmas, schema application
    seed/
      index.js         additive, idempotent seeding
      fixtures.js      the shared acceptance fixtures
      demo.js          the seeded events and accounts
      insert.js        named-column insert helper
      cli.js           `npm run seed`
  lib/
    auth.js            scrypt, sessions, API tokens, identity resolution
    authz.js           every role check, in one file
    lifecycle.js       phases, gates, date formatting
    judging.js         weighting, normalisation, standings, Bradley-Terry
    queries.js         the read model; views never build SQL
    html.js            escaping, safe URLs, the markdown subset
    validate.js        field validation
    audit.js           the append-only trail
    firebase.js        optional ID token verification
  routes/              thin HTTP: parse, guard, call, render
  views/               functions that return HTML strings
public/
  css/hackerly.css     the design system
  js/app.js            progressive enhancement
  fonts/               self-hosted, so nothing is fetched from a CDN
tools/critic.py        the human critic
tests/                 authorization and behaviour
```

## The request path

```
request
  → security headers
  → body parsing
  → identity: cookie, bearer token, or verified Firebase token
  → event context: which event, and what is this person's role in it
  → router
      → guard (requireStaff / requireJudge / requireParticipant)
      → handler
          → lib: the actual work
          → view: HTML
  → error handler, or a 404 page
```

Identity and event context are resolved once, before any router runs. Every
route reads roles from `req.actor`, which was populated from the database on
this request. Nothing in the browser can influence it.

## The authorization model

This is the part worth reading carefully, because the interesting failures in
a platform like this are not rendering failures.

**Roles are per event.** A role only exists in the context of an event, and it
lives in `event_roles` (or, for judges, in the `judges` table where the panel
membership itself is the grant). There is no global "admin" flag that leaks
across tenants.

**Cross-event access is refused by construction.** Every tenant-scoped query
takes an `event_id` and is scoped by it. Changing an id in a URL does nothing,
because the id is only ever used together with a membership the caller has
already proved.

**Review content is private to its author.** A judge reads their own review.
Not a peer's, not through the API, not by changing a query parameter.
Organisers of the event can read every review, because they are accountable
for the outcome. Participants cannot read any of it until results are
published. `tests/authorization.test.js` asserts each of these over HTTP.

**Results are a data decision.** `results.published` and
`events.results_released` are set by an organiser pressing a button. A clock
never publishes anything. The public API returns `results: null` — not an empty
array, not a partial list — until then.

**Deadlines are server-side.** `lifecycle.submissionGate` is evaluated on
every write that touches a submission. A browser that says the deadline is
still open, a crafted `Content-Type`, and a stale page all meet the same
check.

**Credentials are hashed.** Sessions and API tokens are stored as a SHA-256
hash of the value the client holds. Revoking is a row update. Nothing that
reads a query string is a credential, and there is a test that says so.

## Views

Views are plain functions that return strings. They cannot forget to escape a
value because there is no interpolation shortcut — emitting a value means
calling `esc()` on it. There is no template language, no auto-escaping toggle
to get wrong, and no client-side rendering to disagree with the server about
what a user is allowed to see.

The cost is that the views are long. That is a fair trade: a long function
that builds a page is easier to audit than a short one that dispatches into a
framework.

## The design system

One stylesheet, one set of tokens, light and editorial. Warm paper, near-black
ink, one vermilion accent used sparingly, and typography doing most of the
work. Type is self-hosted (Inter for text, Fraunces for display, JetBrains
Mono for numerals) so nothing is fetched from a CDN and nothing changes
because somebody else's stylesheet did.

Imagery is generated. Every event and every project gets a deterministic
composition derived from its own name, so a listing of forty projects reads as
forty things rather than forty identical placeholders — and no fake
photography is shipped. `views/components.js` holds the generator.

## Why no client framework

The interactive surfaces are: a rubric that saves as you type, a comparison
tray, a pairwise picker, media panels. All of it is in one file of about three
hundred lines of vanilla JavaScript. A framework would add a build step, a
lockfile to maintain, and a hydration boundary, in exchange for nothing these
surfaces need.

## Testing strategy

Two suites, both against a real server over HTTP against a real database, and
a human critic that drives a real browser.

The tests exist to catch the failure modes that reading a page will not: a
judge reading a peer, a result appearing early, an email address on a public
page, a seed that contradicts the rules the product enforces.

The critic exists because passing tests is not the same as being usable. It
found the missing sign-out control, the routing collision between the public
project page and the participant workspace, a form that validated and then
threw the messages away, and a write-up hidden behind a tab. None of those are
test failures. All of them are the product being bad.
