'use strict';

const { esc, markdown, safeUrl } = require('../lib/html');
const lc = require('../lib/lifecycle');
const c = require('./components');
const judging = require('../lib/judging');
const { ordinal } = require('./event');

/* ---------------------------------------------------------------- dashboard */

function dashboard({ user, roles, upcoming, past, judging, organising, errors = {} }) {
  const empty = !upcoming.length && !past.length && !judging.length && !organising.length;

  const body = `<div class="wrap">
  <div class="section-head">
    <div class="eyebrow">Your workspace</div>
    <h1>Hello, ${esc(user.name.split(' ')[0])}</h1>
    <p>Everything you are registered for, running, or judging.</p>
  </div>

  ${empty ? c.empty(
    'Nothing here yet',
    'You are not registered for a hackathon, hosting one, or judging one. Browse what is open and pick one.',
    '<a class="btn btn--accent" href="/hackathons">Explore hackathons</a>',
  ) : ''}

  ${organising.length ? section('Hosting', 'You run these hackathons', organising, '/o') : ''}
  ${judging.length ? section('Judging', 'You have been invited to judge these', judging, '/j') : ''}
  ${upcoming.length ? section('Taking part', 'Events you are registered for', upcoming, '/p') : ''}
  ${past.length ? section('Finished', 'Events that have wrapped up', past, '/p') : ''}
</div>`;

  return c.appLayout({ title: 'Dashboard', user, body });
}

function section(eyebrow, title, items, prefix) {
  return `<section class="section" style="padding-top:2rem">
    <div class="eyebrow">${esc(eyebrow)}</div>
    <h2 style="font-size:var(--step-2);margin-bottom:1.1rem">${esc(title)}</h2>
    <div class="grid grid--2">
      ${items.map((it) => `<a class="card" href="${esc(prefix)}/${esc(it.slug)}">
        ${c.artBox(it.slug, { className: 'mb-1' })}
        <div class="cluster cluster--between cluster--start">${c.statusBadge(it.phase)}<span class="badge">${esc(it.badge)}</span></div>
        <h3 class="card__title">${esc(it.name)}</h3>
        <p class="card__body">${esc(it.detail)}</p>
        <div class="card__foot"><span>${esc(lc.fmtRange(it.startsAt, it.endsAt, it.timezone))}</span><span>${esc(it.action)}</span></div>
      </a>`).join('')}
    </div>
  </section>`;
}

/* -------------------------------------------------- registration gate page */

/**
 * Shown to a signed-in visitor who has not registered yet. It is a working
 * page, not an apology: it explains the rules, shows what is still open, and
 * registers them in one step.
 */
