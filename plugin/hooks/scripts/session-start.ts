#!/usr/bin/env bun

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadConfig, getProjectPath } from '../../src/shared/config.js';
import { startSession, readSession, reactivateSession } from '../../src/shared/session-store.js';
import { VaultManager } from '../../src/mcp-server/utils/vault.js';
import { getProjectInfo, readStdinJson } from './utils/helpers.js';
import { createLogger, logSessionIndex } from '../../src/shared/logger.js';
import type { SessionStartInput } from '../../src/shared/types.js';

async function main() {
  try {
    // Read JSON input from stdin
    const input = await readStdinJson<SessionStartInput>();

    const config = loadConfig();
    const logger = createLogger('session-start', input.session_id);

    logger.debug('Session start hook triggered', { session_id: input.session_id, cwd: input.cwd });

    // Get project info from git or directory
    const project = await getProjectInfo(input.cwd);

    if (!project) {
      logger.error('Cannot determine project from cwd', { cwd: input.cwd });
      return;
    }

    logger.debug('Project detected', { name: project.name, path: project.path, gitRemote: project.gitRemote });

    // Check if session already exists (resume scenario after stop event)
    const existingSession = readSession(input.session_id);

    if (existingSession) {
      // Session exists - handle based on status
      if (existingSession.status === 'stopped') {
        // Reactivate stopped session
        const reactivated = reactivateSession(input.session_id, project.name, input.cwd);
        if (reactivated) {
          logger.info(`Session reactivated for project: ${project.name}`);
        } else {
          logger.error('Failed to reactivate stopped session');
        }
      } else if (existingSession.status === 'active') {
        // Already active - just continue (no action needed)
        logger.debug('Session already active, continuing');
      } else if (existingSession.status === 'completed') {
        // Completed session - create a new one (same session_id, fresh start)
        // This handles the edge case where a completed session file wasn't cleaned up
        startSession(input.session_id, project.name, input.cwd);
        logger.info(`New session created (previous was completed) for project: ${project.name}`);
      }
    } else {
      // No existing session - create new one
      startSession(input.session_id, project.name, input.cwd);
      logger.info(`Session initialized for project: ${project.name}`);
    }

    // Log session index to MCP log for easy lookup
    logSessionIndex(input.session_id, project.name);

    // Ensure vault structure exists for this project
    const vault = new VaultManager(config.vault.path, config.vault.memFolder);
    await vault.ensureProjectStructure(project.name);

    // Detect and warn about legacy folders
    const projectPath = getProjectPath(project.name, config);
    const legacyKnowledgeFolder = path.join(projectPath, 'knowledge');
    const legacyFilesFolder = path.join(projectPath, 'files');
    if (fs.existsSync(legacyKnowledgeFolder) || fs.existsSync(legacyFilesFolder)) {
      logger.warn('Legacy folders detected (knowledge/ or files/). Please migrate files to research/ or patterns/', {
        knowledge_exists: fs.existsSync(legacyKnowledgeFolder),
        files_exists: fs.existsSync(legacyFilesFolder),
      });
    }

    // One-time migration: process any existing legacy pending files
    const pendingDir = path.join(os.homedir(), '.cc-obsidian-mem', 'pending');
    if (fs.existsSync(pendingDir)) {
      const pendingFiles = fs.readdirSync(pendingDir).filter(f => f.endsWith('.json'));
      logger.debug('Checking for legacy pending files', { pendingDir, count: pendingFiles.length });

      for (const filename of pendingFiles) {
        const filePath = path.join(pendingDir, filename);
        try {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          const items = Array.isArray(data.items) ? data.items : [];
          const projectHint = data.project_hint;

          // Skip if no project hint (matches main behavior)
          if (!projectHint) {
            logger.error(`Skipping legacy pending file ${filename}: no project_hint`);
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
              logger.error(`Dropping ${invalidItems.length} invalid items from ${filename}`);
            }

            if (validItems.length === 0) {
              logger.error(`No valid items in ${filename}, deleting`);
              fs.unlinkSync(filePath);
              continue;
            }

            // writeKnowledgeBatch automatically creates project structure via writeKnowledge
            const paths = await vault.writeKnowledgeBatch(validItems, projectHint);
            logger.info(`Migrated ${paths.length}/${validItems.length} items from ${filename}`);

            // Handle migration result
            if (paths.length === validItems.length) {
              // All items written - delete the file
              fs.unlinkSync(filePath);
            } else if (paths.length > 0) {
              // Partial success - delete file anyway (can't identify which failed)
              // Accepted data loss: writeKnowledgeBatch returns paths but not failure indices
              logger.error(`Partial migration for ${filename}, ${validItems.length - paths.length} items lost`);
              fs.unlinkSync(filePath);
            } else {
              // All items failed - retain file for debugging
              logger.error(`Migration failed for ${filename}, file retained`);
            }
          } else {
            // Empty pending file, just delete
            fs.unlinkSync(filePath);
          }
        } catch (error) {
          logger.error(`Failed to migrate ${filename}`, error instanceof Error ? error : undefined);
          // Don't delete on error - preserve for debugging
        }
      }
    }

    // If context injection is enabled, get relevant context from vault
    if (config.contextInjection.enabled) {
      logger.debug('Context injection enabled', {
        includeErrors: config.contextInjection.includeRelatedErrors,
        includeDecisions: true,
        includePatterns: config.contextInjection.includeProjectPatterns,
        maxTokens: config.contextInjection.maxTokens,
      });

      try {
        // Build limitResults based on include* flags
        const limitResults: { errors?: number; decisions?: number; patterns?: number } = {};
        if (config.contextInjection.includeRelatedErrors) {
          limitResults.errors = 3;
        }
        limitResults.decisions = 2;
        if (config.contextInjection.includeProjectPatterns) {
          limitResults.patterns = 2;
        }

        const context = await vault.getProjectContext(project.name, {
          includeErrors: config.contextInjection.includeRelatedErrors,
          includeDecisions: true,
          includePatterns: config.contextInjection.includeProjectPatterns,
          limitResults,
        });

        logger.debug('Project context retrieved', {
          errorsCount: context.unresolvedErrors.length,
          decisionsCount: context.activeDecisions.length,
          patternsCount: context.patterns.length,
        });

        // Format and output context if there's anything useful
        const formatted = formatProjectContext(context, config.contextInjection.maxTokens);
        if (formatted) {
          console.log(formatted);
          logger.info('Context injected into session');
        }
      } catch (error) {
        logger.error('Failed to inject context', error instanceof Error ? error : undefined);
        // Silently skip context injection on error
      }
    } else {
      logger.debug('Context injection disabled in config');
    }
  } catch (error) {
    // Silently fail to not break Claude Code (don't use logger here, might not be initialized)
    console.error('Session start hook error:', error);
  }
}

