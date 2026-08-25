// Shared "plain text or light HTML, safely rendered" helper. Used anywhere
// an admin types free-form content into a textarea and it needs to reach
// the public site as real HTML: course lesson bodies (src/lib/courseBuilder.ts)
// and workshop details (src/pages/workshops/[slug].astro).
//
// Deliberately NOT a full markdown/rich-text editor -- this keeps the admin
// UI a plain <textarea> while still letting content authors add semantic
// structure (subheadings, lists, emphasis) when they want SEO-meaningful
// markup instead of a wall of paragraphs.

// Tags content is allowed to use when it already contains real HTML.
// Anything else gets stripped, attributes included, so a compromised or
// careless content source can't inject scripts, styles, or event handlers.
//
// Note: intentionally no 'h1' -- the page itself already renders exactly one
// <h1> (the title), and a second h1 competing with it is a well-known
// on-page SEO foot-gun. 'h2'/'h3'/'h4' give authors real heading structure
// to work with instead.
const ALLOWED_TAGS = new Set([
  'p', 'h2', 'h3', 'h4', 'em', 'strong', 'b', 'i', 'ul', 'ol', 'li', 'br', 'blockquote',
]);

// True if the text already looks like it contains real HTML block/inline
// tags (as opposed to plain text that just happens to contain a literal
// "<" character).
function looksLikeHtml(text: string): boolean {
  return /<\s*(p|h[1-6]|ul|ol|li|em|strong|b|i|br|blockquote)(\s|>|\/)/i.test(text);
}

// Strips <script>/<style> blocks entirely (tag + contents), then strips
// every tag not on the allow-list (keeping its inner text) and strips all
// attributes from tags that are kept -- so even trusted content can't
// smuggle in onclick handlers, style overrides, etc.
function sanitizeHtml(html: string): string {
  let out = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
  out = out.replace(/<\/?([a-zA-Z0-9]+)[^>]*>/g, (match, tag) => {
    const lower = String(tag).toLowerCase();
    if (!ALLOWED_TAGS.has(lower)) return '';
    return match.startsWith('</') ? `</${lower}>` : `<${lower}>`;
  });
  return out;
}

// Renders content stored as plain text typed into a dashboard textarea.
// Handles two cases:
// 1. Plain text (no HTML tags) -- escaped, then blank-line-separated blocks
//    become paragraphs and single newlines become <br>. This is the
//    original dependency-free behavior and needs no authoring know-how.
// 2. Content that already contains real HTML (an author typed <h2>/<ul>/etc,
//    or it came from an automation pipeline) -- passed through the
//    allow-list sanitizer instead of being escaped, so it renders as actual
//    formatted, semantically-structured HTML.
export function textToHtml(text: string): string {
  if (looksLikeHtml(text)) {
    return sanitizeHtml(text);
  }
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${escape(block.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}