function registrationPage({ event, viewer, gates, stats }) {
  const open = gates.registerOpen;
  const body = `<div class="wrap wrap--mid">
  <a class="arrow-link mb-3" href="/h/${esc(event.slug)}" style="border:0">← ${esc(event.name)}</a>
  <div class="section-head">
    <div class="eyebrow">${esc(event.name)}</div>
    <h1>Register to take part</h1>
    <p>${esc(event.tagline)}</p>
  </div>

  <div class="grid grid--split">
    <div class="stack stack--lg">
      ${open ? '' : c.note('stop', esc(gates.registerClosedReason || 'Registration is closed.'), { title: 'Registration is closed' })}

      ${open ? `<section class="panel">
        <form method="post" action="/p/${esc(event.slug)}/register">
          <label class="field">
            <span class="field__label">Anything the organisers should know?</span>
            <textarea name="note" rows="3" maxlength="600" placeholder="What you want to build, your experience, anything you need."></textarea>
            <p class="field__help">Optional. Shared with the organising team only.</p>
          </label>
          <label class="check mb-2"><input type="checkbox" name="rules" value="1" required>
            <span>I have read the rules${event.codeOfConduct ? ' and the code of conduct' : ''} and I am eligible to take part.</span></label>
          <button class="btn btn--accent btn--lg" type="submit" ${open ? '' : 'disabled aria-disabled="true"'}>
            ${event.requireApproval ? 'Request a place' : 'Register'}
          </button>
          ${event.requireApproval ? '<p class="field__help">The organisers review each registration before confirming it.</p>' : ''}
        </form>
      </section>` : `<section class="panel">
        <h3 style="font-size:var(--step-1)">You cannot register right now</h3>
        <p class="muted">${esc(gates.registerClosedReason)}</p>
        <div class="btn-row">
          <a class="btn" href="/hackathons">Find another hackathon</a>
          <a class="btn btn--ghost" href="/h/${esc(event.slug)}">Read the event page</a>
        </div>
      </section>`}

      ${event.eligibility ? `<section class="panel">
        <h3 style="font-size:var(--step-1)">Before you register</h3>
        <div class="prose small">${markdown(event.eligibility)}</div>
      </section>` : ''}
    </div>

    <aside class="stack">
      <div class="panel">
        <div class="eyebrow eyebrow--plain">What happens next</div>
        <ol class="timeline small">
          <li style="grid-template-columns:1.2rem 1fr;padding:.4rem 0;border-top:0">
            <span style="color:var(--accent)">1</span><span>Register. It takes one step.</span></li>
          <li style="grid-template-columns:1.2rem 1fr;padding:.4rem 0;border-top:0">
            <span style="color:var(--accent)">2</span><span>Form a team of ${event.minTeamSize}–${event.maxTeamSize}${event.allowSolo ? ', or go solo' : ''}.</span></li>
          <li style="grid-template-columns:1.2rem 1fr;padding:.4rem 0;border-top:0">
            <span style="color:var(--accent)">3</span><span>Build, and submit by ${esc(lc.fmtDate(event.submissionsCloseAt, event.timezone))}.</span></li>
          <li style="grid-template-columns:1.2rem 1fr;padding:.4rem 0;border-top:0">
            <span style="color:var(--accent)">4</span><span>Judging, then results.</span></li>
        </ol>
      </div>
      <div class="panel panel--sunk">
        <div class="stat-row">
          <div class="stat"><span class="stat__n">${stats.registrations}</span><span class="stat__l">already registered</span></div>
          ${event.maxParticipants ? `<div class="stat"><span class="stat__n">${event.maxParticipants}</span><span class="stat__l">places</span></div>` : ''}
          <div class="stat"><span class="stat__n">${event.maxTeamSize}</span><span class="stat__l">max team size</span></div>
        </div>
        ${c.countdownBlock(event)}
      </div>
    </aside>
  </div>
</div>`;

  return c.appLayout({ title: `Register · ${event.name}`, user: viewer.user, event, body });
}

/* -------------------------------------------------- participant: overview */

function participantPage({
  event, viewer, registration, team, project, checklist, gates, results, announcementCount,
}) {
  const phase = lc.phase(event);
  const nav = participantNav(event, viewer, registration, project, 'overview');

  const body = `<div class="wrap">
  <div class="grid grid--sidebar">
    <aside class="stack">
      <div>
        <div class="eyebrow eyebrow--plain">${esc(event.name)}</div>
        <h1 style="font-size:var(--step-2)">Your entry</h1>
      </div>
      <div class="stack stack--sm">
        ${stepper([
    { label: 'Register', done: Boolean(registration), current: !registration },
    { label: 'Team', done: Boolean(team), current: Boolean(registration) && !team },
    { label: 'Project', done: project && project.status === 'submitted', current: Boolean(team) && !(project && project.status === 'submitted') },
    { label: 'Judged', done: Boolean(results), current: Boolean(project && project.status === 'submitted') && !results },
  ])}
      </div>
      ${c.countdownBlock(event)}
      ${team ? `<div class="panel panel--sunk">
        <div class="eyebrow eyebrow--plain">Your team</div>
        <b>${esc(team.name)}</b>
        <div class="small muted">${team.members.length} of ${event.maxTeamSize} members</div>
        <a class="arrow-link mt-1" href="/p/${esc(event.slug)}/team">Manage team</a>
      </div>` : ''}
    </aside>

    <div>
      ${nav}
      <div class="stack stack--lg">
        ${gates.error ? c.note('stop', esc(gates.error), { title: gates.title }) : ''}
        ${gates.warning ? c.note('warn', esc(gates.warning)) : ''}
        ${announcementCount ? c.note('info', `<a href="/h/${esc(event.slug)}#updates">${announcementCount} new announcement${announcementCount === 1 ? '' : 's'}</a> since you registered.`) : ''}

        ${!registration ? registrationPrompt(event, gates) : ''}

        ${registration ? `
        <section class="panel">
          <div class="panel__head"><h3 style="margin:0">Registration</h3>
            <span class="badge ${registration.state === 'confirmed' ? 'badge--good' : registration.state === 'pending' ? 'badge--warn' : 'badge--stop'}">${esc(registration.stateLabel)}</span>
          </div>
          <div class="kv">
            <div><dt>Registered</dt><dd>${esc(lc.fmt(registration.registeredAt, event.timezone))}</dd></div>
            ${registration.answers && Object.keys(registration.answers).length ? Object.entries(registration.answers)
    .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('') : ''}
          </div>
        </section>

        ${team ? teamPanel(event, team) : ''}
        ${project ? projectPanel(event, project, checklist) : ''}
        ` : ''}

        ${results ? resultsPanel(event, results) : ''}
      </div>
    </div>
  </div>
</div>`;

  return c.appLayout({
    title: `Your entry · ${event.name}`,
    user: viewer.user,
    event,
    nav: participantNav(event, viewer, registration, project, 'overview').match(/href="[^"]+"/g) || [],
    current: `/p/${event.slug}`,
    body,
  });
}

