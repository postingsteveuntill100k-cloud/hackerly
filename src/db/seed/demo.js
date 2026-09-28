'use strict';

/**
 * Seeded content.
 *
 * Three events that between them exercise every state the product supports:
 *
 *   Signal 2026            live, submissions open, judging not yet — this is
 *                          what a participant, an organiser and a judge use
 *   Foundry 2026           finished, judged, results published — this is what
 *                          the public showcase and results pages show
 *   Meridian Invitational  private, invite only — proves visibility rules
 *
 * Plus the three demo accounts, and the deterministic API tokens the
 * acceptance checker and any scripted integration use.
 *
 * Everything here is example content. It is clearly labelled as such in the
 * interface; none of it is presented as real traction or real users.
 */

const { id, now, hashInt, slugify } = require('../../lib/ids');
const { db } = require('../index');
const auth = require('../../lib/auth');
const judging = require('../../lib/judging');
const { insert } = require('./insert');
const { seedFixtures } = require('./fixtures');

const DEMO_PASSWORD = 'hackerly-demo';

/* -------------------------------------------------------------------------- */

const PEOPLE = [
  ['Amara Okonkwo', 'amara@signal.dev', 'Staff engineer, Loop', 'Loop'],
  ['Mira Kaur', 'mira@signal.dev', 'Accessibility lead', 'Public Digital'],
  ['Tomás Varga', 'tomas@signal.dev', 'Data engineer', 'Northwind'],
  ['Lena Kovač', 'lena@signal.dev', 'Product designer', 'Independent'],
  ['Hiro Tanaka', 'hiro@signal.dev', 'Systems engineer', 'Kite'],
  ['Sofia Duarte', 'sofia@signal.dev', 'Researcher, civic tech', 'Open Civic Lab'],
  ['Noor Haddad', 'noor@signal.dev', 'Frontend engineer', 'Tidepool'],
  ['Emeka Adeyemi', 'emeka@signal.dev', 'Security engineer', 'Ledgerline'],
  ['Rosa Moreau', 'rosa@signal.dev', 'ML engineer', 'Fieldnotes'],
  ['Bruno Costa', 'bruno@signal.dev', 'Mobile engineer', 'Alta'],
  ['Yuki Sato', 'yuki@signal.dev', 'Backend engineer', 'Kite'],
  ['Thandi Dlamini', 'thandi@signal.dev', 'Community organiser', 'Ubuntu Cape Town'],
  ['Pavel Ivanov', 'pavel@signal.dev', 'Embedded engineer', 'Northwind'],
  ['Ines Rocha', 'ines@signal.dev', 'Data journalist', 'The Fold'],
  ['Jonas Vogel', 'jonas@signal.dev', 'DevOps', 'Loop'],
  ['Sana Aziz', 'sana@signal.dev', 'Product manager', 'Alta'],
  ['Diego Herrera', 'diego@signal.dev', 'Full-stack developer', 'Independent'],
  ['Nadia Rahman', 'nadia@signal.dev', 'Machine learning engineer', 'Fieldnotes'],
  ['Otto Brandt', 'otto@signal.dev', 'Site reliability engineer', 'Ledgerline'],
  ['Anya Sokolova', 'anya@signal.dev', 'Interaction designer', 'Public Digital'],
  ['Felix Roth', 'felix@signal.dev', 'Compiler engineer', 'Kite'],
  ['Lars Berg', 'lars@signal.dev', 'Hardware engineer', 'Northwind'],
  ['Ada Okoro', 'ada@signal.dev', 'Engineering manager', 'Loop'],
  ['Rafa Okonkwo', 'rafa@signal.dev', 'Developer advocate', 'Alta'],
  // A second pool, so a larger event can have real distinct rosters rather
  // than the same names appearing on several teams.
  ['Ivo Petrov', 'ivo@signal.dev', 'Backend engineer', 'Loop'],
  ['Wren Alvarez', 'wren@signal.dev', 'Data engineer', 'Kite'],
  ['Sana Rahimi', 'sana@signal.dev', 'Design systems', 'Public Digital'],
  ['Joel Amadi', 'joel@signal.dev', 'Platform engineer', 'Ledgerline'],
  ['Freya Lindgren', 'freya@signal.dev', 'Research engineer', 'Fieldnotes'],
  ['Marcus Oyelaran', 'marcus@signal.dev', 'Solutions architect', 'Northwind'],
  ['Petra Novak', 'petra@signal.dev', 'QA engineer', 'Independent'],
  ['Hassan Karim', 'hassan@signal.dev', 'Mobile engineer', 'Tidepool'],
  ['Elena Duarte', 'elena@signal.dev', 'Technical writer', 'The Fold'],
  ['Tobias Lang', 'tobias@signal.dev', 'Compiler engineer', 'Kite'],
  ['Aisha Bello', 'aisha@signal.dev', 'Security analyst', 'Ledgerline'],
  ['Kai Nakamura', 'kai@signal.dev', 'Game developer', 'Independent'],
  ['Beatrix Holm', 'beatrix@signal.dev', 'Data engineer', 'Fieldnotes'],
  ['Omar Farouk', 'omar@signal.dev', 'Infrastructure engineer', 'Loop'],
  ['Lucia Moreau', 'lucia@signal.dev', 'Accessibility tester', 'Public Digital'],
  ['Simon Achebe', 'simon@signal.dev', 'Engineering manager', 'Northwind'],
  ['Greta Lindholm', 'greta@signal.dev', 'Product designer', 'Alta'],
  ['Yusuf Kaplan', 'yusuf@signal.dev', 'Full-stack developer', 'Independent'],
  ['Nina Kowalska', 'nina@signal.dev', 'ML engineer', 'Fieldnotes'],
  ['Idris Bello', 'idris@signal.dev', 'Site reliability engineer', 'Tidepool'],
  ['Tessa Vogel', 'tessa@signal.dev', 'Hardware engineer', 'Northwind'],
  ['Arjun Mehta', 'arjun@signal.dev', 'Data analyst', 'The Fold'],
  ['Hedda Nilsen', 'hedda@signal.dev', 'Frontend developer', 'Alta'],
];

const JUDGE_PEOPLE = [
  ['Ada Okonkwo', 'Principal engineer, Loop', 'Loop', 'Twelve years building developer tools. Cares about the parts nobody demos.'],
  ['Mira Kaur', 'Accessibility lead, Public Digital', 'Public Digital', 'WCAG specialist. Has shipped screen-reader-first products to public services.'],
  ['Rosa Moreau', 'ML engineer, Fieldnotes', 'Fieldnotes', 'Works on applied models in regulated settings. Brutal about evaluation.'],
  ['Hiro Tanaka', 'Systems engineer, Kite', 'Kite', 'Distributed systems and databases. Will ask what happens when it fails.'],
  ['Sofia Duarte', 'Researcher, Open Civic Lab', 'Open Civic Lab', 'Designs public services with the people who use them.'],
];

/* ---------------------------------------------------------- Signal 2026 */

const SIGNAL = {
  slug: 'signal-2026',
  name: 'Signal 2026',
  tagline: 'Two days to build software that helps one specific person do one specific thing better.',
  about: `Signal is a small, deliberately unhurried hackathon. Forty-eight hours, no theme-sponsor noise, and a judging panel that reads every write-up properly rather than skimming.

## What we expect

A working build, not a concept deck. A repository a stranger can clone. A two-minute demo that shows the real thing working, not slides about the real thing.

## Why so few tracks

Three tracks, not ten. Tracks exist to make judging fair — a judge who reviews five projects in one area can rank them honestly. Splitting an event into ten narrow slivers makes every comparison meaningless. We would rather have three honest rankings than ten coin flips.

## Who it is for

Anyone who can write software and wants to finish something. We have had solo entrants, first-time builders, and people who came in with a team already formed. You do not need to be senior.`,
  organiser_name: 'NexusLabs',
  format: 'online',
  city: 'Remote',
  country: 'Worldwide',
  timezone: 'Europe/London',
  topics: ['accessibility', 'developer tools', 'civic tech', 'data'],
  eligibility: `Open to anyone who can write software and wants to finish something.

- No seniority requirement. First-time hackathon builders are actively encouraged.
- Teams of one to four. Solo entries are welcome and are judged on exactly the same rubric.
- You must be the author of the work you submit, or have written a meaningful part of it.
- One submission per person. If you are on a team, you submit with them.`,
  rules: `## The rules, briefly

1. **Build during the event.** Code written before kickoff does not count. Bring a design sketch if you like, not a working prototype.
2. **Open licence.** Your repository must carry a licence that lets others read and run it. A private repository is not a submission.
3. **Your own work.** You may use existing libraries. You may not submit someone else's project, and you must say clearly what you built.
4. **One submission.** If you are on a team, that team submits once.
5. **Be honest in the write-up.** If something is stubbed, say it is stubbed. We read the write-up; a judge who is misled wastes their time and yours.

## Late submissions

The deadline is enforced on the server. When it passes, the endpoint stops accepting writes. There is no grace period and no exceptions, because a grace period is not a grace period for everyone.`,
  code_of_conduct: `Signal is a place where people are expected to be decent to each other.

Harassment of any kind — technical gatekeeping, dismissal of someone's work because of who they are, sustained disruption — ends your participation immediately with no refund of time.

If something happens, contact the organising team privately. We will act on it, and we will not publish who reported it.`,
  min_team_size: 1,
  max_team_size: 4,
  allow_solo: 1,
  allow_team_invites: 1,
  max_participants: 200,
  require_approval: 0,
  require_repo: 1,
  require_demo: 0,
  require_video: 0,
  require_screenshots: 0,
  submission_checklist: [
    'A working build, not a concept deck',
    'A public repository with a licence',
    'A write-up that says what is stubbed',
    'Something you can show in two minutes',
  ],
  rules_about: 'Everything below is enforced by the portal, not by good intentions.',
};

