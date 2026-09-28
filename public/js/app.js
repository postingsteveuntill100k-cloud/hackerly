/* =============================================================================
   Hackerly — client behaviour

   Progressive enhancement only. Every page works with this file blocked; this
   adds autosave, the media tabs, the comparison tray and a few affordances
   that would otherwise need a page reload.

   No framework, no build step, no inline handlers.
   ========================================================================== */

(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ------------------------------------------------------------------ toast */

  function toast(message, kind) {
    let host = $('#toasts');
    if (!host) {
      host = document.createElement('div');
      host.className = 'toast-host';
      host.id = 'toasts';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = `toast${kind ? ` toast--${kind}` : ''}`;
    el.setAttribute('role', 'status');
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s, transform .3s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      setTimeout(() => el.remove(), 320);
    }, 4200);
  }

  window.hackerlyToast = toast;

  /* ------------------------------------------------------- media tab panels */

  function initMediaTabs() {
    const tabs = $$('.media-tabs [data-pane]');
    if (!tabs.length) return;
    const show = (key) => {
      tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.pane === key)));
      $$('.media-pane').forEach((p) => { p.hidden = p.id !== `pane-${key}`; });
    };
    tabs.forEach((t) => t.addEventListener('click', () => show(t.dataset.pane)));
    const first = tabs.find((t) => t.getAttribute('aria-selected') === 'true') || tabs[0];
    if (first) show(first.dataset.pane);

    // Number keys 1-5 jump between panels, which is what a judge does anyway.
    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const n = Number(e.key);
      if (n >= 1 && n <= tabs.length) show(tabs[n - 1].dataset.pane);
    });
  }

  /* -------------------------------------------------------------- rubric */

  function initRubric() {
    const panel = $('#scorePanel');
    if (!panel) return;
    const form = $('#reviewForm');
    if (!form) return;
    const projectId = panel.dataset.project;
    const eventSlug = panel.dataset.event;
    const readOnly = panel.dataset.readonly === '1';
    const stateEl = $('#saveState');
    let timer = null;
    let dirty = false;

    const totalEl = $('#totalScore');
    const answeredEl = $('#answeredCount');

    function recomputeTotal() {
      let earned = 0;
      let possible = 0;
      let answered = 0;
      $$('.criterion', panel).forEach((el) => {
        const hidden = $('input[type=hidden]', el);
        const value = Number(hidden && hidden.value);
        const weight = Number(el.dataset.weight);
        const max = Number(el.dataset.max);
        if (hidden && hidden.value !== '') {
          earned += value * weight;
          possible += max * weight;
          answered += 1;
        }
      });
      const total = possible > 0 ? Math.round((earned / possible) * 100) : 0;
      if (totalEl) totalEl.textContent = possible > 0 ? total : '—';
      if (answeredEl) {
        const of = $$('.criterion', panel).length;
        answeredEl.textContent = `${answered}/${of} criteria`;
      }
      return total;
    }

    function markDirty() {
      if (readOnly) return;
      dirty = true;
      if (stateEl) stateEl.dataset.state = 'saving';
      if (stateEl) stateEl.textContent = 'Saving…';
      clearTimeout(timer);
      timer = setTimeout(save, 900);
    }

    async function save() {
      if (!dirty) return;
      dirty = false;
      const body = new URLSearchParams();
      $$('.criterion', panel).forEach((el) => {
        const hidden = $('input[type=hidden]', el);
        if (hidden) body.set(hidden.name, hidden.value);
        const note = $('.criterion__note', el);
        if (note) body.set(note.name, note.value);
      });
      ['summary', 'strengths', 'improvements', 'concerns', 'recommend'].forEach((name) => {
        const field = form.elements[name];
        if (field) body.set(name, field.value);
      });
      try {
        const res = await fetch(`/api/reviews/${encodeURIComponent(eventSlug)}/${encodeURIComponent(projectId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body,
          credentials: 'same-origin',
        });
        if (stateEl) {
          if (res.ok) {
            stateEl.dataset.state = 'saved';
            stateEl.textContent = 'Draft saved';
          } else {
            stateEl.dataset.state = 'error';
            stateEl.textContent = 'Not saved';
            const payload = await res.json().catch(() => ({}));
            if (payload.message) toast(payload.message, 'stop');
          }
        }
      } catch (err) {
        if (stateEl) {
          stateEl.dataset.state = 'error';
          stateEl.textContent = 'Offline — not saved';
        }
      }
    }

    $$('.scale button', panel).forEach((btn) => {
      if (readOnly) return;
      btn.addEventListener('click', () => {
        const criterion = btn.closest('.criterion');
        const hidden = $('input[type=hidden]', criterion);
        const value = btn.dataset.score;
        if (hidden.value === value) {
          // Clicking the same value clears it, which is how a judge resets.
          hidden.value = '';
          $$('.scale button', criterion).forEach((b) => b.setAttribute('aria-pressed', 'false'));
          criterion.classList.remove('is-scored');
        } else {
          hidden.value = value;
          $$('.scale button', criterion).forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
          criterion.classList.add('is-scored');
        }
        recomputeTotal();
        markDirty();
      });
    });

    $$('.criterion__note', panel).forEach((note) => note.addEventListener('input', markDirty));
    ['summary', 'strengths', 'improvements', 'concerns'].forEach((name) => {
      const field = form.elements[name];
      if (field) field.addEventListener('input', markDirty);
    });
    if (form.elements.recommend) form.elements.recommend.addEventListener('change', markDirty);

    // A submission must not race the autosave.
    form.addEventListener('submit', (e) => {
      if (readOnly) { e.preventDefault(); return; }
      if (e.submitter && e.submitter.value === 'submit') {
        clearTimeout(timer);
        recomputeTotal();
        const total = Number(totalEl ? totalEl.textContent : 0);
        if (!Number.isFinite(total) || total === 0) {
          e.preventDefault();
          toast('Score at least one criterion before submitting.', 'stop');
          return;
        }
        if (form.elements.summary && !form.elements.summary.value.trim()) {
          e.preventDefault();
          toast('Write a short summary before submitting.', 'stop');
          form.elements.summary.focus();
        }
      }
    });

    // Warn before losing unsaved work.
    window.addEventListener('beforeunload', (e) => {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });
    recomputeTotal();
  }

  /* ------------------------------------------------------ conflict toggle */

  function initConflict() {
    const open = $('[data-conflict]');
    const form = $('[data-conflict-form]');
    const cancel = $('[data-conflict-cancel]');
    if (!open || !form) return;
    open.addEventListener('click', () => { form.hidden = false; open.hidden = true; });
    if (cancel) cancel.addEventListener('click', () => { form.hidden = true; open.hidden = false; });
  }

  /* ------------------------------------------------------ comparison tray */

  const TRAY_KEY = 'hackerly.compare';

  function selectedIds() {
    try {
      const raw = sessionStorage.getItem(TRAY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      return [];
    }
  }

  function setSelected(ids) {
    try {
      sessionStorage.setItem(TRAY_KEY, JSON.stringify(ids));
    } catch (err) { /* storage unavailable; the tray still works in-page */ }
  }

  function initCompare() {
    const boxes = $$('[data-compare]');
    if (!boxes.length) return;
    const tray = $('[data-compare-tray]');
    if (!tray) return;
    const countEl = $('[data-compare-count]');
    const itemsEl = $('[data-compare-items]');
    const goLink = $('[data-compare-go]');
    const clearBtn = $('[data-compare-clear]');

    function paint() {
      const ids = selectedIds();
      boxes.forEach((b) => { b.checked = ids.includes(b.dataset.compare); });
      if (countEl) countEl.textContent = String(ids.length);
      if (itemsEl) {
        itemsEl.innerHTML = '';
        ids.forEach((id) => {
          const box = boxes.find((b) => b.dataset.compare === id);
          const chip = document.createElement('span');
          chip.className = 'compare-tray__chip';
          chip.textContent = box ? box.dataset.name : id;
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.setAttribute('aria-label', `Remove ${box ? box.dataset.name : id} from comparison`);
          remove.textContent = '×';
          remove.addEventListener('click', () => {
            setSelected(selectedIds().filter((x) => x !== id));
            paint();
          });
          chip.appendChild(remove);
          itemsEl.appendChild(chip);
        });
      }
      if (goLink) {
        const base = goLink.getAttribute('href').split('?')[0];
        goLink.href = ids.length ? `${base}?ids=${encodeURIComponent(ids.join(','))}` : base;
        goLink.setAttribute('aria-disabled', ids.length ? 'false' : 'true');
        goLink.classList.toggle('btn--ghost', ids.length === 0);
      }
      tray.hidden = ids.length === 0;
    }

    boxes.forEach((box) => box.addEventListener('change', () => {
      const ids = selectedIds();
      if (box.checked) {
        if (!ids.includes(box.dataset.compare)) ids.push(box.dataset.compare);
      } else {
        const i = ids.indexOf(box.dataset.compare);
        if (i > -1) ids.splice(i, 1);
      }
      setSelected(ids);
      paint();
    }));

    if (clearBtn) clearBtn.addEventListener('click', () => { setSelected([]); paint(); });
    paint();

    // On the comparison page itself, the checkbox pre-selects the columns shown.
    const pageIds = new URLSearchParams(window.location.search).get('ids');
    if (pageIds) {
      pageIds.split(',').filter(Boolean).forEach((id) => {
        if (!selectedIds().includes(id)) {
          const ids = selectedIds();
          ids.push(id);
          setSelected(ids);
        }
      });
    }
  }

  /* ------------------------------------------------------------- pairwise */

  function initPairwise() {
    const wrap = $('#pairwise');
    if (!wrap) return;
    const form = $('#pairwiseForm');
    const winnerInput = $('#pairWinner');
    const submit = $('#pairSubmit');
    const rationale = form ? form.elements.rationale : null;

    $$('[data-pick]', wrap).forEach((btn) => btn.addEventListener('click', () => {
      const side = btn.dataset.pick;
      $$('.pairwise__side', wrap).forEach((s) => s.classList.remove('is-winner'));
      const target = $(`.pairwise__side[data-side="${side}"]`, wrap);
      if (target) target.classList.add('is-winner');
      if (winnerInput) winnerInput.value = side;
      if (submit) submit.disabled = false;
      if (rationale) rationale.focus();
    }));

    if (form) {
      form.addEventListener('submit', (e) => {
        if (!winnerInput || !winnerInput.value) {
          e.preventDefault();
          toast('Pick which project is stronger.', 'stop');
        }
      });
    }
  }

  /* ---------------------------------------------------------- confirmations */

  function initConfirms() {
    $$('form[onsubmit]').forEach((form) => {
      form.addEventListener('submit', (e) => {
        // eslint-disable-next-line no-eval
        const message = form.getAttribute('onsubmit');
        if (message && message.includes('confirm')) {
          const inner = message.match(/confirm\((['"])(.*?)\1\)/);
          if (inner && !window.confirm(inner[2])) e.preventDefault();
        }
      });
    });
  }

  /* ------------------------------------------------------- filter helpers */

  function initFilters() {
    $$('form.filter-bar select').forEach((sel) => {
      sel.addEventListener('change', () => {
        const form = sel.closest('form');
        if (form) form.submit();
      });
    });
  }

  /* ------------------------------------------------- countdown ticking */

  function initCountdowns() {
    const host = $$('.countdown').filter((el) => el.dataset.target);
    if (!host.length) return;
    setInterval(() => {
      host.forEach((el) => {
        const target = Number(el.dataset.target);
        if (!target) return;
        let diff = target - Date.now();
        if (diff <= 0) { el.innerHTML = '<div><b>Now</b><span>open</span></div>'; return; }
        const days = Math.floor(diff / 86400000);
        const hours = Math.floor((diff % 86400000) / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);
        el.innerHTML = `${days ? `<div><b>${days}</b><span>days</span></div>` : ''}<div><b>${String(hours).padStart(2, '0')}</b><span>hrs</span></div><div><b>${String(minutes).padStart(2, '0')}</b><span>min</span></div>`;
      });
    }, 30000);
  }

  /* ------------------------------------------------------------------ boot */

  document.addEventListener('DOMContentLoaded', () => {
    initMediaTabs();
    initRubric();
    initConflict();
    initCompare();
    initPairwise();
    initConfirms();
    initFilters();
    initCountdowns();
  });
})();
