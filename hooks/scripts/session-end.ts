#!/usr/bin/env bun

import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, sanitizeProjectName } from '../../src/shared/config.js';
import { endSession, readSession, clearSessionFile } from '../../src/shared/session-store.js';
import { VaultManager } from '../../src/mcp-server/utils/vault.js';
import { readStdinJson } from './utils/helpers.js';
import type { SessionEndInput, Session, Observation } from '../../src/shared/types.js';
import Anthropic from '@anthropic-ai/sdk';

async function main() {
  try {
    const args = process.argv.slice(2);
    const endType = (args.find(a => a.startsWith('--type='))?.split('=')[1] || 'end') as 'stop' | 'end';

    const input = await readStdinJson<SessionEndInput>();
    const config = loadConfig();

    // Validate session_id from input
    if (!input.session_id) {
      console.error('No session_id provided');
      return;
    }

    // Verify session exists and belongs to this session_id
    const existingSession = readSession(input.session_id);
    if (!existingSession) {
      console.error(`Session not found: ${input.session_id}`);
      return;
    }

    // End the specific session by ID
    const session = endSession(input.session_id, endType);
    if (!session) {
      return;
    }

    // Generate AI summary if enabled
    if (config.summarization.enabled && config.summarization.sessionSummary) {
      try {
        const summary = await generateSessionSummary(session, config);
        if (summary) {
          session.summary = summary;
        }
      } catch (error) {
        console.error('Failed to generate summary:', error);
      }

      // Extract and persist decisions if enabled
      if (config.capture.decisions) {
        try {
          const decisions = await extractDecisions(session, config);
          if (decisions.length > 0) {
            await persistDecisions(decisions, session, config);
          }
        } catch (error) {
          console.error('Failed to extract decisions:', error);
        }
      }
    }

    // Persist session to vault (always persist, even for 'stop')
    await persistSession(session, config);

    // Clear the session file after successful persistence
    clearSessionFile(input.session_id);
  } catch (error) {
    // Silently fail to not break Claude Code
    console.error('Session end hook error:', error);
  }
}

/**
 * Generate an AI summary of the session
 */
async function generateSessionSummary(
  session: Session,
  config: ReturnType<typeof loadConfig>
): Promise<string> {
  const apiKey = process.env[config.summarization.apiKeyEnvVar];
  if (!apiKey) {
    return '';
  }

  const client = new Anthropic({ apiKey });

  const prompt = `Summarize this coding session in 2-3 sentences. Focus on what was accomplished, any significant decisions made, and any problems encountered.

Session Info:
- Project: ${session.project}
- Duration: ${session.durationMinutes || 0} minutes
- Files modified: ${session.filesModified.length}
- Commands run: ${session.commandsRun}
- Errors encountered: ${session.errorsEncountered}

Key Actions:
${session.observations.slice(0, 20).map(obs => `- ${obs.type}: ${briefObservation(obs)}`).join('\n')}

Provide only the summary, no additional formatting.`;

  const response = await client.messages.create({
    model: config.summarization.model,
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });

  const textContent = response.content.find(c => c.type === 'text');
  return textContent?.text || '';
}

/**
 * Extract decisions from the session
 */