const SIGNAL_TRACKS = [
  ['Useful', 'Software that removes a specific, named piece of friction.', 'Tools and systems that make somebody\'s Tuesday shorter. Judges reward specificity: a tool for one workflow beats a platform for all of them.'],
  ['Legible', 'Software that people can actually understand and use.', 'Accessibility, clarity, and the craft of explaining a system to the person who has to live with it. Strong showing here in previous years.'],
  ['Resilient', 'Software that keeps working when things go wrong.', 'Failure handling, offline behaviour, degradation under load, and the boring engineering that separates a demo from a product.'],
];

const SIGNAL_SCHEDULE = [
  ['Doors open and team formation', 'registration_opens_at', null, 'Discord', 'social', 'Come and find people. Bring a laptop if you want one.'],
  ['Kickoff: what we are building and what makes a good submission', 'starts_at', 3600000, 'Main stage', 'ceremony', 'The rules, the deadlines, and what the judges actually read.'],
  ['Track briefings', 'starts_at', 7200000, 'Three rooms', 'session', 'One per track. Optional, recorded afterwards.'],
  ['Mentor office hours', 'starts_at', 21600000, 'Voice rooms', 'workshop', 'Six mentors, twenty-minute slots, sign up in the thread.'],
  ['Midpoint: show something that works', 'midpoint', 3600000, 'Main stage', 'session', 'Two minutes each, pass or fail, no judgement.'],
  ['Overnight: the building continues', 'overnight', 28800000, 'Quiet hours', 'social', 'The room is open. We do not police what time you work.'],
  ['Submission deadline', 'submissions_close_at', null, '—', 'deadline', 'Hard stop. The portal stops accepting writes at this exact moment.'],
  ['Judging', 'judging_opens_at', 259200000, '—', 'session', 'The panel reads every write-up in full.'],
  ['Results and demo evening', 'results_at', 10800000, 'Main stage', 'ceremony', 'Live demo slot for the top three.'],
];

const SIGNAL_ANNOUNCEMENTS = [
  ['Submissions are open', 'The submission portal is live. You can save a draft as often as you like and submit as many times as you want before the deadline — each submit freezes a copy, so you can keep improving right up to the end.\n\nYour participant page shows a checklist of what is still missing. If something is unclear, ask in the Discord rather than guessing.', 'update', 1],
  ['Judging panel confirmed', 'Five judges, covering all three tracks, and none of them are on the organising team.\n\nJudges see your demo, your repository, your write-up and your submission answers on one page, and can compare projects side by side before scoring. Individual scores and notes stay private to the judge who wrote them and to the organising team — they are published only as a final ranking.', 'judging', 1],
  ['What the write-up should contain', 'Three short sections, in this order:\n\n**What it does** — two or three sentences a stranger can follow.\n\n**How it works** — the architecture, the data flow, the interesting decision you made and why.\n\n**What is not finished** — the honest list. A judge who finds something you did not disclose will discount everything else you said.', 'update', 0],
  ['Midpoint demos are on', 'Two minutes each, starting now. Pass or fail, no ranking, no audience feedback. It exists so that you find out on Saturday whether your thing runs.', 'update', 0],
];

const SIGNAL_FIELDS = [
  ['What did your team build, and what actually works right now?', 'Be specific. "We built X and it does Y, and Z is stubbed" beats a paragraph of ambition.', 'longtext', 1, 1],
  ['Who is this for, and what did they do before you built it?', 'One paragraph. Name the workflow, not the persona.', 'longtext', 1, 1],
  ['What is deliberately not finished?', 'Judges read this first after the demo. Nothing here is held against you.', 'longtext', 0, 1],
  ['Link to a deployed build', 'Optional if the repository runs locally with one command.', 'url', 0, 0],
];

const SIGNAL_PRIZES = [
  [null, 'Overall winner', '£5,000 and a placement interview at NexusLabs.', 'Grand prize', '£5,000', 'NexusLabs', 0],
  ['useful', 'Best in Useful', 'For the tool that most obviously removes a real piece of friction.', 'Track prize', '£1,500', 'NexusLabs', 1],
  ['legible', 'Best in Legible', 'For the submission a non-expert could actually use.', 'Track prize', '£1,500', 'Public Digital', 2],
  ['resilient', 'Best in Resilient', 'For the build that kept working when everything else broke.', 'Track prize', '£1,500', 'Ledgerline', 3],
  [null, 'Honourable mentions', 'Two teams who will be named at the closing ceremony and interviewed in the write-up.', 'Recognition', '', '', 4],
];

const SIGNAL_FAQS = [
  ['Do I have to be a professional developer?', 'No. We have had students, designers who code, and people writing their first non-tutorial project. The rubric scores the work, not your job title.'],
  ['Can I work solo?', 'Yes. Roughly a third of entries are solo, and they are scored on exactly the same rubric.'],
  ['What if I already have a team?', 'Create the team, share the invite code, and submit together. One submission per person — if you are on a team, that team submits once.'],
  ['What happens if the demo breaks on the day?', 'Nothing catastrophic. The judging panel reads the write-up and the repository. Say clearly in the write-up what worked when you tested it.'],
  ['Can I see other people\'s scores?', 'No, and neither can they see yours. Individual scores and notes are private to the judge who wrote them and to the organising team. Only the final ranking is published.'],
  ['What if I miss the deadline?', 'The portal stops accepting submissions at the deadline. This is enforced on the server, not in your browser, so refreshing will not help and we cannot make exceptions without making them for everyone.'],
];

const SIGNAL_TEAMS = [
  ['Quiet Harbour', 'Tooling for people who review pull requests on a phone.', 'Mara Ellison', ['Theo Brandt', 'Kofi Adjei']],
  ['Longshore', 'Dependency tooling for teams who ship.', 'Rin Takahashi', ['Devon Marsh']],
  ['Tidewater', 'Field data capture that survives no signal.', 'Bea Lindqvist', ['Sam Oduya', 'Priya Nambiar']],
  ['Riveting', 'Repairing public-sector forms nobody can rewrite.', 'Callum Reyes', ['Nina Sørensen']],
  ['Sorrel', 'Urban canopy mapping from ordinary photographs.', 'Ola Bergström', ['Zoe Mensah']],
  ['Wren', 'Care tooling for households without connectivity.', 'Iris Kowalski', ['Tariq Haddad']],
  ['Kittiwake', 'Scheduling for a community boat share.', 'Wren Halloway', ['Ade Fashola']],
];

/* Project content. Descriptions are written the way a real team would write
   them: what it does, how it works, and what is not finished. */
