#!/usr/bin/env bun

import { loadConfig } from '../../src/shared/config.js';
import { addObservation, readSession } from '../../src/shared/session-store.js';
import { VaultManager } from '../../src/mcp-server/utils/vault.js';
import {
  isSignificantAction,
  generateObservationId,
  extractFileInfo,
  extractCommandInfo,
  extractErrorInfo,
  readStdinJson,
} from './utils/helpers.js';
import type { PostToolUseInput, Observation, ErrorData } from '../../src/shared/types.js';
import { sanitizeProjectName } from '../../src/shared/config.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

async function main() {
  try {
    const input = await readStdinJson<PostToolUseInput>();
    const config = loadConfig();

    // Validate session_id from input
    if (!input.session_id) {
      return;
    }

    // Check if we have an active session for this session_id
    const session = readSession(input.session_id);
    if (!session || session.status !== 'active') {
      return;
    }

    // Filter based on configuration
    if (!shouldCapture(input.tool_name, config)) {
      return;
    }

    // Check if action is significant enough to capture
    if (!isSignificantAction(input)) {
      return;
    }

    // Build observation based on tool type
    const observation = buildObservation(input, config);

    // Add to session file using the session_id from input
    addObservation(input.session_id, observation);

    // Handle errors specially - create/update error notes in vault
    if (observation.type === 'error' || observation.isError) {
      await processError(observation, session.project, session.id, config);
    }

    // Handle file edits - update file knowledge
    if (observation.type === 'file_edit') {
      await processFileEdit(observation, session.project, session.id, config);
    }
  } catch (error) {
    // Silently fail to not break Claude Code
    console.error('Post tool use hook error:', error);
  }
}

function shouldCapture(toolName: string, config: ReturnType<typeof loadConfig>): boolean {
  switch (toolName) {
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return config.capture.fileEdits;
    case 'Bash':
      return config.capture.bashCommands;
    default:
      return false;
  }
}

function buildObservation(input: PostToolUseInput, config: ReturnType<typeof loadConfig>): Observation {
  const baseObservation: Observation = {
    id: generateObservationId(),
    timestamp: new Date().toISOString(),
    tool: input.tool_name,
    type: 'other',
    isError: input.tool_response.isError || false,
    data: {},
  };

  switch (input.tool_name) {
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return {
        ...baseObservation,
        type: 'file_edit',
        data: extractFileInfo(input.tool_input, input.tool_response),
      };

    case 'Bash':
      const cmdInfo = extractCommandInfo(
        input.tool_input,
        input.tool_response,
        config.capture.bashOutput
      );
      if (cmdInfo.isError) {
        return {
          ...baseObservation,
          type: 'error',
          isError: true,
          data: extractErrorInfo(input.tool_name, input.tool_input, input.tool_response),
        };
      }
      return {
        ...baseObservation,
        type: 'command',
        data: cmdInfo,
      };

    default:
      return {
        ...baseObservation,
        type: 'other',
        data: {
          input: input.tool_input,
          output: input.tool_response,
        },
      };
  }
}

/**
 * Process an error observation - create/update error notes
 */
async function processError(
  observation: Observation,
  project: string,
  sessionId: string,
  config: ReturnType<typeof loadConfig>
): Promise<void> {
  if (!config.capture.errors) return;

  const vault = new VaultManager(config.vault.path, config.vault.memFolder);
  const errorData = observation.data as ErrorData;
  const errorHash = hashError(errorData);

  const projectPath = path.join(
    vault.getMemPath(),
    'projects',
    sanitizeProjectName(project),
    'errors'
  );

  // Ensure directory exists
  if (!fs.existsSync(projectPath)) {
    fs.mkdirSync(projectPath, { recursive: true });
  }

  const errorFilePath = path.join(projectPath, `${errorHash}.md`);

  if (fs.existsSync(errorFilePath)) {
    // Update existing error note - add new occurrence row
    await updateErrorNote(errorFilePath, observation, sessionId, vault);
  } else {
    // Create new error note
    await createErrorNote(errorFilePath, observation, project, sessionId);
  }
}

/**
 * Create a new error note
 */
