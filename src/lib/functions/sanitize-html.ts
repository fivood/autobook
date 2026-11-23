/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 *
 * Allowlist sanitizer for book HTML.
 *
 * Every format we support (EPUB / HTMLZ / MOBI / Markdown) ultimately hands us
 * HTML written by whoever produced the file, and that HTML is injected with
 * `innerHTML` into a Tauri webview holding real filesystem and IPC access.
 * `<script>` does not execute through innerHTML, but event-handler attributes
 * (`onerror`, `onload`, …) and `javascript:` URLs do — enough to run arbitrary
 * code with the app's privileges and walk off with the API keys and sync token
 * in localStorage.
 *
 * Two entry points:
 *   - `sanitizeElement(root)` when you already hold a parsed subtree.
 *   - `sanitizeHtml(html)` for a string; parses into an INERT document where
 *     images never load and handlers never fire, sanitizes there, and returns
 *     the safe string. Prefer this at every `innerHTML` sink — sanitizing a
 *     subtree that was already parsed into the live document means the payload
 *     was armed before it was disarmed.
 *
 * There is deliberately no tag allowlist: ebooks carry a lot of markup and
 * dropping unknown-but-harmless tags mangles real books. What matters is the
 * element denylist (script-ish and embedding tags) plus the attribute rules,
 * which are strict — an element nobody has heard of still cannot do anything
 * once its handlers and URLs are clean.
 */

/** Elements removed outright, contents and all. */
const FORBIDDEN_TAGS = new Set([
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'base',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'noscript',
  'template',
  'portal',
  // HTML escape hatch inside SVG — an `<img onerror>` can hide in here, and
  // `querySelectorAll` would not match it case-insensitively in foreign content.
  'foreignobject',
  // A book has no business setting http-equiv refresh or pulling remote CSS.
  'meta',
  'link'
]);

/** Attributes carrying a single URL that has to be scheme-checked. */
const URL_ATTRS = new Set([
  'href',
  'src',
  'xlink:href',
  'action',
  'formaction',
  'poster',
  'data',
  // Legacy image-bearing attribute, still seen in Calibre-converted books.
  'background'
]);

/**
 * Attributes whose value is a comma-separated candidate list rather than one
 * URL. Checked entry by entry; one bad entry drops the whole attribute.
 */
const URL_LIST_ATTRS = new Set(['srcset']);

/** Attributes stripped regardless of value. */
const FORBIDDEN_ATTRS = new Set(['srcdoc', 'http-equiv', 'ping', 'formaction']);

/**
 * Control characters and whitespace are stripped before the scheme check.
 * `java&#9;script:alert(1)` decodes to a real tab inside the word: the browser
 * ignores it and navigates, but a naive `/javascript:/` test does not match —
 * that gap was a live bypass in the previous denylist sanitizer.
 */
const URL_NOISE = /[\u0000-\u0020\u007f-\u00a0]/g;

// `ttu:` is this app's own image-placeholder scheme (see the marker rewrite in
// format-book-data-html). Markers whose blob is missing survive to render time.
const KNOWN_SAFE_SCHEME = /^(?:https?|blob|mailto|tel|ttu):/i;
const HAS_SCHEME = /^[a-z0-9.+-]*:/i;

/**
 * `data:` is allowed only where an image is expected — `data:text/html` and
 * `data:application/xhtml+xml` are script vectors. Anything else carrying a
 * scheme must be one we recognize; URLs with no scheme at all are relative
 * references and pass through.
 */
function isSafeUrl(value: string, allowDataImage: boolean): boolean {
  const url = value.replace(URL_NOISE, '');
  if (!url) return true;
  if (/^data:/i.test(url)) {
    return allowDataImage && /^data:image\//i.test(url);
  }
  if (HAS_SCHEME.test(url)) {
    return KNOWN_SAFE_SCHEME.test(url);
  }
  return true;
}

/** Attributes that legitimately hold an inline image payload. */
function expectsImage(tag: string, attr: string): boolean {
  return tag === 'img' || attr === 'poster' || attr === 'background' || attr === 'srcset';
}