const SIGNAL_PROJECTS = [
  {
    key: 'quiet-harbour',
    team: 0,
    track: 0,
    name: 'Slipway',
    tagline: 'A pull request review queue that fits on a phone, and tells you what actually changed.',
    description: `Most code review happens on a laptop, twenty minutes at a time. A lot of it also happens on a phone, in a queue, in ninety seconds. Those are different jobs and the tools assume the first one.

Slipway shows one change at a time, on a screen about 340 pixels wide. It strips the diff down to the lines that matter, using the repository’s own history to work out which hunks have been rewritten before. You get the change, the reason someone gave for it, and three buttons. That is the whole interface.

## How it works

The server parses each pull request into hunks, then scores each hunk against how often that region of the file has churned in the last ninety days. High-churn regions are shown collapsed until you open them. A small language model run at queue time writes a two-line summary per hunk, but the raw diff is always one tap away and is never hidden.

Everything is cached aggressively on the client, so opening the queue on a train with one bar of signal takes under a second.

## What is not finished

- No merge. That is deliberate — we did not want to be in the business of writing to your repository.
- Summary generation is slow on the first run for a large pull request. We cache, so the second person to open it is fast.
- We have not tested beyond iOS and Android.`,
    stack: ['TypeScript', 'React', 'Node.js', 'Postgres', 'Redis'],
    repo: 'https://github.com/hackerly-demo/slipway',
    demo: 'https://slipway.example.dev',
    video: '',
    status: 'submitted',
    isPublic: 1,
    answers: {
      q0: 'A review queue for pull requests, sized for a phone. The core path — open queue, read one hunk, comment, mark seen — works end to end. The language-model summaries are the only slow part and they are cached.',
      q1: 'Mobile reviewers, usually on the way to something. They were reading notifications in a browser tab, switching context each time, and losing the thread of what they had already reviewed.',
      q2: 'Merging, iOS notifications, and the churn model, which currently only works on files under 2000 lines.',
    },
  },
  {
    key: 'slackwater',
    team: 1,
    track: 0,
    name: 'Slackwater',
    tagline: 'A licence checker that tells you what the licence actually forbids, in a sentence a human wrote.',
    description: `Every licence checker prints the same thing: a list of packages and their SPDX identifiers. It then makes you go and read the licence yourself.

Slackwater reads the licences of everything in your dependency tree and writes a plain-language summary of the obligations that matter for a commercial product. Not "MIT" — "you have to keep this notice, you can use it commercially, you cannot hold us liable". It cites the clause.

## How it works

We normalise every licence to a small set of obligations: attribution, source disclosure, patent grant, liability, and termination. Where a licence has no established interpretation, we say so rather than guessing. The mapping table is the product, and it is a public repository so that a lawyer can correct us.

## What is not finished

- Copyleft detection is conservative. It will not flag a licence as reciprocal unless it is certain.
- No dependency update PRs yet.`,
    stack: ['Python', 'FastAPI', 'PostgreSQL', 'spaCy'],
    repo: 'https://github.com/hackerly-demo/slackwater',
    demo: 'https://slackwater.example.dev',
    video: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
    status: 'submitted',
    isPublic: 1,
    answers: {
      q0: 'Reads every licence in a dependency tree and writes a plain-language summary of the obligations, citing the clause. Working on a 400-package repository. Copyleft detection is conservative.',
      q1: 'Engineers who ship commercial software and have to answer "can we use this?" without a lawyer. They were reading SPDX identifiers and guessing.',
      q2: 'Conservative copyleft detection, and no automated update pull requests.',
    },
  },
  {
    key: 'field-manual',
    team: 2,
    track: 2,
    name: 'Field Manual',
    tagline: 'Species logging for conservation teams with two bars of signal and wet hands.',
    description: `A conservation survey takes twelve people into a valley for a week. They log what they see. Halfway through, the valley is in a dead zone and four hundred records sit on phones waiting for a connection that will not come for six hours.

Field Manual is a logging app that assumes no network and never complains about it. Records are written locally, attached to a position, and queued. When a connection appears — any connection, even 2G — the queue drains in the background and the app tells you what synced.

## How it works

Everything is local-first: SQLite on device, with an append-only outbox that survives the app being killed. Photos are resized on device before they are queued, because a raw camera photo on a failed upload is a wasted day. Conflict resolution is last-write-wins per field with a visible conflict list, not silent overwriting — that part took us two rewrites.

## What is not finished

- Species suggestions are trained on 400 images from one reserve. They are wrong outside it, and we say so in the interface.
- No offline map tiles. You need the map downloaded before you leave signal.`,
    stack: ['Kotlin', 'Jetpack Compose', 'Room', 'WorkManager'],
    repo: 'https://github.com/hackerly-demo/field-manual',
    demo: '',
    video: 'https://www.youtube.com/watch?v=ScMzIvxBSi4',
    status: 'submitted',
    isPublic: 1,
    answers: {
      q0: 'A local-first species logging app. Logging, photo capture, and outbox sync all work with the radio off. The species suggestion model is trained on 400 images and is only reliable inside one reserve.',
      q1: 'Conservation surveyors. They lose roughly a day per trip to records that never left the device.',
      q2: 'The suggestion model, offline maps, and anything about exporting to the national database format.',
    },
  },
  {
    key: 'parlour',
    team: 3,
    track: 1,
    name: 'Parlour',
    tagline: 'A keyboard-only path through a council booking form that was never designed for one.',
    description: `Nottingham City Council’s leisure booking form takes eleven minutes with a mouse and cannot be completed at all with a keyboard, because the date picker traps focus and the error summary is invisible to a screen reader.

Parlour is a shim. It sits in front of the form, reads its DOM, and replaces the four broken widgets with accessible equivalents. It is twenty lines of configuration for most forms, and the point of the submission is the diagnosis: the same four patterns are in about sixty percent of the forms we audited.

## How it works

A small accessibility profile per form, applied declaratively. The shim is a content script with no network calls — everything runs in the page, so there is nothing to log and nothing to leak.

## What is not finished

- Works on the five forms we tested. Not general.
- No visual restyling. It fixes behaviour and leaves appearance alone, which is correct but looks like nothing happened.`,
    stack: ['TypeScript', 'Web Components', 'Vitest'],
    repo: 'https://github.com/hackerly-demo/parlour',
    demo: 'https://parlour.example.dev',
    video: '',
    status: 'submitted',
    isPublic: 0,
    answers: {
      q0: 'An accessibility shim that repairs four specific widget patterns in legacy booking forms. Tested against five real forms. Deliberately does not restyle anything.',
      q1: 'People booking a court or a class who use a keyboard or a screen reader. Currently they cannot book at all.',
      q2: 'Generalisation beyond the four patterns, and any visual work.',
    },
  },
  {
    key: 'understory',
    team: 4,
    track: 0,
    name: 'Understory',
    tagline: 'An urban tree canopy map built from photos people already took.',
    description: `The council has a canopy dataset from 2019. It is wrong in the places people care about most. The volunteers who actually know which streets have trees have no way to correct it.

Understory takes ordinary phone photos with location data, runs a classifier over the canopy visible in each one, and produces a canopy map at street resolution. The interesting constraint was making it good enough that a photo taken from a bus window counts.

## How is it going

The classifier is at 0.79 F1 on the validation set, which is good enough to be useful and not good enough to be authoritative. We show confidence per tile and never overwrite the council’s data — we hold a separate layer and let a human merge it.

## What is not finished

- Upload and queueing are not built. Right now the map is regenerated from a folder of photos.
- No mobile app; the ingestion script expects a directory.`,
    stack: ['Python', 'PyTorch', 'FastAPI', 'PostGIS', 'MapLibre'],
    repo: 'https://github.com/hackerly-demo/understory',
    demo: 'https://understory.example.dev',
    video: '',
    status: 'draft',
    isPublic: 0,
    answers: {
      q0: 'A canopy classifier at 0.79 F1 plus a map viewer. The classifier works. The ingestion pipeline does not exist yet — photos have to be in a folder.',
      q1: 'Urban foresters and the residents who know their street better than the dataset does.',
      q2: 'Photo ingestion, the mobile app, and anything above 0.85 F1.',
    },
  },
  {
    key: 'nightingale',
    team: 5,
    track: 1,
    name: 'Nightingale',
    tagline: 'Medication reminders for carers when the network is the thing that is down.',
    description: `A carer looks after someone across two homes. The reminder app is on their phone. The phone has no signal in the second house, which is the house that matters.

Nightingale keeps the schedule on device, fires the reminder regardless of connectivity, and syncs opportunistically. A second carer on the same household network sees the same schedule without a login, over a local web server on the router.

## What is not finished

This is a draft and it is honestly a thin one. The reminder engine and the local sync work. There is no interface beyond a list, and the escalation logic — what happens when a dose is missed twice — is not written.`,
    stack: ['Swift', 'CoreData', 'MultipeerConnectivity'],
    repo: 'https://github.com/hackerly-demo/nightingale',
    demo: '',
    video: '',
    status: 'draft',
    isPublic: 0,
    answers: {
      q0: 'The reminder engine and local household sync work. There is no interface beyond a list, and the escalation logic is not written.',
      q1: 'Carers looking after someone across two homes, where one of them has no signal.',
      q2: 'Everything. Escalation, the interface, multi-household support.',
    },
  },
  {
    key: 'brackish',
    team: 6,
    track: 2,
    name: 'Brackish',
    tagline: 'A boat-share scheduler that knows the tide will not wait for anyone.',
    description: `A community boat share on an estuary. Two boats, forty members, and a crossing that is only safe for four hours either side of high water. The existing spreadsheet schedule ignores the tide, and somebody learned that the hard way.

Brackish computes safe windows from tide predictions, refuses bookings that fall outside them, and warns members when a booking is within an hour of the boundary.

## What is not finished

Tide prediction is downloaded once as a static table and never updated. If you run this past the end of the table it will cheerfully give you the last known value, which we consider a bug.`,
    stack: ['Ruby', 'Rails', 'PostgreSQL', 'PostGIS'],
    repo: 'https://github.com/hackerly-demo/brackish',
    demo: 'https://brackish.example.dev',
    video: '',
    status: 'submitted',
    isPublic: 1,
    answers: {
      q0: 'Booking with tide-window enforcement. Booking, refusal, and warnings all work against a static tide table. The table does not update.',
      q1: 'Forty members of a community boat share who book crossings on a spreadsheet and have twice been caught out by the tide.',
      q2: 'Live tide data, and anything about weather.',
    },
  },
];

/* -------------------------------------------------------- Foundry 2026 */

const FOUNDRY = {
  slug: 'foundry-2026',
  name: 'Foundry 2026',
  tagline: 'A weekend on the tools nobody has time to build, judged by the people who have to maintain them.',
  about: `Foundry is a hackathon about maintenance. The submissions are tools that make somebody else’s job less painful: a migration runner, a test harness, a debugging aid, a thing that has lived in a pull request for a year because nobody had a weekend.

## Why maintenance

Most hackathons reward novelty. Novelty is easy to demo and hard to value. Foundry instead asks a different question: would you rather have this in your repository, or would you rather keep doing it by hand? The rubric rewards the second question.

## The panel

Six maintainers of widely used open-source tools. None of them work for a sponsor of this event.`,
  organiser_name: 'NexusLabs',
  format: 'hybrid',
  venue: 'The Foundry, Bermondsey',
  city: 'London',
  country: 'United Kingdom',
  timezone: 'Europe/London',
  topics: ['developer tools', 'open source', 'infrastructure'],
  eligibility: 'Open to everyone. No restrictions on nationality, institution or seniority.',
  rules: '1. Build during the event.\n2. Open licence.\n3. Your own work, attributed.\n4. One submission per person.\n5. Say what is not finished.',
  code_of_conduct: 'Be decent. Harassment ends participation immediately. Report privately to the organising team.',
  min_team_size: 1,
  max_team_size: 4,
  allow_solo: 1,
  allow_team_invites: 1,
  max_participants: 120,
  require_approval: 0,
  require_repo: 1,
  require_demo: 1,
  require_video: 0,
  require_screenshots: 0,
  submission_checklist: [
    'A working build',
    'A public repository with a licence',
    'A deployed demo',
    'An honest list of what is not finished',
  ],
  results_released: 1,
};

