#!/usr/bin/env bun

/**
 * PreCompact Hook
 *
 * Runs before conversation history is compacted (manual or auto).
 * Spawns a background script to extract knowledge using `claude -p`.
 *
 * Key design:
 * - Hook exits immediately after spawning background process
 * - Background script uses `claude -p` (not Agent SDK) to avoid deadlock
 * - Knowledge extraction happens asynchronously
 */

import * as path from 'path';
import { spawn } from 'child_process';
import { loadConfig } from '../../src/shared/config.js';
import { readSession, markBackgroundJobStarted } from '../../src/shared/session-store.js';
import { readStdinJson } from './utils/helpers.js';

interface PreCompactInput {
  session_id: string;
  cwd: string;
  transcript_path: string;
  trigger: 'manual' | 'auto';
  custom_instructions?: string;
}

async function main() {
  try {
    const input = await readStdinJson<PreCompactInput>();
    const config = loadConfig();

    // Skip if summarization is disabled
    if (!config.summarization.enabled) {
      return;
    }

    // Validate session
    if (!input.session_id) {
      return;
    }

    const session = readSession(input.session_id);
    if (!session) {
      return;
    }

    // Validate transcript path
    if (!input.transcript_path) {
      return;
    }

    // Mark that a background job is starting (so session-end knows to wait)
    markBackgroundJobStarted(input.session_id);

    // Spawn background summarization script (don't await - fire and forget)
    // Note: project_hint is passed for reference, but frontend (MCP) determines final project
    const backgroundInput = JSON.stringify({
      transcript_path: input.transcript_path,
      session_id: input.session_id,
      project_hint: session.project, // Hint only - may be wrong if cwd detection failed
      trigger: 'pre-compact',
      mem_folder: config.vault.memFolder,
    });

    const scriptPath = path.join(__dirname, 'background-summarize.ts');

    spawn('bun', ['run', scriptPath, backgroundInput], {
      detached: true,      // Run independently of parent
      stdio: 'ignore',     // Don't block on I/O
      cwd: path.dirname(scriptPath),
    }).unref();            // Allow hook to exit without waiting

    // Log that we spawned the background process
    console.error(`PreCompact: Spawned background summarization for ${input.trigger} compact`);

  } catch (error) {
    // Silently fail to not break Claude Code
    console.error('PreCompact hook error:', error);
  }
}

main();
