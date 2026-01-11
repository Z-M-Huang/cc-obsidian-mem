#!/usr/bin/env bun

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadConfig } from '../../src/shared/config.js';
import { startSession } from '../../src/shared/session-store.js';
import { VaultManager } from '../../src/mcp-server/utils/vault.js';
import { getProjectInfo, readStdinJson } from './utils/helpers.js';
import type { SessionStartInput } from '../../src/shared/types.js';

async function main() {
  try {
    // Read JSON input from stdin
    const input = await readStdinJson<SessionStartInput>();

    const config = loadConfig();

    // Get project info from git or directory
    const project = await getProjectInfo(input.cwd);

    // Initialize session in file store
    startSession(input.session_id, project.name, input.cwd);

    // Ensure vault structure exists for this project
    const vault = new VaultManager(config.vault.path, config.vault.memFolder);
    await vault.ensureProjectStructure(project.name);

    // One-time migration: process any existing legacy pending files
    const pendingDir = path.join(os.homedir(), '.cc-obsidian-mem', 'pending');
    if (fs.existsSync(pendingDir)) {
      const pendingFiles = fs.readdirSync(pendingDir).filter(f => f.endsWith('.json'));

      for (const filename of pendingFiles) {
        const filePath = path.join(pendingDir, filename);
        try {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          const items = Array.isArray(data.items) ? data.items : [];
          const projectHint = data.project_hint;

          // Skip if no project hint (matches main behavior)
          if (!projectHint) {
            console.error(`[cc-obsidian-mem] Skipping legacy pending file ${filename}: no project_hint`);
            fs.unlinkSync(filePath);
            continue;
          }

          if (items.length > 0) {
            // Valid knowledge types
            const VALID_TYPES = ['qa', 'explanation', 'decision', 'research', 'learning'];

            // Filter and map valid items
            const validItems: Array<{
              type: 'qa' | 'explanation' | 'decision' | 'research' | 'learning';
              title: string;
              context: string;
              content: string;
              keyPoints: string[];
              topics: string[];
              sourceSession?: string;
            }> = [];
            const invalidItems: Array<unknown> = [];

            for (const item of items) {
              const typeStr = typeof item.type === 'string' ? item.type.trim().toLowerCase() : '';
              const titleStr = typeof item.title === 'string' ? item.title : '';
              const contentStr = typeof item.content === 'string' ? item.content : '';
              const hasRequiredFields = typeStr && titleStr && contentStr;
              const hasValidType = VALID_TYPES.includes(typeStr);

              if (hasRequiredFields && hasValidType) {
                // Filter arrays to only string items to prevent writeKnowledge failures
                const keyPoints = Array.isArray(item.keyPoints)
                  ? item.keyPoints.filter((k: unknown) => typeof k === 'string')
                  : [];
                const topics = Array.isArray(item.topics)
                  ? item.topics.filter((t: unknown) => typeof t === 'string')
                  : [];

                validItems.push({
                  type: typeStr as 'qa' | 'explanation' | 'decision' | 'research' | 'learning',
                  title: titleStr,
                  context: typeof item.context === 'string' ? item.context : '',
                  content: contentStr,
                  keyPoints,
                  topics,
                  sourceSession: item.sourceSession,
                });
              } else {
                invalidItems.push(item);
              }
            }

            // Log invalid items
            if (invalidItems.length > 0) {
              console.error(`[cc-obsidian-mem] Dropping ${invalidItems.length} invalid items from ${filename}`);
            }

            if (validItems.length === 0) {
              console.error(`[cc-obsidian-mem] No valid items in ${filename}, deleting`);
              fs.unlinkSync(filePath);
              continue;
            }

            // writeKnowledgeBatch automatically creates project structure via writeKnowledge
            const paths = await vault.writeKnowledgeBatch(validItems, projectHint);
            console.error(`[cc-obsidian-mem] Migrated ${paths.length}/${validItems.length} items from ${filename}`);

            // Handle migration result
            if (paths.length === validItems.length) {
              // All items written - delete the file
              fs.unlinkSync(filePath);
            } else if (paths.length > 0) {
              // Partial success - delete file anyway (can't identify which failed)
              // Accepted data loss: writeKnowledgeBatch returns paths but not failure indices
              console.error(`[cc-obsidian-mem] Partial migration for ${filename}, ${validItems.length - paths.length} items lost`);
              fs.unlinkSync(filePath);
            } else {
              // All items failed - retain file for debugging
              console.error(`[cc-obsidian-mem] Migration failed for ${filename}, file retained`);
            }
          } else {
            // Empty pending file, just delete
            fs.unlinkSync(filePath);
          }
        } catch (error) {
          console.error(`[cc-obsidian-mem] Failed to migrate ${filename}:`, error);
          // Don't delete on error - preserve for debugging
        }
      }
    }

    // If context injection is enabled, get relevant context from vault
    if (config.contextInjection.enabled) {
      try {
        const context = await vault.getProjectContext(project.name, {
          includeErrors: config.contextInjection.includeRelatedErrors,
          includeDecisions: true,
          includePatterns: config.contextInjection.includeProjectPatterns,
        });

        // Format and output context if there's anything useful
        const formatted = formatProjectContext(context, config.contextInjection.maxTokens);
        if (formatted) {
          console.log(formatted);
        }
      } catch {
        // Silently skip context injection on error
      }
    }
  } catch (error) {
    // Silently fail to not break Claude Code
    console.error('Session start hook error:', error);
  }
}

/**
 * Format project context for output
 */
function formatProjectContext(
  context: Awaited<ReturnType<VaultManager['getProjectContext']>>,
  maxTokens: number
): string {
  const lines: string[] = [];

  // Add header
  lines.push(`<!-- Memory context for ${context.project} -->`);

  // Unresolved errors
  if (context.unresolvedErrors.length > 0) {
    lines.push('\n## Known Issues');
    for (const error of context.unresolvedErrors.slice(0, 5)) {
      lines.push(`- **${error.type}**: ${error.message}`);
    }
  }

  // Active decisions
  if (context.activeDecisions.length > 0) {
    lines.push('\n## Active Decisions');
    for (const decision of context.activeDecisions.slice(0, 3)) {
      lines.push(`- **${decision.title}**: ${decision.decision}`);
    }
  }

  // Patterns
  if (context.patterns.length > 0) {
    lines.push('\n## Patterns');
    for (const pattern of context.patterns.slice(0, 3)) {
      lines.push(`- **${pattern.name}**: ${pattern.description}`);
    }
  }

  const output = lines.join('\n');

  // Rough token estimate (4 chars per token)
  if (output.length > maxTokens * 4) {
    return output.substring(0, maxTokens * 4) + '\n...';
  }

  return output;
}

main();