const FOUNDRY_TRACKS = [
  ['Tooling', 'Things that live in other people\'s repositories.', ''],
  ['Observability', 'Knowing what your system is doing without guessing.', ''],
  ['Data', 'Moving and trusting data between systems.', ''],
  ['Security', 'The work that never feels urgent until it is.', ''],
];

const FOUNDRY_FIELDS = [
  ['What does this replace, and what did it cost you before?', 'Concrete, please. "Two hours per deploy" is the kind of answer we are looking for.', 'longtext', 1, 1],
  ['What is the hardest part you solved?', 'The thing that took you the longest, not the thing that looks cleverest.', 'longtext', 1, 1],
  ['What is not finished?', 'We will not penalise you for this. We will penalise you for hiding it.', 'longtext', 0, 1],
];

const FOUNDRY_PROJECTS = [
  ['Bandit Proxy', 'A reverse proxy that rate-limits by what a request costs, not by how many there are.', 0,
    '```\n## What it replaces\n\nOur deploy pipeline was rate-limited by request count, which meant a cheap health check and an expensive migration counted the same. We hit the limit on every deploy and the fix was always to raise the limit.\n\n## How it works\n\nA cost function per route, declared in the proxy config. The budget is consumed in units, not requests, and the 429 response tells you which route is expensive and what it cost. In steady state this changed our p99 deploy time from four minutes to under one.\n\n## The hard part\n\nPersisting the budget across proxy restarts without making the hot path do I/O. A write-behind log with a 200ms flush interval, and counters reconstructed from the log tail on boot.\n```',
    ['Go', 'Redis', 'OpenTelemetry'], 'submitted', 1, 'Overall winner'],
  ['Slowdrop', 'A CI reporter that shows you what made the build slow, not that it was slow.', 1,
    '```\n## What it replaces\n\nReading a CI log and scrolling. We were spending about twenty minutes a week working out why builds had got slower.\n\n## How it works\n\nParses timing emitted by most CI providers, attributes time to a step and then to a line within the step when the tool emits it, and renders one page: a flame chart, and a list of what changed since the last green build.\n\n## The hard part\n\nAttribution when steps run in parallel and a slow step is not the one that made the *build* slow.\n```',
    ['TypeScript', 'Node.js', 'PostgreSQL'], 'submitted', 1, 'Second place'],
  ['Coldline', 'Reads a flame graph and names the one function worth rewriting.', 2,
    '```\n## What it replaces\n\nAsking a colleague to look at a flame graph. It is a fifteen-minute conversation we were having several times a week.\n\n## How it works\n\nA static pass over the collapsed stack, then a model trained on our own historical PRs to rank candidate functions. The output is a list of five functions with the projected effect, not a rewritten file. It has been wrong about half the time, which is stated in the output.\n\n## The hard part\n\nNot being confidently wrong. Anything the model is unsure about is dropped rather than ranked low.\n```',
    ['Rust', 'Polars', 'Python'], 'submitted', 1, 'Third place'],
  ['Tideline', 'Schema migrations for a fleet of databases where you cannot stop to run anything.', 3,
    '```\n## What it replaces\n\nA runbook that assumed a quiet moment. We have 400 databases and no quiet moments.\n\n## How it works\n\nEvery migration is expressed as expand, migrate, contract, with each phase independently reversible. A control plane tracks which databases are at which phase, and a migration is only applied when the whole fleet agrees to move together.\n\n## The hard part\n\nReversibility for migrations that have already moved data. We keep a shadow column and a reconciliation job rather than pretending it can be undone.\n```',
    ['Go', 'CockroachDB', 'Terraform'], 'submitted', 1, ''],
  ['Quietroom', 'A staging environment that rebuilds itself from a pull request, and only when asked.', 0,
    '```\n## What it replaces\n\nA staging environment that everyone shared and nobody trusted.\n\n## How it works\n\nEach pull request gets a namespace and a database seeded from a scrubbed snapshot. Destroyed automatically after 48 hours. The scrubbing is the interesting part: it walks foreign keys and replaces anything matching a column marked sensitive.\n\n## The hard part\n\nScrubbing a schema nobody documented. We infer sensitivity from column names, which is a heuristic we are not proud of.\n```',
    ['TypeScript', 'Kubernetes', 'PostgreSQL'], 'submitted', 1, ''],
  ['Fair Share', 'Splits a bill fairly when one person had the expensive drink.', 1,
    '```\n## What it replaces\n\nAn argument.\n\n## How it works\n\nEveryone logs what they consumed. Fairness is solved as a constrained optimisation: minimise the difference between what people paid and what they consumed, subject to nobody paying less than zero. It is a small linear program and it is exact.\n\n## The hard part\n\nShared items. A bottle of wine consumed by six people is genuinely ambiguous, and we let people weight it.\n```',
    ['Python', 'SciPy', 'FastAPI'], 'submitted', 1, ''],
  ['Greenlight', 'A CI check for whether a dependency is going to be a problem in eighteen months.', 3,
    '```\n## What it replaces\n\nDependency review by reading release notes, which nobody does.\n\n## How it works\n\nFor each dependency, it looks at maintainer count, release cadence, issue response time, and how much of your code touches it. It produces a short report per dependency with a recommendation and the evidence.\n\n## The hard part\n\nNot being alarmist. A report that cries wolf is ignored, and an ignored report is worse than none.\n```',
    ['Python', 'GitHub API', 'Jinja'], 'submitted', 1, ''],
  ['Longhand', 'Documentation that knows when the code it describes has changed.', 0,
    '```\n## What it replaces\n\nA README that is wrong by six months.\n\n## How it works\n\nEvery code block in the documentation is executed against the current codebase in a container. A block that no longer runs, or no longer produces the output it claims, fails the build.\n\n## The hard part\n\nBlocks that are illustrative rather than literal. We require an explicit opt-out marker, and the opt-outs are listed in the report.\n```',
    ['Python', 'Docker', 'MyST'], 'submitted', 1, ''],
  ['Wheelhouse', 'A dependency proxy that knows the difference between urgent and interesting.', 0,
    '```\n## What it replaces\n\nRegistry outages, and a nervous habit of pinning everything forever.\n\n## How it works\n\nA local proxy with a priority queue. A build that is broken gets a lock on the version it needs; everything else waits. Cache eviction is driven by that priority rather than by time.\n\n## The hard part\n\nCorrectness under a partial outage. We fail closed for the locking path and open for the caching path, which is a compromise we can defend.\n```',
    ['Rust', 'Squid', 'Redis'], 'submitted', 1, ''],
  ['Nightwatch', 'Alerts that know whether anyone is awake to be woken up.', 1,
    '```\n## What it replaces\n\nA pager that woke three people for a disk at 94%.\n\n## How it works\n\nOn-call schedules, plus a confidence model per alert type. When the same alert fires three times, it collapses into one page with a count, and the confidence that it is real goes down rather than up.\n\n## The hard part\n\nThe model is only as good as the history, and early in an incident there is no history. It is conservative: it will under-page, never over-page.\n```',
    ['Python', 'FastAPI', 'ClickHouse'], 'submitted', 1, ''],
  ['Braid', 'Keeps a fork and its upstream in sync without a merge conflict every week.', 0,
    '```\n## What it replaces\n\nA weekly “sync with upstream” that takes an afternoon and produces a conflict in a file nobody remembers writing.\n\n## How it works\n\nCommits are classified as touching the fork’s own behaviour or the upstream’s. Only the second kind is replayed, and replayed through a semantic merge that knows the intent of the change.\n\n## The hard part\n\nClassifying intent. We use a heuristic plus a human confirmation step, and the confirmation is the product.\n```',
    ['Go', 'go-git', 'SQLite'], 'submitted', 1, ''],
  ['Sparrow', 'A test data builder that makes invalid data easy to write on purpose.', 2,
    '```\n## What it replaces\n\nHand-writing a JSON blob with a broken foreign key, then wondering why the test passed.\n\n## How it works\n\nA builder DSL that can produce valid and invalid instances of any schema, with the invalid ones annotated. A test that is meant to exercise a failure path says so in the test name.\n\n## The hard part\n\nKeeping the generated set small. A fuzzer that produces forty thousand cases is not a test suite.\n```',
    ['TypeScript', 'Zod', 'Vitest'], 'submitted', 1, ''],
  ['Kettle', 'One command to reproduce a production bug locally, or an honest explanation why not.', 2,
    '```\n## What it replaces\n\nThe “works on my machine” conversation, and the four hours of log archaeology that follows it.\n\n## How it works\n\nTakes a request id, pulls the trace, the environment, the feature flags and the config versions, and assembles a container. Where it cannot reproduce faithfully — a managed dependency, a third-party API — it says which part is approximated.\n\n## The hard part\n\nKnowing when not to trust the reproduction. It reports a fidelity score and we have been careful not to let anyone use it as an absolute.\n```',
    ['Go', 'OpenTelemetry', 'Docker'], 'submitted', 1, ''],
  ['Rookery', 'A migration for the migration: keeps a database schema readable as it changes.', 2,
    '```\n## What it replaces\n\nA schema that only one person understands.\n\n## How it works\n\nA continuous render of the schema with every column annotated with its owning team, its last change, and the queries that touch it. The annotation is the point; the schema was already there.\n\n## The hard part\n\nInferring ownership from query logs when the team has rotated twice.\n```',
    ['Python', 'SQLAlchemy', 'PostgreSQL'], 'submitted', 1, ''],
];

