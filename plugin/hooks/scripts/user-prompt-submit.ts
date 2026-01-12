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
import { createLogger } from '../../src/shared/logger.js';
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
    const logger = createLogger('user-prompt-submit', input.session_id);

    logger.debug('User prompt submit hook triggered', { session_id: input.session_id, promptLength: input.prompt?.length });

    // Validate session
    if (!input.session_id || !input.prompt) {
      logger.debug('Invalid input: missing session_id or prompt');
      return;
    }

    const session = readSession(input.session_id);
    if (!session || session.status !== 'active') {
      logger.debug('Session not found or inactive', { sessionExists: !!session, status: session?.status });
      return;
    }

    // Skip very short prompts (likely just commands or acknowledgments)
    if (input.prompt.trim().length < 20) {
      logger.debug('Skipping short prompt', { length: input.prompt.trim().length });
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
    logger.info('User prompt observation recorded', { promptLength: input.prompt.length });
  } catch (error) {
    // Silently fail to not break Claude Code (don't use logger here, might not be initialized)
    console.error('UserPromptSubmit hook error:', error);
  }
}

main();
