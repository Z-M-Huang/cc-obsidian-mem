#!/usr/bin/env bun

import { WorkerClient } from './utils/api-client.js';
import { loadConfig } from '../../src/shared/config.js';
import { getProjectInfo, formatContextForInjection, readStdinJson } from './utils/helpers.js';
import type { SessionStartInput } from '../../src/shared/types.js';

async function main() {
  try {
    // Read JSON input from stdin
    const input = await readStdinJson<SessionStartInput>();

    const config = loadConfig();
    const client = new WorkerClient(config.worker.port);

    // Ensure worker is running
    const workerReady = await client.ensureRunning();
    if (!workerReady) {
      console.error('Worker service not available');
      return;
    }

    // Get project info from git or directory
    const project = await getProjectInfo(input.cwd);

    // Initialize session in worker
    await client.post('/session/start', {
      sessionId: input.session_id,
      project: project.name,
      projectPath: input.cwd,
      startTime: new Date().toISOString(),
    });

    // If context injection is enabled, get relevant context
    if (config.contextInjection.enabled) {
      const context = await client.get<{
        success: boolean;
        formatted?: string;
        context?: unknown;
      }>('/context/project', {
        project: project.name,
        maxTokens: String(config.contextInjection.maxTokens),
        includeRecentSessions: String(config.contextInjection.includeRecentSessions),
        includeRelatedErrors: String(config.contextInjection.includeRelatedErrors),
      });

      if (context?.success && context.formatted) {
        // Output context to stdout for Claude to consume
        console.log(context.formatted);
      }
    }
  } catch (error) {
    // Silently fail to not break Claude Code
    console.error('Session start hook error:', error);
  }
}

main();