const FOUNDRY_JUDGES = [
  ['Tomas Varga', 'Maintainer, Northwind', 'Northwind'],
  ['Ada Okonkwo', 'Principal engineer, Loop', 'Loop'],
  ['Hiro Tanaka', 'Systems engineer, Kite', 'Kite'],
  ['Mira Kaur', 'Accessibility lead, Public Digital', 'Public Digital'],
  ['Emeka Adeyemi', 'Security engineer, Ledgerline', 'Ledgerline'],
  ['Lena Kovac', 'Product designer', 'Independent'],
];

/* -------------------------------------------------------------------------- */

function userId(email) {
  return db().prepare('SELECT id FROM users WHERE email_key = ?').get(email.toLowerCase());
}

function ensureUser(name, email, headline, organisation) {
  const existing = userId(email);
  if (existing) return existing.id;
  const user = auth.createUser({ email, name, password: DEMO_PASSWORD, headline, organisation });
  return user.id;
}

function eventRow(slug) {
  return db().prepare('SELECT * FROM events WHERE slug = ?').get(slug);
}

/* -------------------------------------------------------------------------- */

function seedDemo() {
  const database = db();

  const already = eventRow(SIGNAL.slug);
  if (already) return { skipped: true };

  const organiser = ensureUser('Ada Okonkwo', 'organiser@hackerly.dev', 'Principal engineer, Loop', 'NexusLabs');
  const demoJudge = ensureUser('Mira Kaur', 'judge@hackerly.dev', 'Accessibility lead', 'Public Digital');
  const demoJudge2 = ensureUser('Hiro Tanaka', 'judge2@hackerly.dev', 'Systems engineer', 'Kite');
  const demoParticipant = ensureUser('Devon Marsh', 'participant@hackerly.dev', 'Full-stack developer', 'Independent');

  const organiserUser = auth.findUserById(organiser);

  /* ---- Signal 2026: live ---- */
  const signalId = insertEvent({
    ...SIGNAL,
    organiser_id: organiser,
    organiser_name: 'NexusLabs',
    cover_hue: 18,
    status: 'published',
    visibility: 'public',
    starts_at: '2026-09-26T17:00:00Z',
    ends_at: '2026-09-28T17:00:00Z',
    registration_opens_at: '2026-09-14T09:00:00Z',
    registration_closes_at: '2026-09-25T23:00:00Z',
    submissions_open_at: '2026-09-26T17:00:00Z',
    submissions_close_at: '2026-10-03T18:00:00Z',
    judging_opens_at: '2026-09-28T09:00:00Z',
    judging_closes_at: '2026-10-06T18:00:00Z',
    results_at: '2026-10-08T18:00:00Z',
  });

  grantRole(signalId, organiser, 'organiser');

  // tracks
  const signalTracks = SIGNAL_TRACKS.map(([name, description, brief], i) => {
    const trackId = id('trk');
    database.prepare(`
      INSERT INTO tracks (id, event_id, slug, name, description, brief, sponsor, colour, position)
      VALUES (?,?,?,?,?,?,'',?,?)
    `).run(trackId, signalId, slugify(name, `track-${i}`), name, description, brief,
      ['ink', 'blue', 'green'][i % 3], i);
    return trackId;
  });

  // schedule
  for (const [title, anchor, offset, location, kind, description] of SIGNAL_SCHEDULE) {
    const at = anchorFor(signalId, anchor);
    database.prepare(`
      INSERT INTO schedule_items (id, event_id, title, description, kind, location, starts_at, ends_at, position)
      VALUES (?,?,?,?,?,?,?,?,0)
    `).run(id('sch'), signalId, title, description, kind, location, at,
      offset ? new Date(Date.parse(at) + offset).toISOString() : null);
  }

  // announcements
  for (const [title, body, kind, pinned] of SIGNAL_ANNOUNCEMENTS) {
    database.prepare(`
      INSERT INTO announcements (id, event_id, title, body, kind, pinned, author_id, created_at)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(id('ann'), signalId, title, body, kind, pinned, organiser,
      new Date(Date.now() - Math.floor(Math.random() * 5) * 86400000).toISOString());
  }

  // submission fields
  SIGNAL_FIELDS.forEach(([label, help, kind, required, judgesSee], i) => {
    database.prepare(`
      INSERT INTO submission_fields (id, event_id, field_key, label, help, kind, options, required, judges_see, position)
      VALUES (?,?,?,?,?,?, '[]', ?,?,?)
    `).run(id('sfd'), signalId, `q${i}`, label, help, kind, required, judgesSee, i);
  });

  // prizes
  SIGNAL_PRIZES.forEach(([trackKey, name, description, place, value, sponsor, position], i) => {
    const trackId = trackKey ? signalTracks[['useful', 'legible', 'resilient'].indexOf(trackKey)] : null;
    database.prepare(`
      INSERT INTO prizes (id, event_id, track_id, name, description, place_label, value, sponsor, position)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(id('prz'), signalId, trackId, name, description, place, value, sponsor, i);
  });

  // faqs
  SIGNAL_FAQS.forEach(([question, answer], i) => {
    database.prepare('INSERT INTO faqs (id, event_id, question, answer, position) VALUES (?,?,?,?,?)')
      .run(id('faq'), signalId, question, answer, i);
  });

  // rubric
  const criteria = [
    ['does-it-work', 'Does it work', 'The core path runs end to end without a script and without you narrating over it.', 1.4, 5],
    ['craft', 'Craft', 'Is the engineering sound? Would you be happy to maintain this in six months?', 1.0, 5],
    ['usefulness', 'Usefulness', 'Does it remove a real piece of friction for a real person?', 1.0, 5],
    ['honesty', 'Honesty of the write-up', 'Is the account of what is finished and what is not accurate and specific?', 0.6, 5],
  ];
  criteria.forEach(([key, name, description, weight, max], i) => {
    database.prepare(`
      INSERT INTO rubric_criteria (id, event_id, field_key, name, description, weight, max_score, position)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(id('crt'), signalId, key, name, description, weight, max, i);
  });

  // people
  const peopleIds = PEOPLE.map(([name, email, headline, organisation]) => ({
    name, email, userId: ensureUser(name, email, headline, organisation), headline, organisation,
  }));
  for (const p of peopleIds) register(signalId, p.userId);

  // judges
  const signalJudges = [];
  JUDGE_PEOPLE.forEach(([name, headline, organisation, bio], i) => {
    const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@panel.example`;
    // Link the judge to a seeded account when one exists under the same name,
    // so the panel on the public page is populated by people who are real
    // within this installation rather than by placeholder rows.
    const match = peopleIds.find((p) => p.name === name);
    const judgeId = id('jdg');
    const userIdForJudge = match ? match.userId : null;
    const code = `SIG-${String(1000 + i)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const creds = auth.hashPassword(code);
    database.prepare(`
      INSERT INTO judges (id, event_id, user_id, name, email_key, headline, organisation, bio, state,
        access_code_hash, access_code_salt, invite_code, invited_by, invited_at, verified_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(judgeId, signalId, userIdForJudge, name, email, headline, organisation, bio,
      userIdForJudge ? 'verified' : 'invited', creds.hash, creds.salt, code, organiser,
      '2026-09-10T09:00:00Z', userIdForJudge ? '2026-09-10T11:00:00Z' : null);
    for (const t of [signalTracks[i % 3], signalTracks[(i + 1) % 3]]) {
      database.prepare('INSERT OR IGNORE INTO judge_tracks (judge_id, track_id) VALUES (?,?)').run(judgeId, t);
    }
    if (userIdForJudge) grantRole(signalId, userIdForJudge, 'judge');
    signalJudges.push({ id: judgeId, name, userId: userIdForJudge, code });
  });

  // attach the demo judge accounts to the two panel members that have accounts
  const mira = signalJudges.find((j) => j.name === 'Mira Kaur');
  const hiro = signalJudges.find((j) => j.name === 'Hiro Tanaka');
  if (mira) {
    database.prepare('UPDATE judges SET user_id = ? WHERE id = ?').run(demoJudge, mira.id);
    database.prepare(`
      INSERT OR IGNORE INTO event_roles (id, event_id, user_id, role, created_at) VALUES (?,?,?,'judge',?)
    `).run(id('rol'), signalId, demoJudge, now());
    mira.userId = demoJudge;
  }
  if (hiro) {
    database.prepare('UPDATE judges SET user_id = ? WHERE id = ?').run(demoJudge2, hiro.id);
    database.prepare(`
      INSERT OR IGNORE INTO event_roles (id, event_id, user_id, role, created_at) VALUES (?,?,?,'judge',?)
    `).run(id('rol'), signalId, demoJudge2, now());
    hiro.userId = demoJudge2;
  }

  // teams
  const signalPeople = new Set();
  const teamRecords = SIGNAL_TEAMS.map(([name, tagline, lead, members], i) => {
    const teamId = id('tm');
    database.prepare(`
      INSERT INTO teams (id, event_id, slug, name, tagline, invite_code, is_final, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,0,?,?,?)
    `).run(teamId, signalId, slugify(name, `team-${i}`), name, tagline,
      `${name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      organiser, now(), now());

    // One person, one team. The named leads and members are used first, then
    // the pool is filled with people who are not already spoken for.
    const named = [lead, ...members]
      .map((n) => peopleIds.find((p) => p.name === n))
      .filter(Boolean);
    const taken = new Set(signalPeople);
    for (const p of named) taken.add(p.userId);
    let cursor = i;
    const roster = [...named];
    while (roster.length < Math.max(2, named.length)) {
      const candidate = peopleIds[(cursor * 5 + 1) % peopleIds.length];
      cursor += 1;
      if (taken.has(candidate.userId)) continue;
      taken.add(candidate.userId);
      roster.push(candidate);
    }
    for (const p of roster) signalPeople.add(p.userId);

    roster.forEach((match, mi) => {
      const role = mi === 0 ? 'lead' : 'member';
      database.prepare('INSERT OR IGNORE INTO team_members (team_id, user_id, role, joined_at) VALUES (?,?,?,?)')
        .run(teamId, match.userId, role, now());
      grantRole(signalId, match.userId, 'participant');
      register(signalId, match.userId);
    });
    return { id: teamId, name };
  });

  // The demo participant is registered and on a team, so the participant
  // workspace has real content to look at rather than an empty shell.
  register(signalId, demoParticipant);
  grantRole(signalId, demoParticipant, 'participant');
  database.prepare('INSERT OR IGNORE INTO team_members (team_id, user_id, role, joined_at) VALUES (?,?,?,?)')
    .run(teamRecords[0].id, demoParticipant, 'member', now());

  // projects
  const signalProjects = [];
  for (const p of SIGNAL_PROJECTS) {
    const projectId = id('prj');
    const trackId = signalTracks[p.track];
    const teamId = teamRecords[p.team].id;
    const submittedAt = p.status === 'submitted' ? '2026-09-28T09:00:00Z' : null;
    database.prepare(`
      INSERT INTO projects (id, event_id, team_id, track_id, slug, name, tagline, description,
        tech_stack, repo_url, demo_url, video_url, cover_hue, screenshots, answers, status,
        is_public, submitted_at, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, '[]', ?, ?, ?, ?, ?, ?)
    `).run(projectId, signalId, teamId, trackId, slugify(p.name), p.name, p.tagline, p.description,
      JSON.stringify(p.stack), p.repo, p.demo, p.video, hashInt(projectId, 360),
      JSON.stringify(p.answers), p.status, p.isPublic, submittedAt, now(), now());

    if (submittedAt) {
      database.prepare(`
        INSERT INTO project_submissions (id, project_id, event_id, version, snapshot, submitted_at)
        VALUES (?,?,?,1,?,?)
      `).run(id('sub'), projectId, signalId, JSON.stringify({ name: p.name, tagline: p.tagline, repo: p.repo }), submittedAt);
    }
    signalProjects.push({ id: projectId, track: p.track, status: p.status, name: p.name });
  }

  // Assignments. Deliberately uneven: a real panel has people carrying more
  // than others, and it makes "you are not assigned to this project" a state
  // you can actually reach rather than a rule nobody has tested.
  const submitted = signalProjects.filter((p) => p.status === 'submitted');
  const withAccounts = signalJudges.filter((j) => j.userId);
  const QUEUE = {
    // the accessibility lead carries the Legible track
    'Mira Kaur': [' parlour', 'nightingale', 'field-manual'],
    // the systems engineer carries two of the three Resilient projects
    'Hiro Tanaka': ['field-manual', 'brackish', 'slipway'],
  };
  for (const project of submitted) {
    const names = Object.entries(QUEUE)
      .filter(([, keys]) => keys.some((k) => project.name.toLowerCase().includes(k.trim())))
      .map(([name]) => name);
    const assigned = names.length
      ? withAccounts.filter((j) => names.includes(j.name))
      : withAccounts;
    for (const j of assigned) {
      database.prepare(`
        INSERT OR IGNORE INTO judge_assignments (id, event_id, judge_id, project_id, state, assigned_at, due_at)
        VALUES (?,?,?,?, 'assigned', ?, ?)
      `).run(id('asg'), signalId, j.id, project.id, '2026-10-01T09:00:00Z', '2026-10-06T18:00:00Z');
    }
  }

  // a couple of reviews in progress so the judge workspace is not empty
  const criteriaForSignal = judging.criteriaFor(signalId);
  const firstProject = submitted[0];
  if (firstProject && mira.userId) {
    const scores = {};
    criteriaForSignal.forEach((cr, i) => { scores[cr.id] = [4, 4, 5, 4][i % 4]; });
    const notes = { [criteriaForSignal[0].id]: 'Core path works with no narration. Two of the four flows are real.' };
    const result = queries.saveReview({
      eventId: signalId,
      projectId: firstProject.id,
      judgeId: mira.id,
      scores,
      notes,
      prose: {
        summary: 'A genuinely useful tool that understands the constraint it was built for. The churn heuristic is doing real work.',
        strengths: 'The caching is thoughtful. Opening the queue on a bad connection is under a second, which is the whole product.',
        improvements: 'No merge, and it should say why more prominently. A judge new to the project will assume it is missing by accident.',
        concerns: '',
        recommend: 'shortlist',
      },
      state: 'submitted',
    });
    markAssignment(signalId, mira.id, firstProject.id, 'completed');
    void result;
  }

  // conflicts table is created but empty; nothing to do.

  /* ---- Foundry 2026: finished, results published ---- */
  const foundryId = insertEvent({
    ...FOUNDRY,
    organiser_id: organiser,
    cover_hue: 158,
    status: 'published',
    visibility: 'public',
    starts_at: '2026-08-14T17:00:00Z',
    ends_at: '2026-08-16T17:00:00Z',
    registration_opens_at: '2026-07-20T09:00:00Z',
    registration_closes_at: '2026-08-12T23:00:00Z',
    submissions_open_at: '2026-08-14T17:00:00Z',
    submissions_close_at: '2026-08-16T17:00:00Z',
    judging_opens_at: '2026-08-16T18:00:00Z',
    judging_closes_at: '2026-08-19T18:00:00Z',
    results_at: '2026-08-20T18:00:00Z',
  });
  grantRole(foundryId, organiser, 'organiser');

  const foundryTracks = FOUNDRY_TRACKS.map(([name, description, brief], i) => {
    const trackId = id('trk');
    database.prepare(`
      INSERT INTO tracks (id, event_id, slug, name, description, brief, sponsor, colour, position)
      VALUES (?,?,?,?,?,?,'',?,?)
    `).run(trackId, foundryId, slugify(name, `track-${i}`), name, description, brief,
      ['teal', 'indigo', 'amber', 'red'][i % 4], i);
    return trackId;
  });

  FOUNDRY_FIELDS.forEach(([label, help, kind, required, judgesSee], i) => {
    database.prepare(`
      INSERT INTO submission_fields (id, event_id, field_key, label, help, kind, options, required, judges_see, position)
      VALUES (?,?,?,?,?,?, '[]', ?,?,?)
    `).run(id('sfd'), foundryId, `q${i}`, label, help, kind, required, judgesSee, i);
  });

  criteria.forEach(([key, name, description, weight, max], i) => {
    database.prepare(`
      INSERT INTO rubric_criteria (id, event_id, field_key, name, description, weight, max_score, position)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(id('crt'), foundryId, `f-${key}`, name, description, weight, max, i);
  });

  database.prepare(`
    INSERT INTO schedule_items (id, event_id, title, description, kind, location, starts_at, ends_at, position)
    VALUES (?,?,?,?,?,?,?,?,0)
  `).run(id('sch'), foundryId, 'Kickoff', 'The rules and the rubric.', 'ceremony', 'The Foundry', '2026-08-14T17:00:00Z', '2026-08-14T18:00:00Z');
  database.prepare(`
    INSERT INTO schedule_items (id, event_id, title, description, kind, location, starts_at, ends_at, position)
    VALUES (?,?,?,?,?,?,?,?,1)
  `).run(id('sch'), foundryId, 'Submission deadline', 'Hard stop.', 'deadline', '—', '2026-08-16T17:00:00Z', null);
  database.prepare(`
    INSERT INTO schedule_items (id, event_id, title, description, kind, location, starts_at, ends_at, position)
    VALUES (?,?,?,?,?,?,?,?,2)
  `).run(id('sch'), foundryId, 'Results', 'Published at 19:00.', 'ceremony', 'The Foundry', '2026-08-20T18:00:00Z', '2026-08-20T20:00:00Z');

  const foundryJudges = FOUNDRY_JUDGES.map(([name, headline, organisation], i) => {
    const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@panel.example`;
    const linked = peopleIds.find((p) => p.name === name);
    const judgeId = id('jdg');
    const code = `FND-${String(2000 + i)}`;
    const creds = auth.hashPassword(code);
    database.prepare(`
      INSERT INTO judges (id, event_id, user_id, name, email_key, headline, organisation, bio, state,
        access_code_hash, access_code_salt, invite_code, invited_by, invited_at, verified_at)
      VALUES (?,?,?,?,?,?,?,'', 'verified', ?,?,?,?,?,?)
    `).run(judgeId, foundryId, linked ? linked.userId : null, name, email, headline, organisation,
      creds.hash, creds.salt, code, organiser, '2026-08-01T09:00:00Z', '2026-08-01T10:00:00Z');
    foundryTracks.forEach((t, ti) => {
      if ((i + ti) % 3 === 0) database.prepare('INSERT OR IGNORE INTO judge_tracks (judge_id, track_id) VALUES (?,?)').run(judgeId, t);
    });
    if (linked) grantRole(foundryId, linked.userId, 'judge');
    return { id: judgeId, name };
  });

  // teams, one per project, with a real roster
  const foundryPeople = new Set();
  const foundryProjects = [];
  FOUNDRY_PROJECTS.forEach(([name, tagline, trackIndex, description, stack, status, isPublic], i) => {
    void status;
    const teamId = id('tm');
    database.prepare(`
      INSERT INTO teams (id, event_id, slug, name, tagline, invite_code, is_final, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,1,?,?,?)
    `).run(teamId, foundryId, slugify(`${name}-team`), `${name} team`, `Built ${name} at Foundry 2026.`,
      `FND-${Math.random().toString(36).slice(2, 6).toUpperCase()}`, organiser, now(), now());

    // One person, one team, per event — the same rule the platform enforces.
    const roster = [];
    let cursor = i;
    while (roster.length < 3) {
      const candidate = peopleIds[(cursor * 3 + 1) % peopleIds.length];
      cursor += 1;
      if (roster.some((p) => p.userId === candidate.userId)) continue;
      if (foundryPeople.has(candidate.userId)) continue;
      roster.push(candidate);
    }
    for (const p of roster) foundryPeople.add(p.userId);
    roster.forEach((p, mi) => {
      database.prepare('INSERT OR IGNORE INTO team_members (team_id, user_id, role, joined_at) VALUES (?,?,?,?)')
        .run(teamId, p.userId, mi === 0 ? 'lead' : 'member', now());
      register(foundryId, p.userId);
    });

    const projectId = id('prj');
    const submittedAt = '2026-08-16T16:00:00Z';
    insert('projects', {
      id: projectId,
      event_id: foundryId,
      team_id: teamId,
      track_id: foundryTracks[trackIndex % 4],
      slug: slugify(name),
      name,
      tagline,
      description,
      tech_stack: JSON.stringify(stack),
      repo_url: `https://github.com/hackerly-demo/${slugify(name)}`,
      demo_url: `https://${slugify(name)}.example.dev`,
      video_url: '',
      cover_hue: hashInt(projectId, 360),
      screenshots: '[]',
      answers: '{}',
      status: 'submitted',
      is_public: isPublic,
      submitted_at: submittedAt,
      created_at: submittedAt,
      updated_at: submittedAt,
    });

    database.prepare(`
      INSERT INTO project_submissions (id, project_id, event_id, version, snapshot, submitted_at)
      VALUES (?,?,?,1,?,?)
    `).run(id('sub'), projectId, foundryId, JSON.stringify({ name, tagline }), submittedAt);

    foundryProjects.push({ id: projectId, track: trackIndex % 4, trackName: FOUNDRY_TRACKS[trackIndex % 4][0], name });
  });

  // every project to three judges, and a full set of reviews
  const foundryCriteria = judging.criteriaFor(foundryId);
  const deterministicScore = (seed, i) => 2 + (hashInt(`${seed}-${i}`, 40) / 10);
  for (const project of foundryProjects) {
    const panel = [foundryJudges[0], foundryJudges[1], foundryJudges[2], foundryJudges[3]];
    panel.forEach((j, ji) => {
      database.prepare(`
        INSERT OR IGNORE INTO judge_assignments (id, event_id, judge_id, project_id, state, assigned_at, completed_at)
        VALUES (?,?,?,?, 'completed', ?, ?)
      `).run(id('asg'), foundryId, j.id, project.id, '2026-08-17T09:00:00Z', '2026-08-19T17:00:00Z');

      const scores = {};
      foundryCriteria.forEach((cr, ci) => {
        const raw = Math.round(deterministicScore(`${project.name}-${j.name}`, ci) * 2) / 2;
        scores[cr.id] = Math.min(cr.max_score, Math.max(0, raw));
      });
      const summary = judgeSummaryFor(project.name, j.name);
      queries.saveReview({
        eventId: foundryId,
        projectId: project.id,
        judgeId: j.id,
        scores,
        notes: {},
        prose: {
          summary: summary.text,
          strengths: summary.strengths,
          improvements: summary.improvements,
          concerns: '',
          recommend: summary.recommend,
        },
        state: 'submitted',
      });
      void ji;
    });
  }

  // Publish results. Awards are derived from the computed standings rather than
  // declared per project, so a demo can never show "Overall winner" on the
  // fourth-placed project.
  const standings = judging.standings(foundryId);
  const OVERALL = new Map([[1, 'Overall winner'], [2, 'Second place'], [3, 'Third place']]);
  for (const s of standings) {
    const parts = [];
    if (OVERALL.has(s.rank)) parts.push(OVERALL.get(s.rank));
    if (s.track_rank === 1 && s.trackName) parts.push(`Best in ${s.trackName}`);
    insert('results', {
      id: id('res'),
      event_id: foundryId,
      project_id: s.id,
      rank: s.rank,
      track_rank: s.track_rank,
      weighted_score: s.weighted,
      normalised_score: s.final,
      public_votes: hashInt(s.id, 40),
      award: parts.join(' · '),
      published: 1,
      published_at: '2026-08-20T18:00:00Z',
      computed_at: now(),
    });
  }
  database.prepare("UPDATE events SET results_released = 1 WHERE id = ?").run(foundryId);

  // an announcement and a couple of FAQs so the finished event page is complete
  database.prepare(`
    INSERT INTO announcements (id, event_id, title, body, kind, pinned, author_id, created_at)
    VALUES (?,?,?,?,?,1,?,?)
  `).run(id('ann'), foundryId, 'Results are published',
    'The judging panel finished reading. Every write-up was read in full by at least three judges, and the ranking below is the result of the blended weighted and normalised scores.\n\nCongratulations to everyone who took part — the standard this year was noticeably higher than last.', 'results', organiser, '2026-08-20T18:00:00Z');

  for (const [q, a] of [
    ['How were scores normalised?', 'Each judge\'s totals are rescaled against that judge\'s own distribution of reviews, so a lenient judge does not decide the ranking on their own. The method is documented on the About page.'],
    ['Can I see individual scores?', 'No. Scores and notes are private to the judge who wrote them and to the organising team. Only the ranking is public.'],
  ]) {
    database.prepare('INSERT INTO faqs (id, event_id, question, answer, position) VALUES (?,?,?,?,0)')
      .run(id('faq'), foundryId, q, a);
  }

  /* ---- a private event, to prove visibility ---- */
  const meridianId = insertEvent({
    slug: 'meridian-invitational',
    name: 'Meridian Invitational',
    tagline: 'A closed event for partner organisations. Not listed, not reachable without an invitation.',
    about: 'This event exists so the portal can be checked for a real access rule: it is private, it does not appear in the directory, and its projects are not visible to anyone who is not on the organising team.',
    organiser_name: 'NexusLabs',
    format: 'in_person',
    venue: 'The Foundry, Bermondsey',
    city: 'London',
    country: 'United Kingdom',
    timezone: 'Europe/London',
    topics: ['private'],
    visibility: 'private',
    status: 'published',
    organiser_id: organiser,
    cover_hue: 268,
    starts_at: '2026-11-06T09:00:00Z',
    ends_at: '2026-11-07T18:00:00Z',
    registration_opens_at: '2026-10-01T09:00:00Z',
    registration_closes_at: '2026-10-28T23:00:00Z',
    submissions_open_at: '2026-11-06T09:00:00Z',
    submissions_close_at: '2026-11-07T16:00:00Z',
    judging_opens_at: '2026-11-07T17:00:00Z',
    judging_closes_at: '2026-11-09T18:00:00Z',
    results_at: '2026-11-10T18:00:00Z',
    min_team_size: 2,
    max_team_size: 6,
    allow_solo: 0,
    allow_team_invites: 0,
    max_participants: 40,
    require_approval: 1,
    require_repo: 1,
    require_demo: 1,
    submission_checklist: ['A working build', 'An in-person demo slot booked'],
  });
  grantRole(meridianId, organiser, 'organiser');

  /* ---- deterministic API tokens for automation and the acceptance checker ---- */
  const tokens = [
    [organiser, 'organiser', 'organiser@hackerly.dev', 'CSV export and organiser automation', ['export', 'read']],
    [demoJudge, 'judge_a', 'judge@hackerly.dev', 'Judge read access for scripted checks', ['read']],
    [demoJudge2, 'judge_b', 'judge2@hackerly.dev', 'Second judge, for isolation checks', ['read']],
    [demoParticipant, 'participant', 'participant@hackerly.dev', 'Participant read access', ['read']],
  ];
  const SEEDED_TOKEN = {
    organiser: 'org_7f2a',
    judge_a: 'jdg_a_91bc',
    judge_b: 'jdg_b_44de',
    participant: 'prt_2e88',
  };
  for (const [uid, role, label, , scopes] of tokens) {
    const raw = SEEDED_TOKEN[role];
    database.prepare(`
      INSERT INTO api_tokens (id, token_hash, user_id, event_id, label, scopes, created_at)
      VALUES (?,?,?,?,?,?,?)
    `).run(id('tok'), auth.sha256(raw), uid, null, label, JSON.stringify(scopes), now());
  }

  return {
    events: 3,
    users: peopleIds.length + 4,
    projects: FOUNDRY_PROJECTS.length + SIGNAL_PROJECTS.length,
    tokens: SEEDED_TOKEN,
  };
}

/* ---------------------------------------------------------------- helpers */

const EVENT_COLUMNS = [
  'id', 'slug', 'name', 'tagline', 'about', 'cover_hue', 'organiser_name', 'organiser_id',
  'visibility', 'status', 'results_released', 'format', 'venue', 'city', 'country', 'timezone', 'topics',
  'registration_opens_at', 'registration_closes_at', 'starts_at', 'ends_at',
  'submissions_open_at', 'submissions_close_at', 'judging_opens_at', 'judging_closes_at', 'results_at',
  'eligibility', 'min_team_size', 'max_team_size', 'allow_solo', 'allow_team_invites', 'participation_fee',
  'max_participants', 'require_approval', 'require_repo', 'require_demo', 'require_video',
  'require_screenshots', 'submission_checklist', 'code_of_conduct', 'rules', 'show_projects',
  'allow_public_voting', 'allow_comments', 'created_at', 'updated_at',
];

function insertEvent(spec) {
  const eventId = spec.id || id('evt');
  const flag = (value) => (value ? 1 : 0);
  const values = {
    id: eventId,
    slug: spec.slug,
    name: spec.name,
    tagline: spec.tagline || '',
    about: spec.about || '',
    cover_hue: spec.cover_hue ?? 24,
    organiser_name: spec.organiser_name || '',
    organiser_id: spec.organiser_id || null,
    visibility: spec.visibility || 'public',
    status: spec.status || 'draft',
    results_released: flag(spec.results_released),
    format: spec.format || 'online',
    venue: spec.venue || '',
    city: spec.city || '',
    country: spec.country || '',
    timezone: spec.timezone || 'UTC',
    topics: JSON.stringify(spec.topics || []),
    registration_opens_at: spec.registration_opens_at || null,
    registration_closes_at: spec.registration_closes_at || null,
    starts_at: spec.starts_at,
    ends_at: spec.ends_at,
    submissions_open_at: spec.submissions_open_at || spec.starts_at,
    submissions_close_at: spec.submissions_close_at,
    judging_opens_at: spec.judging_opens_at || null,
    judging_closes_at: spec.judging_closes_at || null,
    results_at: spec.results_at || null,
    eligibility: spec.eligibility || '',
    min_team_size: spec.min_team_size ?? 1,
    max_team_size: spec.max_team_size ?? 4,
    allow_solo: spec.allow_solo === false ? 0 : 1,
    allow_team_invites: spec.allow_team_invites === false ? 0 : 1,
    participation_fee: spec.participation_fee || '',
    max_participants: spec.max_participants || 0,
    require_approval: flag(spec.require_approval),
    require_repo: flag(spec.require_repo),
    require_demo: flag(spec.require_demo),
    require_video: flag(spec.require_video),
    require_screenshots: flag(spec.require_screenshots),
    submission_checklist: JSON.stringify(spec.submission_checklist || []),
    code_of_conduct: spec.code_of_conduct || '',
    rules: spec.rules || '',
    show_projects: spec.show_projects === false ? 0 : 1,
    allow_public_voting: flag(spec.allow_public_voting),
    allow_comments: flag(spec.allow_comments),
    created_at: now(),
    updated_at: now(),
  };

  db().prepare(`
    INSERT INTO events (${EVENT_COLUMNS.join(', ')})
    VALUES (${EVENT_COLUMNS.map(() => '?').join(', ')})
  `).run(...EVENT_COLUMNS.map((column) => values[column]));

  return eventId;
}

function grantRole(eventId, uid, role) {
  db().prepare(`
    INSERT OR IGNORE INTO event_roles (id, event_id, user_id, role, created_at) VALUES (?,?,?,?,?)
  `).run(id('rol'), eventId, uid, role, now());
}

function register(eventId, uid) {
  db().prepare(`
    INSERT OR IGNORE INTO registrations (id, event_id, user_id, state, registered_at) VALUES (?,?,?, 'confirmed', ?)
  `).run(id('reg'), eventId, uid, now());
}

function markAssignment(eventId, judgeId, projectId, state) {
  db().prepare(`
    UPDATE judge_assignments SET state = ?, completed_at = ?
    WHERE event_id = ? AND judge_id = ? AND project_id = ?
  `).run(state, state === 'completed' ? now() : null, eventId, judgeId, projectId);
}

function anchorFor(eventId, anchor) {
  const event = db().prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  const map = {
    registration_opens_at: event.registration_opens_at,
    submissions_close_at: event.submissions_close_at,
    judging_opens_at: event.judging_opens_at,
    results_at: event.results_at,
    starts_at: event.starts_at,
    ends_at: event.ends_at,
  };
  if (map[anchor]) return map[anchor];
  if (anchor === 'midpoint') return new Date(Date.parse(event.starts_at) + 24 * 3600_000).toISOString();
  if (anchor === 'overnight') return new Date(Date.parse(event.starts_at) + 10 * 3600_000).toISOString();
  return event.starts_at;
}

const SUMMARIES = {
  'Bandit Proxy': ['Replaced a rate limit that treated a health check and a migration as equal. The cost model is the whole idea and it is right.', 'The budget survives a proxy restart, which is the part most implementations skip.', 'The 429 body should include a remediation hint.', 'shortlist'],
  Slowdrop: ['Does the one thing a CI log is bad at: attributing time to a cause. The flame chart is a bonus.', 'The "what changed since the last green" panel is the feature I would keep.', 'Parallel step attribution is still wrong in the nested case.', 'shortlist'],
  Coldline: ['Interesting idea, honest about its own error rate, which is rarer than it should be.', 'Drops uncertain candidates instead of ranking them low. Good instinct.', 'The projection numbers are not reproducible, and I could not work out how they are derived.', 'discuss'],
  Tideline: ['The expand/migrate/contract framing is correct and the fleet-level control plane is the part that makes it real.', 'Reconciliation instead of pretending a data migration is reversible. Exactly right.', 'Nothing blocking for a weekend. Ship it.', 'shortlist'],
  Quietroom: ['Solves a real and very common problem. The scrubbing is the risky part and they know it.', 'Per-PR namespaces destroyed on a timer.', 'Column-name-based sensitivity inference will be wrong in ways that matter.', 'discuss'],
  'Fair Share': ['Small, complete, and correct. The constrained formulation is the elegant bit.', 'Handles shared items without pretending there is an answer.', 'No offline mode.', 'pass'],
  Greenlight: ['The report format is genuinely readable, which is the difference between a tool and a dashboard.', 'The confidence labelling avoids crying wolf.', 'Evidence quality varies wildly by registry and it does not always say so.', 'discuss'],
  Longhand: ['Executing every code block in the documentation is an idea I have not seen anywhere.', 'The explicit opt-out list is the right design.', 'Slow on a large documentation set.', 'shortlist'],
  Wheelhouse: ['Priority-driven cache eviction is a good idea and the fail-closed/open split is defensible.', 'Works under a partial outage, which I tested.', 'Configuration is fiddly.', 'pass'],
  Nightwatch: ['Collapsing repeats and *reducing* confidence rather than increasing it is the correct, counterintuitive choice.', 'Under-pages rather than over-pages, and says so.', 'The model has no history early in an incident.', 'discuss'],
  Braid: ['Classifying commit intent is the right frame and the human confirmation is honest about it.', 'Only replays upstream-owned changes.', 'The classifier heuristics are undocumented.', 'pass'],
  Sparrow: ['Making invalid data easy to write on purpose is a small idea with a large effect on test suites.', 'Keeps the generated set small, which most generators do not.', 'Only works with Zod schemas.', 'pass'],
  Kettle: ['The fidelity score is the most honest thing in this whole event. Refusing to claim a reproduction it cannot make is rare.', 'Assembles the environment properly.', 'Assembling for managed dependencies is approximate and the report says so.', 'shortlist'],
  Rookery: ['Annotation is the product and the schema was already there. Correct observation.', 'Ownership inference from query logs is clever and fragile.', 'A rendering rather than a tool, really.', 'pass'],
};

function judgeSummaryFor(projectName, judgeName) {
  const base = SUMMARIES[projectName] || ['A competent build with a clear use case.', 'Sensible engineering.', 'More polish.', 'pass'];
  return {
    text: `${base[0]} (read by ${judgeName.split(' ')[0]}.)`,
    strengths: base[1],
    improvements: base[2],
    recommend: base[3],
  };
}

// required after the functions above, avoids a circular import at module load
const queries = require('../../lib/queries');

module.exports = { seedDemo, DEMO_PASSWORD, SEEDED_ACCOUNTS: {
  organiser: 'organiser@hackerly.dev',
  judge: 'judge@hackerly.dev',
  judge2: 'judge2@hackerly.dev',
  participant: 'participant@hackerly.dev',
} };