async function createErrorNote(
  filePath: string,
  observation: Observation,
  project: string,
  sessionId: string
): Promise<void> {
  const errorData = observation.data as ErrorData;
  const errorType = categorizeError(errorData);

  const frontmatter = `---
type: error
title: "Error: ${(errorData.type || 'Unknown').replace(/"/g, '\\"')}"
project: ${project}
created: ${new Date().toISOString()}
updated: ${new Date().toISOString()}
tags:
  - error
  - error/${errorType}
  - project/${sanitizeProjectName(project)}
error_type: ${errorData.type || 'unknown'}
error_hash: ${path.basename(filePath, '.md')}
first_seen: ${observation.timestamp}
last_seen: ${observation.timestamp}
occurrences: 1
resolved: false
sessions:
  - ${sessionId}
---

`;

  const content = `# Error: ${errorData.type || 'Unknown'}

## Summary

> [!danger] Error Pattern
> ${errorData.message || 'No message'}

## Context

**File**: \`${errorData.file || 'unknown'}\`
**Line**: ${errorData.line || 'unknown'}

## Error Message

\`\`\`
${errorData.message || 'No error message'}
\`\`\`

${errorData.stack ? `## Stack Trace

\`\`\`
${errorData.stack}
\`\`\`` : ''}

## Resolution

> [!success] Solution
> _Not yet resolved_

## Occurrences

| Date | Session | Context |
|------|---------|---------|
| ${observation.timestamp.split('T')[0]} | ${sessionId.substring(0, 8)} | First occurrence |
`;

  fs.writeFileSync(filePath, frontmatter + content);
}

/**
 * Update an existing error note with new occurrence
 */
async function updateErrorNote(
  filePath: string,
  observation: Observation,
  sessionId: string,
  vault: VaultManager
): Promise<void> {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const errorData = observation.data as ErrorData;

  // Update frontmatter fields
  let updated = raw;

  // Update last_seen
  updated = updated.replace(
    /last_seen: .+/,
    `last_seen: ${observation.timestamp}`
  );

  // Increment occurrences
  const occurrencesMatch = updated.match(/occurrences: (\d+)/);
  if (occurrencesMatch) {
    const count = parseInt(occurrencesMatch[1], 10) + 1;
    updated = updated.replace(/occurrences: \d+/, `occurrences: ${count}`);
  }

  // Update updated timestamp
  updated = updated.replace(
    /updated: .+/,
    `updated: ${new Date().toISOString()}`
  );

  // Add session to sessions list if not already there
  if (!updated.includes(`  - ${sessionId}`)) {
    updated = updated.replace(
      /(sessions:\n(?:  - .+\n)*)/,
      `$1  - ${sessionId}\n`
    );
  }

  // Add new row to occurrences table
  const newRow = `| ${observation.timestamp.split('T')[0]} | ${sessionId.substring(0, 8)} | ${errorData.context || 'Recurring'} |`;

  const occurrencesHeader = '## Occurrences';
  const headerIndex = updated.indexOf(occurrencesHeader);

  if (headerIndex !== -1) {
    const afterHeader = updated.substring(headerIndex);
    const separatorMatch = afterHeader.match(/\|[-|\s]+\|\n/);

    if (separatorMatch) {
      const separatorEnd = headerIndex + (separatorMatch.index || 0) + separatorMatch[0].length;
      updated = updated.substring(0, separatorEnd) + newRow + '\n' + updated.substring(separatorEnd);
    }
  }

  fs.writeFileSync(filePath, updated);
}

/**
 * Process a file edit observation
 */
async function processFileEdit(
  observation: Observation,
  project: string,
  sessionId: string,
  config: ReturnType<typeof loadConfig>
): Promise<void> {
  const vault = new VaultManager(config.vault.path, config.vault.memFolder);
  const fileData = observation.data as { path: string; language?: string; changeType?: string };
  const fileHash = hashFilePath(fileData.path);

  const projectPath = path.join(
    vault.getMemPath(),
    'projects',
    sanitizeProjectName(project),
    'files'
  );

  // Ensure directory exists
  if (!fs.existsSync(projectPath)) {
    fs.mkdirSync(projectPath, { recursive: true });
  }

  const knowledgeFilePath = path.join(projectPath, `${fileHash}.md`);

  if (fs.existsSync(knowledgeFilePath)) {
    await updateFileKnowledge(knowledgeFilePath, observation, sessionId);
  } else {
    await createFileKnowledge(knowledgeFilePath, observation, project, sessionId);
  }
}

/**
 * Create a new file knowledge note
 */
async function createFileKnowledge(
  filePath: string,
  observation: Observation,
  project: string,
  sessionId: string
): Promise<void> {
  const fileData = observation.data as { path: string; language?: string; changeType?: string };

  const frontmatter = `---
