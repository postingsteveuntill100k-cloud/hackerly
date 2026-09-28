'use strict';

const { esc, markdown, safeUrl, hostOf, qs } = require('../lib/html');
const lc = require('../lib/lifecycle');
const c = require('./components');

/* ------------------------------------------------------------- queue home */

function judgeHome({ event, viewer, judge, summary, conflicts, pairwise, gate, spread }) {
  const next = summary.items.find((i) => i.state !== 'done');
  const done = summary.items.filter((i) => i.state === 'done');

  const body = `<div class="wrap">
  <div class="grid grid--sidebar">
    <aside class="stack">
      <div>
        <div class="eyebrow eyebrow--plain">${esc(event.name)}</div>
        <h1 style="font-size:var(--step-2)">Judging</h1>
      </div>
      <div class="panel">
        <div class="kv mb-2">
          <div><dt>Your progress</dt><dd>${summary.done} of ${summary.total} submitted</dd></div>
        </div>
        ${c.meter(summary.done, summary.total, { label: summary.inProgress ? `${summary.inProgress} in progress` : '', right: summary.total ? `${Math.round((summary.done / summary.total) * 100)}%` : '0%' })}
        <div class="btn-row mt-3" style="margin-top:1rem">
          ${next ? `<a class="btn btn--accent btn--block" href="/j/${esc(event.slug)}/r/${esc(next.projectId)}">${summary.done ? 'Continue reviewing' : 'Start reviewing'}</a>` : '<span class="btn btn--block" aria-disabled="true">All done</span>'}
          <a class="btn btn--ghost btn--block" href="/j/${esc(event.slug)}/compare">Compare projects</a>
        </div>
      </div>
      <div class="stack stack--sm console__nav" style="display:grid">
        <a href="/j/${esc(event.slug)}" aria-current="page">Queue</a>
        <a href="/j/${esc(event.slug)}/compare">Side by side</a>
        <a href="/j/${esc(event.slug)}/pairwise">Head to head</a>
        <a href="/j/${esc(event.slug)}/progress">Panel progress</a>
      </div>
      ${c.countdownBlock(event)}
    </aside>

    <div>
      <div class="section-head">
        <div class="eyebrow">Assigned to you</div>
        <h2 style="font-size:var(--step-2)">${summary.total} project${summary.total === 1 ? '' : 's'}</h2>
        <p>Only these projects are visible to your account. Everything you need to judge one sits on a single page.</p>
      </div>

      ${gate.error ? c.note('stop', esc(gate.error), { title: 'Judging is not open' }) : ''}
      ${conflicts.length ? c.note('warn', `You have declared a conflict of interest on ${conflicts.length} project${conflicts.length === 1 ? '' : 's'}. They have been withdrawn from your queue.`) : ''}

      ${summary.total === 0 ? c.empty('No assignments yet',
    'The organising team has not assigned you any projects. They will appear here as soon as they do.',
    `<a class="btn btn--ghost" href="/h/${esc(event.slug)}">Back to the event</a>`) : ''}

      ${next ? `
      <section class="panel mb-3">
        <div class="eyebrow eyebrow--plain">${next.state === 'in_progress' ? 'Pick up where you left off' : 'Up next'}</div>
        <div class="cluster cluster--start" style="gap:1.1rem;margin-top:.5rem">
          <div style="width:150px;flex:none">${c.artBox(next.projectId, { tall: true })}</div>
          <div class="flex-1">
            <div class="cluster mb-1">${next.trackName ? c.trackChip(next.trackName, next.trackColour) : ''}
              ${next.state === 'in_progress' ? '<span class="badge badge--warn">Draft saved</span>' : ''}</div>
            <h3 style="font-size:var(--step-2);margin-bottom:.2rem">${esc(next.name)}</h3>
            <a class="btn btn--accent mt-2" href="/j/${esc(event.slug)}/r/${esc(next.projectId)}">Open judging workspace</a>
          </div>
        </div>
      </section>` : ''}

      ${summary.items.length ? `<div class="panel panel--flush">
        <div class="list" style="padding:0 1rem">
          ${summary.items.map((i) => `<a class="list-row" href="/j/${esc(event.slug)}/r/${esc(i.projectId)}">
            <span class="queue__dot ${i.state === 'done' ? 'queue__dot--done' : i.state === 'in_progress' ? 'queue__dot--progress' : ''}"></span>
            <div class="list-row__main">
              <div class="list-row__title">${esc(i.name)}</div>
              <div class="list-row__sub">${esc(i.trackName || 'No track')}${i.score ? ` · ${Math.round(i.score)} / 100` : ''}</div>
            </div>
            <div class="list-row__side">
              <label class="check" title="Add to side-by-side comparison">
                <input type="checkbox" data-compare="${esc(i.projectId)}" data-name="${esc(i.name)}" aria-label="Compare ${esc(i.name)}">
              </label>
              <span class="badge ${i.state === 'done' ? 'badge--good' : i.state === 'in_progress' ? 'badge--warn' : ''}">${i.state === 'done' ? 'Submitted' : i.state === 'in_progress' ? 'Draft' : 'To do'}</span>
            </div>
          </a>`).join('')}
        </div>
      </div>` : ''}

      ${done.length ? `<div class="mt-3">${c.note('info', `<strong>${done.length} submitted.</strong> Your scores are private to you and the organising team. They are published only when results are released, and only as standings.`)}</div>` : ''}
    </div>
  </div>
</div>`;

  return c.appLayout({
    title: `Judging · ${event.name}`,
    user: viewer.user,
    event,
    body,
  });
}

