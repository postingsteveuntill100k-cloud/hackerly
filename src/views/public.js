'use strict';

const { esc, markdown, plain, safeUrl, qs } = require('../lib/html');
const lc = require('../lib/lifecycle');
const c = require('./components');

/* --------------------------------------------------------------- homepage */

const LIFECYCLE = [
  ['Discover', 'Browse open hackathons by format, topic and date. Every event page explains what you are building, who can enter, and when things close.'],
  ['Register', 'Sign up in one step. Eligibility, team size and entry requirements are stated up front, not buried.'],
  ['Team', 'Create a team or join one with an invite code. Leads control the roster; Hackerly keeps the rules straight.'],
  ['Build', 'Draft your project while you work. Save as often as you like — nothing is locked before the deadline.'],
  ['Submit', 'One checklist, one deadline, enforced on the server. A frozen copy of your submission goes to the judges.'],
  ['Judge', 'Judges work in a workspace built for software: demo, repo, write-up and rubric on one page, with side-by-side comparison.'],
  ['Showcase', 'Results publish when the organiser says so. Winners and everything else land in the public showcase.'],
];

function homePage({ user, events, projects, stats }) {
  const featured = events.slice(0, 3);
  const body = `
<section class="hero">
  <div class="wrap">
    <div class="eyebrow">The hackathon platform</div>
    <h1 class="display hero__title">Run the event.<br><em>Judge the work.</em></h1>
    <p class="lede hero__lede">Hackerly is one place to discover hackathons, take part in them, host them, and evaluate what gets built — with a judging workspace designed for software, not spreadsheets.</p>
    <div class="hero__actions">
      <a class="btn btn--lg btn--accent" href="/hackathons">Explore hackathons</a>
      <a class="btn btn--lg btn--ghost" href="/host">Host a hackathon</a>
    </div>
    <div class="hero__proof">
      <span><b>${events.length}</b> listed hackathons</span>
      <span><b>${projects.length}</b> public projects</span>
      <span><b>${stats.judges}</b> verified judges</span>
      <span>Self-hostable · Open source</span>
    </div>
  </div>
</section>

${featured.length ? `<section class="bay" style="padding-top:0">
  <div class="wrap">
    <div class="cluster cluster--between mb-3">
      <div class="section-head mb-0" style="margin-bottom:0">
        <div class="eyebrow">Open now</div>
        <h2 style="margin:0">Hackathons you can join</h2>
      </div>
      <a class="arrow-link" href="/hackathons">See all</a>
    </div>
    <div class="grid grid--3">
      ${featured.map((e) => eventCard(e)).join('')}
    </div>
  </div>
</section>` : ''}

<section class="bay sunk">
  <div class="wrap">
    <div class="section-head">
      <div class="eyebrow">The lifecycle</div>
      <h2>Everything a hackathon needs, in one thread</h2>
      <p>From the first announcement to the published results, nobody has to move between five different tools or retype the same deadlines.</p>
    </div>
    <ol class="lifecycle">
      ${LIFECYCLE.map(([t, d], i) => `<li class="lifecycle__item">
        <span class="lifecycle__n">${String(i + 1).padStart(2, '0')}</span>
        <h3>${esc(t)}</h3>
        <p>${esc(d)}</p>
      </li>`).join('')}
    </ol>
  </div>
</section>

<section class="bay">
  <div class="wrap">
    <div class="grid grid--split">
      <div>
        <div class="eyebrow">For judges</div>
        <h2>Judging that does not fight you</h2>
        <p class="lede mt-2">A panel judge with thirty projects to review is doing real work. Hackerly treats it that way.</p>
        <div class="stack stack--sm mt-3">
          ${[
    ['Everything on one page', 'Demo video, live demo, repository, write-up and the submission answers sit in the same view as the rubric. No tab juggling.'],
    ['Side-by-side comparison', 'Select projects and put two, three or four of them next to each other — media, write-up, stack and your own scores lined up.'],
    ['Scores that survive scrutiny', 'Every review is private to its author and the organising team. Raw scores are normalised against each judge’s own distribution before results are published.'],
    ['Nothing to submit twice', 'Drafts save as you go. Submitting freezes a copy, so a project cannot change under a judge mid-review.'],
  ].map(([t, d]) => `<div class="feature" style="padding-top:0.9rem">
            <h3>${esc(t)}</h3>
            <p>${esc(d)}</p>
          </div>`).join('')}
        </div>
        <a class="arrow-link mt-3" href="/about#judging">How judging works</a>
      </div>
      <div class="stack">
        <div class="shot">
          <div class="shot__bar"><span class="shot__dots"><i></i><i></i><i></i></span> judging workspace</div>
          <div class="shot__body">
            <div class="cluster cluster--between mb-2">
              <div>
                <div class="eyebrow eyebrow--plain" style="margin-bottom:0.2rem">Track · Developer tools</div>
                <b style="font-family:var(--serif);font-size:var(--step-1)">Driftwood</b>
                <div class="small muted">by Quiet Harbour · submitted 27 Feb</div>
              </div>
              <span class="badge badge--good">3 of 3 scored</span>
            </div>
            <div class="media-frame" style="aspect-ratio:16/7">
              <div class="media-frame__fallback">
                <div>
                  <div class="mono" style="letter-spacing:.1em">DEMO</div>
                  <div class="small" style="opacity:.7">Video, live demo and repository open in place</div>
                </div>
              </div>
            </div>
            <div class="rubric mt-2">
              ${[['Functionality', 4, 5], ['Technical quality', 5, 5], ['Originality', 3, 5]].map(([n, v, m]) => `
                <div class="criterion is-scored">
                  <div class="criterion__head"><span class="criterion__name">${n}</span><span class="criterion__meta">${v} / ${m}</span></div>
                  <div class="scale">${Array.from({ length: m }, (_, i) => `<button type="button" aria-pressed="${i + 1 === v}" class="${i + 1 >= 4 ? 'is-high' : ''}">${i + 1}</button>`).join('')}</div>
                </div>`).join('')}
            </div>
          </div>
        </div>
        <p class="small muted center">An illustration, not a screenshot. The real thing is at <a href="/signin">your dashboard</a>.</p>
      </div>
    </div>
  </div>
</section>

<section class="bay sunk">
  <div class="wrap">
    <div class="grid grid--3">
      ${[
    ['Built for organisers', 'Create an event, set real deadlines, publish tracks and challenges, build a weighted rubric, invite judges, assign projects, watch progress and release results when you are ready.'],
    ['Built for participants', 'Know the rules before you sign up. Form a team, draft your project, see exactly what is still missing before the deadline, and follow the event through to results.'],
    ['Built to be trusted', 'Roles live on the server. Private events stay private, unpublished results stay unpublished, and one judge can never read another judge’s notes — verified by the portal’s own test suite.'],
  ].map(([t, d], i) => `<div class="feature">
        <span class="feature__n">${String(i + 1).padStart(2, '0')}</span>
        <h3>${esc(t)}</h3>
        <p>${esc(d)}</p>
      </div>`).join('')}
    </div>
  </div>
</section>

${projects.length ? `<section class="bay">
  <div class="wrap">
    <div class="cluster cluster--between mb-3">
      <div class="section-head" style="margin-bottom:0">
        <div class="eyebrow">From the showcase</div>
        <h2 style="margin:0">Recently built</h2>
      </div>
      <a class="arrow-link" href="/projects">Open the showcase</a>
    </div>
    <div class="grid grid--4">
      ${projects.slice(0, 4).map((p) => projectCard(p, { compact: true })).join('')}
    </div>
  </div>
</section>` : ''}

<section class="bay" style="padding-bottom:var(--bay-lg)">
  <div class="wrap">
    <div class="cta-band">
      <div class="eyebrow eyebrow--plain" style="justify-content:center;color:rgba(252,251,248,.6)">Get started</div>
      <h2>Find an event, or put on your own</h2>
      <p>Browsing is open to everyone. You only need an account to register, build, host or judge.</p>
      <div class="btn-row mt-2" style="justify-content:center">
        <a class="btn btn--lg btn--accent" href="/hackathons">Explore hackathons</a>
        <a class="btn btn--lg btn--ghost" href="/host">Host a hackathon</a>
      </div>
    </div>
  </div>
</section>`;

  return c.siteLayout({
    title: 'The hackathon platform',
    description: 'Hackerly is one place to discover hackathons, take part in them, host them, and evaluate what gets built — with a judging workspace designed for software.',
    current: '/',
    user,
    body,
  });
}

