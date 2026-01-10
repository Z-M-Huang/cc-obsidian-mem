#!/usr/bin/env bun

import { WorkerClient } from './utils/api-client.js';
import { loadConfig } from '../../src/shared/config.js';
import {
  isSignificantAction,
  generateObservationId,
  extractFileInfo,
  extractCommandInfo,
  extractErrorInfo,
  readStdinJson,
} from './utils/helpers.js';
import type { PostToolUseInput, Observation } from '../../src/shared/types.js';

async function main() {
  try {
    const input = await readStdinJson<PostToolUseInput>();
    const config = loadConfig();

    // Filter based on configuration
    if (!shouldCapture(input.tool_name, config)) {
      return;
    }

    // Check if action is significant enough to capture
    if (!isSignificantAction(input)) {
      return;
    }

    const client = new WorkerClient(config.worker.port);

    // Check if worker is running (don't start it here, just skip if not running)
    const isHealthy = await client.healthCheck();
    if (!isHealthy) {
      return;
    }

    // Build observation based on tool type
    const observation = buildObservation(input, config);

    // Send to worker for processing
    await client.post('/observation/capture', {
      sessionId: input.session_id,
      observation,
    });
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

main();
