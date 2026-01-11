/**
 * Pending Knowledge Utilities
 *
 * Manages a staging area for extracted knowledge items that need to be
 * written to the vault. This separates AI extraction (background) from
 * vault writes (frontend via MCP).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const PENDING_DIR = path.join(os.homedir(), '.cc-obsidian-mem', 'pending');

export interface PendingItem {
  type: 'qa' | 'explanation' | 'decision' | 'research' | 'learning';
  title: string;
  context: string;
  content: string;
  keyPoints: string[];
  topics: string[];
  sourceSession?: string; // Session ID for provenance tracking
}

interface PendingFile {
  session_id: string;
  created_at: string;
  updated_at: string;
  project_hint?: string; // Detected project (may be wrong, for reference only)
  items: PendingItem[];
}

/**
 * Sanitize session ID for safe file path usage
 * Only allows alphanumeric, hyphens, and underscores
 */
function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9\-_]/g, '_').substring(0, 100);
}

/**
 * Ensure the pending directory exists
 */
export function ensurePendingDir(): void {
  if (!fs.existsSync(PENDING_DIR)) {
    fs.mkdirSync(PENDING_DIR, { recursive: true });
  }
}

/**
 * Write pending items for a session (appends to existing items)
 * Note: Not lock-protected, but concurrent writes are rare (only on /compact)
 */
export function writePending(sessionId: string, items: PendingItem[], projectHint?: string): void {
  ensurePendingDir();
  const safeId = sanitizeSessionId(sessionId);
  const filePath = path.join(PENDING_DIR, `${safeId}.json`);

  // Read existing items to append
  let existingItems: PendingItem[] = [];
  let createdAt = new Date().toISOString();

  if (fs.existsSync(filePath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as PendingFile;
      // Defensive: ensure existing.items is a valid array before spreading
      existingItems = Array.isArray(existing.items) ? existing.items : [];
      createdAt = existing.created_at || createdAt;
    } catch {
      // If parse fails, start fresh
    }
  }

  const file: PendingFile = {
    session_id: sessionId,
    created_at: createdAt,
    updated_at: new Date().toISOString(),
    project_hint: projectHint,
    items: [...existingItems, ...items],
  };

  fs.writeFileSync(filePath, JSON.stringify(file, null, 2));
}

/**
 * Read pending file for a session (returns full file including project_hint)
 */
export function readPendingFile(sessionId: string): PendingFile | null {
  const safeId = sanitizeSessionId(sessionId);
  const filePath = path.join(PENDING_DIR, `${safeId}.json`);
  if (!fs.existsSync(filePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as PendingFile;
  } catch {
    return null;
  }
}

/**
 * Read pending items for a session
 */
export function readPending(sessionId: string): PendingItem[] | null {
  const file = readPendingFile(sessionId);
  return file?.items || null;
}

/**
 * Clear pending items for a session
 */
export function clearPending(sessionId: string): void {
  const safeId = sanitizeSessionId(sessionId);
  const filePath = path.join(PENDING_DIR, `${safeId}.json`);
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Ignore if doesn't exist
  }
}

/**
 * Format pending items for injection into Claude conversation
 * Includes full content so Claude can write via mem_write_knowledge
 */
export function formatPendingForInjection(items: PendingItem[], projectHint?: string): string {
  if (items.length === 0) return '';

  const lines = [
    '<!-- Pending knowledge from background summarization -->',
    '',
    `**${items.length} Knowledge Item${items.length > 1 ? 's' : ''} Ready to Save:**`,
    '',
  ];

  if (projectHint) {
    lines.push(`> Suggested project: \`${projectHint}\` (from session detection - please confirm)`);
    lines.push('');
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    // Defensive: ensure keyPoints and topics are arrays (AI output may be malformed)
    const keyPoints = Array.isArray(item.keyPoints) ? item.keyPoints : [];
    const topics = Array.isArray(item.topics) ? item.topics : [];

    lines.push(`### ${i + 1}. [${item.type}] ${item.title}`);
    lines.push('');
    lines.push(`**Context:** ${item.context || 'N/A'}`);
    lines.push('');
    lines.push(`**Content:**`);
    lines.push(item.content || '_No content_');
    lines.push('');
    if (keyPoints.length > 0) {
      lines.push(`**Key Points:**`);
      for (const point of keyPoints) {
        lines.push(`- ${point}`);
      }
      lines.push('');
    }
    if (topics.length > 0) {
      lines.push(`**Topics:** ${topics.join(', ')}`);
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  lines.push('Please use `mem_write_knowledge` to save each item to the vault.');
  lines.push('For each item, call `mem_write_knowledge` with: `type`, `title`, `context`, `content`, `project`');
  lines.push('Optional: `keyPoints`, `topics`, `sourceSession`');

  return lines.join('\n');
}