/* -------------------------------------------------------------- listings */

function eventCard(e, { featured = false } = {}) {
  const phase = lc.phase(e);
  const where = c.formatLocation(e);
  return `<a class="card" href="/h/${esc(e.slug)}">
    ${featured ? c.artBox(e.slug, { tall: true, className: 'mb-1' }) : ''}
    <div class="cluster cluster--between cluster--start" style="gap:.5rem">
      ${c.statusBadge(phase)}
      ${c.formatBadge(e.format)}
    </div>
    <h3 class="card__title">${esc(e.name)}</h3>
    <p class="card__body">${esc(e.tagline || plain(e.about, 130))}</p>
    <div class="small muted tight">
      <div>${esc(lc.fmtRange(e.startsAt, e.endsAt, e.timezone))}</div>
      <div>${esc(where)}</div>
    </div>
    <div class="card__foot">
      <span>${e.stats.projects} project${e.stats.projects === 1 ? '' : 's'}</span>
      <span>${e.stats.registrations} registered</span>
    </div>
  </a>`;
}

function projectCard(p, { compact = false, showEvent = true } = {}) {
  return `<a class="card" href="/p/${esc(p.eventSlug || '')}/${esc(p.slug)}">
    ${compact ? c.artBox(p.id, { className: 'mb-1' }) : ''}
    ${p.award ? `<div><span class="badge badge--accent">${esc(p.award)}</span></div>` : ''}
    <h3 class="card__title">${esc(p.name)}</h3>
    <p class="card__body">${esc(p.tagline)}</p>
    ${p.techStack && p.techStack.length ? c.techTags(p.techStack.slice(0, compact ? 3 : 4)) : ''}
    <div class="card__foot">
      <span>${esc(p.teamName)}</span>
      ${showEvent && p.eventName ? `<span>${esc(p.eventName)}</span>` : (p.trackName ? c.trackChip(p.trackName, p.trackColour) : '')}
    </div>
  </a>`;
}