function stepper(steps) {
  return `<ol class="timeline" style="font-size:.82rem">${steps.map((s) => `<li style="grid-template-columns:1.1rem 1fr;padding:.4rem 0;border-top:0">
    <span style="color:${s.done ? 'var(--good)' : s.current ? 'var(--accent)' : 'var(--ink-4)'};font-weight:700">${s.done ? '✓' : s.current ? '◦' : '·'}</span>
    <span style="font-weight:${s.current ? 600 : 400};color:${s.done || s.current ? 'var(--ink)' : 'var(--ink-4)'}">${esc(s.label)}</span>
  </li>`).join('')}</ol>`;
}

function registrationPrompt(event, gates) {
  if (gates.registerOpen) {
    return `<section class="panel">
      ${c.sectionHead({ eyebrow: 'Step one', title: 'Register for this hackathon', body: 'Registration is open now. Tell the organisers a little about yourself — most events ask for nothing more than this.' })}
      <form method="post" action="/p/${esc(event.slug)}/register" class="mt-2">
        <label class="field">
          <span class="field__label">Anything the organisers should know?</span>
          <textarea name="note" rows="3" maxlength="600" placeholder="Experience, what you want to build, accessibility needs…"></textarea>
          <p class="field__help">Optional. Shared with the organising team only.</p>
        </label>
        <label class="check mb-2"><input type="checkbox" name="rules" value="1" required>
          <span>I have read the rules${event.codeOfConduct ? ' and the code of conduct' : ''} and I am eligible to take part.</span></label>
        <button class="btn btn--accent" type="submit">Register</button>
      </form>
    </section>`;
  }
  return `<section class="panel">
    <div class="eyebrow">Registration closed</div>
    <h3 style="font-size:var(--step-1)">You cannot register right now</h3>
    <p class="muted">${esc(gates.registerClosedReason)}</p>
    <a class="arrow-link" href="/hackathons">Find another hackathon</a>
  </section>`;
}

function teamPanel(event, team) {
  const slots = Array.from({ length: Math.max(0, event.maxTeamSize - team.members.length) });
  return `<section class="panel">
    <div class="panel__head"><h3 style="margin:0">Team</h3><span class="badge">${team.members.length} / ${event.maxTeamSize}</span></div>
    <div class="list">
      ${team.members.map((m) => `<div class="list-row">
        ${c.avatar(m, 'sm')}
        <div class="list-row__main">
          <div class="list-row__title">${esc(m.name)}${m.isYou ? ' <span class="badge">you</span>' : ''}</div>
          <div class="list-row__sub">${esc(m.role === 'lead' ? 'Team lead' : 'Member')}${m.headline ? ` · ${esc(m.headline)}` : ''}</div>
        </div>
        ${m.role === 'lead' ? '<span class="badge badge--accent">Lead</span>' : (team.isLead ? `<form method="post" action="/p/${esc(event.slug)}/team/remove" class="inline"><input type="hidden" name="userId" value="${esc(m.userId)}"><button class="btn btn--quiet btn--sm" type="submit">Remove</button></form>` : '')}
      </div>`).join('')}
      ${slots.map(() => `<div class="list-row" style="opacity:.6">
        <span class="avatar avatar--sm" style="background:var(--paper-3);color:var(--ink-4)">+</span>
        <div class="list-row__main"><div class="list-row__sub">Open place</div></div>
      </div>`).join('')}
    </div>
    <div class="form-actions">
      <a class="btn btn--sm" href="/p/${esc(event.slug)}/team">Manage team and invite</a>
      <a class="btn btn--sm btn--quiet" href="/p/${esc(event.slug)}/join">Join with an invite code</a>
    </div>
  </section>`;
}