/* --------------------------------------------------- the judging workspace */

function reviewWorkspace({ event, viewer, judge, project, criteria, review, assignment, queue, conflict, gate, formErrors }) {
  const pct = queue.total ? Math.round((queue.done / queue.total) * 100) : 0;
  const hasMedia = Boolean(project.videoUrl || project.demoUrl || project.screenshots.length);

  const body = `<div class="wrap">
  <div class="cluster cluster--between mb-2 no-print">
    <a class="arrow-link" href="/j/${esc(event.slug)}" style="border:0">← Queue</a>
    <div class="cluster">
      <span class="save-state" id="saveState" data-state="idle">Not saved yet</span>
      <a class="btn btn--sm btn--ghost" href="/j/${esc(event.slug)}/compare${qs({ a: project.id })}">Compare</a>
    </div>
  </div>

  <div class="judge-layout">
    <!-- ------------------------------------------------ project material -->
    <article>
      <header class="mb-3">
        <div class="cluster mb-1">
          ${project.track ? c.trackChip(project.track.name, project.track.colour) : ''}
          <span class="badge">Submitted ${esc(lc.fmtDate(project.submittedAt, event.timezone))}</span>
          ${review && review.state === 'submitted' ? '<span class="badge badge--good">Review submitted</span>' : (review ? '<span class="badge badge--warn">Draft in progress</span>' : '')}
        </div>
        <h1 style="font-size:var(--step-3)">${esc(project.name)}</h1>
        <p class="lede" style="font-size:var(--step-0)">${esc(project.tagline)}</p>
        <div class="cluster mt-2">
          ${c.avatarStack(project.team ? project.team.members : [], 5)}
          <div class="small">
            <b>${esc(project.team ? project.team.name : 'Unknown team')}</b>
            <span class="muted">${esc((project.team ? project.team.members.map((m) => m.name) : []).join(', '))}</span>
          </div>
        </div>
      </header>

      ${hasMedia ? `<section class="mb-4">
        <div class="media-tabs" role="tablist" aria-label="Demo material">
          ${project.videoUrl ? '<button role="tab" id="tab-video" aria-controls="pane-video" aria-selected="true" data-pane="video">Demo video</button>' : ''}
          ${project.demoUrl ? `<button role="tab" id="tab-demo" aria-controls="pane-demo" aria-selected="${project.videoUrl ? 'false' : 'true'}" data-pane="demo">Live demo</button>` : ''}
          ${project.screenshots.length ? `<button role="tab" id="tab-shots" aria-controls="pane-shots" aria-selected="false" data-pane="shots">Screenshots <span class="divider-dots">${project.screenshots.length}</span></button>` : ''}
        </div>

        <div id="pane-video" class="media-pane" ${project.videoUrl ? '' : 'hidden'}>
          <div class="media-frame" id="mediaHost">${renderVideo(project)}</div>
          ${project.videoUrl ? `<p class="small muted mt-1">Plays inside Hackerly when the provider allows it. <a href="${esc(safeUrl(project.videoUrl))}" target="_blank" rel="noopener noreferrer">Open on ${esc(hostOf(project.videoUrl) || 'the provider')}</a> if it does not.</p>` : ''}
        </div>

        <div id="pane-demo" class="media-pane" ${project.videoUrl ? 'hidden' : ''}>
          <div class="panel panel--sunk">
            <div class="cluster cluster--between">
              <div><b>Live demo</b><div class="small muted">${esc(hostOf(project.demoUrl))}</div></div>
              <a class="btn btn--sm" href="${esc(safeUrl(project.demoUrl))}" target="_blank" rel="noopener noreferrer">Open in a new tab ↗</a>
            </div>
            <p class="small muted mt-2 mb-0">Third-party demos are opened on their own origin in a new tab. Hackerly never frames or proxies a participant’s site.</p>
          </div>
        </div>

        <div id="pane-shots" class="media-pane" hidden>
          <div class="screenshot-strip">
            ${project.screenshots.map((s, i) => `<figure class="screenshot">
              ${s.url ? `<img src="${esc(safeUrl(s.url))}" alt="${esc(s.caption || `${project.name} screenshot ${i + 1}`)}" loading="lazy" referrerpolicy="no-referrer">` : c.artBox(`${project.id}-s${i}`, { tall: true })}
              ${s.caption ? `<figcaption>${esc(s.caption)}</figcaption>` : ''}
            </figure>`).join('')}
          </div>
        </div>
      </section>` : ''}

      <!-- The write-up is never behind a tab. It is the second thing a judge
           reads after the demo, and making them click to find it is the kind
           of small friction that makes a review slower than it needs to be. -->
      <section class="mb-4">
        <div class="cluster cluster--between mb-2">
          <div class="eyebrow eyebrow--plain" style="margin:0">The write-up</div>
          ${project.description ? `<span class="small muted">${esc(String(project.description).split(/\s+/).filter(Boolean).length)} words</span>` : ''}
        </div>
        ${project.description
    ? `<div class="prose">${markdown(project.description)}</div>`
    : '<p class="muted">This project did not include a write-up. Judge it on the demo and the repository alone.</p>'}
      </section>

      ${project.answers.length ? `<section class="mb-4">
        <div class="eyebrow eyebrow--plain">Submission answers</div>
        <div class="def-list mt-2">
          ${project.answers.map((a) => `<div><dt>${esc(a.label)}</dt><dd>${esc(a.value)}</dd></div>`).join('')}
        </div>
      </section>` : ''}

      <section class="mb-4">
        <div class="eyebrow">Everything they provided</div>
        <div class="link-cards mt-2">
          ${c.externalLink(project.repoUrl, 'Repository') || ''}
          ${c.externalLink(project.demoUrl, 'Live demo') || ''}
          ${project.videoUrl ? c.externalLink(project.videoUrl, 'Demo video') : ''}
        </div>
        ${project.techStack.length ? `<div class="mt-2"><div class="eyebrow eyebrow--plain">Built with</div>${c.techTags(project.techStack)}</div>` : ''}
      </section>
    </article>

    <!-- ------------------------------------------------- scoring panel -->
    <aside class="judge-layout__aside">
      <div class="panel${gate.error ? ' is-readonly' : ''}" id="scorePanel"
        data-project="${esc(project.id)}"
        data-event="${esc(event.slug)}"
        data-readonly="${gate.error ? '1' : '0'}"
        data-review="${esc(review ? review.id : '')}">
        <div class="panel__head">
          <h2 style="font-size:var(--step-1);margin:0">Your review</h2>
          ${review && review.state === 'submitted' ? '<span class="badge badge--good">Submitted</span>' : ''}
        </div>

        ${conflict ? c.note('stop', esc(conflict)) : ''}
        ${gate.error ? c.note('stop', esc(gate.error), { title: 'Judging closed' }) : ''}
        ${formErrors && formErrors.form ? c.note('stop', esc(formErrors.form)) : ''}

        <div class="total-bar">
          <div>
            <div class="total-bar__n" id="totalScore">${review ? Math.round(review.totalScore) : '—'}</div>
            <div class="total-bar__l">weighted score out of 100</div>
          </div>
          <div style="text-align:right">
            <div class="total-bar__l" id="answeredCount">${review ? Object.keys(review.scores).length : 0}/${criteria.length} criteria</div>
            <div class="total-bar__l">${review && review.state === 'submitted' ? 'locked' : 'auto-saved'}</div>
          </div>
        </div>

        <form id="reviewForm" method="post" action="/j/${esc(event.slug)}/r/${esc(project.id)}/review">
          <div class="rubric">
            ${criteria.map((cr) => {
    const current = review ? review.scores[cr.id] : undefined;
    const noteValue = review && review.notes ? review.notes[cr.id] : '';
    return `<div class="criterion${current !== undefined ? ' is-scored' : ''}" data-criterion="${esc(cr.id)}" data-max="${cr.max_score}" data-weight="${cr.weight}">
                <div class="criterion__head">
                  <span class="criterion__name">${esc(cr.name)}</span>
                  <span class="criterion__meta">weight ${cr.weight} · max ${cr.max_score}</span>
                </div>
                ${cr.description ? `<p class="criterion__desc">${esc(cr.description)}</p>` : ''}
                <div class="scale" role="group" aria-label="${esc(cr.name)} score">
                  ${Array.from({ length: Math.round(cr.max_score) }, (_, i) => i + 1).map((v) => {
      const low = v <= Math.round(cr.max_score * 0.4);
      const high = v >= Math.round(cr.max_score * 0.8);
      return `<button type="button" data-score="${v}" class="${low ? 'is-low' : high ? 'is-high' : ''}" aria-pressed="${current === v}"${gate.error ? ' disabled' : ''}>${v}</button>`;
    }).join('')}
                </div>
                <input type="hidden" name="score_${esc(cr.id)}" value="${current !== undefined ? esc(current) : ''}">
                <input class="criterion__note" type="text" name="note_${esc(cr.id)}" value="${esc(noteValue || '')}" maxlength="300"${gate.error ? ' disabled' : ''}
                  placeholder="Optional note — e.g. what drove this score" aria-label="Note for ${esc(cr.name)}">
              </div>`;
  }).join('')}
          </div>

          <div class="stack stack--sm mt-3" style="margin-top:1.4rem">
            <label class="field">
              <span class="field__label">Summary<span class="field__req">*</span></span>
              <textarea name="summary" rows="3" maxlength="1200" required placeholder="What does it do, and how well does it do it?">${esc(review ? review.summary : '')}</textarea>
              <p class="field__help">Required before you can submit. This is what the organiser reads first.</p>
            </label>
            <label class="field">
              <span class="field__label">What works well</span>
              <textarea name="strengths" rows="2" maxlength="800" placeholder="Genuinely good engineering, clear UX, surprising approach…">${esc(review ? review.strengths : '')}</textarea>
            </label>
            <label class="field">
              <span class="field__label">What would improve it</span>
              <textarea name="improvements" rows="2" maxlength="800" placeholder="The one thing that would most raise the score…">${esc(review ? review.improvements : '')}</textarea>
            </label>
            <label class="field">
              <span class="field__label">Concerns or integrity flags</span>
              <textarea name="concerns" rows="2" maxlength="800" placeholder="Only if something is genuinely off. Leave empty otherwise.">${esc(review ? review.concerns : '')}</textarea>
            </label>
            <label class="field">
              <span class="field__label">Recommendation</span>
              <select name="recommend">
                <option value="">No recommendation</option>
                <option value="shortlist"${review && review.recommend === 'shortlist' ? ' selected' : ''}>Shortlist</option>
                <option value="discuss"${review && review.recommend === 'discuss' ? ' selected' : ''}>Discuss at the panel</option>
                <option value="pass"${review && review.recommend === 'pass' ? ' selected' : ''}>Not a winner</option>
              </select>
            </label>
          </div>

          <div class="form-actions">
            <button class="btn" type="submit" name="action" value="save" ${gate.error ? 'disabled aria-disabled="true"' : ''}>Save draft</button>
            <button class="btn btn--accent" type="submit" name="action" value="submit" ${gate.error ? 'disabled aria-disabled="true"' : ''}>Submit review</button>
            <button class="btn btn--quiet btn--sm" type="button" data-conflict>Declare a conflict</button>
          </div>
        </form>

        <form method="post" action="/j/${esc(event.slug)}/r/${esc(project.id)}/conflict" class="mt-2" data-conflict-form hidden>
          <label class="field">
            <span class="field__label">Why are you conflicted?</span>
            <input type="text" name="reason" maxlength="200" required placeholder="I built this, it is my employer’s product…">
          </label>
          <div class="btn-row">
            <button class="btn btn--sm btn--danger" type="submit">Withdraw and declare conflict</button>
            <button class="btn btn--sm btn--quiet" type="button" data-conflict-cancel>Cancel</button>
          </div>
        </form>
      </div>

      <div class="panel mt-3 no-print">
        <div class="eyebrow eyebrow--plain">Queue</div>
        ${c.meter(queue.done, queue.total, { label: `${queue.done} of ${queue.total} submitted`, right: `${pct}%` })}
        <div class="queue mt-2">
          ${queue.items.map((i) => `<a class="queue__item${i.state === 'done' ? ' is-done' : ''}" href="/j/${esc(event.slug)}/r/${esc(i.projectId)}"${i.projectId === project.id ? ' aria-current="true"' : ''}>
            <span class="queue__dot ${i.state === 'done' ? 'queue__dot--done' : i.state === 'in_progress' ? 'queue__dot--progress' : ''}"></span>
            <span class="queue__t">${esc(i.name)}</span>
            <label class="check" style="margin:0"><input type="checkbox" data-compare="${esc(i.projectId)}" data-name="${esc(i.name)}" aria-label="Compare ${esc(i.name)}"></label>
          </a>`).join('')}
        </div>
      </div>
    </aside>
  </div>

  <div class="compare-tray no-print" data-compare-tray hidden>
    <span class="compare-tray__n"><span data-compare-count>0</span> selected</span>
    <span class="compare-tray__items" data-compare-items></span>
    <span class="flex-1"></span>
    <a class="btn btn--sm" data-compare-go href="#">Compare side by side</a>
    <button class="btn btn--sm btn--quiet" type="button" data-compare-clear style="--btn-fg:var(--paper);--btn-bd:rgba(252,251,248,.3)">Clear</button>
  </div>
</div>`;

  return c.appLayout({ title: `${project.name} · Judging`, user: viewer.user, event, body });
}

