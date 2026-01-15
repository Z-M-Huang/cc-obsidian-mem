#!/usr/bin/env bun

/**
 * Background Session End Processor
 *
 * This script runs in the background after the stop hook exits.
 * It handles all the heavy processing:
 * 1. Process remaining pending messages
 * 2. Generate session summary
 * 3. Clean up agent context
 * 4. Mark session as completed
 * 5. Trigger vault summarization
 * 6. Clean up old sessions
 *
 * Usage: bun run run-session-end.ts <session_id>
 */

import { loadConfig, AGENT_SESSION_MARKER } from "../shared/config.js";
import { createLogger } from "../shared/logger.js";
import { initDatabase, closeDatabase } from "../sqlite/database.js";
import {
	updateSessionStatus,
	cleanupOldSessions,
	getSession,
	markSessionProcessing,
} from "../sqlite/session-store.js";
import { enqueueMessage, hasPendingMessages } from "../sqlite/pending-store.js";
import { processSessionMessages, clearAgentContext } from "../sdk/agent.js";
import { summarizeSession, writeCompletionMarker } from "../summarizer/summarizer.js";
import { claimLock, releaseLock } from "./process-lock.js";
import { generateAllCanvases } from "../vault/canvas.js";
import { slugifyProjectName } from "../vault/vault-manager.js";

async function main() {
	const sessionId = process.argv[2];
	if (!sessionId) {
		console.error("[run-session-end] Missing session_id argument");
		process.exit(1);
	}

	const config = loadConfig();
	const logger = createLogger({
		logDir: config.logging?.logDir,
		sessionId,
		verbose: config.logging?.verbose,
	});

	logger.info("Background session-end processor started", { sessionId });

	try {
		// Step 1: Claim the lock with our PID
		const claimed = claimLock(sessionId);
		if (!claimed) {
			logger.warn("Failed to claim lock - another process may have it", { sessionId });
			return;
		}

		logger.info("Lock claimed", { pid: process.pid });

		const db = initDatabase(config.sqlite.path!, logger);

		// Step 2: Mark session as processing
		markSessionProcessing(db, sessionId);

		// Step 3: Get session for project info
		const session = getSession(db, sessionId);
		if (!session) {
			logger.warn("Session not found", { sessionId });
			closeDatabase(db, logger);
			releaseLock(sessionId);
			return;
		}

		// Step 1: Process any remaining pending messages
		if (hasPendingMessages(db, sessionId)) {
			logger.info("Processing remaining pending messages");
			try {
				const result = processSessionMessages(db, sessionId, logger);
				logger.info("Pending messages processed", {
					processed: result.processed,
					observations: result.observations.length,
				});
			} catch (agentError) {
				logger.warn("Agent processing failed", { error: agentError });
			}
		}

		// Step 2: Request and process final summary
		enqueueMessage(db, sessionId, "summary_request", {
			last_assistant_message: "",
		});

		try {
			const summaryResult = processSessionMessages(db, sessionId, logger);
			logger.info("Summary generated", {
				observations: summaryResult.observations.length,
			});
		} catch (summaryError) {
			logger.warn("Summary generation failed", { error: summaryError });
		}

		// Step 3: Clear agent context
		clearAgentContext(sessionId);

		// Step 4: Mark session as completed
		updateSessionStatus(db, sessionId, "completed");
		logger.info("Session marked as completed", { sessionId });

		// Step 5: Run vault summarization (extract knowledge to Obsidian)
		logger.info("Starting vault summarization");
		const summaryResult = await summarizeSession(sessionId, logger, db);

		if (summaryResult.success) {
			logger.info("Vault summarization completed", {
				notesWritten: summaryResult.writtenNotes.length,
			});
			writeCompletionMarker(sessionId, true, summaryResult.writtenNotes);
		} else {
			logger.warn("Vault summarization failed", {
				error: summaryResult.error,
			});
			writeCompletionMarker(sessionId, false, [], summaryResult.error);
		}

		// Step 5.5: Generate canvases if enabled
		if (config.canvas?.enabled && config.canvas?.autoGenerate) {
			logger.info("Starting canvas generation");
			try {
				const projectSlug = slugifyProjectName(session.project);
				const canvasPaths = generateAllCanvases(projectSlug);
				logger.info("Canvas generation completed", {
					canvasesGenerated: canvasPaths.length,
					paths: canvasPaths,
				});
			} catch (canvasError) {
				// Don't fail session-end on canvas errors
				logger.warn("Canvas generation failed", { error: canvasError });
			}
		}

		// Step 6: Clean up old sessions based on retention
		const retentionCount = config.sqlite.retention?.sessions ?? 50;
		cleanupOldSessions(db, retentionCount);

		// Step 7: Release lock
		releaseLock(sessionId);
		logger.info("Lock released", { sessionId });

		closeDatabase(db, logger);
		logger.info("Background session-end processor completed", { sessionId });
	} catch (error) {
		logger.error("Background session-end processor failed", { error });
		// Release lock on error
		try {
			releaseLock(sessionId);
		} catch {
			// Ignore
		}
		process.exit(1);
	}
}

main();