function hackathonsPage({ user, events, topics, filters, resultCount }) {
  const { search, topic, format, state } = filters;
  const hasFilters = Boolean(search || topic || format || state);
  const body = `
<div class="wrap" style="padding-top:clamp(2rem,1.5rem+2vw,3.2rem)">
  <div class="section-head">
    <div class="eyebrow">Directory</div>
    <h1>Hackathons on Hackerly</h1>
    <p>Every event below is a real listing on this installation. Open one to see its dates, rules, tracks, prizes and projects.</p>
  </div>

  <form class="filter-bar" method="get" action="/hackathons">
    <input type="search" name="q" value="${esc(search)}" placeholder="Search by name, city or topic" aria-label="Search hackathons">
    <select name="state" aria-label="When">
      <option value="">Any time</option>
      <option value="upcoming"${state === 'upcoming' ? ' selected' : ''}>Upcoming</option>
      <option value="live"${state === 'live' ? ' selected' : ''}>Open now</option>
      <option value="past"${state === 'past' ? ' selected' : ''}>Finished</option>
    </select>
    <select name="format" aria-label="Format">
      <option value="">Any format</option>
      <option value="online"${format === 'online' ? ' selected' : ''}>Online</option>
      <option value="in_person"${format === 'in_person' ? ' selected' : ''}>In person</option>
      <option value="hybrid"${format === 'hybrid' ? ' selected' : ''}>Hybrid</option>
    </select>
    ${topic ? `<input type="hidden" name="topic" value="${esc(topic)}">` : ''}
    <button class="btn btn--sm" type="submit">Apply</button>
    ${hasFilters ? `<a class="btn btn--sm btn--quiet" href="/hackathons">Clear</a>` : ''}
  </form>

  ${topics.length ? `<div class="cluster mb-3">
    <a class="badge${!topic ? ' badge--solid' : ''}" href="/hackathons${state ? `?state=${encodeURIComponent(state)}` : ''}">All topics</a>
    ${topics.slice(0, 14).map((t) => `<a class="badge${topic === t.name ? ' badge--solid' : ''}" href="/hackathons?topic=${encodeURIComponent(t.name)}${state ? `&state=${encodeURIComponent(state)}` : ''}">${esc(t.name)} <span class="divider-dots">${t.n}</span></a>`).join('')}
  </div>` : ''}

  ${events.length
    ? `<div class="grid grid--3">${events.map((e) => eventCard(e)).join('')}</div>
       <p class="small muted mt-3">${resultCount} hackathon${resultCount === 1 ? '' : 's'}${hasFilters ? ' matching your filters' : ' listed'}.</p>`
    : c.empty('Nothing matches yet', hasFilters
      ? 'No hackathon on this installation matches those filters. Try clearing them, or host the one you were looking for.'
      : 'No hackathons have been published on this installation yet.',
      '<a class="btn btn--accent" href="/host">Host a hackathon</a>')}
</div>`;

  return c.siteLayout({
    title: 'Hackathons',
    description: 'Browse hackathons you can join. Filter by format, topic and date.',
    current: '/hackathons',
    user,
    body,
  });
}