async function extractDecisions(
  session: Session,
  config: ReturnType<typeof loadConfig>
): Promise<Array<{ title: string; description: string; rationale: string }>> {
  const apiKey = process.env[config.summarization.apiKeyEnvVar];
  if (!apiKey || session.observations.length === 0) {
    return [];
  }

  const client = new Anthropic({ apiKey });

  const prompt = `Analyze this coding session and extract any significant technical decisions that were made. Only extract real decisions, not routine actions.

Session Info:
- Project: ${session.project}
- Files modified: ${session.filesModified.join(', ') || 'none'}

Key Actions:
${session.observations.slice(0, 30).map(obs => `- ${obs.type}: ${briefObservation(obs)}`).join('\n')}

Return a JSON array of decisions. Each decision should have:
- title: Short title (3-7 words)
- description: What was decided
- rationale: Why this approach was chosen

Return [] if no significant decisions were made. Return only valid JSON, no other text.`;

  try {
    const response = await client.messages.create({
      model: config.summarization.model,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent?.text) return [];

    const parsed = JSON.parse(textContent.text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Persist decisions to the vault
 */
async function persistDecisions(
  decisions: Array<{ title: string; description: string; rationale: string }>,
  session: Session,
  config: ReturnType<typeof loadConfig>
): Promise<void> {
  const vault = new VaultManager(config.vault.path, config.vault.memFolder);
  const sessionDate = new Date().toISOString().split('T')[0];
  const sessionRef = session.id.substring(0, 8);

  for (const decision of decisions) {
    let slugifiedTitle = decision.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50);

    if (!slugifiedTitle) {
      slugifiedTitle = `untitled-decision-${Date.now()}`;
    }

    const decisionPath = `projects/${sanitizeProjectName(session.project)}/decisions/${slugifiedTitle}.md`;

    try {
      // Check if decision exists
      const existingNote = await vault.readNote(decisionPath);

      // Update existing decision - insert row into Session History
      let updatedContent = existingNote.content;
      const newRow = `| ${sessionDate} | ${sessionRef} | Updated |`;

      const historyHeader = '## Session History';
      const headerIndex = existingNote.content.indexOf(historyHeader);

      if (headerIndex !== -1) {
        const afterHeader = existingNote.content.substring(headerIndex);
        const separatorMatch = afterHeader.match(/\|[-|\s]+\|\n/);

        if (separatorMatch) {
          const separatorEnd = headerIndex + (separatorMatch.index || 0) + separatorMatch[0].length;
          updatedContent =
            existingNote.content.substring(0, separatorEnd) +
            newRow + '\n' +
            existingNote.content.substring(separatorEnd);
        }
      } else {
        // No Session History section, append one
        updatedContent = existingNote.content.trimEnd() + `\n\n## Session History

| Date | Session | Notes |
|------|---------|-------|
| ${sessionDate} | ${sessionRef} | Updated |
`;
      }

      await vault.writeNote({
        type: 'decision',
        title: decision.title,
        content: updatedContent,
        project: session.project,
        tags: ['decision', 'auto-extracted'],
        path: decisionPath,
        preserveFrontmatter: true,
      });
    } catch {
      // Create new decision
      await vault.writeNote({
        type: 'decision',
        title: decision.title,
        content: `## Context

${decision.rationale || 'Extracted from session activity.'}

## Decision

${decision.description}

## Session History

| Date | Session | Notes |
|------|---------|-------|
| ${sessionDate} | ${sessionRef} | Initial extraction |
`,
        project: session.project,
        tags: ['decision', 'auto-extracted'],
      });
    }
  }
}

/**
 * Persist session to vault as markdown
 */
async function persistSession(
  session: Session,
  config: ReturnType<typeof loadConfig>
): Promise<void> {
  const vault = new VaultManager(config.vault.path, config.vault.memFolder);

  const projectPath = path.join(
    vault.getMemPath(),
    'projects',
    sanitizeProjectName(session.project),
    'sessions'
  );

  if (!fs.existsSync(projectPath)) {
    fs.mkdirSync(projectPath, { recursive: true });
  }

  const fileName = `${session.startTime.split('T')[0]}_${session.id.substring(0, 8)}.md`;
  const filePath = path.join(projectPath, fileName);

  const frontmatter = `---
type: session
title: "Session ${session.startTime.split('T')[0]}"
project: ${session.project}
created: ${session.startTime}
updated: ${new Date().toISOString()}
tags:
  - session
  - project/${sanitizeProjectName(session.project)}
session_id: ${session.id}
start_time: ${session.startTime}
end_time: ${session.endTime || new Date().toISOString()}
duration_minutes: ${session.durationMinutes || 0}
status: ${session.status}
observations_count: ${session.observations.length}
files_modified: ${session.filesModified.length}
commands_run: ${session.commandsRun}
errors_encountered: ${session.errorsEncountered}
---

`;

  const content = generateSessionContent(session);

  fs.writeFileSync(filePath, frontmatter + content);
}

/**
 * Generate session note content
 */
function generateSessionContent(session: Session): string {
  const lines: string[] = [];

  lines.push(`# Session: ${session.startTime.split('T')[0]}`);
  lines.push('');

  // Summary section
  lines.push('## Summary');
  lines.push('');
  if (session.summary) {
    lines.push(session.summary);
  } else {
    lines.push('> [!note] Session completed');
    lines.push(`> Duration: ${session.durationMinutes || 0} minutes`);
    lines.push(`> Files modified: ${session.filesModified.length}`);
    lines.push(`> Commands run: ${session.commandsRun}`);
    lines.push(`> Errors: ${session.errorsEncountered}`);
  }
  lines.push('');

  // Key actions
  if (session.observations.length > 0) {
    lines.push('## Key Actions');
    lines.push('');

    const significantObs = session.observations.slice(0, 20);
    for (const obs of significantObs) {
      const brief = briefObservation(obs);
      lines.push(`- **${obs.type}** (${obs.timestamp.split('T')[1]?.substring(0, 5) || ''}): ${brief}`);
    }

    if (session.observations.length > 20) {
      lines.push(`- ... and ${session.observations.length - 20} more actions`);
    }
    lines.push('');
  }

  // Files modified
  if (session.filesModified.length > 0) {
    lines.push('## Files Modified');
    lines.push('');
    for (const file of session.filesModified.slice(0, 20)) {
      lines.push(`- \`${file}\``);
    }
    if (session.filesModified.length > 20) {
      lines.push(`- ... and ${session.filesModified.length - 20} more files`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generate brief description of an observation
 */
function briefObservation(obs: Observation): string {
  const data = obs.data as Record<string, unknown>;
  switch (obs.type) {
    case 'file_edit':
      return `Edited \`${data.path}\``;
    case 'command':
      const cmd = (data.command as string || '').substring(0, 50);
      return `Ran: ${cmd}${(data.command as string || '').length > 50 ? '...' : ''}`;
    case 'error':
      return `Error: ${(data.message as string || '').substring(0, 50)}...`;
    default:
      return obs.tool;
  }
}

main();