type: file
title: "${path.basename(fileData.path).replace(/"/g, '\\"')}"
project: ${project}
created: ${new Date().toISOString()}
updated: ${new Date().toISOString()}
tags:
  - file
  - lang/${fileData.language || 'unknown'}
  - project/${sanitizeProjectName(project)}
file_path: ${fileData.path}
file_hash: ${path.basename(filePath, '.md')}
language: ${fileData.language || 'unknown'}
edit_count: 1
last_edited: ${observation.timestamp}
---

`;

  const content = `# File: ${fileData.path}

## Purpose

_File purpose not yet documented_

## Edit History

| Date | Session | Change Summary |
|------|---------|----------------|
| ${observation.timestamp.split('T')[0]} | ${sessionId.substring(0, 8)} | ${fileData.changeType || 'Modified'} |

## Notes

_No notes yet_
`;

  fs.writeFileSync(filePath, frontmatter + content);
}

/**
 * Update existing file knowledge
 */
async function updateFileKnowledge(
  filePath: string,
  observation: Observation,
  sessionId: string
): Promise<void> {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const fileData = observation.data as { path: string; changeType?: string };

  let updated = raw;

  // Update edit_count
  const editCountMatch = updated.match(/edit_count: (\d+)/);
  if (editCountMatch) {
    const count = parseInt(editCountMatch[1], 10) + 1;
    updated = updated.replace(/edit_count: \d+/, `edit_count: ${count}`);
  }

  // Update last_edited
  updated = updated.replace(
    /last_edited: .+/,
    `last_edited: ${observation.timestamp}`
  );

  // Update updated timestamp
  updated = updated.replace(
    /updated: .+/,
    `updated: ${new Date().toISOString()}`
  );

  // Add new row to edit history
  const newRow = `| ${observation.timestamp.split('T')[0]} | ${sessionId.substring(0, 8)} | ${fileData.changeType || 'Modified'} |`;

  const tableMatch = updated.match(/(\| Date \| Session \| Change Summary \|\n\|[-|\s]+\|)/);
  if (tableMatch) {
    const insertPos = updated.indexOf(tableMatch[0]) + tableMatch[0].length;
    updated = updated.substring(0, insertPos) + '\n' + newRow + updated.substring(insertPos);
  }

  fs.writeFileSync(filePath, updated);
}

/**
 * Hash an error for deduplication
 */
function hashError(error: ErrorData): string {
  const key = `${error.type || ''}:${error.message || ''}:${error.file || ''}`;
  return crypto.createHash('md5').update(key).digest('hex').substring(0, 12);
}

/**
 * Hash a file path for note naming
 */
function hashFilePath(filePath: string): string {
  return crypto.createHash('md5').update(filePath).digest('hex').substring(0, 12);
}

/**
 * Categorize an error type
 */
function categorizeError(error: ErrorData): string {
  const type = (error.type || '').toLowerCase();
  const message = (error.message || '').toLowerCase();

  if (type.includes('syntax') || message.includes('syntax')) return 'syntax';
  if (type.includes('type') || message.includes('type')) return 'type';
  if (type.includes('reference') || message.includes('undefined')) return 'reference';
  if (type.includes('network') || message.includes('fetch') || message.includes('connection')) return 'network';
  if (type.includes('permission') || message.includes('access denied')) return 'permission';
  if (message.includes('not found') || message.includes('enoent')) return 'not-found';

  return 'general';
}

main();