/**
 * Format project context for output
 * Two-layer budget: 1) Fixed item limits (3/2/2) for typical case, 2) maxTokens truncation for edge cases with long content
 */
function formatProjectContext(
  context: Awaited<ReturnType<VaultManager['getProjectContext']>>,
  maxTokens: number
): string {
  const lines: string[] = [];

  // Add header
  lines.push(`<!-- Memory context for ${context.project} -->`);

  // Unresolved errors (with safe fallbacks)
  const totalErrors = context.totalErrorCount ?? context.unresolvedErrors.length;
  if (totalErrors > 0 && context.unresolvedErrors.length > 0) {
    const showCount = totalErrors > context.unresolvedErrors.length;
    lines.push(
      showCount
        ? `\n## Known Issues (${totalErrors} total, showing ${context.unresolvedErrors.length} most recent)`
        : `\n## Known Issues`
    );
    for (const error of context.unresolvedErrors) {
      lines.push(`- **${error.type}**: ${error.message}`);
    }
  }

  // Active decisions (with safe fallbacks)
  const totalDecisions = context.totalDecisionCount ?? context.activeDecisions.length;
  if (totalDecisions > 0 && context.activeDecisions.length > 0) {
    const showCount = totalDecisions > context.activeDecisions.length;
    lines.push(
      showCount
        ? `\n## Active Decisions (${totalDecisions} total, showing ${context.activeDecisions.length} most recent)`
        : `\n## Active Decisions`
    );
    for (const decision of context.activeDecisions) {
      lines.push(`- **${decision.title}**: ${decision.decision}`);
    }
  }

  // Patterns (with safe fallbacks)
  const totalPatterns = context.totalPatternCount ?? context.patterns.length;
  if (totalPatterns > 0 && context.patterns.length > 0) {
    const showCount = totalPatterns > context.patterns.length;
    lines.push(
      showCount
        ? `\n## Patterns (${totalPatterns} total, showing ${context.patterns.length})`
        : `\n## Patterns`
    );
    for (const pattern of context.patterns) {
      lines.push(`- **${pattern.name}**: ${pattern.description}`);
    }
  }

  // Add prompt to use mem_search for full details if anything was shown
  if (lines.length > 1) {
    lines.push('\nUse `mem_search` for full details on any of these items.');
  }

  const output = lines.join('\n');

  // Preserve maxTokens truncation safeguard (rough estimate: 4 chars per token)
  if (output.length > maxTokens * 4) {
    return output.substring(0, maxTokens * 4) + '\n...';
  }

  return output;
}

main();