function showcasePage({ user, projects, facets, filters }) {
  const { search, track, tech, awarded } = filters;
  const hasFilters = Boolean(search || track || tech || awarded);
  const body = `
<div class="wrap" style="padding-top:clamp(2rem,1.5rem+2vw,3.2rem)">
  <div class="section-head">
    <div class="eyebrow">Showcase</div>
    <h1>Projects people built</h1>
    <p>Every project here opted into public display. Read the write-up, watch the demo, look at the code, and see how it placed.</p>
  </div>

  <form class="filter-bar" method="get" action="/projects">
    <input type="search" name="q" value="${esc(search)}" placeholder="Search projects, teams or events" aria-label="Search projects">
    <select name="track" aria-label="Track">
      <option value="">Any track</option>
      ${facets.tracks.map((t) => `<option value="${esc(t.name)}"${track === t.name ? ' selected' : ''}>${esc(t.name)} (${t.n})</option>`).join('')}
    </select>
    <select name="tech" aria-label="Technology">
      <option value="">Any technology</option>
      ${facets.tech.map((t) => `<option value="${esc(t.name)}"${tech === t.name ? ' selected' : ''}>${esc(t.name)} (${t.n})</option>`).join('')}
    </select>
    <label class="check" style="align-items:center">
      <input type="checkbox" name="awarded" value="1"${awarded ? ' checked' : ''}> Awarded only
    </label>
    <button class="btn btn--sm" type="submit">Apply</button>
    ${hasFilters ? `<a class="btn btn--sm btn--quiet" href="/projects">Clear</a>` : ''}
  </form>

  ${projects.length
    ? `<div class="grid grid--3">${projects.map((p) => projectCard(p)).join('')}</div>`
    : c.empty('No projects to show', hasFilters
      ? 'Nothing in the showcase matches those filters yet.'
      : 'No project has opted into the public showcase on this installation yet.',
      '<a class="btn btn--accent" href="/hackathons">Find a hackathon to join</a>')}
</div>`;

  return c.siteLayout({
    title: 'Project showcase',
    description: 'Software built at hackathons on Hackerly: write-ups, demos, repositories and results.',
    current: '/projects',
    user,
    body,
  });
}

/* ------------------------------------------------------------ host / about */

