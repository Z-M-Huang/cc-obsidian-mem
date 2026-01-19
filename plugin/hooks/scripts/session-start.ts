#!/usr/bin/env bun

/**
 * SessionStart Hook
 *
 * Initializes session tracking in the database.
 * Cleanup operations have been moved to /mem-repair skill.
 */

import { loadConfig, isAgentSession } from "../../src/shared/config.js";
import { createLogger } from "../../src/shared/logger.js";
import { initDatabase, closeDatabase } from "../../src/sqlite/database.js";
import { createSession } from "../../src/sqlite/session-store.js";
import { initFallbackSession } from "../../src/fallback/fallback-store.js";
import { validate, SessionStartPayloadSchema } from "../../src/shared/validation.js";
import { detectProjectName } from "../../src/shared/project-detection.js";

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

			// Create new session
			createSession(db, validated.sessionId, projectName);

			logger.info("Session created in SQLite", {
				sessionId: validated.sessionId,
				project: projectName,
			});

			closeDatabase(db, logger);
		} catch (sqliteError) {
			logger.warn("SQLite error, using fallback storage", { error: sqliteError });

			// Fallback to JSON storage
			initFallbackSession(validated.sessionId, projectName);

			logger.info("Session created in fallback storage", {
				sessionId: validated.sessionId,
				project: projectName,
			});
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