/** YouTube and Vimeo get an embed; anything else gets a poster with a link. */
function renderVideo(project) {
  const url = safeUrl(project.videoUrl);
  if (!url) return '<div class="media-frame__fallback"><span>No demo video</span></div>';
  let embed = '';
  let m;
  if ((m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|live\/)|youtu\.be\/)([\w-]{6,})/))) {
    embed = `<iframe src="https://www.youtube-nocookie.com/embed/${esc(m[1])}?rel=0&modestbranding=1" title="Demo video" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  } else if ((m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/))) {
    embed = `<iframe src="https://player.vimeo.com/video/${esc(m[1])}?dnt=1" title="Demo video" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  }
  if (embed) return embed;
  return `<div class="media-frame__fallback">
    <div>
      <p class="mb-1">This video is hosted somewhere Hackerly cannot embed safely.</p>
      <a class="btn btn--ghost" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open the video ↗</a>
    </div>
  </div>`;
}

/* -------------------------------------------------------------- comparison */

function comparePage({ event, viewer, columns, criteria, mine, missing, selection }) {
  const body = `<div class="wrap">
  <div class="cluster cluster--between mb-3">
    <div>
      <a class="arrow-link mb-1" href="/j/${esc(event.slug)}" style="border:0">← Queue</a>
      <h1 style="font-size:var(--step-3);margin:0">Side by side</h1>
      <p class="muted" style="font-size:var(--step--1);margin:0">${columns.length
    ? 'Aligned rows so the difference is obvious, not something you have to hold in your head.'
    : 'Pick projects from your queue to put them next to each other.'}</p>
    </div>
    ${columns.length > 1 ? '<a class="btn btn--ghost btn--sm" href="/j/' + esc(event.slug) + '/pairwise">Prefer head to head?</a>' : ''}
  </div>

  ${columns.length === 0 ? c.empty('Nothing selected',
    'Tick the checkbox beside any project in your queue to add it here. You can compare two, three or four at once.',
    `<a class="btn btn--accent" href="/j/${esc(event.slug)}">Go to my queue</a>`) : ''}

  ${missing.length ? c.note('info', `Only showing projects you are assigned to. ${missing} other project${missing === 1 ? ' was' : 's were'} not available to you.`) : ''}

  ${columns.length ? `<form method="post" action="/j/${esc(event.slug)}/compare" class="filter-bar no-print">
    <label class="check" style="align-items:center">
      <input type="checkbox" name="mine" value="1"${mine ? ' checked' : ''}> Only show rows where I have scored
    </label>
    <button class="btn btn--sm" type="submit">Apply</button>
    <span class="flex-1"></span>
    <span class="small muted">${selection ? `${selection.size} selected` : ''}</span>
    <a class="btn btn--sm btn--quiet" href="/j/${esc(event.slug)}/compare">Reset</a>
  </form>` : ''}

  ${columns.length ? `<div class="compare">
    <div class="compare__grid compare__grid--${Math.min(4, columns.length)}">
      ${columns.map((col) => `<div class="compare__col">
        <div class="compare__head">
          <div class="flex-1">
            ${col.project.track ? c.trackChip(col.project.track.name, col.project.track.colour) : ''}
            <h3 class="mt-1">${esc(col.project.name)}</h3>
            <div class="small muted">${esc(col.project.team ? col.project.team.name : '')}</div>
          </div>
        </div>
        <div class="compare__body">
          <div>
            <div class="compare__rowlabel">Tagline</div>
            <div class="compare__text">${esc(col.project.tagline || '—')}</div>
          </div>
          <div>
            <div class="compare__rowlabel">Material</div>
            <div class="cluster btn-row--tight">
              ${col.project.demoUrl ? '<span class="badge">Live demo</span>' : ''}
              ${col.project.repoUrl ? '<span class="badge">Repository</span>' : ''}
              ${col.project.videoUrl ? '<span class="badge badge--accent">Video</span>' : ''}
              ${!col.project.demoUrl && !col.project.repoUrl && !col.project.videoUrl ? '<span class="muted small">Nothing linked</span>' : ''}
            </div>
            <div class="btn-row btn-row--tight mt-1">
              <a class="btn btn--sm btn--ghost" href="/j/${esc(event.slug)}/r/${esc(col.project.id)}">Open workspace</a>
              ${col.project.demoUrl ? `<a class="btn btn--sm btn--quiet" href="${esc(safeUrl(col.project.demoUrl))}" target="_blank" rel="noopener noreferrer">Demo ↗</a>` : ''}
            </div>
          </div>
          <div>
            <div class="compare__rowlabel">Built with</div>
            ${col.project.techStack.length ? c.techTags(col.project.techStack.slice(0, 6)) : '<span class="muted small">Not stated</span>'}
          </div>
          <div>
            <div class="compare__rowlabel">Write-up</div>
            ${col.project.description
    ? `<div class="compare__text small compare__text--clip">${markdown(col.project.description)}</div>
                 <a class="compare__more" href="/j/${esc(event.slug)}/r/${esc(col.project.id)}">Read it in full →</a>`
    : '<span class="muted small">No write-up provided</span>'}
          </div>
          ${criteria.map((cr) => {
      const score = col.review ? col.review.scores[cr.id] : undefined;
      return `<div>
              <div class="compare__rowlabel">${esc(cr.name)}</div>
              ${score === undefined
        ? '<span class="muted small">not scored</span>'
        : `<div class="score-bar${col.isBest && criteria.length > 1 ? ' score-bar--best' : ''}">
                     <span class="score-bar__label">your score</span>
                     <span class="score-bar__val">${score} / ${cr.max_score}</span>
                     <span class="score-bar__track"><span class="score-bar__fill" style="width:${(score / cr.max_score) * 100}%"></span></span>
                   </div>`}
            </div>`;
    }).join('')}
          <div>
            <div class="compare__rowlabel">Weighted total</div>
            <div class="score-bar score-bar--mine">
              <span class="score-bar__label">your score</span>
              <span class="score-bar__val" style="font-size:.95rem">${col.review ? Math.round(col.review.totalScore) : '—'}</span>
              <span class="score-bar__track"><span class="score-bar__fill" style="width:${col.review ? col.review.totalScore : 0}%"></span></span>
            </div>
          </div>
          ${col.review && col.review.summary ? `<div>
            <div class="compare__rowlabel">Your note</div>
            <div class="compare__text small">${esc(col.review.summary)}</div>
          </div>` : ''}
        </div>
        <div class="compare__drop">
          <a class="btn btn--sm btn--quiet w-full" href="/j/${esc(event.slug)}/r/${esc(col.project.id)}">Open &amp; score</a>
        </div>
      </div>`).join('')}
    </div>
  </div>` : ''}
</div>`;

  return c.appLayout({ title: 'Compare projects', user: viewer.user, event, body });
}

