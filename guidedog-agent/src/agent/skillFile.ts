/**
 * SKILL.md parsing / serialization for the experience library.
 *
 * File format (Anthropic Agent Skills style, zero-dependency subset):
 *
 *   ---
 *   name: <slug>
 *   description: <one line>
 *   ---
 *   <markdown body>
 *
 * Only `name` and `description` are read from the frontmatter; every other
 * key is ignored so hand-edited files with extra fields stay parseable.
 */

export interface ParsedSkillMarkdown {
  name: string;
  description: string;
  body: string;
}

export interface SkillMarkdownInput {
  name: string;
  description: string;
  body: string;
}

export const SKILL_NAME_MAX_LENGTH = 30;

/**
 * Name used as both the directory name and the read_skill lookup key.
 * Chinese (CJK basic block), ASCII letters/digits, space, `-` and `_` are
 * allowed; 1–30 characters after trimming.
 */
export function isValidSkillName(name: string): boolean {
  const trimmed = name.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= SKILL_NAME_MAX_LENGTH &&
    /^[\u4e00-\u9fa5A-Za-z0-9_\- ]+$/.test(trimmed)
  );
}

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

/**
 * Parses a SKILL.md document. Returns null for an empty document or one
 * whose frontmatter lacks a valid name (damaged files are skipped by the
 * store rather than crashing the library load).
 */
export function parseSkillMarkdown(content: string): ParsedSkillMarkdown | null {
  const match = FRONTMATTER_RE.exec(content);
  if (!match) return null;

  const fields: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && value) fields[key] = value;
  }

  const name = (fields.name ?? '').trim();
  if (!isValidSkillName(name)) return null;
  const description = (fields.description ?? '').trim();
  const body = content.slice(match[0].length).trim();
  return { name, description, body };
}

/** Serializes a skill document into the canonical SKILL.md text. */
export function serializeSkillMarkdown(input: SkillMarkdownInput): string {
  return `---\nname: ${input.name}\ndescription: ${input.description}\n---\n\n${input.body}\n`;
}