function hostPage({ user }) {
  const body = `
<section class="hero" style="padding-bottom:clamp(1.6rem,1.2rem+2vw,2.6rem)">
  <div class="wrap wrap--narrow">
    <div class="eyebrow">For organisers</div>
    <h1 class="display" style="font-size:var(--step-5);max-width:16ch">Put on the whole event, not just a form.</h1>
    <p class="lede mt-2">Create the hackathon, set the rules that matter, run registration, watch submissions arrive, get judging done properly, and publish results. All on one instance you control.</p>
    <div class="hero__actions">
      <a class="btn btn--lg btn--accent" href="${user ? '/host/new' : '/signup'}">Create a hackathon</a>
      <a class="btn btn--lg btn--ghost" href="#judging">See the judging engine</a>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="grid grid--3">
      ${[
    ['Set it up once', 'Identity, format, eligibility, team rules, every milestone, the submission checklist, the rubric and the prizes. Change anything later without breaking what participants already see.'],
    ['Run it', 'Registrations with approval or a capacity cap, team invites by code, a submission deadline enforced on the server, and announcements participants actually read.'],
    ['Get honest judging', 'Invite judges, verify their access, assign projects against track expertise, watch completion live, and only then release results.'],
  ].map(([t, d], i) => `<div class="feature">
        <span class="feature__n">${String(i + 1).padStart(2, '0')}</span>
        <h3>${esc(t)}</h3>
        <p>${esc(d)}</p>
      </div>`).join('')}
    </div>
  </div>
</section>

<section class="section sunk" id="judging">
  <div class="wrap">
    <div class="grid grid--split-left">
      <div>
        <div class="eyebrow">Judging engine</div>
        <h2>Assignments, rubric, normalisation</h2>
        <div class="stack stack--sm mt-2">
          <div class="kv">
            <div><dt>Access</dt><dd>Judges only reach projects they are assigned. A project page is refused server-side, not hidden behind a button.</dd></div>
            <div><dt>Rubric</dt><dd>Weighted criteria with your own scale. Judges see the same rubric you defined, with the description you wrote for each criterion.</dd></div>
            <div><dt>Progress</dt><dd>Completion per judge, per project and overall, while judging is still open.</dd></div>
            <div><dt>Normalisation</dt><dd>Raw scores are reported next to a per-judge normalised score, because one lenient judge should not decide the winner. The method is shown, not hidden.</dd></div>
            <div><dt>Export</dt><dd>A CSV of every submitted review, for your own records or a results spreadsheet.</dd></div>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel__head"><h3 style="margin:0">Judging progress</h3><span class="badge badge--warn">Judging open</span></div>
        <div class="stack">
          ${meter(11, 15, { label: '11 of 15 reviews submitted', right: '73%' })}
          ${[
    ['A. Okonkwo', '8 / 9', 0.89],
    ['M. Lindqvist', '5 / 6', 0.83],
    ['S. Duarte', '4 / 5', 0.8],
  ].map(([n, s, p]) => `<div class="cluster cluster--between">
            <span class="small">${esc(n)}</span>
            <span class="mono small">${esc(s)}</span>
            <div style="flex:1"><div class="meter__track"><div class="meter__fill" style="width:${p * 100}%"></div></div></div>
          </div>`).join('')}
        </div>
        <hr>
        <p class="small muted mb-0">An illustration. Live figures come from your own event.</p>
      </div>
    </div>
  </div>
</section>

<section class="section" id="selfhost">
  <div class="wrap">
    <div class="grid grid--split">
      <div>
        <div class="eyebrow">Self-hosting</div>
        <h2>It runs where you want it to</h2>
        <p>Hackerly is a single Node process on SQLite. <code class="mono">docker compose up</code> gives you a working, seeded portal with no external services and no network. Firebase is optional and additive — for authentication and hosting — never a dependency.</p>
        <div class="pre mono mt-2" style="background:var(--ink);color:var(--paper);padding:1rem 1.1rem;border-radius:var(--r);font-size:.82rem;overflow-x:auto">git clone &lt;repo&gt; &amp;&amp; cd hackerly
docker compose up --build
# → http://localhost:10000</div>
        <a class="arrow-link mt-2" href="/about#selfhost">Deployment details</a>
      </div>
      <div class="panel panel--sunk">
        <h4 class="mb-2">What you get out of the box</h4>
        <ul class="checklist checklist--soft">
          <li>Email and password accounts, sessions, sign out everywhere</li>
          <li>Public, unlisted and private events</li>
          <li>Teams, invitations, tracks, challenges, prizes, schedule, FAQs</li>
          <li>Configurable submission requirements per event</li>
          <li>Judge invitations, verification and assignment</li>
          <li>Weighted rubric, drafts, normalisation, CSV export</li>
          <li>Audit log of everything that changes</li>
        </ul>
      </div>
    </div>
  </div>
</section>

<section class="bay" style="padding-top:0">
  <div class="wrap"><div class="cta-band">
    <h2>Ready to put on an event?</h2>
    <p>It takes about two minutes to create one, and you can change every detail afterwards.</p>
    <a class="btn btn--lg btn--accent" href="${user ? '/host/new' : '/signup'}">Create a hackathon</a>
  </div></div>
</section>`;

  return c.siteLayout({
    title: 'Host a hackathon',
    description: 'Create, run, judge and publish a hackathon on Hackerly — an open, self-hostable platform.',
    current: '/host',
    user,
    body,
  });
}

