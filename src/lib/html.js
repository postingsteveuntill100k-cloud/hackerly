'use strict';

/**
 * Output helpers.
 *
 * Everything user-authored goes through esc() before it reaches a template.
 * Views are plain functions returning strings, so there is no "forgot to
 * interpolate" failure mode — you have to call a function to emit anything.
 */

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape for HTML text and double-quoted attribute values. */
function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Escape for a single-quoted JS string inside an inline handler-free script. */
function js(value) {
  if (value === null || value === undefined) return '';
  return JSON.stringify(String(value)).slice(1, -1)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

/**
 * Allow only http(s) URLs. Everything else — javascript:, data:, vbscript:,
 * protocol-relative //host, and relative junk — collapses to an empty string
 * so the caller renders no link at all.
 */
function safeUrl(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (raw.startsWith('//')) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return '';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
  return parsed.toString();
}

/** A hostname to show next to a link, with www stripped. */
function hostOf(value) {
  const safe = safeUrl(value);
  if (!safe) return '';
  try {
    return new URL(safe).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Build a query string from an object, dropping empties. */
function qs(params) {
  const parts = [];
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

/**
 * A very small markdown subset for organizer-authored prose:
 * paragraphs, ## headings, ### headings, - bullets, 1. ordered lists,
 * > quotes, **bold**, *italic*, `code`, [text](url), and blank-line breaks.
 * Everything is escaped first, so raw HTML in the source is inert.
 */
function markdown(source) {
  if (!source) return '';
  const lines = esc(source).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let list = null; // 'ul' | 'ol'
  let paragraph = [];

  const inline = (text) => text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noopener nofollow" target="_blank">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');

  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${inline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }
    let m;
    if ((m = line.match(/^###\s+(.*)$/))) {
      flushParagraph(); closeList();
      out.push(`<h4>${inline(m[1])}</h4>`);
    } else if ((m = line.match(/^##\s+(.*)$/))) {
      flushParagraph(); closeList();
      out.push(`<h3>${inline(m[1])}</h3>`);
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flushParagraph(); closeList();
      out.push(`<blockquote>${inline(m[1])}</blockquote>`);
    } else if ((m = line.match(/^[-*]\s+(.*)$/))) {
      flushParagraph();
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^\d+[.)]\s+(.*)$/))) {
      flushParagraph();
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^([-*_]\s*){3,}$/))) {
      flushParagraph(); closeList();
      out.push('<hr>');
    } else {
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  closeList();
  return out.join('\n');
}

/** Plain-text summary of markdown, for meta descriptions. */
function plain(source, limit = 180) {
  const text = String(source || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`]/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1).replace(/\s+\S*$/, '')}…`;
}

function json(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

module.exports = { esc, js, safeUrl, hostOf, qs, markdown, plain, json };