const DANGEROUS_CSS = /expression\s*\(|url\s*\(\s*['"]?\s*(?:javascript|vbscript|data:text)/i;

/**
 * Inline styles referencing a script-capable URL or a legacy IE `expression()`
 * lose the whole attribute. Editing the offending declaration out invites
 * nested-paren games; a book losing one inline style is a fine price for not
 * having to be clever here.
 */
function isDangerousStyle(value: string): boolean {
  return DANGEROUS_CSS.test(value);
}

function sanitizeAttributes(el: Element, tag: string) {
  // Copy first: removing while iterating a live NamedNodeMap skips entries.
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    const value = attr.value;

    if (name.startsWith('on') || FORBIDDEN_ATTRS.has(name)) {
      el.removeAttribute(attr.name);
      continue;
    }

    if (name === 'style') {
      if (isDangerousStyle(value)) el.removeAttribute(attr.name);
      continue;
    }

    if (URL_LIST_ATTRS.has(name)) {
      // "url 2x, url 640w" — the URL is the first token of each entry.
      const bad = value
        .split(',')
        .some((entry) => !isSafeUrl(entry.trim().split(/\s+/)[0] || '', true));
      if (bad) el.removeAttribute(attr.name);
      continue;
    }

    if (URL_ATTRS.has(name) && !isSafeUrl(value, expectsImage(tag, name))) {
      el.removeAttribute(attr.name);
    }
  }

  // An anchor that survived with a target should not get a window handle back.
  if (tag === 'a' && el.hasAttribute('target')) {
    el.setAttribute('rel', 'noopener noreferrer');
  }
}

/**
 * `<style>` survives because some books put real layout CSS inline, but
 * `@import` pulls a remote sheet (IP leak, and a styling injection vector), so
 * those rules are cut while the rest of the sheet is kept.
 */
function sanitizeStyleSheet(el: Element) {
  const text = el.textContent || '';
  if (/@import/i.test(text)) {
    el.textContent = text.replace(/@import[^;]*;?/gi, '');
  }
}

/**
 * Sanitize a parsed subtree in place. Safe to call on nodes belonging to the
 * live document — nothing dangerous is left by the time it returns — but
 * prefer sanitizing before the markup ever reaches a live node.
 */
export function sanitizeElement(root: Element): Element {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const toRemove: Element[] = [];

  let node = walker.nextNode() as Element | null;
  while (node) {
    // localName, not tagName: inside SVG/MathML the case is preserved, so
    // `<foreignObject>` must not be matched case-sensitively.
    const tag = node.localName.toLowerCase();

    if (FORBIDDEN_TAGS.has(tag)) {
      toRemove.push(node);
    } else {
      sanitizeAttributes(node, tag);
      if (tag === 'style') sanitizeStyleSheet(node);
    }

    node = walker.nextNode() as Element | null;
  }

  for (const el of toRemove) el.remove();

  return root;
}

/** Build an inert holder — parsing there loads no resources and fires no handlers. */
function inertHolder(html: string): HTMLElement | null {
  try {
    if (typeof DOMParser === 'undefined') return null;
    const doc = new DOMParser().parseFromString(`<body><div>${html}</div></body>`, 'text/html');
    return (doc.body.firstElementChild as HTMLElement | null) ?? null;
  } catch {
    // A parser failure must not be able to hand back unsanitized markup; the
    // caller falls through to returning the input, which stays a string.
    return null;
  }
}

/**
 * Cheap pre-check so the common case — a book with no dangerous markup at all
 * — costs one regex pass instead of a full parse and re-serialize. Books run
 * to tens of megabytes, so this matters.
 */
const SUSPICIOUS_MARKUP =
  /<\s*\/?\s*(?:script|iframe|frame|frameset|object|embed|applet|base|form|input|button|textarea|select|noscript|template|meta|link|portal|foreignobject)\b|[\s/]on[a-z-]+\s*=|srcdoc|http-equiv|ping\s*=|expression\s*\(|@import/i;

/**
 * Browsers ignore control characters inside a URL, so `java&#9;script:x` runs
 * just as well as `javascript:x`. The pre-check has to tolerate that noise
 * between every letter or it waves the obfuscated form straight through.
 */
const NOISE = '[\\u0000-\\u0020\\u007f-\\u00a0]*';
const spaced = (word: string) => word.split('').join(NOISE);
const SCRIPT_SCHEME = new RegExp(
  `(?:${spaced('javascript')}|${spaced('vbscript')}|${spaced('data')})${NOISE}:`,
  'i'
);

/**
 * The pre-check reads raw source, where `java&#9;script:` is nine printable
 * characters — the control-character class above cannot see the tab until the
 * parser decodes the entity, so an entity-obfuscated scheme would sail past.
 * Rather than teach the regex every entity form, treat any `&` as "entities
 * are in play, parse it properly". Books that use no character references at
 * all still get the cheap path.
 */
function isDefinitelyClean(html: string): boolean {
  return !html.includes('&') && !SUSPICIOUS_MARKUP.test(html) && !SCRIPT_SCHEME.test(html);
}

/**
 * Sanitize an HTML string. Returns the input unchanged when it holds nothing
 * dangerous, or when parsing is unavailable (SSR / prerender), where the string
 * is inert anyway.
 *
 * Prefer `parseSanitized` when the result is headed straight for the DOM — it
 * skips the serialize/re-parse round trip this function is forced into.
 */
export function sanitizeHtml(html: string): string {
  if (!html || isDefinitelyClean(html)) return html;
  const holder = inertHolder(html);
  if (!holder) return html;
  sanitizeElement(holder);
  return holder.innerHTML;
}

/**
 * Parse untrusted HTML straight into a sanitized element owned by `targetDoc`.
 *
 * The string form has to serialize the cleaned tree and let the caller parse it
 * a second time; on a book that runs to tens of megabytes that doubles the
 * most expensive step in the load. Parsing once in an inert document and
 * importing the result keeps the "never parse untrusted markup in the live
 * document" property while doing strictly less work.
 *
 * Falls back to a plain `innerHTML` assignment only where `DOMParser` does not
 * exist (SSR / prerender), which is not a rendering context.
 */
export function parseSanitized(html: string, targetDoc: Document): HTMLElement {
  const holder = inertHolder(html);
  if (!holder) {
    const fallback = targetDoc.createElement('div');
    fallback.innerHTML = sanitizeHtml(html);
    return fallback;
  }
  sanitizeElement(holder);
  return targetDoc.importNode(holder, true) as HTMLElement;
}