function aboutPage({ user, stats }) {
  const body = `
<section class="hero" style="padding-bottom:clamp(1.4rem,1rem+1.6vw,2.2rem)">
  <div class="wrap wrap--narrow">
    <div class="eyebrow">About</div>
    <h1 class="display" style="font-size:var(--step-5)">Hackerly</h1>
    <p class="lede mt-2">A hackathon platform built around the three jobs that actually happen: taking part, running the event, and evaluating the software people submit.</p>
  </div>
</section>

<section class="section" id="how">
  <div class="wrap">
    <div class="grid grid--split">
      <div>
        <div class="eyebrow">How it works</div>
        <h2>Seven steps, one place</h2>
      </div>
      <ol class="lifecycle" style="display:grid;gap:0">
        ${LIFECYCLE.map(([t, d], i) => `<li class="lifecycle__item">
          <span class="lifecycle__n">${String(i + 1).padStart(2, '0')}</span>
          <div><h3>${esc(t)}</h3><p>${esc(d)}</p></div>
        </li>`).join('')}
      </ol>
    </div>
  </div>
</section>

<section class="section sunk" id="judging">
  <div class="wrap wrap--narrow">
    <div class="eyebrow">Judging</div>
    <h2>Why scores get normalised</h2>
    <p>Judges are people, and people score differently. One panelist reserves the top mark for work that changes their mind; another hands out fours to anything that runs. Averaging those numbers rewards the lenient judge, not the good work.</p>
    <p>Hackerly reports two figures for every project:</p>
    <ul>
      <li><b>The weighted score</b> — Σ(score × weight) ÷ Σ(max × weight), normalised to 100. It answers “how did the judges score this, on their own terms”.</li>
      <li><b>The adjusted score</b> — the same total rescaled against that judge’s own distribution of reviews, mapped onto 0–100.</li>
    </ul>
    <p>Standings blend the two. If a judge has given every project the same score there is no personal scale to correct against, and Hackerly says so rather than inventing an adjustment.</p>
    <h3 class="mt-4">Privacy between judges</h3>
    <p>A judge can read their own review and nothing else. Not a peer’s scores, not a peer’s notes, not through the page, not through the API, not by changing an identifier in a URL. Organisers of the event can read every review, because they are accountable for the outcome. Participants cannot read any of it until results are published.</p>
  </div>
</section>

<section class="section" id="integrity">
  <div class="wrap wrap--narrow">
    <div class="eyebrow">Integrity</div>
    <h2>What Hackerly refuses to do</h2>
    <ul class="checklist">
      <li>Ship results before an organiser publishes them, whatever the clock says</li>
      <li>Trust a role sent by the browser — roles are read from the database on every request</li>
      <li>Let a judge open a project they were not assigned</li>
      <li>Let one judge read another judge’s review, score or note</li>
      <li>Accept a submission after the deadline because a request asked nicely</li>
      <li>Expose a private event, or a participant’s email, through a public endpoint</li>
      <li>Render user content as HTML without escaping it</li>
    </ul>
  </div>
</section>

<section class="section sunk" id="selfhost">
  <div class="wrap wrap--narrow">
    <div class="eyebrow">Self-hosting</div>
    <h2>Run your own</h2>
    <p>Hackerly is MIT licensed and self-hostable. It needs Node 22 and a writable directory for its SQLite file. Nothing else — no hosted database, no cloud account, no outbound network request at runtime.</p>
    <p>Firebase is supported for hosting and optional for authentication, but a local install never needs it.</p>
    <div class="stat-row mt-3">
      <div class="stat"><span class="stat__n">${stats.events}</span><span class="stat__l">events on this instance</span></div>
      <div class="stat"><span class="stat__n">${stats.projects}</span><span class="stat__l">projects submitted</span></div>
      <div class="stat"><span class="stat__n">${stats.judges}</span><span class="stat__l">verified judges</span></div>
    </div>
  </div>
</section>

<section class="section" id="privacy">
  <div class="wrap wrap--narrow">
    <div class="eyebrow">Privacy</div>
    <h2>What Hackerly stores</h2>
    <p>Your name, email and the content you write. Email addresses are never shown on public pages — participant lists show names only, and judge records never expose an address. Sessions are stored hashed, so a copy of the database does not hand out live logins.</p>
  </div>
</section>`;

  return c.siteLayout({
    title: 'About',
    description: 'How Hackerly works, how judging is scored and normalised, and what the platform refuses to do.',
    current: '/about',
    user,
    body,
  });
}

module.exports = {
  homePage,
  hackathonsPage,
  showcasePage,
  hostPage,
  aboutPage,
  eventCard,
  projectCard,
};
