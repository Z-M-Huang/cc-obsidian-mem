#!/usr/bin/env bun

/**
 * SessionStart Hook
 *
 * Initializes session, cleans up orphans, and injects context
 */

import { loadConfig, isAgentSession } from "../../src/shared/config.js";
import { createLogger } from "../../src/shared/logger.js";
import { initDatabase, closeDatabase } from "../../src/sqlite/database.js";
import {
	createSession,
	getOrphanSessions,
	updateSessionStatus,
	cleanupOldSessions,
	cleanupStaleProcessingSessions,
} from "../../src/sqlite/session-store.js";
import {
	initFallbackSession,
	updateFallbackSessionStatus,
} from "../../src/fallback/fallback-store.js";
import { validate, SessionStartPayloadSchema } from "../../src/shared/validation.js";
import { detectProjectName } from "../../src/shared/project-detection.js";
import { ensureLocksDir, cleanupStaleLocks } from "../../src/session-end/process-lock.js";
import { existsSync, readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Claude Code sends snake_case fields
interface SessionStartInput {
	session_id: string;
	cwd: string;
}

/**
 * Read JSON from stdin
 */
async function readStdinJson<T>(): Promise<T> {
	const stdin = Bun.stdin.stream();
	const reader = stdin.getReader();
	const chunks: Uint8Array[] = [];

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
		}

		const text = new TextDecoder().decode(Buffer.concat(chunks));
		return JSON.parse(text) as T;
	} finally {
		reader.releaseLock();
	}
}

/**
 * Clean up orphan temp files older than 1 hour
 */
function cleanupOrphanTempFiles(logger: ReturnType<typeof createLogger>): void {
	try {
		const tempDir = tmpdir();
		const files = readdirSync(tempDir);
		const now = Date.now();
		const maxAge = 60 * 60 * 1000; // 1 hour

		let cleaned = 0;

		for (const file of files) {
			if (file.startsWith("cc-obsidian-mem-") && file.endsWith(".txt")) {
				const filePath = join(tempDir, file);

				try {
					const stats = statSync(filePath);
					if (now - stats.mtimeMs > maxAge) {
						unlinkSync(filePath);
						cleaned++;
					}
				} catch {
					// Skip files we can't access
				}
			}
		}

		if (cleaned > 0) {
			logger.info("Cleaned up orphan temp files", { count: cleaned });
		}
	} catch (error) {
		logger.warn("Failed to clean up orphan temp files", { error });
	}
}

/**
 * Output context to stdout for injection into prompt
 */
function outputContext(context: string): void {
	// Write to stdout in the format Claude Code expects
	console.log(context);
}

async function main() {
	let logger: ReturnType<typeof createLogger> | null = null;

	// Step 1: Read stdin with dedicated error handling
	let input: SessionStartInput;
	try {
		input = await readStdinJson<SessionStartInput>();
	} catch (error) {
		console.error("[cc-obsidian-mem] Failed to parse stdin in session-start hook:", error);
		return;
	}

	// Step 2: Check if this is an agent session - skip hooks for agent-spawned sessions
	if (isAgentSession()) {
		console.error("[cc-obsidian-mem] Skipping session-start hook - agent session");
		return;
	}

	// Step 3: Normal processing with its own try-catch
	try {
		const config = loadConfig();
		logger = createLogger({
			logDir: config.logging?.logDir,
			sessionId: input.session_id,
			verbose: config.logging?.verbose,
		});

		logger.info("SessionStart hook triggered", {
			sessionId: input.session_id,
			cwd: input.cwd,
		});

		// Validate input
		const validated = validate(SessionStartPayloadSchema, input);

		// Detect project name
		const projectName = detectProjectName(validated.cwd, config.defaultProject);

		logger.info("Detected project", { project: projectName });

		// Try SQLite first
		try {
			const db = initDatabase(config.sqlite.path!, logger);

			// 0. Ensure locks directory exists
			ensureLocksDir();

			// 1. Clean up stale processing sessions (atomic operation)
			const stalenessTimeoutMinutes = config.processing?.stalenessTimeoutMinutes ?? 30;
			const staleCount = cleanupStaleProcessingSessions(db, stalenessTimeoutMinutes);

			if (staleCount > 0) {
				logger.info("Cleaned up stale processing sessions", { count: staleCount });
			}

			// 2. Clean up stale lock files
			const staleLocks = cleanupStaleLocks(5 * 60 * 1000); // 5 minute max age for reservations
			if (staleLocks.length > 0) {
				logger.info("Cleaned up stale lock files", { count: staleLocks.length, sessions: staleLocks });
			}

			// 3. Clean up orphan sessions (active but older than timeout)
			const orphanTimeoutHours = config.sqlite.retention?.orphan_timeout_hours ?? 24;
			const orphans = getOrphanSessions(db, orphanTimeoutHours);

			if (orphans.length > 0) {
				logger.info("Found orphan sessions", { count: orphans.length });

				for (const orphan of orphans) {
					updateSessionStatus(db, orphan.session_id, "failed");
					logger.info("Marked orphan session as failed", {
						sessionId: orphan.session_id,
					});
				}
			}

			// 4. Clean up orphan temp files
			cleanupOrphanTempFiles(logger);

			// 5. Create new session
			createSession(db, validated.sessionId, projectName);

			logger.info("Session created in SQLite", {
				sessionId: validated.sessionId,
				project: projectName,
			});

			// 6. TODO: Query Obsidian vault for project context and inject
			// For now, just output a simple context message
			const contextMessage = `<!-- Memory context for ${projectName.replace(/_/g, "-")} -->

Use \`mem_search\` and \`mem_read\` to access project knowledge.
`;

			outputContext(contextMessage);

			// 7. Clean up old sessions based on retention
			const retentionCount = config.sqlite.retention?.sessions ?? 50;
			cleanupOldSessions(db, retentionCount);

			closeDatabase(db, logger);
		} catch (sqliteError) {
			logger.warn("SQLite error, using fallback storage", { error: sqliteError });

			// Fallback to JSON storage
			initFallbackSession(validated.sessionId, projectName);

			logger.info("Session created in fallback storage", {
				sessionId: validated.sessionId,
				project: projectName,
			});

			// Still output context
			const contextMessage = `<!-- Memory context for ${projectName} -->`;
			outputContext(contextMessage);
		}
	} catch (error) {
		// Log error but don't throw - hooks must never crash
		if (logger) {
			logger.error("SessionStart hook error", { error });
		} else {
			console.error("SessionStart hook error:", error);
		}
	}
}

main();
