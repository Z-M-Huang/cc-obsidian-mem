import matter from 'gray-matter';
import type { NoteFrontmatter } from '../../shared/types.js';
import { sanitizeProjectName } from '../../shared/config.js';

/**
 * Parse markdown content with YAML frontmatter
 */
export function parseFrontmatter(content: string): {
  frontmatter: NoteFrontmatter;
  content: string;
} {
  const parsed = matter(content);

  const frontmatter: NoteFrontmatter = {
    type: parsed.data.type || 'learning',
    title: parsed.data.title,
    project: parsed.data.project,
    created: parsed.data.created || new Date().toISOString(),
    updated: parsed.data.updated || new Date().toISOString(),
    tags: parsed.data.tags || [],
    aliases: parsed.data.aliases,
    ...parsed.data,
  };

  return {
    frontmatter,
    content: parsed.content,
  };
}

/**
 * Stringify frontmatter and content back to markdown
 */
export function stringifyFrontmatter(
  frontmatter: NoteFrontmatter,
  content: string
): string {
  // Update the updated timestamp and filter out undefined values
  const fm: Record<string, unknown> = {
    ...frontmatter,
    updated: new Date().toISOString(),
  };

  // Remove undefined values to prevent YAML serialization errors
  for (const key of Object.keys(fm)) {
    if (fm[key] === undefined) {
      delete fm[key];
    }
  }

  return matter.stringify(content, fm);
}

/**
 * Extract title from markdown content (first H1)
 */
export function extractTitle(content: string): string | undefined {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : undefined;
}

/**
 * Generate frontmatter for a new note
 */
export function generateFrontmatter(
  type: NoteFrontmatter['type'],
  options: {
    title?: string;
    project?: string;
    tags?: string[];
    aliases?: string[];
    additional?: Record<string, unknown>;
  } = {}
): NoteFrontmatter {
  const now = new Date().toISOString();

  const tags = options.tags || [];
  if (!tags.includes(type)) {
    tags.unshift(type);
  }
  if (options.project && !tags.some(t => t.startsWith('project/'))) {
    // Sanitize project name for valid tag format
    tags.push(`project/${sanitizeProjectName(options.project)}`);
  }

  return {
    type,
    title: options.title,
    project: options.project,
    created: now,
    updated: now,
    tags,
    aliases: options.aliases,
    ...options.additional,
  };
}

/**
 * Merge additional properties into existing frontmatter
 */
export function mergeFrontmatter(
  existing: NoteFrontmatter,
  updates: Partial<NoteFrontmatter>
): NoteFrontmatter {
  const merged = { ...existing, ...updates };

  // Merge tags if both exist
  if (updates.tags && existing.tags) {
    const uniqueTags = new Set([...existing.tags, ...updates.tags]);
    merged.tags = Array.from(uniqueTags);
  }

  // Merge aliases if both exist
  if (updates.aliases && existing.aliases) {
    const uniqueAliases = new Set([...existing.aliases, ...updates.aliases]);
    merged.aliases = Array.from(uniqueAliases);
  }

  merged.updated = new Date().toISOString();

  return merged;
}

/**
 * Convert frontmatter to Dataview-compatible inline fields
 */
export function toInlineFields(frontmatter: NoteFrontmatter): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      lines.push(`${key}:: ${value.join(', ')}`);
    } else if (typeof value === 'object') {
      lines.push(`${key}:: ${JSON.stringify(value)}`);
    } else {
      lines.push(`${key}:: ${value}`);
    }
  }

  return lines.join('\n');
}
