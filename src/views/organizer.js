'use strict';

const { esc, markdown, qs, json } = require('../lib/html');
const lc = require('../lib/lifecycle');
const c = require('./components');
const { ordinal } = require('./event');

const TABS = [
  ['overview', 'Overview'],
  ['event', 'Event details'],
  ['tracks', 'Tracks & challenges'],
  ['schedule', 'Schedule'],
  ['requirements', 'Requirements'],
  ['registration', 'Registration'],
  ['teams', 'Teams'],
  ['projects', 'Projects'],
  ['rubric', 'Rubric'],
  ['judges', 'Judges'],
  ['assignments', 'Assignments'],
  ['announcements', 'Announcements'],
  ['results', 'Results'],
  ['activity', 'Activity'],
];

function nav(slug, counts = {}, current = 'overview') {
  return TABS.map(([key, label]) => [key === 'overview' ? `/o/${slug}` : `/o/${slug}/${key}`,
    label, counts[key] !== undefined ? { count: counts[key] } : {}])
    .map(([href, label, opts]) => ({ href, label, current: current === key, ...opts }))
    .map((n) => [n.href, n.label, { count: n.count, current: n.current }]);
}

function console(current, event, body, { title, subtitle, actions = '', extraActions = '', counts = {}, user }) {
  const slug = event ? event.slug : '';
  const items = TABS.map(([key, label]) => {
    const href = key === 'overview' ? `/o/${slug}` : `/o/${slug}/${key}`;
    return `<a href="${href}"${current === key ? ' aria-current="page"' : ''}>${label}${counts[key] !== undefined ? `<span class="count">${counts[key]}</span>` : ''}</a>`;
  });
  return c.appLayout({
    title,
    user,
    event,
    nav: event ? [[`/h/${event.slug}`, 'Public page']] : [],
    current: `/o/${slug}`,
    body: `<div class="wrap">
    <div class="console">
      <div class="console__mobile">${items.join('')}</div>
      <nav class="console__nav" aria-label="Organiser console">${items.join('')}</nav>
      <div>
        <div class="console__head">
          <div class="cluster cluster--between cluster--start">
            <div><h1>${esc(title)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
            ${(actions || extraActions) ? `<div class="btn-row btn-row--tight">${extraActions}${actions}</div>` : ''}
          </div>
        </div>
        ${body}
      </div>
    </div>
  </div>`,
  });
}

/* --------------------------------------------------------------- overview */

function overviewPage({ event, snapshot, phase, nextDeadline, resultsReady, gateErrors, recentProjects, user = null, extraActions = '' }) {
  const body = `
  <div class="stack stack--lg">
    ${gateErrors.length ? `<div class="stack stack--sm">${gateErrors.map((e) => c.note('stop', esc(e))).join('')}</div>` : ''}

    <div class="grid grid--4">
      ${[
    ['Registrations', snapshot.registrations, snapshot.participants + ' records'],
    ['Teams', snapshot.teams, `${snapshot.projects} project${snapshot.projects === 1 ? '' : 's'}`],
    ['Judges verified', snapshot.judges, `${snapshot.assigned} assignments`],
    ['Reviews in', snapshot.reviewsDone, `of ${snapshot.assigned} assigned`],
  ].map(([l, n, s]) => `<div class="panel">
        <div class="eyebrow eyebrow--plain">${esc(l)}</div>
        <div class="stat__n">${n}</div>
        <div class="small muted">${esc(s)}</div>
      </div>`).join('')}
    </div>

    ${nextDeadline ? c.note(nextDeadline.urgent ? 'warn' : 'info',
    `<strong>Next: ${esc(nextDeadline.label)}</strong> — ${esc(lc.fmt(nextDeadline.at, event.timezone))} ${esc(event.timezone)} (${esc(lc.relative(nextDeadline.at))}).`) : ''}

    <div class="grid grid--split">
      <section class="panel">
        <div class="panel__head"><h3 style="margin:0">Event state</h3>${c.statusBadge(phase)}</div>
        <div class="timeline">
          ${lc.milestones(event).map((m) => `<li style="grid-template-columns:8rem 1fr">
            <span class="timeline__when">${esc(lc.fmtDay(m.at, event.timezone))}</span>
            <span class="timeline__what">${esc(m.label)}${m.done ? ' <span class="badge badge--good">done</span>' : ''}</span>
          </li>`).join('')}
        </div>
        <div class="btn-row mt-3" style="margin-top:1.2rem">
          <a class="btn btn--sm" href="/o/${esc(event.slug)}/event">Edit event</a>
          <a class="btn btn--sm btn--ghost" href="/h/${esc(event.slug)}">View public page ↗</a>
        </div>
      </section>

      <section class="panel">
        <div class="panel__head"><h3 style="margin:0">Setup checklist</h3></div>
        <ul class="checklist">
          ${snapshot.announcements ? `<li class="done">Posted ${snapshot.announcements} announcement${snapshot.announcements === 1 ? '' : 's'}</li>` : ''}
          <li class="${snapshot.judges ? 'done' : ''}">Invited and verified at least one judge</li>
          <li class="${snapshot.projects ? 'done' : ''}">Received at least one submission</li>
          <li class="${snapshot.reviewsDone ? 'done' : ''}">Judging has started</li>
          <li class="${resultsReady ? 'done' : ''}">Results computed and published</li>
        </ul>
        ${!resultsReady && snapshot.projects ? `<div class="btn-row mt-3" style="margin-top:1.2rem">
          <a class="btn btn--sm btn--accent" href="/o/${esc(event.slug)}/results">Compute standings</a>
        </div>` : ''}
      </section>
    </div>

    ${recentProjects.length ? `<section class="panel panel--flush">
      <div class="panel__head" style="padding:1.1rem 1.2rem 0.9rem;margin:0"><h3 style="margin:0">Latest submissions</h3><a class="arrow-link" href="/o/${esc(event.slug)}/projects">All projects</a></div>
      <div class="list" style="padding:0 1.2rem 0.6rem">
        ${recentProjects.map((p) => `<a class="list-row" href="/o/${esc(event.slug)}/projects">
          <div style="width:44px;flex:none">${c.artBox(p.id)}</div>
          <div class="list-row__main">
            <div class="list-row__title">${esc(p.name)}</div>
            <div class="list-row__sub">${esc(p.teamName)} · ${p.trackName ? esc(p.trackName) : 'no track'}</div>
          </div>
          <div class="list-row__side">
            <span class="badge ${p.status === 'submitted' ? 'badge--good' : 'badge--warn'}">${p.status}</span>
          </div>
        </a>`).join('')}
      </div>
    </section>` : ''}
  </div>`;

  return console('overview', event, body, {
    user, event,
    extraActions,
    // Archiving is reversible, so the control is always present. Hiding it on
    // an archived event would make a mistake permanent.
    actions: `<form method="post" action="/o/${esc(event.slug)}/archive">
        <button class="btn btn--sm btn--quiet" type="submit" onclick="return confirm('${event.status === 'archived' ? 'Put this hackathon back in the directory?' : 'Archive this hackathon? It disappears from the directory. Nothing is deleted.'}')">${event.status === 'archived' ? 'Restore to directory' : 'Archive'}</button>
      </form>
      ${event.status === 'archived' ? '<a class="btn btn--sm btn--ghost" href="/o">All hackathons</a>' : ''}`,
    title: event.name,
    subtitle: 'Organiser console',
    counts: { projects: snapshot.projects, judges: snapshot.judges, teams: snapshot.teams },
  });
}

