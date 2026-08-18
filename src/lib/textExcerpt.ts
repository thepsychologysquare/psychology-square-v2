// Turns a raw markdown body into a short plain-text preview for cards —
// used where we want to show a snippet of a written "Overview" section
// (assessments, worksheets) the same way article cards show a description.
// Falls back to a provided string (e.g. the frontmatter `description`) when
// the body is empty, so older/blank entries still render something.

export function getExcerpt(markdown: string | undefined | null, fallback: string, maxChars = 160): string {
  const source = (markdown || '').trim();
  if (!source) return fallback;

  const plain = source
    // Strip markdown images/links down to their visible text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Strip heading/emphasis/list/quote markers
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`~>]+/g, '')
    .replace(/^[-+]\s+/gm, '')
    // Collapse whitespace/newlines
    .replace(/\s+/g, ' ')
    .trim();

  if (!plain) return fallback;
  if (plain.length <= maxChars) return plain;

  const truncated = plain.slice(0, maxChars);
  const lastSpace = truncated.lastIndexOf(' ');
  return `${truncated.slice(0, lastSpace > 0 ? lastSpace : maxChars)}…`;
}
