export interface TemplateTokens {
  readonly source: string;
  /** 1-based panel index. */
  readonly n: number;
  readonly total: number;
  readonly label: string;
}

/** Lowercase, filesystem-safe slug. Keeps unicode letters, digits, `_` and `-`. */
export function sanitize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function safeFileName(name: string): string {
  return sanitize(name.replace(/\.[^./]+$/, '')) || 'image';
}

/** Render a filename template with {source}, {n} and {label}. Unknown tokens render empty. */
export function applyTemplate(template: string, tokens: TemplateTokens): string {
  const index = String(tokens.n).padStart(Math.max(2, String(tokens.total).length), '0');
  const rendered = template
    .replace(/\{source\}/g, safeFileName(tokens.source))
    .replace(/\{n\}/g, index)
    .replace(/\{label\}/g, sanitize(tokens.label))
    .replace(/\{[^}]*\}/g, '');
  return sanitize(rendered) || index;
}

/** Suffix duplicates with -2, -3, ... (case-insensitive, since most filesystems are). */
export function uniqueNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map(name => {
    let candidate = name;
    for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `${name}-${i}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}
