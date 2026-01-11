#!/usr/bin/env bun

/**
 * UserPromptSubmit Hook
 *
 * Runs when user submits a prompt, before Claude processes it.
 * Captures user prompts as observations for later analysis.
 */

import { loadConfig } from '../../src/shared/config.js';
import { addObservation, readSession } from '../../src/shared/session-store.js';
import { readStdinJson, generateObservationId } from './utils/helpers.js';
import { readPendingFile, formatPendingForInjection, clearPending } from './utils/pending.js';
import type { Observation } from '../../src/shared/types.js';

interface UserPromptSubmitInput {
  session_id: string;
  cwd: string;
  prompt: string;
}

async function main() {
  try {
    const input = await readStdinJson<UserPromptSubmitInput>();
    const config = loadConfig();

    // Check for pending knowledge items from background summarization
    if (input.session_id) {
      const pendingFile = readPendingFile(input.session_id);
      // Defensive: ensure items is a valid array before accessing .length
      const items = pendingFile && Array.isArray(pendingFile.items) ? pendingFile.items : [];
      if (items.length > 0) {
        // Inject pending items into conversation for Claude to write via MCP
        console.log(formatPendingForInjection(items, pendingFile?.project_hint));
        // Clear after injection so it's not repeated
        clearPending(input.session_id);
      }
    }

    // Validate session
    if (!input.session_id || !input.prompt) {
      return;
    }

    const session = readSession(input.session_id);
    if (!session || session.status !== 'active') {
      return;
    }

    // Skip very short prompts (likely just commands or acknowledgments)
    if (input.prompt.trim().length < 20) {
      return;
    }

    // Create observation for the user prompt
    const observation: Observation = {
      id: generateObservationId(),
      timestamp: new Date().toISOString(),
      tool: 'UserPrompt',
      type: 'other',
      isError: false,
      data: {
        prompt: input.prompt.substring(0, 5000), // Truncate very long prompts
        promptLength: input.prompt.length,
      },
    };

    // Add to session observations
    addObservation(input.session_id, observation);
  } catch (error) {
    // Silently fail to not break Claude Code
    console.error('UserPromptSubmit hook error:', error);
  }
}

main();