/* ------------------------------------------------------------ event setup */

function eventFormPage({ event = null, errors = {}, values = {}, isNew = false, user = null, extraActions = '' }) {
  const v = (k, fallback = '') => esc(values[k] !== undefined && values[k] !== null ? values[k] : (event ? event[fallback] : ''));
  const checked = (k) => (values[k] !== undefined ? Boolean(values[k]) : Boolean(event && event[k]));

  // Every field error is listed together, so a message produced by validation
  // can never be dropped by the template.
  const errorList = Object.entries(errors);

  const body = `<form method="post" action="${isNew ? '/host/new' : `/o/${esc(event.slug)}/event`}" novalidate>
  <div class="stack stack--lg">
    ${errorList.length ? `<div class="note note--stop">
      <span class="note__icon" aria-hidden="true">×</span>
      <span><strong>This form was not saved.</strong>
        <ul style="margin:.4rem 0 0;padding-left:1.1rem">
          ${errorList.map(([, message]) => `<li>${esc(message)}</li>`).join('')}
        </ul>
      </span>
    </div>` : ''}

    <fieldset class="panel">
      <legend>Identity</legend>
      <p class="fieldset__hint">This is what participants see first.</p>
      <div class="form-grid">
        <label class="field field--full">
          <span class="field__label">Name<span class="field__req">*</span></span>
          <input type="text" name="name" value="${v('name')}" required maxlength="100" aria-invalid="${errors.name ? 'true' : 'false'}">
          ${errors.name ? `<p class="field__err">${esc(errors.name)}</p>` : ''}
        </label>
        <label class="field field--full">
          <span class="field__label">Tagline<span class="field__req">*</span></span>
          <input type="text" name="tagline" value="${v('tagline')}" required maxlength="180" placeholder="One sentence that makes someone want to join" aria-invalid="${errors.tagline ? 'true' : 'false'}">
          ${errors.tagline ? `<p class="field__err">${esc(errors.tagline)}</p>` : ''}
        </label>
        <label class="field field--full">
          <span class="field__label">About</span>
          <textarea name="about" rows="10" maxlength="8000" placeholder="What is this event, who is it for, what will people build?&#10;&#10;## headings, **bold**, - bullets and [links](https://…) all work.">${v('about')}</textarea>
          <p class="field__help">Markdown. Appears on the public event page.</p>
        </label>
        <label class="field">
          <span class="field__label">Organising body</span>
          <input type="text" name="organiserName" value="${v('organiserName')}" maxlength="90" placeholder="NexusLabs, or your university’s society">
        </label>
        <label class="field">
          <span class="field__label">Timezone<span class="field__req">*</span></span>
          <input type="text" name="timezone" value="${v('timezone', 'UTC') || 'UTC'}" required maxlength="60" placeholder="Europe/London">
          <p class="field__help">IANA name. Every deadline on the page is shown in it.</p>
        </label>
        <label class="field">
          <span class="field__label">Format</span>
          <select name="format">
            ${['online', 'in_person', 'hybrid'].map((f) => `<option value="${f}"${(values.format || (event && event.format)) === f ? ' selected' : ''}>${({ online: 'Online', in_person: 'In person', hybrid: 'Hybrid' })[f]}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span class="field__label">Visibility</span>
          <select name="visibility">
            ${['public', 'unlisted', 'private'].map((f) => `<option value="${f}"${(values.visibility || (event && event.visibility)) === f ? ' selected' : ''}>${({ public: 'Public — listed in the directory', unlisted: 'Unlisted — reachable by link', private: 'Private — organisers only' })[f]}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span class="field__label">Venue</span>
          <input type="text" name="venue" value="${v('venue')}" maxlength="120" placeholder="Building and room, if in person">
        </label>
        <label class="field">
          <span class="field__label">City</span>
          <input type="text" name="city" value="${v('city')}" maxlength="80">
        </label>
        <label class="field">
          <span class="field__label">Country</span>
          <input type="text" name="country" value="${v('country')}" maxlength="80">
        </label>
        <label class="field field--full">
          <span class="field__label">Topics</span>
          <input type="text" name="topics" value="${Array.isArray(values.topics) ? values.topics.join(', ') : (values.topics || json(event && event.topics, []).join(', ') || '')}" maxlength="200" placeholder="AI, climate, developer tools, accessibility">
          <p class="field__help">Comma separated. Used by the discovery filters.</p>
        </label>
      </div>
    </fieldset>

    <fieldset class="panel">
      <legend>Dates</legend>
      <p class="fieldset__hint">These are enforced on the server. A submission that arrives after the close time is refused regardless of what the browser thinks.</p>
      <div class="form-grid">
        <label class="field"><span class="field__label">Registration opens</span>
          <input type="datetime-local" name="registrationOpensAt" value="${dt(values, event, 'registration_opens_at')}"></label>
        <label class="field"><span class="field__label">Registration closes</span>
          <input type="datetime-local" name="registrationClosesAt" value="${dt(values, event, 'registration_closes_at')}"></label>
        <label class="field"><span class="field__label">Start time<span class="field__req">*</span></span>
          <input type="datetime-local" name="startsAt" value="${dt(values, event, 'starts_at')}" required>
          ${errors.startsAt ? `<p class="field__err">${esc(errors.startsAt)}</p>` : ''}</label>
        <label class="field"><span class="field__label">End time<span class="field__req">*</span></span>
          <input type="datetime-local" name="endsAt" value="${dt(values, event, 'ends_at')}" required>
          ${errors.endsAt ? `<p class="field__err">${esc(errors.endsAt)}</p>` : ''}</label>
        <label class="field"><span class="field__label">Submissions open</span>
          <input type="datetime-local" name="submissionsOpenAt" value="${dt(values, event, 'submissions_open_at')}">
          <p class="field__help">Defaults to the start time.</p></label>
        <label class="field"><span class="field__label">Submissions close<span class="field__req">*</span></span>
          <input type="datetime-local" name="submissionsCloseAt" value="${dt(values, event, 'submissions_close_at')}" required>
          ${errors.submissionsCloseAt ? `<p class="field__err">${esc(errors.submissionsCloseAt)}</p>` : ''}</label>
        <label class="field"><span class="field__label">Judging opens</span>
          <input type="datetime-local" name="judgingOpensAt" value="${dt(values, event, 'judging_opens_at')}"></label>
        <label class="field"><span class="field__label">Judging closes</span>
          <input type="datetime-local" name="judgingClosesAt" value="${dt(values, event, 'judging_closes_at')}"></label>
        <label class="field"><span class="field__label">Results published</span>
          <input type="datetime-local" name="resultsAt" value="${dt(values, event, 'results_at')}"></label>
        <label class="field"><span class="field__label">Timezone offset shown to judges</span>
          <input type="text" name="judgingOpensHint" value="" maxlength="120" placeholder="Optional note, e.g. &quot;Deadline is 18:00 BST&quot;" disabled>
          <p class="field__help">Judging window is controlled by the dates above.</p></label>
      </div>
    </fieldset>

    <fieldset class="panel">
      <legend>Participation</legend>
      <div class="form-grid">
        <label class="field field--full">
          <span class="field__label">Who is eligible</span>
          <textarea name="eligibility" rows="4" maxlength="2000" placeholder="Students only. First-time builders welcome. Must be 18 or over.">${v('eligibility')}</textarea>
        </label>
        <label class="field"><span class="field__label">Minimum team size</span>
          <input type="number" name="minTeamSize" min="1" max="20" value="${values.minTeamSize !== undefined ? esc(values.minTeamSize) : (event ? event.min_team_size : 1)}"></label>
        <label class="field"><span class="field__label">Maximum team size</span>
          <input type="number" name="maxTeamSize" min="1" max="20" value="${values.maxTeamSize !== undefined ? esc(values.maxTeamSize) : (event ? event.max_team_size : 4)}">
          ${errors.maxTeamSize ? `<p class="field__err">${esc(errors.maxTeamSize)}</p>` : ''}</label>
        <label class="field"><span class="field__label">Capacity (0 = unlimited)</span>
          <input type="number" name="maxParticipants" min="0" max="100000" value="${values.maxParticipants !== undefined ? esc(values.maxParticipants) : (event ? event.max_participants : 0)}"></label>
        <label class="field"><span class="field__label">Entry fee</span>
          <input type="text" name="participationFee" value="${v('participationFee')}" maxlength="60" placeholder="Free" placeholder="Free"></label>
      </div>
      <div class="checkbox-grid mt-2">
        <label class="check"><input type="checkbox" name="allowSolo" value="1"${checked('allowSolo') ? ' checked' : ''}> Allow solo entries</label>
        <label class="check"><input type="checkbox" name="allowTeamInvites" value="1"${checked('allowTeamInvites') ? ' checked' : ''}> Allow invite codes</label>
        <label class="check"><input type="checkbox" name="requireApproval" value="1"${checked('requireApproval') ? ' checked' : ''}> Review each registration</label>
        <label class="check"><input type="checkbox" name="showProjects" value="1"${checked('showProjects') ? ' checked' : ''}> Public project showcase</label>
        <label class="check"><input type="checkbox" name="allowPublicVoting" value="1"${checked('allowPublicVoting') ? ' checked' : ''}> Allow public voting</label>
        <label class="check"><input type="checkbox" name="allowComments" value="1"${checked('allowComments') ? ' checked' : ''}> Allow comments on projects</label>
      </div>
    </fieldset>

    <fieldset class="panel">
      <legend>Submission requirements</legend>
      <p class="fieldset__hint">Checklist items appear on the event page and in the participant’s own progress list.</p>
      <div class="checkbox-grid">
        <label class="check"><input type="checkbox" name="requireRepo" value="1"${checked('requireRepo') ? ' checked' : ''}> Repository link</label>
        <label class="check"><input type="checkbox" name="requireDemo" value="1"${checked('requireDemo') ? ' checked' : ''}> Live demo link</label>
        <label class="check"><input type="checkbox" name="requireVideo" value="1"${checked('requireVideo') ? ' checked' : ''}> Demo video</label>
        <label class="check"><input type="checkbox" name="requireScreenshots" value="1"${checked('requireScreenshots') ? ' checked' : ''}> Screenshots</label>
      </div>
      <label class="field mt-2">
        <span class="field__label">Checklist</span>
        <textarea name="submissionChecklist" rows="4" maxlength="1200" placeholder="One item per line, e.g.&#10;A working build, not just a concept&#10;A two-minute demo video&#10;At least one team member present at the closing ceremony">${values.submissionChecklist !== undefined ? esc(values.submissionChecklist) : json(event && event.submissionChecklist, []).join('\n')}</textarea>
      </label>
    </fieldset>

    <fieldset class="panel">
      <legend>Rules</legend>
      <div class="stack">
        <label class="field"><span class="field__label">Rules</span>
          <textarea name="rules" rows="8" maxlength="8000">${v('rules')}</textarea></label>
        <label class="field"><span class="field__label">Code of conduct</span>
          <textarea name="codeOfConduct" rows="5" maxlength="4000">${v('codeOfConduct')}</textarea></label>
      </div>
    </fieldset>

    <div class="form-actions form-actions--end">
      <a class="btn btn--quiet" href="${isNew ? '/dashboard' : `/o/${esc(event.slug)}`}">Cancel</a>
      <button class="btn btn--accent" type="submit">${isNew ? 'Create hackathon' : 'Save changes'}</button>
    </div>
  </div>
</form>`;

  return console(isNew ? 'overview' : 'event', isNew ? { slug: '' } : event, body, {
    title: isNew ? 'New hackathon' : 'Event details',
    subtitle: isNew ? 'Set up the essentials now. Everything can be changed later.' : 'Identity, dates, participation rules and requirements.',
    user,
    event: isNew ? null : event,
    extraActions: isNew ? '' : extraActions,
  });
}

function dt(values, event, column) {
  const raw = values[columnToKey(column)] !== undefined ? values[columnToKey(column)] : (event ? event[column] : '');
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function columnToKey(col) {
  return col.replace(/_(\w)/g, (_, ch) => ch.toUpperCase());
}

/* ------------------------------------------------------- tracks & schedule */

function tracksPage({ event, tracks, challenges, errors = {}, user = null, extraActions = '' }) {
  const body = `<div class="stack stack--lg">
  <section class="panel">
    <div class="panel__head"><h3 style="margin:0">Tracks</h3><span class="badge">${tracks.length}</span></div>
    ${tracks.length ? `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Track</th><th>Sponsor</th><th class="tbl__num">Projects</th><th></th></tr></thead>
      <tbody>${tracks.map((t) => `<tr>
        <td><b>${esc(t.name)}</b><div class="small muted">${esc(t.description || '')}</div></td>
        <td class="muted">${esc(t.sponsor || '—')}</td>
        <td class="tbl__num">${t.project_count}</td>
        <td class="tbl__num"><form method="post" action="/o/${esc(event.slug)}/tracks/${esc(t.id)}/delete" onsubmit="return confirm('Delete this track? Projects on it keep their data but lose the track.')"><button class="btn btn--quiet btn--sm" type="submit">Delete</button></form></td>
      </tr>`).join('')}</tbody>
    </table></div>` : '<p class="muted small">No tracks yet. Teams can submit without one, but tracks give judges a clearer pool to work in.</p>'}
  </section>

  <section class="panel">
    <h3 style="font-size:var(--step-1)">Add a track</h3>
    <form method="post" action="/o/${esc(event.slug)}/tracks" class="mt-2">
      <div class="form-grid">
        <label class="field"><span class="field__label">Name<span class="field__req">*</span></span>
          <input type="text" name="name" required maxlength="70" placeholder="Developer tools"></label>
        <label class="field"><span class="field__label">Sponsor</span>
          <input type="text" name="sponsor" maxlength="70"></label>
        <label class="field field--full"><span class="field__label">Short description</span>
          <input type="text" name="description" maxlength="200"></label>
        <label class="field field--full"><span class="field__label">Full brief</span>
          <textarea name="brief" rows="4" maxlength="3000" placeholder="The problem statement participants build against."></textarea></label>
        <label class="field"><span class="field__label">Colour</span>
          <select name="colour">${['ink', 'red', 'amber', 'green', 'teal', 'blue', 'indigo', 'plum', 'rose'].map((col) => `<option value="${col}">${col}</option>`).join('')}</select></label>
      </div>
      <button class="btn btn--sm" type="submit">Add track</button>
    </form>
  </section>

  <section class="panel">
    <div class="panel__head"><h3 style="margin:0">Challenges</h3><span class="badge">${challenges.length}</span></div>
    ${challenges.length ? `<div class="grid grid--2">
      ${challenges.map((ch) => `<div class="card">
        <h4 style="margin:0;font-size:var(--step-0)">${esc(ch.name)}</h4>
        <p class="card__body">${esc(ch.description || '')}</p>
        <div class="card__foot"><span>${esc(ch.sponsor || 'No sponsor')}</span>
          <form method="post" action="/o/${esc(event.slug)}/challenges/${esc(ch.id)}/delete"><button class="btn btn--quiet btn--sm" type="submit">Delete</button></form>
        </div>
      </div>`).join('')}
    </div>` : '<p class="muted small">No challenges published.</p>'}
    <form method="post" action="/o/${esc(event.slug)}/challenges" class="mt-3">
      <div class="form-grid">
        <label class="field"><span class="field__label">Name<span class="field__req">*</span></span>
          <input type="text" name="name" required maxlength="140"></label>
        <label class="field"><span class="field__label">Sponsor</span>
          <input type="text" name="sponsor" maxlength="70"></label>
        <label class="field field--full"><span class="field__label">Description</span>
          <textarea name="description" rows="3" maxlength="1200"></textarea></label>
        <label class="field field--full"><span class="field__label">Prize note</span>
          <input type="text" name="prizeLabel" maxlength="80" placeholder="£2,000 and a placement interview"></label>
      </div>
      <button class="btn btn--sm" type="submit">Add challenge</button>
    </form>
  </section>
</div>`;

  return console('tracks', event, body, { title: 'Tracks & challenges', user, event, extraActions });
}

function schedulePage({ event, items, user = null, extraActions = '' }) {
  const body = `<div class="stack stack--lg">
  <section class="panel">
    <div class="panel__head"><h3 style="margin:0">Schedule</h3><span class="badge">${items.length} item${items.length === 1 ? '' : 's'}</span></div>
    ${items.length ? `<div class="timeline">
      ${items.map((s) => `<li style="grid-template-columns:8rem 1fr auto">
        <span class="timeline__when">${esc(lc.fmtDay(s.starts_at, event.timezone))}</span>
        <span class="timeline__what">${esc(s.title)}<div class="small muted">${esc(lc.fmtTime(s.starts_at, event.timezone))}${s.ends_at ? `–${esc(lc.fmtTime(s.ends_at, event.timezone))}` : ''}${s.location ? ` · ${esc(s.location)}` : ''}</div></span>
        <form method="post" action="/o/${esc(event.slug)}/schedule/${esc(s.id)}/delete"><button class="btn btn--quiet btn--sm" type="submit">Delete</button></form>
      </li>`).join('')}
    </div>` : '<p class="muted small">No schedule items yet.</p>'}
  </section>

  <section class="panel">
    <h3 style="font-size:var(--step-1)">Add a schedule item</h3>
    <form method="post" action="/o/${esc(event.slug)}/schedule" class="mt-2">
      <div class="form-grid">
        <label class="field field--full"><span class="field__label">Title<span class="field__req">*</span></span>
          <input type="text" name="title" required maxlength="120" placeholder="Opening ceremony"></label>
        <label class="field"><span class="field__label">Starts<span class="field__req">*</span></span>
          <input type="datetime-local" name="startsAt" required></label>
        <label class="field"><span class="field__label">Ends</span>
          <input type="datetime-local" name="endsAt"></label>
        <label class="field"><span class="field__label">Location</span>
          <input type="text" name="location" maxlength="90" placeholder="Main stage"></label>
        <label class="field"><span class="field__label">Kind</span>
          <select name="kind">${['session', 'workshop', 'meal', 'deadline', 'ceremony', 'social'].map((k) => `<option value="${k}">${k}</option>`).join('')}</select></label>
        <label class="field field--full"><span class="field__label">Description</span>
          <input type="text" name="description" maxlength="200"></label>
      </div>
      <button class="btn btn--sm" type="submit">Add item</button>
    </form>
  </section>
</div>`;

  return console('schedule', event, body, { title: 'Schedule', user, event, extraActions });
}

function requirementsPage({ event, fields, answersSample, user = null, extraActions = '' }) {
  const body = `<div class="stack stack--lg">
  ${c.note('info', 'These questions are asked when a team submits. Mark a question as judge-visible only if the panel genuinely needs it — most events need far fewer than they think.')}
  <section class="panel">
    <div class="panel__head"><h3 style="margin:0">Submission questions</h3><span class="badge">${fields.length}</span></div>
    ${fields.length ? `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Question</th><th>Type</th><th>Required</th><th>Panel sees</th><th></th></tr></thead>
      <tbody>${fields.map((f) => `<tr>
        <td><b>${esc(f.label)}</b>${f.help ? `<div class="small muted">${esc(f.help)}</div>` : ''}</td>
        <td class="muted">${esc(f.kind)}</td>
        <td>${f.required ? '<span class="badge badge--accent">required</span>' : '<span class="muted">optional</span>'}</td>
        <td>${f.judges_see ? '<span class="badge badge--good">yes</span>' : '<span class="badge">no</span>'}</td>
        <td class="tbl__num"><form method="post" action="/o/${esc(event.slug)}/requirements/${esc(f.id)}/delete"><button class="btn btn--quiet btn--sm" type="submit">Delete</button></form></td>
      </tr>`).join('')}</tbody>
    </table></div>` : '<p class="muted small">No extra questions. Teams submit name, description, links and stack.</p>'}
  </section>

  <section class="panel">
    <h3 style="font-size:var(--step-1)">Add a question</h3>
    <form method="post" action="/o/${esc(event.slug)}/requirements" class="mt-2">
      <div class="form-grid">
        <label class="field field--full"><span class="field__label">Question<span class="field__req">*</span></span>
          <input type="text" name="label" required maxlength="160" placeholder="What did your team build, and what actually works?"></label>
        <label class="field"><span class="field__label">Type</span>
          <select name="kind"><option value="text">Short text</option><option value="longtext">Long text</option><option value="url">URL</option></select></label>
        <label class="field"><span class="field__label">Key</span>
          <input type="text" name="key" maxlength="40" placeholder="auto from label">
          <p class="field__help">Leave blank and Hackerly will generate one.</p></label>
        <label class="field field--full"><span class="field__label">Help text</span>
          <input type="text" name="help" maxlength="200" placeholder="Shown under the field while a team is writing."></label>
      </div>
      <div class="checkbox-grid">
        <label class="check"><input type="checkbox" name="required" value="1"> Required</label>
        <label class="check"><input type="checkbox" name="judgesSee" value="1" checked> Judges can read the answer</label>
      </div>
      <button class="btn btn--sm mt-2" type="submit">Add question</button>
    </form>
  </section>
</div>`;

  return console('requirements', event, body, { title: 'Submission requirements', user, event, extraActions });
}

/* ------------------------------------------------------------ participants */

function registrationPage({ event, registrations, pending, teams, participants, user = null, extraActions = '' }) {
  const body = `<div class="stack stack--lg">
  <div class="grid grid--4">
    <div class="stat"><span class="stat__n">${registrations.length}</span><span class="stat__l">registrations</span></div>
    <div class="stat"><span class="stat__n">${pending.length}</span><span class="stat__l">awaiting review</span></div>
    <div class="stat"><span class="stat__n">${teams.length}</span><span class="stat__l">teams</span></div>
    <div class="stat"><span class="stat__n">${event.maxParticipants ? `${registrations.length}/${event.maxParticipants}` : '∞'}</span><span class="stat__l">capacity</span></div>
  </div>

  ${pending.length ? `<section class="panel panel--accent">
    <div class="panel__head"><h3 style="margin:0">Awaiting your decision</h3><span class="badge badge--warn">${pending.length}</span></div>
    <div class="list">
      ${pending.map((r) => `<div class="list-row">
        ${c.avatar(r, 'sm')}
        <div class="list-row__main">
          <div class="list-row__title">${esc(r.name)}</div>
          <div class="list-row__sub">${esc(lc.fmt(r.registeredAt, event.timezone))}${r.note ? ` · ${esc(r.note)}` : ''}</div>
        </div>
        <div class="list-row__side">
          <form method="post" action="/o/${esc(event.slug)}/registrations/${esc(r.userId)}/state" class="btn-row btn-row--tight">
            <input type="hidden" name="state" value="confirmed"><button class="btn btn--sm" type="submit">Confirm</button>
          </form>
          <form method="post" action="/o/${esc(event.slug)}/registrations/${esc(r.userId)}/state" class="btn-row btn-row--tight">
            <input type="hidden" name="state" value="declined"><button class="btn btn--sm btn--quiet" type="submit">Decline</button>
          </form>
        </div>
      </div>`).join('')}
    </div>
  </section>` : ''}

  <section class="panel panel--flush">
    <div class="panel__head" style="padding:1.1rem 1.2rem .9rem;margin:0"><h3 style="margin:0">Everyone registered</h3></div>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Name</th><th>Team</th><th>Project</th><th>State</th><th></th></tr></thead>
      <tbody>
        ${participants.map((p) => `<tr>
          <td>${esc(p.name)}${p.organisation ? `<div class="small muted">${esc(p.organisation)}</div>` : ''}</td>
          <td>${p.teamName ? esc(p.teamName) : '<span class="muted">—</span>'}</td>
          <td>${p.projectName ? esc(p.projectName) : '<span class="muted">—</span>'}</td>
          <td><span class="badge ${p.state === 'confirmed' ? 'badge--good' : p.state === 'pending' ? 'badge--warn' : 'badge--stop'}">${esc(p.state)}</span></td>
          <td class="tbl__num">
            ${p.state === 'confirmed' ? `<form method="post" action="/o/${esc(event.slug)}/registrations/${esc(p.userId)}/state"><input type="hidden" name="state" value="withdrawn"><button class="btn btn--quiet btn--sm" type="submit">Withdraw</button></form>` : ''}
          </td>
        </tr>`).join('')}
      </tbody>
    </table></div>
  </section>
</div>`;

  return console('registration', event, body, { title: 'Registration', counts: { registration: pending.length }, user, event, extraActions });
}

function teamsPage({ event, teams, assignments, user = null, extraActions = '' }) {
  const body = `<div class="stack stack--lg">
  <section class="panel panel--flush">
    <div class="panel__head" style="padding:1.1rem 1.2rem .9rem;margin:0"><h3 style="margin:0">Teams</h3><span class="badge">${teams.length}</span></div>
    ${teams.length ? `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Team</th><th>Members</th><th>Project</th><th>Invite code</th></tr></thead>
      <tbody>${teams.map((t) => `<tr>
        <td><b>${esc(t.name)}</b>${t.tagline ? `<div class="small muted">${esc(t.tagline)}</div>` : ''}</td>
        <td class="tbl__num">${t.memberCount}</td>
        <td>${t.projects.length ? esc(t.projects[0].name) : '<span class="muted">none yet</span>'}</td>
        <td class="mono small">${esc(t.inviteCode)}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : c.empty('No teams yet', 'Participants create or join teams from their own page once registered.')}
  </section>
</div>`;

  return console('teams', event, body, { title: 'Teams', counts: { teams: teams.length }, user, event, extraActions });
}

function projectsPage({ event, projects, scores, bulkAction, user = null, extraActions = '' }) {
  const body = `<form method="post" action="/o/${esc(event.slug)}/projects/bulk">
  <div class="panel panel--flush">
    <div class="panel__head" style="padding:1.1rem 1.2rem .9rem;margin:0">
      <h3 style="margin:0">Submissions</h3><span class="badge">${projects.length}</span>
    </div>
    ${projects.length ? `<div class="tbl-wrap"><table class="tbl">
      <thead><tr>
        <th style="width:2rem"></th><th>Project</th><th>Team</th><th>Track</th>
        <th class="tbl__num">Reviews</th><th class="tbl__num">Score</th><th>State</th><th></th>
      </tr></thead>
      <tbody>${projects.map((p) => `<tr>
        <td><input type="checkbox" name="projectIds" value="${esc(p.id)}" aria-label="Select ${esc(p.name)}"></td>
        <td><b>${esc(p.name)}</b><div class="small muted">${esc(p.tagline || '')}</div></td>
        <td class="small">${esc(p.teamName)}</td>
        <td class="small">${p.trackName ? esc(p.trackName) : '<span class="muted">—</span>'}</td>
        <td class="tbl__num">${p.reviewCount}</td>
        <td class="tbl__num">${scores[p.id] ? Math.round(scores[p.id].final) : '<span class="muted">—</span>'}</td>
        <td><span class="badge ${p.status === 'submitted' ? 'badge--good' : p.status === 'disqualified' ? 'badge--stop' : 'badge--warn'}">${esc(p.status)}</span></td>
        <td class="tbl__num">
          <div class="btn-row btn-row--tight">
            ${p.status === 'submitted' ? `<a class="btn btn--sm btn--quiet" href="/o/${esc(event.slug)}/projects/${esc(p.id)}">Inspect</a>` : ''}
            ${p.status === 'submitted' ? `<button class="btn btn--sm btn--quiet" type="submit" name="action" value="withdraw:${esc(p.id)}">Withdraw</button>` : ''}
            ${p.status === 'withdrawn' ? `<button class="btn btn--sm btn--quiet" type="submit" name="action" value="restore:${esc(p.id)}">Restore</button>` : ''}
          </div>
        </td>
      </tr>`).join('')}</tbody>
    </table></div>` : c.empty('No submissions yet', 'Nothing has been submitted. Participants can save drafts any time before the deadline.')}
  </div>
  ${projects.length ? `<div class="form-actions">
    <span class="small muted">Tick rows then choose an action.</span>
    <span class="flex-1"></span>
    <button class="btn btn--sm" type="submit" name="action" value="public:1">Make showcase-public</button>
    <button class="btn btn--sm" type="submit" name="action" value="public:0">Hide from showcase</button>
    <button class="btn btn--sm btn--danger" type="submit" name="action" value="disqualify">Disqualify selected</button>
  </div>` : ''}
</form>`;

  return console('projects', event, body, { title: 'Projects', counts: { projects: projects.length }, user, event, extraActions });
}

function projectInspectPage({ event, project, submission, reviews, redacted, scores, user = null, extraActions = '' }) {
  const body = `<div class="stack stack--lg">
  <a class="arrow-link" href="/o/${esc(event.slug)}/projects" style="border:0">← All projects</a>
  <div class="grid grid--split">
    <div class="stack stack--lg">
      <section class="panel">
        <div class="cluster cluster--between mb-2">
          <h2 style="font-size:var(--step-2);margin:0">${esc(project.name)}</h2>
          <span class="badge ${project.status === 'submitted' ? 'badge--good' : 'badge--warn'}">${esc(project.status)}</span>
        </div>
        <p class="lede" style="font-size:var(--step-0)">${esc(project.tagline)}</p>
        <div class="cluster mt-2">
          ${project.track ? c.trackChip(project.track.name, project.track.colour) : ''}
          <span class="badge">${esc(project.team ? project.team.name : '')}</span>
          ${project.is_public ? '<span class="badge badge--good">in showcase</span>' : '<span class="badge">not in showcase</span>'}
        </div>
        <hr>
        <div class="prose">${markdown(project.description || '_No description._')}</div>
        ${project.answers.length ? `<hr><div class="def-list">
          ${project.answers.map((a) => `<div><dt>${esc(a.label)}</dt><dd>${esc(a.value)}</dd></div>`).join('')}
        </div>` : ''}
        <hr>
        <div class="link-cards">
          ${c.externalLink(project.demoUrl, 'Live demo')}
          ${c.externalLink(project.repoUrl, 'Repository')}
          ${project.videoUrl ? c.externalLink(project.videoUrl, 'Demo video') : ''}
        </div>
      </section>
    </div>

    <div class="stack stack--lg">
      <section class="panel">
        <h3 style="font-size:var(--step-1)">Judging</h3>
        ${redacted ? c.note('info', `Judge names and individual scores are shown to organisers for audit purposes. Participants cannot see any of this.`) : ''}
        <div class="kv">
          <div><dt>Weighted score</dt><dd>${scores ? Math.round(scores.weighted) : '—'}</dd></div>
          <div><dt>Normalised</dt><dd>${scores ? Math.round(scores.normalised) : '—'}</dd></div>
          <div><dt>Standings score</dt><dd>${scores ? Math.round(scores.final) : '—'}</dd></div>
          <div><dt>Reviews</dt><dd>${reviews.filter((r) => r.state === 'submitted').length} submitted of ${reviews.length}</dd></div>
        </div>
        ${reviews.length ? `<div class="tbl-wrap mt-2"><table class="tbl">
          <thead><tr><th>Judge</th><th class="tbl__num">Score</th><th>State</th></tr></thead>
          <tbody>${reviews.map((r) => `<tr>
            <td>${esc(r.judgeName)}</td>
            <td class="tbl__num">${r.state === 'submitted' ? Math.round(r.totalScore) : '—'}</td>
            <td><span class="badge ${r.state === 'submitted' ? 'badge--good' : 'badge--warn'}">${esc(r.state)}</span></td>
          </tr>`).join('')}</tbody>
        </table></div>` : ''}
      </section>

      ${submission ? `<section class="panel panel--sunk">
        <h3 style="font-size:var(--step-1)">Submission history</h3>
        <div class="timeline">
          ${submission.map((s) => `<li style="grid-template-columns:9rem 1fr">
            <span class="timeline__when">v${s.version}</span>
            <span class="timeline__what">${esc(lc.fmt(s.submitted_at, event.timezone))}</span>
          </li>`).join('')}
        </div>
        <p class="small muted mb-0">Each submit froze a copy, so nothing a judge saw can have changed underneath them.</p>
      </section>` : ''}
    </div>
  </div>
</div>`;

  return console('projects', event, body, { title: project.name, subtitle: 'Submission inspection', user, event, extraActions });
}

/* ----------------------------------------------------------------- judging */

function rubricPage({ event, criteria, user = null, extraActions = '' }) {
  const total = criteria.reduce((a, c2) => a + c2.weight, 0);
  const body = `<div class="stack stack--lg">
  ${c.note('info', 'Weights are relative — they do not need to add up to 1. Hackerly normalises them against the total when scoring. Changing the rubric after judging has started changes how scores read, so do it before.')}
  <section class="panel">
    <div class="panel__head"><h3 style="margin:0">Criteria</h3><span class="badge">${criteria.length} · total weight ${Math.round(total * 100) / 100}</span></div>
    ${criteria.length ? `<div class="list">
      ${criteria.map((cr) => `<div class="list-row">
        <div class="list-row__main">
          <div class="list-row__title">${esc(cr.name)}</div>
          <div class="list-row__sub">${esc(cr.description || 'No description')} · max ${cr.max_score}</div>
        </div>
        <div class="list-row__side">
          <span class="badge">weight ${cr.weight}</span>
          <form method="post" action="/o/${esc(event.slug)}/rubric/${esc(cr.id)}/delete"><button class="btn btn--quiet btn--sm" type="submit">Delete</button></form>
        </div>
      </div>`).join('')}
    </div>` : '<p class="muted small">No criteria yet. Judges cannot score without at least one.</p>'}
  </section>

  <section class="panel">
    <h3 style="font-size:var(--step-1)">Add a criterion</h3>
    <form method="post" action="/o/${esc(event.slug)}/rubric" class="mt-2">
      <div class="form-grid">
        <label class="field"><span class="field__label">Name<span class="field__req">*</span></span>
          <input type="text" name="name" required maxlength="80" placeholder="Functionality"></label>
        <label class="field"><span class="field__label">Weight</span>
          <input type="number" name="weight" min="0.1" max="10" step="0.1" value="1"></label>
        <label class="field"><span class="field__label">Maximum score</span>
          <input type="number" name="maxScore" min="1" max="10" step="1" value="5"></label>
        <label class="field field--full"><span class="field__label">What judges should look for</span>
          <input type="text" name="description" maxlength="300" placeholder="Does the core path work end to end, or only in a demo script?"></label>
      </div>
      <button class="btn btn--sm" type="submit">Add criterion</button>
    </form>
  </section>
</div>`;

  return console('rubric', event, body, { title: 'Rubric', counts: { rubric: criteria.length }, user, event, extraActions });
}

function judgesPage({ event, judges, assignmentCounts, inviteLink, user = null, extraActions = '' }) {
  const body = `<div class="stack stack--lg">
  ${inviteLink ? c.note('info', `Anyone with this link can request judge access and be verified by you: <span class="mono">${esc(inviteLink)}</span>`) : ''}

  <section class="panel panel--flush">
    <div class="panel__head" style="padding:1.1rem 1.2rem .9rem;margin:0"><h3 style="margin:0">Judging panel</h3><span class="badge">${judges.length}</span></div>
    ${judges.length ? `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Judge</th><th>Tracks</th><th class="tbl__num">Assigned</th><th class="tbl__num">Submitted</th><th>State</th><th></th></tr></thead>
      <tbody>${judges.map((j) => `<tr>
        <td><b>${esc(j.name)}</b>${j.headline ? `<div class="small muted">${esc(j.headline)}</div>` : ''}
          ${j.user_id ? '' : '<div class="small"><span class="badge">no account yet</span></div>'}</td>
        <td class="small">${j.tracks.length ? j.tracks.map(esc).join(', ') : '<span class="muted">any</span>'}</td>
        <td class="tbl__num">${j.assigned}</td>
        <td class="tbl__num">${j.submitted}</td>
        <td><span class="badge ${j.state === 'verified' ? 'badge--good' : j.state === 'invited' ? 'badge--warn' : 'badge--stop'}">${esc(j.state)}</span></td>
        <td class="tbl__num"><div class="btn-row btn-row--tight">
          ${j.state === 'invited' ? `<form method="post" action="/o/${esc(event.slug)}/judges/${esc(j.id)}/verify"><button class="btn btn--sm" type="submit">Verify</button></form>` : ''}
          ${j.state !== 'removed' ? `<form method="post" action="/o/${esc(event.slug)}/judges/${esc(j.id)}/remove"><button class="btn btn--quiet btn--sm" type="submit">Remove</button></form>` : ''}
        </div></td>
      </tr>`).join('')}</tbody>
    </table></div>` : c.empty('No judges yet', 'Invite the people who will evaluate submissions. They verify themselves with the code you send them.', inviteLink ? `<a class="btn btn--accent" href="${esc(inviteLink)}">${esc(inviteLink)}</a>` : '')}
  </section>

  <section class="panel">
    <h3 style="font-size:var(--step-1)">Invite a judge</h3>
    <p class="small muted">They receive a one-time access code. Until they verify it, they cannot read a single project.</p>
    <form method="post" action="/o/${esc(event.slug)}/judges" class="mt-2">
      <div class="form-grid">
        <label class="field"><span class="field__label">Name<span class="field__req">*</span></span>
          <input type="text" name="name" required maxlength="90"></label>
        <label class="field"><span class="field__label">Email<span class="field__req">*</span></span>
          <input type="email" name="email" required maxlength="254"></label>
        <label class="field"><span class="field__label">Role or company</span>
          <input type="text" name="headline" maxlength="90" placeholder="Principal engineer, Acme"></label>
        <label class="field"><span class="field__label">Expertise (comma separated tracks)</span>
          <input type="text" name="tracks" maxlength="160" placeholder="Developer tools, Accessibility"></label>
      </div>
      <button class="btn btn--sm" type="submit">Send invitation</button>
    </form>
  </section>
</div>`;

  return console('judges', event, body, { title: 'Judges', counts: { judges: judges.length }, user, event, extraActions });
}

function assignmentsPage({ event, projects, judges, assignmentMap, tracks, user = null, extraActions = '' }) {
  const body = `<div class="stack stack--lg">
  ${c.note('info', 'Assign by track where you can — a judge who does not know the domain will still be fair, but slower. Judges can only open projects they are assigned.')}
  <section class="panel">
    <div class="panel__head">
      <h3 style="margin:0">Assignment matrix</h3>
      <div class="btn-row btn-row--tight">
        <form method="post" action="/o/${esc(event.slug)}/assignments/auto">
          <input type="hidden" name="perJudge" value="3">
          <button class="btn btn--sm" type="submit">Auto-assign by track</button>
        </form>
        <form method="post" action="/o/${esc(event.slug)}/assignments/clear">
          <button class="btn btn--sm btn--danger" type="submit" onclick="return confirm('Remove every assignment?')">Clear all</button>
        </form>
      </div>
    </div>
    ${projects.length && judges.length ? `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Project</th>${judges.map((j) => `<th class="tbl__num">${esc(j.name.split(' ')[0])}</th>`).join('')}</tr></thead>
      <tbody>${projects.map((p) => `<tr>
        <td><b>${esc(p.name)}</b><div class="small muted">${p.trackName ? esc(p.trackName) : 'no track'}</div></td>
        ${judges.map((j) => {
    const a = assignmentMap[p.id] ? assignmentMap[p.id].find((x) => x.judge_id === j.id) : null;
    return `<td class="tbl__num">
            <form method="post" action="/o/${esc(event.slug)}/assignments/toggle">
              <input type="hidden" name="projectId" value="${esc(p.id)}">
              <input type="hidden" name="judgeId" value="${esc(j.id)}">
              <input type="hidden" name="next" value="${a ? '0' : '1'}">
              <button class="btn btn--sm ${a ? '' : 'btn--quiet'}" type="submit" aria-label="${a ? 'Unassign' : 'Assign'} ${esc(j.name)}">${a ? '✓' : '·'}</button>
            </form></td>`;
  }).join('')}
      </tr>`).join('')}</tbody>
    </table></div>` : c.empty('Nothing to assign',
    projects.length ? 'Verify at least one judge first.' : 'No projects have been submitted yet.')}
  </section>
</div>`;

  return console('assignments', event, body, { title: 'Judge assignments', counts: { assignments: projects.length }, user, event, extraActions });
}

function announcementsPage({ event, announcements, user = null, extraActions = '' }) {
  const body = `<div class="stack stack--lg">
  <section class="panel">
    <div class="panel__head"><h3 style="margin:0">Published</h3><span class="badge">${announcements.length}</span></div>
    ${announcements.length ? `<div>
      ${announcements.map((a) => `<article class="announce">
        <div class="announce__meta">
          <span>${esc(lc.fmtDate(a.created_at, event.timezone))}</span>
          ${a.pinned ? '<span class="badge badge--accent">Pinned</span>' : ''}
          <form method="post" action="/o/${esc(event.slug)}/announcements/${esc(a.id)}/delete" class="btn-row btn-row--tight">
            <button class="btn btn--quiet btn--sm" type="submit">Delete</button>
          </form>
        </div>
        <div class="announce__title">${esc(a.title)}</div>
        <div class="prose small">${markdown(a.body)}</div>
      </article>`).join('')}
    </div>` : '<p class="muted small">Nothing posted yet. Participants see announcements on the event page.</p>'}
  </section>

  <section class="panel">
    <h3 style="font-size:var(--step-1)">Post an announcement</h3>
    <form method="post" action="/o/${esc(event.slug)}/announcements" class="mt-2">
      <label class="field"><span class="field__label">Title<span class="field__req">*</span></span>
        <input type="text" name="title" required maxlength="140"></label>
      <label class="field"><span class="field__label">Body<span class="field__req">*</span></span>
        <textarea name="body" rows="5" required maxlength="4000"></textarea>
        <p class="field__help">Markdown. ## heading, **bold**, - list.</p></label>
      <div class="checkbox-grid"><label class="check"><input type="checkbox" name="pinned" value="1"> Pin to the top</label></div>
      <button class="btn btn--sm mt-2" type="submit">Publish</button>
    </form>
  </section>
</div>`;

  return console('announcements', event, body, { title: 'Announcements', counts: { announcements: announcements.length }, user, event, extraActions });
}

function resultsPage({ event, computed, standings, published, spread, hasReviews, user = null, extraActions = '' }) {
  const body = `<div class="stack stack--lg">
  ${c.note('stop', '<strong>Nothing publishes automatically.</strong> Scores exist on this page because you are an organiser. Participants and the public only see standings after you press publish.')}

  <div class="form-actions" style="margin-top:0;border-top:0;padding-top:0">
    <form method="post" action="/o/${esc(event.slug)}/results/compute">
      <button class="btn btn--accent" type="submit" ${computed ? '' : 'disabled aria-disabled="true"'}>${computed ? 'Recompute standings' : 'Compute standings'}</button>
    </form>
    ${computed ? `<form method="post" action="/o/${esc(event.slug)}/results/publish">
      <button class="btn" type="submit" onclick="return confirm('${published ? 'Withdraw these results from public view?' : 'Publish these results publicly?'}')">${published ? 'Unpublish results' : 'Publish results'}</button>
    </form>` : ''}
    <a class="btn btn--ghost" href="/api/export.csv?event=${esc(event.slug)}">Download CSV</a>
    ${computed && !published ? `<a class="btn btn--quiet" href="/h/${esc(event.slug)}/results">Preview as a participant would</a>` : ''}
  </div>

  ${!hasReviews ? c.note('warn', 'No reviews have been submitted yet, so any standings would be meaningless.') : ''}

  <section class="panel panel--sunk">
    <h4 class="mb-1">How the final column is produced</h4>
    <p class="small muted mb-0">Weighted is the raw rubric total rescaled to 100. Normalised rescales that total against each judge’s own distribution of reviews, so one lenient judge does not decide the ranking alone. Final is 60% weighted and 40% normalised. ${spread.judges} verified judge${spread.judges === 1 ? '' : 's'}, ${spread.submitted} review${spread.submitted === 1 ? '' : 's'} across ${spread.count} project${spread.count === 1 ? '' : 's'}. <a href="/about#judging">Read the full method</a>.</p>
  </section>

  ${computed ? `<section class="panel panel--flush">
    <div class="panel__head" style="padding:1.1rem 1.2rem .9rem;margin:0">
      <h3 style="margin:0">Standings</h3>
      <span class="badge ${published ? 'badge--good' : 'badge--warn'}">${published ? 'published' : 'not published'}</span>
    </div>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th class="tbl__num">#</th><th>Project</th><th>Team</th><th>Track</th>
        <th class="tbl__num">Reviews</th><th class="tbl__num">Weighted</th><th class="tbl__num">Normalised</th><th class="tbl__num">Final</th><th>Award</th></tr></thead>
      <tbody>${standings.map((s) => `<tr>
        <td class="tbl__num">${s.rank}</td>
        <td><b>${esc(s.name)}</b>${s.trackRank && s.trackRank !== s.rank ? `<div class="small muted">#${s.trackRank} in track</div>` : ''}</td>
        <td class="small">${esc(s.teamName)}</td>
        <td class="small">${s.trackName ? esc(s.trackName) : '<span class="muted">—</span>'}</td>
        <td class="tbl__num">${s.submitted}</td>
        <td class="tbl__num">${Math.round(s.weighted)}</td>
        <td class="tbl__num">${Math.round(s.normalised)}</td>
        <td class="tbl__num"><b>${Math.round(s.final)}</b></td>
        <td>${s.award ? `<span class="badge badge--accent">${esc(s.award)}</span>` : ''}</td>
      </tr>`).join('')}</tbody>
    </table></div>
  </section>` : ''}
</div>`;

  return console('results', event, body, { title: 'Results', subtitle: published ? 'Published publicly' : 'Not published', user, event, extraActions });
}

function activityPage({ event, entries, user = null, extraActions = '' }) {
  const body = `<section class="panel panel--flush">
    <div class="panel__head" style="padding:1.1rem 1.2rem .9rem;margin:0"><h3 style="margin:0">Activity</h3><span class="badge">${entries.length}</span></div>
    ${entries.length ? `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Resource</th><th>Outcome</th></tr></thead>
      <tbody>${entries.map((e) => `<tr>
        <td class="small nowrap">${esc(lc.fmt(e.at, event.timezone))}</td>
        <td class="small">${esc(e.actor_name || e.actor_id || 'system')}</td>
        <td class="small mono">${esc(e.action)}</td>
        <td class="small muted">${esc(e.resource_type)}${e.resource_id ? ` <span class="mono">${esc(String(e.resource_id).slice(0, 10))}</span>` : ''}</td>
        <td>${e.outcome === 'ok' ? '<span class="badge badge--good">ok</span>' : `<span class="badge badge--stop">${esc(e.outcome)}</span>`}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : '<p class="muted small" style="padding:1.2rem">No activity recorded yet.</p>'}
  </section>`;

  return console('activity', event, body, { title: 'Activity', user, event, extraActions });
}

module.exports = {
  overviewPage,
  eventFormPage,
  tracksPage,
  schedulePage,
  requirementsPage,
  registrationPage,
  teamsPage,
  projectsPage,
  projectInspectPage,
  rubricPage,
  judgesPage,
  assignmentsPage,
  announcementsPage,
  resultsPage,
  activityPage,
};
