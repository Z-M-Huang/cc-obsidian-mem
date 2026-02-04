#!/usr/bin/env bun

/**
 * UserPromptSubmit Hook
 *
 * 1. Injects memory context before each prompt
 * 2. Records user prompts to SQLite
 * 3. Enqueues prompt for SDK agent processing
 */

import { loadConfig, isAgentSession } from "../../src/shared/config.js";
import { createLogger } from "../../src/shared/logger.js";
import { initDatabase } from "../../src/sqlite/database.js";
import { addUserPrompt, createSession, getSession, getNextPromptNumber } from "../../src/sqlite/session-store.js";
import { enqueueMessage } from "../../src/sqlite/pending-store.js";
import { generateContext, generateCompactContext } from "../../src/context/context-builder.js";
import {
	initFallbackSession,
	addFallbackPrompt,
	fallbackSessionExists,
	getFallbackNextPromptNumber,
} from "../../src/fallback/fallback-store.js";
import { validate, UserPromptSubmitPayloadSchema } from "../../src/shared/validation.js";
import { detectProjectName } from "../../src/shared/project-detection.js";

// Claude Code sends snake_case fields
interface UserPromptSubmitInput {
	session_id: string;
	prompt: string;
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
	let input: UserPromptSubmitInput;
	try {
		input = await readStdinJson<UserPromptSubmitInput>();
	} catch (error) {
		console.error("[cc-obsidian-mem] Failed to parse stdin in user-prompt-submit hook:", error);
		return;
	}

	// Step 2: Check if this is an agent session - skip hooks for agent-spawned sessions
	if (isAgentSession()) {
		console.error("[cc-obsidian-mem] Skipping user-prompt-submit hook - agent session");
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

		logger.debug("UserPromptSubmit hook triggered", {
			sessionId: input.session_id,
		});

		// Validate input
		const validated = validate(UserPromptSubmitPayloadSchema, input);

		// Try SQLite first
		try {
			const db = initDatabase(config.sqlite.path!, logger);

			// Check session exists - create lazily if not found
			// Session creation was moved here from SessionStart hook to avoid
			// a race condition in Claude Code that prevents the REPL from mounting
			let session = getSession(db, validated.sessionId);
			if (!session) {
				const projectName = detectProjectName(process.cwd(), config.defaultProject);
				createSession(db, validated.sessionId, projectName);
				logger.info("Session lazily created", {
					sessionId: validated.sessionId,
					project: projectName,
				});
				session = getSession(db, validated.sessionId);
				if (!session) {
					logger.warn("Session creation failed, skipping prompt recording");
					db.close();
					return;
				}
			}

			// Auto-assign prompt number (Claude Code doesn't send this)
			const promptNumber = getNextPromptNumber(db, validated.sessionId);

			// Add prompt to database
			addUserPrompt(
				db,
				validated.sessionId,
				promptNumber,
				validated.promptText
			);

			// Enqueue prompt for SDK agent processing
			enqueueMessage(db, validated.sessionId, "prompt", {
				prompt_text: validated.promptText,
				prompt_number: promptNumber,
			});

			logger.info("User prompt recorded and enqueued", {
				promptNumber: promptNumber,
				promptLength: validated.promptText.length,
			});

			// Generate and inject memory context
			// Skip context injection for first prompt (handled in SessionStart)
			if (promptNumber > 1) {
				try {
					const context = generateContext(db, session.project, validated.sessionId);

					if (context && context.length > 50) {
						// Output context as a comment that will be injected
						console.log(context);
						logger.debug("Context injected", {
							contextLength: context.length,
							project: session.project,
						});
					}
				} catch (contextError) {
					// Context injection is non-critical, log and continue
					logger.warn("Context generation failed", { error: contextError });
				}
			}

			db.close();
		} catch (sqliteError) {
			logger.warn("SQLite error, using fallback storage", { error: sqliteError });

			// Fallback to JSON storage - create session lazily if needed
			if (!fallbackSessionExists(validated.sessionId)) {
				const projectName = detectProjectName(process.cwd(), config.defaultProject);
				initFallbackSession(validated.sessionId, projectName);
				logger.info("Fallback session lazily created", {
					sessionId: validated.sessionId,
					project: projectName,
				});
			}

			// Auto-assign prompt number in fallback too
			const promptNumber = getFallbackNextPromptNumber(validated.sessionId);

			addFallbackPrompt(
				validated.sessionId,
				promptNumber,
				validated.promptText
			);

			logger.info("User prompt recorded to fallback storage", {
				promptNumber: promptNumber,
			});
		}
	} catch (error) {
		// Log error but don't throw - hooks must never crash
		if (logger) {
			logger.error("UserPromptSubmit hook error", { error });
		} else {
			console.error("UserPromptSubmit hook error:", error);
		}
	}
}

main();
