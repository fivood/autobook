/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Allowlist sanitizer for book HTML.
 *
 * Every format we support (EPUB, HTMLZ, MOBI, Markdown) ultimately hands us
 * HTML written by whoever produced the file, and that HTML is injected into
 * the reader with `innerHTML` inside a Tauri webview that has real filesystem
 * and IPC access. `<script>` doesn't execute through innerHTML, but event
 * handler attributes (`onerror`, `onload`, ...), `javascript:` URLs and
 * `<iframe srcdoc>` do — which is enough to run arbitrary code with the
 * app's privileges. So we strip them.
 *
 * Two entry points:
 *   - `sanitizeElement(root)` when you already hold a parsed subtree.
 *   - `sanitizeHtml(html)` for a string; parses into an INERT document where
 *     images never load and handlers never fire, sanitizes there, and returns
 *     the safe string.
 *
 * There is no tag allowlist: ebooks use a lot of markup and dropping
 * unknown-but-harmless tags would mangle real books. What matters is the
 * element denylist (script-ish and embedding tags) plus the attribute rules,
 * which are strict — an element we've never heard of can't do anything
 * dangerous once its handlers and URLs are cleaned.
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
  // HTML escape hatch inside SVG — an <img onerror> can hide in here.
  'foreignobject',
  // A book has no business setting http-equiv refresh or pulling remote CSS.
  'meta',
  'link'
]);

/** Attributes carrying a URL that has to be scheme-checked. */
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'poster', 'data']);

/** Attributes stripped regardless of value. */
const FORBIDDEN_ATTRS = new Set(['srcdoc', 'http-equiv', 'ping', 'formaction']);

/**
 * Control characters and whitespace are stripped before the scheme check —
 * `java\tscript:alert(1)` is a valid URL to the browser but slips past a
 * naive prefix test.
 */
// eslint-disable-next-line no-control-regex
const URL_NOISE = /[\u0000-\u0020\u007f-\u00a0]/g;

const KNOWN_SAFE_SCHEME = /^(?:https?|blob|mailto|tel|ttu):/i;
const HAS_SCHEME = /^[a-z0-9.+-]*:/i;

/**
 * `data:` is allowed only for images — `data:text/html` is a script vector.
 * Anything else carrying a scheme must be one we recognize; URLs with no
 * scheme at all are relative references and pass through.
 */
function isSafeUrl(value: string, tagName: string): boolean {
  const url = value.replace(URL_NOISE, '');
  if (!url) return true;
  if (/^data:/i.test(url)) {
    return tagName === 'img' && /^data:image\//i.test(url);
  }
  if (HAS_SCHEME.test(url)) {
    return KNOWN_SAFE_SCHEME.test(url);
  }
  return true;
}

const DANGEROUS_CSS = /expression\s*\(|url\s*\(\s*['"]?\s*(?:javascript|vbscript|data:text)/i;

/**
 * Inline styles that reference a script-capable URL or a legacy IE
 * `expression()` lose the whole attribute. Surgically editing the declaration
 * out invites nested-paren games; a book losing one inline style is a fine
 * price for not having to be clever here.
 */
function isDangerousStyle(value: string): boolean {
  return DANGEROUS_CSS.test(value);
}

function sanitizeAttributes(el: Element, tag: string) {
  // Copy the list first: removing while iterating a live NamedNodeMap skips entries.
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

    if (URL_ATTRS.has(name) && !isSafeUrl(value, tag)) {
      el.removeAttribute(attr.name);
    }
  }

  // An anchor that survived with a target should not get a window handle back.
  if (tag === 'a' && el.hasAttribute('target')) {
    el.setAttribute('rel', 'noopener noreferrer');
  }
}

/**
 * Sanitize a parsed subtree in place. Safe to call on nodes belonging to the
 * live document — by the time it returns nothing dangerous is left — but
 * prefer sanitizing before the markup ever reaches a live node.
 */
export function sanitizeElement(root: Element): Element {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const toRemove: Element[] = [];

  let node = walker.nextNode() as Element | null;
  while (node) {
    // localName rather than tagName: inside SVG/MathML the case is preserved,
    // so `<foreignObject>` must not be matched case-sensitively.
    const tag = node.localName.toLowerCase();

    if (FORBIDDEN_TAGS.has(tag)) {
      toRemove.push(node);
    } else {
      sanitizeAttributes(node, tag);
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
    return null;
  }
}

/**
 * Cheap pre-check so the common case — a book with no dangerous markup at all
 * — costs one regex pass instead of a full parse and re-serialize. Books run
 * to tens of megabytes, so this matters.
 */
const SUSPICIOUS_MARKUP =
  /<\s*\/?\s*(?:script|iframe|frame|frameset|object|embed|applet|base|form|input|button|textarea|select|noscript|template|meta|link|portal|foreignobject)\b|[\s/]on[a-z-]+\s*=|srcdoc|expression\s*\(/i;

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
 * Sanitize an HTML string. Returns the input unchanged when it holds nothing
 * dangerous, or when parsing isn't available (SSR / prerender), where the
 * string is inert anyway.
 */
export function sanitizeHtml(html: string): string {
  if (!html || (!SUSPICIOUS_MARKUP.test(html) && !SCRIPT_SCHEME.test(html))) return html;
  const holder = inertHolder(html);
  if (!holder) return html;
  sanitizeElement(holder);
  return holder.innerHTML;
}