/* --------------------------------------------------------- head to head */

function pairwisePage({ event, viewer, pair, history, myStrengths, canCompare }) {
  const body = `<div class="wrap">
  <div class="cluster cluster--between mb-3">
    <div>
      <a class="arrow-link mb-1" href="/j/${esc(event.slug)}" style="border:0">← Queue</a>
      <h1 style="font-size:var(--step-3);margin:0">Head to head</h1>
      <p class="muted" style="font-size:var(--step--1);margin:0">Some things are only obvious in comparison. Pick the stronger project; your wins and losses build a relative strength score.</p>
    </div>
  </div>

  ${!canCompare ? c.note('info', 'You need at least two completed assignments before head-to-head pairs can be generated.') : ''}

  ${pair ? `<div class="pairwise" id="pairwise" data-event="${esc(event.slug)}" data-a="${esc(pair.a.id)}" data-b="${esc(pair.b.id)}">
    ${[['a', pair.a], ['b', pair.b]].map(([side, p]) => `<div class="pairwise__side" data-side="${side}">
      <div class="compare__head">
        <div class="flex-1">
          ${p.track ? c.trackChip(p.track.name, p.track.colour) : ''}
          <h3 class="mt-1">${esc(p.name)}</h3>
          <div class="small muted">${esc(p.teamName)}</div>
        </div>
      </div>
      <div class="compare__body">
        <div><div class="compare__rowlabel">Tagline</div><div class="compare__text">${esc(p.tagline || '—')}</div></div>
        <div>
          <div class="compare__rowlabel">Material</div>
          <div class="cluster btn-row--tight">
            ${p.demoUrl ? '<span class="badge">Live demo</span>' : ''}${p.repoUrl ? '<span class="badge">Repository</span>' : ''}${p.videoUrl ? '<span class="badge badge--accent">Video</span>' : ''}
          </div>
          <div class="btn-row btn-row--tight mt-1">
            <a class="btn btn--sm btn--ghost" href="/j/${esc(event.slug)}/r/${esc(p.id)}">Open workspace</a>
            ${p.demoUrl ? `<a class="btn btn--sm btn--quiet" href="${esc(safeUrl(p.demoUrl))}" target="_blank" rel="noopener noreferrer">Demo ↗</a>` : ''}
          </div>
        </div>
        <div><div class="compare__rowlabel">Your score</div>
          <div class="score-bar score-bar--mine"><span class="score-bar__label">yours</span><span class="score-bar__val">${p.review && p.review.state === 'submitted' ? Math.round(p.review.totalScore) : 'not submitted'}</span>
          <span class="score-bar__track"><span class="score-bar__fill" style="width:${p.review && p.review.state === 'submitted' ? p.review.totalScore : 0}%"></span></span></div>
        </div>
      </div>
      <div class="pairwise__pick">
        <button class="btn ${side === 'a' ? 'btn--accent' : 'btn--ghost'}" type="button" data-pick="${side}">${side === 'a' ? 'A is stronger' : 'B is stronger'}</button>
      </div>
    </div>`).join('')}
  </div>

  <form id="pairwiseForm" method="post" action="/j/${esc(event.slug)}/pairwise" class="panel mt-3" hidden>
    <input type="hidden" name="a" value="${esc(pair.a.id)}">
    <input type="hidden" name="b" value="${esc(pair.b.id)}">
    <input type="hidden" name="winner" value="" id="pairWinner">
    <label class="field">
      <span class="field__label">Why?</span>
      <textarea name="rationale" rows="2" maxlength="600" placeholder="One line is enough. This is what makes the decision defensible later."></textarea>
    </label>
    <div class="btn-row">
      <button class="btn btn--accent" type="submit" id="pairSubmit" disabled>Record and next pair</button>
    </div>
  </form>

  <div class="mt-3" id="pairDone" hidden>
    ${c.note('good', '<strong>Recorded.</strong> Loading the next pair…')}
  </div>` : c.empty('No pairs left',
    canCompare ? 'You have compared every available pair. Head back to your queue.' : 'Complete at least two reviews to unlock head-to-head comparisons.',
    '<a class="btn btn--accent" href="/j/' + esc(event.slug) + '">Back to queue</a>')}

  <div class="grid grid--split mt-4">
    <section class="panel">
      <h3 style="font-size:var(--step-1)">Your relative strength</h3>
      <p class="small muted">A win/loss model across every pair you have judged, independent of the rubric scale.</p>
      ${myStrengths.length ? `<div class="score-bars mt-2">
        ${myStrengths.map((s) => `<div class="score-bar${s.projectId === pair?.a?.id ? ' score-bar--mine' : ''}">
          <span class="score-bar__label">${esc(s.name)}</span>
          <span class="score-bar__val">${s.wins} win${s.wins === 1 ? '' : 's'}</span>
          <span class="score-bar__track"><span class="score-bar__fill" style="width:${Math.min(100, s.strength * 40)}%"></span></span>
        </div>`).join('')}
      </div>` : '<p class="muted small">No comparisons recorded yet.</p>'}
    </section>
    <section class="panel">
      <h3 style="font-size:var(--step-1)">History</h3>
      ${history.length ? `<div class="list">
        ${history.map((h) => `<div class="list-row" style="padding:.5rem 0">
          <div class="list-row__main">
            <div class="list-row__title small">${esc(h.winnerName)} over ${esc(h.loserName)}</div>
            <div class="list-row__sub">${esc(lc.fmtDate(h.createdAt, event.timezone))}${h.rationale ? ` · ${esc(h.rationale)}` : ''}</div>
          </div>
        </div>`).join('')}
      </div>` : '<p class="muted small">Nothing recorded yet.</p>'}
    </section>
  </div>
</div>`;

  return c.appLayout({ title: 'Head to head', user: viewer.user, event, body });
}

