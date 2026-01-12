#!/usr/bin/env bun

/**
 * Session End Hook
 *
 * Runs when a Claude Code session ends (stop or natural end).
 *
 * Key design:
 * - Sessions are ephemeral - no vault persistence
 * - NO background summarization at session-end (no injection path exists)
 * - Cleans up session file and pending items
 * - Generates/updates project canvases if enabled
 *
 * Note: Knowledge extraction only happens on /compact (pre-compact hook)
 * where there's a subsequent message for pending injection.
 */

import * as path from 'path';
import { loadConfig, getProjectPath } from '../../src/shared/config.js';
import { endSession, readSession, clearSessionFile } from '../../src/shared/session-store.js';
import { VaultManager } from '../../src/mcp-server/utils/vault.js';
import { generateProjectCanvases, detectFolder, type CanvasNote } from '../../src/mcp-server/utils/canvas.js';
import { readStdinJson } from './utils/helpers.js';
import { clearPending } from './utils/pending.js';
import { createLogger, cleanupOldLogs } from '../../src/shared/logger.js';
import type { SessionEndInput } from '../../src/shared/types.js';

async function main() {
  try {
    const args = process.argv.slice(2);
    const endType = (args.find(a => a.startsWith('--type='))?.split('=')[1] || 'end') as 'stop' | 'end';

    const input = await readStdinJson<SessionEndInput>();
    const logger = createLogger('session-end', input.session_id);

    logger.debug('Session end hook triggered', { endType, session_id: input.session_id });

    // Validate session_id from input
    if (!input.session_id) {
      logger.error('No session_id provided');
      return;
    }

    // Verify session exists and belongs to this session_id
    const existingSession = readSession(input.session_id);
    if (!existingSession) {
      logger.error(`Session not found: ${input.session_id}`);
      return;
    }

    // End the specific session by ID
    const session = endSession(input.session_id, endType);
    if (!session) {
      logger.debug('endSession returned null');
      return;
    }

    logger.info(`Session ended`, { project: session.project, endType, duration: session.durationMinutes });

    const config = loadConfig();

    // Generate/update project canvases if enabled
    if (config.canvas?.enabled) {
      logger.debug('Canvas generation enabled', { updateStrategy: config.canvas.updateStrategy });
      try {
        const vault = new VaultManager(config.vault.path, config.vault.memFolder);
        const notes = await vault.getProjectNotes(session.project);
        logger.debug('Retrieved project notes for canvas', { notesCount: notes.length });

        if (notes.length > 0) {
          const canvasNotes: CanvasNote[] = notes.map((note) => ({
            path: note.path,
            title: note.title,
            folder: detectFolder(note.path),
            status: note.frontmatter.status || 'active',
            created: note.frontmatter.created,
          }));

          const projectPath = getProjectPath(session.project, config);
          const canvasDir = path.join(projectPath, 'canvases');
          const updateStrategy = config.canvas.updateStrategy || 'skip';

          const result = generateProjectCanvases(
            session.project,
            canvasNotes,
            canvasDir,
            updateStrategy,
            false // don't force
          );

          const generated: string[] = [];
          if (result.dashboard) generated.push('dashboard');
          if (result.timeline) generated.push('timeline');
          if (result.graph) generated.push('graph');

          if (generated.length > 0) {
            logger.info(`Updated ${generated.length} canvas(es): ${generated.join(', ')}`);
          }
        }
      } catch (canvasError) {
        logger.error('Canvas generation failed', canvasError instanceof Error ? canvasError : undefined);
      }
    } else {
      logger.debug('Canvas generation disabled in config');
    }

    // Note: We intentionally do NOT spawn background summarization here.
    // Session-end has no injection path - there's no subsequent message
    // where we could inject pending items for Claude to write.
    // Knowledge extraction only happens on /compact (pre-compact hook).

    // Clear any pending knowledge items that were never written
    // (e.g., user ran /compact but didn't write the pending items before ending)
    clearPending(input.session_id);
    logger.debug('Cleared pending knowledge items');

    // Clear the session file
    clearSessionFile(input.session_id);
    logger.debug('Cleared session file');

    // Cleanup old session log files (24+ hours old)
    cleanupOldLogs(24);
    logger.debug('Cleaned up old log files');

    logger.info(`Session ${input.session_id.substring(0, 8)} ended successfully`);

  } catch (error) {
    // Silently fail to not break Claude Code (don't use logger here, might not be initialized)
    console.error('Session end hook error:', error);
  }
}

main();
