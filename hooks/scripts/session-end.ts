#!/usr/bin/env bun

import { WorkerClient } from './utils/api-client.js';
import { loadConfig } from '../../src/shared/config.js';
import { readStdinJson } from './utils/helpers.js';
import type { SessionEndInput } from '../../src/shared/types.js';

async function main() {
  try {
    const args = process.argv.slice(2);
    const endType = args.find(a => a.startsWith('--type='))?.split('=')[1] || 'end';

    const input = await readStdinJson<SessionEndInput>();

    const config = loadConfig();
    const client = new WorkerClient(config.worker.port);

    // Check if worker is running
    const isHealthy = await client.healthCheck();
    if (!isHealthy) {
      return;
    }

    // End the session
    await client.post('/session/end', {
      sessionId: input.session_id,
      endType,
      endTime: new Date().toISOString(),
      transcriptPath: input.transcript_path,
    });

    // Request AI summary if enabled
    if (config.summarization.enabled && config.summarization.sessionSummary) {
      await client.post('/session/summarize', {
        sessionId: input.session_id,
      });
    }
  } catch (error) {
    // Silently fail to not break Claude Code
    console.error('Session end hook error:', error);
  }
}

main();