/* ---------------------------------------------------------------- progress */

function judgeProgressPage({ event, viewer, judge, summary, panel, spread, myReviews }) {
  const body = `<div class="wrap">
  <a class="arrow-link mb-2" href="/j/${esc(event.slug)}" style="border:0">← Queue</a>
  <div class="section-head">
    <div class="eyebrow">Progress</div>
    <h1>Where judging stands</h1>
    <p>Completion across the panel. Individual scores stay private to each judge.</p>
  </div>

  <div class="grid grid--3 mb-4">
    <div class="stat"><span class="stat__n">${spread.count}</span><span class="stat__l">projects submitted</span></div>
    <div class="stat"><span class="stat__n">${spread.submitted}</span><span class="stat__l">reviews written</span></div>
    <div class="stat"><span class="stat__n">${summary.done}/${summary.total}</span><span class="stat__l">yours submitted</span></div>
  </div>

  <div class="grid grid--split">
    <section class="panel">
      <div class="panel__head"><h3 style="margin:0">Panel</h3><span class="badge">${panel.length} judges</span></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Judge</th><th class="tbl__num">Submitted</th><th class="tbl__num">Last review</th></tr></thead>
        <tbody>
          ${panel.map((p) => `<tr>
            <td>${esc(p.name)}${p.id === judge.id ? ' <span class="badge">you</span>' : ''}
              ${p.state !== 'verified' ? `<span class="badge badge--warn">${esc(p.state)}</span>` : ''}</td>
            <td class="tbl__num">${p.submitted} / ${p.assigned}</td>
            <td class="tbl__num muted">${p.last_at ? esc(lc.fmtDate(p.last_at, event.timezone)) : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </section>

    <section class="panel">
      <h3 style="font-size:var(--step-1)">Your submitted reviews</h3>
      ${myReviews.length ? `<div class="list mt-2">
        ${myReviews.map((r) => `<a class="list-row" href="/j/${esc(event.slug)}/r/${esc(r.projectId)}">
          <div class="list-row__main">
            <div class="list-row__title">${esc(r.projectName)}</div>
            <div class="list-row__sub">${esc(lc.fmtDate(r.submittedAt, event.timezone))}</div>
          </div>
          <div class="list-row__side"><span class="badge badge--good">${Math.round(r.totalScore)}</span></div>
        </a>`).join('')}
      </div>` : '<p class="muted small">You have not submitted any reviews yet.</p>'}
      <p class="small muted mt-2 mb-0">These scores are visible to you and to the organising team. No other judge can read them, and participants cannot see them until results are published.</p>
    </section>
  </div>
</div>`;

  return c.appLayout({ title: 'Judging progress', user: viewer.user, event, body });
}

module.exports = { judgeHome, reviewWorkspace, comparePage, pairwisePage, judgeProgressPage };