function projectPanel(event, project, checklist) {
  const missing = checklist.filter((i) => !i.done);
  return `<section class="panel">
    <div class="panel__head">
      <h3 style="margin:0">Project</h3>
      <span class="badge ${project.status === 'submitted' ? 'badge--good' : 'badge--warn'}">${project.status === 'submitted' ? 'Submitted' : 'Draft'}</span>
    </div>
    <div class="cluster cluster--start" style="gap:1rem">
      <div style="width:120px;flex:none">${c.artBox(project.id, { tall: true })}</div>
      <div class="flex-1">
        <h4 style="margin-bottom:.2rem">${esc(project.name || 'Untitled project')}</h4>
        <p class="small muted" style="margin:0">${esc(project.tagline || 'No tagline yet.')}</p>
        <div class="cluster mt-2">
          ${project.trackName ? c.trackChip(project.trackName, project.trackColour) : ''}
          ${project.submittedAt ? `<span class="badge">Submitted ${esc(lc.fmt(project.submittedAt, event.timezone))}</span>` : ''}
        </div>
      </div>
    </div>

    <hr>
    <div class="grid grid--2">
      <div>
        <h4 class="mb-1" style="font-size:.86rem">Before you submit</h4>
        <ul class="checklist">
          ${checklist.map((i) => `<li class="${i.done ? 'done' : ''}">${esc(i.label)}${i.required ? ' <span style="color:var(--accent)">*</span>' : ''}${i.hint ? ` <span class="muted" style="font-size:.78rem">— ${esc(i.hint)}</span>` : ''}</li>`).join('')}
        </ul>
      </div>
      <div class="stack stack--sm">
        ${missing.length
    ? c.note('warn', `<strong>${missing.length} thing${missing.length === 1 ? '' : 's'} left.</strong> You can keep editing until ${esc(lc.fmt(event.submissionsCloseAt, event.timezone))}.`)
    : c.note('good', '<strong>Everything is filled in.</strong> You can submit now, or keep refining until the deadline.')}
        <a class="btn btn--accent" href="/p/${esc(event.slug)}/project">${project.status === 'submitted' ? 'Edit submission' : 'Continue building'}</a>
        ${project.status === 'submitted' ? '<p class="small muted mb-0">You can resubmit an updated version until the deadline. Each submit freezes a copy for the judges.</p>' : ''}
      </div>
    </div>
  </section>`;
}

function resultsPanel(event, results) {
  return `<section class="panel panel--accent">
    <div class="eyebrow eyebrow--plain">Results</div>
    <h3 style="font-size:var(--step-2);margin-bottom:.3rem">${esc(results.award || `You placed ${ordinal(results.rank)}`)}</h3>
    <div class="stat-row">
      <div class="stat"><span class="stat__n">${results.rank}</span><span class="stat__l">overall</span></div>
      ${results.trackRank && results.trackRank !== results.rank ? `<div class="stat"><span class="stat__n">${results.trackRank}</span><span class="stat__l">in ${esc(results.trackName || 'track')}</span></div>` : ''}
      <div class="stat"><span class="stat__n">${Math.round(results.normalisedScore)}</span><span class="stat__l">normalised score</span></div>
      <div class="stat"><span class="stat__n">${results.reviewsSubmitted}</span><span class="stat__l">judges</span></div>
    </div>
    <a class="arrow-link mt-2" href="/h/${esc(event.slug)}/results">Full results</a>
  </section>`;
}

/* --------------------------------------------------------- team management */

