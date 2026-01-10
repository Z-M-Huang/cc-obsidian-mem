#!/usr/bin/env bun

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

    // If context injection is enabled, get relevant context from vault
    if (config.contextInjection.enabled) {
      try {
        const context = await vault.getProjectContext(project.name, {
          includeRecentSessions: config.contextInjection.includeRecentSessions,
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

  // Recent sessions
  if (context.recentSessions.length > 0) {
    lines.push('\n## Recent Sessions');
    for (const session of context.recentSessions.slice(0, 3)) {
      lines.push(`- **${session.date}**: ${session.summary || 'No summary'}`);
    }
  }

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
