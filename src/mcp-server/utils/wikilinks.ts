import * as path from 'path';

/**
 * Create a wikilink to a note
 */
export function wikilink(notePath: string, displayText?: string): string {
  const name = path.basename(notePath, '.md');
  if (displayText) {
    return `[[${name}|${displayText}]]`;
  }
  return `[[${name}]]`;
}

/**
 * Create a wikilink to a heading in a note
 */
export function wikilinkHeading(
  notePath: string,
  heading: string,
  displayText?: string
): string {
  const name = path.basename(notePath, '.md');
  const link = `${name}#${heading}`;
  if (displayText) {
    return `[[${link}|${displayText}]]`;
  }
  return `[[${link}]]`;
}

/**
 * Create a wikilink to a block in a note
 */
export function wikilinkBlock(
  notePath: string,
  blockId: string,
  displayText?: string
): string {
  const name = path.basename(notePath, '.md');
  const link = `${name}#^${blockId}`;
  if (displayText) {
    return `[[${link}|${displayText}]]`;
  }
  return `[[${link}]]`;
}

/**
 * Create an embedded wikilink (transclusion)
 */
export function embed(notePath: string): string {
  const name = path.basename(notePath, '.md');
  return `![[${name}]]`;
}

/**
 * Create an embedded heading (transclusion)
 */
export function embedHeading(notePath: string, heading: string): string {
  const name = path.basename(notePath, '.md');
  return `![[${name}#${heading}]]`;
}

/**
 * Create an embedded block (transclusion)
 */
export function embedBlock(notePath: string, blockId: string): string {
  const name = path.basename(notePath, '.md');
  return `![[${name}#^${blockId}]]`;
}

/**
 * Generate a unique block ID
 */
export function generateBlockId(prefix = 'obs'): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Extract wikilinks from markdown content
 */
export function extractWikilinks(content: string): Array<{
  link: string;
  displayText?: string;
  isEmbed: boolean;
  heading?: string;
  blockId?: string;
}> {
  const regex = /(!?)\[\[([^\]|#]+)(?:#([^^|\]]+))?(?:\^([^|\]]+))?(?:\|([^\]]+))?\]\]/g;
  const links: Array<{
    link: string;
    displayText?: string;
    isEmbed: boolean;
    heading?: string;
    blockId?: string;
  }> = [];

  let match;
  while ((match = regex.exec(content)) !== null) {
    links.push({
      isEmbed: match[1] === '!',
      link: match[2],
      heading: match[3],
      blockId: match[4],
      displayText: match[5],
    });
  }

  return links;
}

/**
 * Replace wikilinks with markdown links (for export)
 */
export function wikilinkToMarkdown(
  content: string,
  basePath: string
): string {
  return content.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_, link, displayText) => {
      const text = displayText || link;
      const href = path.join(basePath, `${link}.md`);
      return `[${text}](${href})`;
    }
  );
}

/**
 * Create a tag
 */
export function tag(name: string): string {
  // Remove any leading # and sanitize
  const sanitized = name
    .replace(/^#/, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9-_/]/g, '');
  return `#${sanitized}`;
}

/**
 * Create a nested tag
 */
export function nestedTag(...parts: string[]): string {
  return tag(parts.join('/'));
}

/**
 * Extract tags from markdown content
 */
export function extractTags(content: string): string[] {
  const regex = /#([a-zA-Z0-9-_/]+)/g;
  const tags: string[] = [];

  let match;
  while ((match = regex.exec(content)) !== null) {
    // Avoid matching hex colors
    if (!/^[0-9a-fA-F]{6}$/.test(match[1])) {
      tags.push(match[1]);
    }
  }

  return [...new Set(tags)];
}