function teamPage({ event, viewer, team, invitations, gate, errors = {}, notice }) {
  const body = `<div class="wrap wrap--mid">
  <a class="arrow-link mb-3" href="/p/${esc(event.slug)}" style="border:0">← ${esc(event.name)}</a>
  <div class="section-head">
    <div class="eyebrow">Step two</div>
    <h1>Your team</h1>
    <p>Teams of ${event.minTeamSize}–${event.maxTeamSize}${event.allowSolo ? ', or go solo' : ''}. Everyone on a team shares one project and one submission.</p>
  </div>

  ${notice ? c.note('accent', esc(notice)) : ''}
  ${Object.keys(errors).length ? c.note('stop', esc(Object.values(errors)[0])) : ''}
  ${gate.error ? c.note('stop', esc(gate.error)) : ''}

  ${team ? `
  <div class="grid grid--split">
    <section class="panel">
      <div class="panel__head"><h3 style="margin:0">${esc(team.name)}</h3><span class="badge">${team.members.length} / ${event.maxTeamSize}</span></div>
      <div class="list">
        ${team.members.map((m) => `<div class="list-row">
          ${c.avatar(m, 'sm')}
          <div class="list-row__main">
            <div class="list-row__title">${esc(m.name)}${m.isYou ? ' <span class="badge">you</span>' : ''}</div>
            <div class="list-row__sub">${esc(m.role === 'lead' ? 'Team lead' : 'Member')}</div>
          </div>
          <div class="list-row__side">
            ${m.role === 'lead' ? '<span class="badge badge--accent">Lead</span>' : ''}
            ${team.isLead && !m.isYou ? `<form method="post" action="/p/${esc(event.slug)}/team/remove"><input type="hidden" name="userId" value="${esc(m.userId)}"><button class="btn btn--quiet btn--sm" type="submit">Remove</button></form>` : ''}
          </div>
        </div>`).join('')}
      </div>
    </section>

    <div class="stack">
      <section class="panel">
        <h4 class="mb-1">Invite someone</h4>
        <p class="small muted">They will need to be registered for this hackathon. Share the code below or send an email invite.</p>
        <div class="code-box mono">${esc(team.inviteCode)}</div>
        ${event.allowTeamInvites ? `<form method="post" action="/p/${esc(event.slug)}/team/invite" class="mt-2">
          <label class="field">
            <span class="field__label">Invite by email</span>
            <input type="email" name="email" placeholder="teammate@example.com" required>
            <p class="field__help">They see a join link the next time they sign in.</p>
          </label>
          <button class="btn btn--sm" type="submit">Send invite</button>
        </form>` : '<p class="small muted">This event does not allow direct invites.</p>'}
        ${invitations.length ? `<div class="mt-2">
          <h4 class="mb-1" style="font-size:.82rem">Pending invitations</h4>
          <div class="tags">${invitations.map((i) => `<span class="badge">${esc(i.email)}</span>`).join('')}</div>
        </div>` : ''}
      </section>

      ${team.isLead && event.allowSolo ? `<section class="panel">
        <h4 class="mb-1">Dissolve this team</h4>
        <p class="small muted">Only do this if you are going solo. Your project, if you have one, stays with your account.</p>
        <form method="post" action="/p/${esc(event.slug)}/team/dissolve" onsubmit="return confirm('Dissolve this team? Everyone will need to rejoin.')">
          <button class="btn btn--danger btn--sm" type="submit">Dissolve team</button>
        </form>
      </section>` : ''}
    </div>
  </div>` : `
  <div class="grid grid--2">
    <section class="panel">
      <h3 style="font-size:var(--step-1)">Create a team</h3>
      <p class="small muted">Pick a name your teammates will recognise. You get an invite code to share.</p>
      <form method="post" action="/p/${esc(event.slug)}/team/create">
        <label class="field">
          <span class="field__label">Team name<span class="field__req">*</span></span>
          <input type="text" name="name" required maxlength="60" placeholder="Nightshift">
        </label>
        <label class="field">
          <span class="field__label">One-line description</span>
          <input type="text" name="tagline" maxlength="120" placeholder="What are you likely to build?">
        </label>
        <button class="btn btn--accent" type="submit">Create team</button>
      </form>
    </section>

    <section class="panel">
      <h3 style="font-size:var(--step-1)">Join a team</h3>
      <p class="small muted">Ask the team lead for their invite code.</p>
      <form method="post" action="/p/${esc(event.slug)}/join">
        <label class="field">
          <span class="field__label">Invite code<span class="field__req">*</span></span>
          <input type="text" name="code" required maxlength="40" class="mono" style="text-transform:uppercase" placeholder="ABC-123">
        </label>
        <button class="btn" type="submit">Join team</button>
      </form>
    </section>
  </div>

  ${event.allowSolo ? `<div class="mt-3">${c.note('info', 'You can also <a href="/p/' + esc(event.slug) + '/project">start a project on your own</a> without creating a team.')}</div>` : ''}`}
</div>`;

  return c.appLayout({ title: 'Team', user: viewer.user, event, body });
}

