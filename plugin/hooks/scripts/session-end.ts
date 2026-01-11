#!/usr/bin/env bun

/**
 * Session End Hook
 *
 * Runs when a Claude Code session ends (stop or natural end).
 *
 * Key design:
 * - Sessions are ephemeral - no vault persistence
 * - Spawns background script for AI summarization (if enabled)
 * - Cleans up session file from ~/.cc-obsidian-mem/sessions/
 */

import * as path from 'path';
import { spawn } from 'child_process';
import { loadConfig } from '../../src/shared/config.js';
import { endSession, readSession, clearSessionFile } from '../../src/shared/session-store.js';
import { readStdinJson } from './utils/helpers.js';
import type { SessionEndInput } from '../../src/shared/types.js';

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

    // Spawn background script for AI summarization (if enabled and transcript available)
    if (config.summarization.enabled && input.transcript_path) {
      const backgroundInput = JSON.stringify({
        transcript_path: input.transcript_path,
        session_id: input.session_id,
        project: session.project,
        trigger: 'session-end',
        mem_folder: config.vault.memFolder,
      });

      const scriptPath = path.join(__dirname, 'background-summarize.ts');

      spawn('bun', ['run', scriptPath, backgroundInput], {
        detached: true,
        stdio: 'ignore',
        cwd: path.dirname(scriptPath),
      }).unref();

      console.error('SessionEnd: Spawned background summarization');
    }

    // Clear the session file
    clearSessionFile(input.session_id);

    console.error(`SessionEnd: Session ${input.session_id.substring(0, 8)} ended`);

  } catch (error) {
    // Silently fail to not break Claude Code
    console.error('Session end hook error:', error);
  }
}

main();
