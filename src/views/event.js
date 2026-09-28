'use strict';

const { esc, markdown, plain, safeUrl } = require('../lib/html');
const lc = require('../lib/lifecycle');
const c = require('./components');
const { projectCard } = require('./public');

/**
 * The event page. Sections appear only when the event actually has content,
 * because an empty "Prizes" heading is worse than no heading at all.
 */
function eventPage({ event, viewer, sections, results, tabs, currentTab, pageHref }) {
  const phase = lc.phase(event);
  const where = c.formatLocation(event);

  const facts = [
    ['◷', `${lc.fmtDate(event.startsAt, event.timezone)} – ${lc.fmtDate(event.endsAt, event.timezone)}`],
    ['⌖', where],
    ['⌘', event.format === 'online' ? 'Online event' : event.format === 'hybrid' ? 'Hybrid event' : 'In person'],
  ];
  if (event.maxParticipants) facts.push(['⊞', `${sections.people.length} of ${event.maxParticipants} places`]);
  if (event.maxTeamSize !== 4 || event.allowSolo) {
    facts.push(['◫', `${event.allowSolo ? 'Solo or ' : ''}teams of up to ${event.maxTeamSize}`]);
  }
  if (event.participationFee) facts.push(['$', event.participationFee]);
  if (event.eligibility) facts.push(['✓', event.eligibility.split(/[.\n]/)[0].slice(0, 70)]);

  // Topics may be an empty array; the map must never be called on nothing.
  const topicList = Array.isArray(event.tags) ? event.tags : [];

  const nav = tabs.filter(Boolean).map((t) => `<a href="/h/${esc(event.slug)}${t.href}"${currentTab === t.key ? ' aria-current="page"' : ''}>${esc(t.label)}${t.count !== undefined ? ` <span class="divider-dots">${t.count}</span>` : ''}</a>`).join('');

  const body = `
<section class="event-hero">
  <div class="wrap">
    <div class="event-hero__grid">
      <div>
        <div class="cluster mb-2">
          ${c.statusBadge(phase)}
          ${c.formatBadge(event.format)}
          ${topicList.map((t) => `<a class="badge" href="/hackathons?topic=${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}
        </div>
        <h1>${esc(event.name)}</h1>
        <p class="event-hero__tagline">${esc(event.tagline)}</p>
        <div class="facts mt-3">
          ${facts.map(([i, t]) => `<span class="fact"><span class="fact__i" aria-hidden="true">${i}</span> ${esc(t)}</span>`).join('')}
        </div>
      </div>
      <div class="stack">
        ${c.artBox(event.slug, { tall: true })}
        <div class="panel">
          ${c.countdownBlock(event) || `
            <div class="eyebrow eyebrow--plain">${esc(lc.phaseLabel(event, Date.now()))}</div>
            <p class="mb-2">${esc(event.resultsReleased ? 'Results are published.' : 'Follow this event for announcements and deadlines.')}</p>`}
          <div class="btn-row mt-3" style="margin-top:1.1rem">
            ${viewer.cta}
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<nav class="event-nav" aria-label="Sections">
  <div class="wrap event-nav__in">${nav}</div>
</nav>

${currentTab === 'overview' ? overview({ event, sections, results, viewer })
    : currentTab === 'projects' ? projectsTab({ event, sections, viewer, pageHref })
      : currentTab === 'results' ? resultsTab({ event, results })
        : ''}`;

  return c.siteLayout({
    title: event.name,
    description: plain(event.tagline || event.about, 155),
    canonical: `/h/${event.slug}`,
    current: '/hackathons',
    user: viewer.user,
    body,
  });
}

/* ------------------------------------------------------------- sub-pages */

function overview({ event, sections, results, viewer }) {
  const { tracks, challenges, schedule, prizes, faqs, announcements, people, judges, staff, projects } = sections;

  const out = [];
  const push = (id, label, inner) => { if (inner) out.push(`<section class="section" id="${id}"><div class="wrap">${inner}</div></section>`); };

  // About
  if (event.about) {
    push('about', 'About', `
      ${c.sectionHead({ eyebrow: 'About', title: `About ${event.name}`, body: event.tagline })}
      <div class="grid grid--split">
        <div class="prose">${markdown(event.about)}</div>
        <div class="stack">
          <div class="panel panel--sunk">
            <div class="eyebrow eyebrow--plain">Essential dates</div>
            <div class="timeline">
              ${lc.milestones(event).map((m) => `<li>
                <span class="timeline__when">${esc(lc.fmtDay(m.at, event.timezone))}</span>
                <span class="timeline__what">${esc(m.label)}</span>
                <span class="timeline__note">${esc(lc.fmtTime(m.at, event.timezone))} ${esc(event.timezone)}${m.done ? ' · done' : ''}</span>
              </li>`).join('')}
            </div>
          </div>
        </div>
      </div>`);
  }

  // Who it's for
  if (event.eligibility) {
    push('who', 'Who can take part', `
      ${c.sectionHead({ eyebrow: 'Eligibility', title: 'Who can take part' })}
      <div class="prose">${markdown(event.eligibility)}</div>
      <div class="grid grid--3 mt-3">
        ${[
    ['Team size', `${event.allowSolo ? 'Solo entries are allowed. ' : ''}Teams of ${event.minTeamSize}–${event.maxTeamSize} people.`],
    ['Entry', event.participationFee ? `Participation fee: ${event.participationFee}` : 'Free to enter.'],
    ['Approval', event.requireApproval ? 'Registrations are reviewed by the organisers before they are confirmed.' : 'Registrations are confirmed immediately.'],
  ].map(([t, d]) => `<div class="panel"><h4 class="mb-1">${esc(t)}</h4><p class="small muted mb-0">${esc(d)}</p></div>`).join('')}
      </div>`);
  }

  // Tracks and challenges
  if (tracks.length) {
    push('tracks', 'Tracks', `
      ${c.sectionHead({ eyebrow: 'Tracks', title: 'What you can build towards', body: 'Pick the track closest to what you are making. Judges review within the track, and each track has its own ranking.' })}
      <div class="grid grid--2">
        ${tracks.map((t, i) => `<article class="challenge" style="--tc:var(--track-${esc(t.colour)}, var(--ink))">
          <span class="challenge__n">${String(i + 1).padStart(2, '0')}${t.sponsor ? ` · ${esc(t.sponsor)}` : ''}</span>
          <h3>${esc(t.name)}</h3>
          ${t.description ? `<p>${esc(t.description)}</p>` : ''}
          ${t.brief ? `<div class="prose small">${markdown(t.brief)}</div>` : ''}
          <div class="card__foot" style="padding-top:.5rem">
            <span>${t.projectCount} project${t.projectCount === 1 ? '' : 's'} entered</span>
          </div>
        </article>`).join('')}
      </div>`);
  }

  if (challenges.length) {
    push('challenges', 'Challenges', `
      ${c.sectionHead({ eyebrow: 'Challenges', title: 'Challenge statements', body: 'Specific problems sponsors have put up for this event.' })}
      <div class="grid grid--2">
        ${challenges.map((ch, i) => `<article class="challenge" style="--tc:var(--track-${esc(ch.colour)}, var(--ink))">
          <span class="challenge__n">${String(i + 1).padStart(2, '0')}${ch.sponsor ? ` · ${esc(ch.sponsor)}` : ''}</span>
          <h3>${esc(ch.name)}</h3>
          ${ch.description ? `<p>${esc(ch.description)}</p>` : ''}
          ${ch.prizeLabel ? `<div class="prize__value">${esc(ch.prizeLabel)}</div>` : ''}
        </article>`).join('')}
      </div>`);
  }

  // Schedule
  if (schedule.length) {
    push('schedule', 'Schedule', `
      ${c.sectionHead({ eyebrow: 'Schedule', title: 'How the event runs', body: `All times are ${event.timezone}.` })}
      <div class="timeline">
        ${schedule.map((s) => `<li>
          <span class="timeline__when">${esc(lc.fmtDay(s.startsAt, event.timezone))}</span>
          <span class="timeline__what">${esc(s.title)}${s.location ? ` <span class="badge">${esc(s.location)}</span>` : ''}</span>
          <span class="timeline__note">${esc(lc.fmtTime(s.startsAt, event.timezone))}${s.endsAt ? `–${esc(lc.fmtTime(s.endsAt, event.timezone))}` : ''}${s.description ? ` · ${esc(s.description)}` : ''}</span>
        </li>`).join('')}
      </div>`);
  }

  // Submission requirements
  const fields = sections.fields;
  const checklist = event.submissionChecklist;
  if (fields.length || checklist.length) {
    push('submit', 'Submission', `
      ${c.sectionHead({ eyebrow: 'Submitting', title: 'What your project needs', body: `Submissions close ${esc(lc.fmt(event.submissionsCloseAt, event.timezone))} ${esc(event.timezone)}.` })}
      <div class="grid grid--split">
        ${checklist.length ? `<div class="panel">
          <h4 class="mb-2">Checklist</h4>
          <ul class="checklist">${checklist.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
        </div>` : ''}
        ${fields.length ? `<div class="panel">
          <h4 class="mb-2">Questions you will answer</h4>
          <ul class="list">
            ${fields.map((f) => `<li><div class="list-row" style="pointer-events:none">
              <div class="list-row__main">
                <div class="list-row__title">${esc(f.label)}${f.required ? ' <span style="color:var(--accent)">*</span>' : ''}</div>
                ${f.help ? `<div class="list-row__sub">${esc(f.help)}</div>` : ''}
              </div>
              <div class="list-row__side"><span class="badge">${esc(f.kind)}</span></div>
            </div></li>`).join('')}
          </ul>
        </div>` : ''}
      </div>`);
  }

  // Judging
  if (sections.criteria.length) {
    push('judging', 'Judging', `
      ${c.sectionHead({ eyebrow: 'Judging', title: 'How projects are evaluated', body: `${sections.judges.filter((j) => j.state === 'verified').length || 'The panel'} judges score every project against this rubric.` })}
      <div class="grid grid--split">
        <div class="panel">
          <h4 class="mb-2">Rubric</h4>
          <div class="def-list">
            ${sections.criteria.map((cr) => `<div>
              <dt>${esc(cr.name)} · weight ${cr.weight} · max ${cr.max_score}</dt>
              <dd>${esc(cr.description || '—')}</dd>
            </div>`).join('')}
          </div>
        </div>
        <div class="stack">
          ${judges.filter((j) => j.state === 'verified').length ? `<div class="panel">
            <h4 class="mb-2">Judging panel</h4>
            ${judges.filter((j) => j.state === 'verified').map((j) => c.personRow(j, { role: j.organisation })).join('')}
          </div>` : ''}
          <div class="note note--info">
            <span class="note__icon" aria-hidden="true">i</span>
            <span>Judges see each project’s demo, repository, write-up and your submission answers on one page, and can compare projects side by side. Individual scores and notes stay private to the judge who wrote them and the organising team.</span>
          </div>
        </div>
      </div>`);
  }

  // Prizes
  if (prizes.length) {
    push('prizes', 'Prizes', `
      ${c.sectionHead({ eyebrow: 'Prizes', title: 'What is up for grabs' })}
      <div class="grid grid--3">
        ${prizes.map((p) => `<div class="prize${/first|grand|winner|^1$/i.test(p.placeLabel) ? ' prize--top' : ''}">
          ${p.placeLabel ? `<div class="prize__place">${esc(p.placeLabel)}</div>` : ''}
          <div class="prize__name">${esc(p.name)}</div>
          ${p.value ? `<div class="prize__value">${esc(p.value)}</div>` : ''}
          ${p.description ? `<div class="prize__desc">${esc(p.description)}</div>` : ''}
          ${p.trackName ? `<div class="card__foot" style="padding-top:.4rem">${c.trackChip(p.trackName)}</div>` : ''}
        </div>`).join('')}
      </div>`);
  }

  // Announcements
  if (announcements.length) {
    push('updates', 'Updates', `
      ${c.sectionHead({ eyebrow: 'Updates', title: 'Announcements' })}
      <div>
        ${announcements.map((a) => `<article class="announce">
          <div class="announce__meta">
            <time datetime="${esc(a.createdAt)}">${esc(lc.fmtDate(a.createdAt, event.timezone))}</time>
            <span aria-hidden="true">·</span>
            <span>${esc(a.author)}</span>
            ${a.pinned ? '<span class="badge badge--accent">Pinned</span>' : ''}
          </div>
          <div class="announce__title">${esc(a.title)}</div>
          <div class="prose small">${markdown(a.body)}</div>
        </article>`).join('')}
      </div>`);
  }

  // People
  if (people.length) {
    push('people', 'Participants', `
      ${c.sectionHead({ eyebrow: 'Taking part', title: 'Who is coming', body: `${people.length} registered${event.maxParticipants ? ` of ${event.maxParticipants} places` : ''}.` })}
      <div class="grid grid--4">
        ${people.slice(0, 24).map((p) => `<div class="person">${c.avatar(p, 'lg')}<div class="person__body">
          <div class="person__name">${esc(p.name)}</div>
          ${p.organisation || p.headline ? `<div class="person__role">${esc([p.organisation, p.headline].filter(Boolean).join(' · '))}</div>` : ''}
        </div></div>`).join('')}
      </div>
      ${people.length > 24 ? `<p class="small muted mt-2">and ${people.length - 24} more</p>` : ''}`);
  }

  // Organisers
  if (staff.length) {
    push('team', 'Organisers', `
      ${c.sectionHead({ eyebrow: 'Organising team', title: 'Who is running this' })}
      <div class="grid grid--3">
        ${staff.map((s) => c.personRow(s, { role: s.role === 'organiser' ? 'Organiser' : 'Coordinator' })).join('')}
      </div>`);
  }

  // Rules
  if (event.rules || event.codeOfConduct) {
    push('rules', 'Rules', `
      ${c.sectionHead({ eyebrow: 'Rules', title: 'The rules of this hackathon' })}
      <div class="prose">${event.rules ? markdown(event.rules) : '<p class="muted">The organisers have not published rules for this event.</p>'}</div>
      ${event.codeOfConduct ? `<div class="panel panel--sunk mt-3">
        <h4 class="mb-2">Code of conduct</h4>
        <div class="prose">${markdown(event.codeOfConduct)}</div>
      </div>` : ''}`);
  }

  // FAQ
  if (faqs.length) {
    push('faq', 'FAQ', `
      ${c.sectionHead({ eyebrow: 'Questions', title: 'Frequently asked' })}
      <div class="grid grid--2" style="align-items:start">
        ${faqs.map((f) => `<details class="faq">
          <summary>${esc(f.question)}</summary>
          <div class="faq__a prose">${markdown(f.answer)}</div>
        </details>`).join('')}
      </div>`);
  }

  return out.join('\n');
}

function projectsTab({ event, sections, viewer, pageHref }) {
  const projects = sections.projects;
  if (!projects.length) {
    return `<div class="wrap bay">${c.empty(
      event.showProjects ? 'No public projects yet' : 'Projects are not public for this event',
      event.showProjects
        ? 'Teams have not published their projects to the showcase yet. Check back once the event has progressed.'
        : 'The organisers have kept submissions private for this event.',
    )}</div>`;
  }
  const { page, pages, total, pageSize } = sections.projectPage;
  const noun = (n) => `${n} project${n === 1 ? '' : 's'}`;
  return `<div class="wrap bay">
    ${c.sectionHead({ eyebrow: 'Projects', title: 'What teams built', body: `${noun(total)} opted into the public showcase.` })}
    <div class="grid grid--3">${projects.map((p) => projectCard(p, { showEvent: false })).join('')}</div>
    <p class="small muted mt-3">Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${noun(total)}.</p>
    ${c.pagination(page, pages, pageHref || ((p) => `/h/${event.slug}/projects${p > 1 ? `?page=${p}` : ''}`))}
  </div>`;
}

function resultsTab({ event, results }) {
  if (!results.length) {
    return `<div class="wrap bay">${c.empty(
      'Results are not published yet',
      event.resultsAt
        ? `Results are scheduled for ${lc.fmt(event.resultsAt, event.timezone)} ${event.timezone}. They appear here only once the organising team publishes them.`
        : 'The organising team has not published results for this event yet.',
    )}</div>`;
  }
  const top = results[0];
  return `<div class="wrap bay">
    ${c.sectionHead({ eyebrow: 'Results', title: 'How it went', body: `Published ${lc.fmtDate(results[0].publishedAt || event.resultsAt, event.timezone)}.` })}
    <div class="panel panel--accent mb-3">
      <div class="grid grid--split cluster--top" style="align-items:center">
        <div>
          <div class="eyebrow eyebrow--plain">${esc(top.award || 'Overall winner')}</div>
          <h2 style="margin-bottom:.3rem">${esc(top.name)}</h2>
          <p class="mb-0">${esc(top.tagline)}</p>
          <p class="small muted mb-0">by ${esc(top.teamName)}${top.trackName ? ` · ${esc(top.trackName)}` : ''}</p>
        </div>
        <div><a class="btn btn--accent" href="/projects/${esc(event.slug)}/${esc(top.slug)}">See the project</a></div>
      </div>
    </div>
    <div>
      ${results.map((r) => `<a class="standing-row${r.rank <= 3 ? ` standing-row--${r.rank}` : ''}" href="/projects/${esc(event.slug)}/${esc(r.slug)}">
        <span class="standing-row__rank">${r.rank}</span>
        <span>
          <span class="standing-row__name">${esc(r.name)}</span>
          <span class="standing-row__meta"> — ${esc(r.teamName)}${r.trackName ? ` · ${esc(r.trackName)}` : ''}${r.award ? ` · ${esc(r.award)}` : ''}</span>
        </span>
        <span class="standing-row__score">${Math.round(r.normalisedScore)}</span>
      </a>`).join('')}
    </div>
    <p class="small muted mt-3">Scores shown are normalised against each judge’s own distribution of reviews. <a href="/about#judging">How that works</a>.</p>
  </div>`;
}

/* ------------------------------------------------------ single project page */

function projectPage({ project, event, results, comments, viewer, backHref, backLabel, canVote, voted }) {
  const body = `
<div class="wrap" style="padding-top:clamp(1.6rem,1.2rem+2vw,2.8rem)">
  <a class="arrow-link mb-3" href="${esc(backHref)}" style="border:0">← ${esc(backLabel)}</a>

  <div class="project-hero">
    <div>
      <div class="cluster mb-2">
        ${project.track ? c.trackChip(project.track.name, project.track.colour) : ''}
        ${project.isPublic ? '<span class="badge">Public showcase</span>' : ''}
        ${project.award ? `<span class="badge badge--accent">${esc(project.award)}</span>` : ''}
        ${results && results.rank ? `<span class="badge">Rank ${results.rank}${results.trackRank && results.trackRank !== results.rank ? ` in track` : ''}</span>` : ''}
      </div>
      <h1>${esc(project.name)}</h1>
      <p class="project-hero__tagline">${esc(project.tagline)}</p>

      <div class="cluster mt-3">
        ${c.avatarStack(project.team ? project.team.members : [], 5)}
        <div class="small">
          <div style="font-weight:550">${esc(project.team ? project.team.name : 'Unknown team')}</div>
          ${project.team && project.team.members.length ? `<div class="muted">${project.team.members.map((m) => esc(m.name)).join(', ')}</div>` : ''}
        </div>
      </div>

      ${project.description ? `<div class="prose mt-4">${markdown(project.description)}</div>` : ''}

      ${project.answers.length ? `<div class="panel mt-4">
        <h4 class="mb-2">Submission details</h4>
        <div class="def-list">
          ${project.answers.map((a) => `<div><dt>${esc(a.label)}</dt><dd>${esc(a.value)}</dd></div>`).join('')}
        </div>
      </div>` : ''}
    </div>

    <div class="stack">
      <div class="panel">
        <div class="stack stack--sm">
          <div>
            <div class="eyebrow eyebrow--plain">Built with</div>
            ${c.techTags(project.techStack)}
          </div>
          <hr>
          <div class="link-cards">
            ${c.externalLink(project.demoUrl, 'Live demo') || ''}
            ${c.externalLink(project.repoUrl, 'Source code') || ''}
            ${project.videoUrl ? `<a class="link-card" href="${esc(safeUrl(project.videoUrl))}" target="_blank" rel="noopener noreferrer nofollow">
              <span class="link-card__i">▶</span>
              <span class="flex-1"><span class="link-card__t">Demo video</span><span class="link-card__s">opens in a new tab</span></span>
            </a>` : ''}
          </div>
          ${!project.demoUrl && !project.repoUrl && !project.videoUrl ? '<p class="small muted mb-0">This project has not linked any live material.</p>' : ''}
        </div>
      </div>

      <div class="panel panel--sunk">
        <div class="kv">
          <div><dt>Event</dt><dd><a href="/h/${esc(event.slug)}">${esc(event.name)}</a></dd></div>
          ${project.submittedAt ? `<div><dt>Submitted</dt><dd>${esc(lc.fmt(project.submittedAt, event.timezone))}</dd></div>` : ''}
          ${project.votes !== undefined ? `<div><dt>Public votes</dt><dd>${project.votes}</dd></div>` : ''}
        </div>
        ${canVote ? `<form method="post" action="/projects/${esc(event.slug)}/${esc(project.slug)}/vote" class="mt-2">
          <button class="btn btn--sm ${voted ? 'btn--ghost' : 'btn--accent'}" type="submit">${voted ? 'Remove your vote' : 'Vote for this project'}</button>
        </form>` : ''}
      </div>
    </div>
  </div>

  ${project.screenshots.length ? `<section class="section">
    <div class="eyebrow">Screens</div>
    <div class="screenshot-strip mt-2">
      ${project.screenshots.map((s) => `<figure class="screenshot">
        ${s.url ? `<img src="${esc(safeUrl(s.url))}" alt="${esc(s.caption || `${project.name} screenshot`)}" loading="lazy" referrerpolicy="no-referrer">` : c.artBox(`${project.id}-${s.caption || 'shot'}`, { tall: true })}
        ${s.caption ? `<figcaption>${esc(s.caption)}</figcaption>` : ''}
      </figure>`).join('')}
    </div>
  </section>` : ''}

  ${results ? `<section class="section">
    <div class="eyebrow">Result</div>
    <h2 class="mt-1">${esc(results.award || `Placed ${ordinal(results.rank)} overall`)}</h2>
    <div class="stat-row mt-2">
      <div class="stat"><span class="stat__n">${results.rank}</span><span class="stat__l">overall rank</span></div>
      ${results.trackRank && results.trackRank !== results.rank ? `<div class="stat"><span class="stat__n">${results.trackRank}</span><span class="stat__l">rank in ${esc(project.track ? project.track.name : 'track')}</span></div>` : ''}
      <div class="stat"><span class="stat__n">${Math.round(results.normalisedScore)}</span><span class="stat__l">normalised score</span></div>
      <div class="stat"><span class="stat__n">${results.reviewsSubmitted}</span><span class="stat__l">judges scored it</span></div>
    </div>
  </section>` : ''}

  ${event.allowComments ? `<section class="section">
    <div class="grid grid--split">
      <div>
        <div class="eyebrow">Discussion</div>
        <h2 class="mt-1">What people said</h2>
        ${comments.length ? comments.map((cm) => `<article class="announce">
          <div class="announce__meta">${c.avatar(cm.author, 'sm')} ${esc(cm.authorName)} · ${esc(lc.fmtDate(cm.createdAt, event.timezone))}</div>
          <p class="mt-1">${esc(cm.body)}</p>
        </article>`).join('') : '<p class="muted">No comments yet.</p>'}
      </div>
      <div>
        ${viewer.user ? `<form method="post" action="/projects/${esc(event.slug)}/${esc(project.slug)}/comment" class="panel">
          <label class="field"><span class="field__label">Add a comment</span>
            <textarea name="body" rows="4" maxlength="1200" required placeholder="Be useful. Be kind."></textarea>
          </label>
          <button class="btn btn--accent btn--sm" type="submit">Post comment</button>
        </form>` : '<p class="small muted">Sign in to join the discussion.</p>'}
      </div>
    </div>
  </section>` : ''}
</div>`;

  return c.siteLayout({
    title: project.name,
    description: plain(project.tagline || project.description, 155),
    canonical: `/p/${event.slug}/${project.slug}`,
    current: '/projects',
    user: viewer.user,
    body,
  });
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

module.exports = { eventPage, projectPage, overview, ordinal };