/* --------------------------------------------------------- project editor */

function projectEditor({ event, viewer, project, team, fields, errors = {}, notice, gate, checklist }) {
  const value = (k) => (project && project.answers ? project.answers[k] : '') || '';
  const submitted = project && project.status === 'submitted';

  const body = `<div class="wrap wrap--mid">
  <a class="arrow-link mb-3" href="/p/${esc(event.slug)}" style="border:0">← ${esc(event.name)}</a>
  <div class="section-head">
    <div class="eyebrow">Step three</div>
    <h1>${submitted ? 'Your submission' : 'Build your project'}</h1>
    <p>Everything here is a draft until you press submit. Save as often as you like — the server keeps the deadline, not you.</p>
  </div>

  ${notice ? c.note('accent', esc(notice)) : ''}
  ${gate.error ? c.note('stop', esc(gate.error)) : ''}
  ${submitted ? c.note('good', `<strong>Submitted.</strong> A frozen copy went to the judges${project.submittedAt ? ` on ${esc(lc.fmt(project.submittedAt, event.timezone))}` : ''}. You can still edit and resubmit until the deadline.`) : ''}

  <form method="post" action="/p/${esc(event.slug)}/project" class="stack stack--lg" novalidate>
    <section class="panel">
      <h3 class="mb-2" style="font-size:var(--step-1)">The project</h3>
      <div class="form-grid">
        <label class="field">
          <span class="field__label">Name<span class="field__req">*</span></span>
          <input type="text" name="name" value="${esc(project ? project.name : '')}" required maxlength="80" aria-invalid="${errors.name ? 'true' : 'false'}">
          ${errors.name ? `<p class="field__err">${esc(errors.name)}</p>` : ''}
        </label>
        <label class="field">
          <span class="field__label">Track</span>
          <select name="trackId">
            <option value="">No track</option>
            ${fields.tracks.map((t) => `<option value="${esc(t.id)}"${project && project.track_id === t.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field field--full">
          <span class="field__label">One-line summary<span class="field__req">*</span></span>
          <input type="text" name="tagline" value="${esc(project ? project.tagline : '')}" required maxlength="140" placeholder="What it does, in one sentence" aria-invalid="${errors.tagline ? 'true' : 'false'}">
          ${errors.tagline ? `<p class="field__err">${esc(errors.tagline)}</p>` : '<p class="field__help">This appears on the project card and in the showcase.</p>'}
        </label>
        <label class="field field--full">
          <span class="field__label">Full description<span class="field__req">*</span></span>
          <textarea name="description" rows="9" required maxlength="6000" placeholder="What problem does it solve? How does it work? What did you build in the time you had?&#10;&#10;You can use ## headings, **bold** and - lists.">${esc(project ? project.description : '')}</textarea>
          ${errors.description ? `<p class="field__err">${esc(errors.description)}</p>` : '<p class="field__help">Judges read this. Be specific about what actually works.</p>'}
        </label>
      </div>
    </section>

    <section class="panel">
      <h3 class="mb-2" style="font-size:var(--step-1)">Material</h3>
      <p class="small muted">This is what judges open. Everything here appears in their workspace without leaving the page.</p>
      <div class="form-grid">
        <label class="field">
          <span class="field__label">Repository URL${event.requireRepo ? '<span class="field__req">*</span>' : ''}</span>
          <input type="url" name="repoUrl" value="${esc(project ? project.repoUrl : '')}" placeholder="https://github.com/you/project" maxlength="300">
        </label>
        <label class="field">
          <span class="field__label">Live demo URL${event.requireDemo ? '<span class="field__req">*</span>' : ''}</span>
          <input type="url" name="demoUrl" value="${esc(project ? project.demoUrl : '')}" placeholder="https://your-project.app" maxlength="300">
        </label>
        <label class="field">
          <span class="field__label">Demo video URL${event.requireVideo ? '<span class="field__req">*</span>' : ''}</span>
          <input type="url" name="videoUrl" value="${esc(project ? project.videoUrl : '')}" placeholder="https://www.youtube.com/watch?v=…" maxlength="300">
          <p class="field__help">A YouTube or Vimeo link plays inside the judging workspace.</p>
        </label>
        <label class="field">
          <span class="field__label">Built with</span>
          <input type="text" name="techStack" value="${esc(project ? project.techStack.join(', ') : '')}" placeholder="Python, FastAPI, Postgres, Redis" maxlength="240">
          <p class="field__help">Comma separated. Shown as tags.</p>
        </label>
      </div>
    </section>

    ${fields.questions.length ? `<section class="panel">
      <h3 class="mb-2" style="font-size:var(--step-1)">Submission questions</h3>
      <p class="small muted">These are the questions the organisers set for this event. Judges read the answers marked as visible to the panel.</p>
      <div class="stack">
        ${fields.questions.map((f) => `<label class="field">
          <span class="field__label">${esc(f.label)}${f.required ? '<span class="field__req">*</span>' : ''}
            ${f.judgesSee ? '<span class="badge" style="margin-left:.4rem">judges see this</span>' : '<span class="badge" style="margin-left:.4rem">organisers only</span>'}
          </span>
          ${f.kind === 'longtext'
    ? `<textarea name="answer_${esc(f.key)}" rows="4" maxlength="2000">${esc(value(f.key))}</textarea>`
    : f.kind === 'select'
      ? `<select name="answer_${esc(f.key)}"><option value="">Choose…</option>${f.options.map((o) => `<option value="${esc(o)}"${value(f.key) === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`
      : `<input type="${f.kind === 'url' ? 'url' : 'text'}" name="answer_${esc(f.key)}" value="${esc(value(f.key))}" maxlength="400">`}
          ${f.help ? `<p class="field__help">${esc(f.help)}</p>` : ''}
        </label>`).join('')}
      </div>
    </section>` : ''}

    <section class="panel panel--sunk">
      <div class="grid grid--2 cluster--start">
        <div>
          <h4 class="mb-1">Checklist</h4>
          <ul class="checklist">
            ${checklist.map((i) => `<li class="${i.done ? 'done' : ''}">${esc(i.label)}</li>`).join('')}
          </ul>
        </div>
        <div>
          <h4 class="mb-1">Save or submit</h4>
          <p class="small muted">Saving keeps a draft. Submitting freezes a copy for the judges and marks the project complete.</p>
          <div class="btn-row">
            <button class="btn" type="submit" name="action" value="save">Save draft</button>
            <button class="btn btn--accent" type="submit" name="action" value="submit"
              ${gate.canSubmit ? '' : 'disabled aria-disabled="true"'}>Submit project</button>
          </div>
          ${gate.canSubmit ? '' : `<p class="field__err mt-1">${esc(gate.submitBlockedReason || 'Submissions are closed.')}</p>`}
        </div>
      </div>
    </section>
  </form>
</div>`;

  return c.appLayout({ title: 'Your project', user: viewer.user, event, body });
}

function participantNav(event, viewer, registration, project, current) {
  const items = [
    ['/p/' + event.slug, 'Overview'],
  ];
  if (registration) {
    items.push(['/p/' + event.slug + '/team', 'Team']);
    items.push(['/p/' + event.slug + '/project', project ? 'Project' : 'Build']);
  }
  if (lc.phase(event) === 'results') items.push(['/h/' + event.slug + '/results', 'Results']);
  return `<div class="console__mobile">${items.map(([h, l]) => `<a href="${esc(h)}"${current === h ? ' aria-current="page"' : ''}>${esc(l)}</a>`).join('')}</div>`;
}

module.exports = {
  dashboard,
  registrationPage,
  participantPage,
  teamPage,
  projectEditor,
  participantNav,
};
