#!/usr/bin/env bun

/**
 * Stop Hook (Non-Blocking)
 *
 * This hook exits immediately after spawning a background process.
 * All heavy processing happens in the background:
 * - Processing pending messages
 * - Generating session summary
 * - Vault summarization
 * - Cleanup
 *
 * This ensures Claude's exit is not delayed by our processing.
 */

import { isAgentSession } from "../../src/shared/config.js";
import { validate, StopPayloadSchema } from "../../src/shared/validation.js";
import { spawn } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// Claude Code sends snake_case fields
interface StopInput {
	session_id: string;
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
	// Step 1: Read stdin with dedicated error handling
	let input: StopInput;
	try {
		input = await readStdinJson<StopInput>();
	} catch (error) {
		console.error("[cc-obsidian-mem] Failed to parse stdin in stop hook:", error);
		return;
	}

	// Step 2: Check if this is an agent session - skip hooks for agent-spawned sessions
	if (isAgentSession()) {
		console.error("[cc-obsidian-mem] Skipping stop hook - agent session");
		return;
	}

	// Step 3: Validate input
	let sessionId: string;
	try {
		const validated = validate(StopPayloadSchema, input);
		sessionId = validated.sessionId;
	} catch (error) {
		console.error("[cc-obsidian-mem] Invalid stop hook input:", error);
		return;
	}

	// Step 4: Try to acquire reservation lock
	const { acquireReservationLock, readLockFile, isProcessAliveWithStartTime } = await import("../../src/session-end/process-lock.js");
	const { loadConfig } = await import("../../src/shared/config.js");

	const config = loadConfig();
	const timeoutMs = config.processing?.pidValidationTimeoutMs ?? 500;

	const lockAcquired = acquireReservationLock(sessionId);

	if (!lockAcquired) {
		// Lock exists - check if process is alive
		const lock = readLockFile(sessionId);

		if (lock && lock.status === "running") {
			// Validate process with timeout
			const alive = await isProcessAliveWithStartTime(
				lock.pid,
				lock.startedAt,
				timeoutMs
			);

			if (alive) {
				// Process is alive (or timeout) - SKIP spawn to prevent duplicates
				console.error(`[cc-obsidian-mem] Session already being processed (pid=${lock.pid}), skipping`);
				return;
			}

			// Process is dead - will retry lock acquisition in spawn
		} else if (lock && lock.status === "reserved") {
			// Another stop hook has reservation
			console.error(`[cc-obsidian-mem] Session already reserved, skipping`);
			return;
		}

		// Lock was stale/invalid - readLockFile deleted it, retry
		const retryAcquired = acquireReservationLock(sessionId);
		if (!retryAcquired) {
			console.error(`[cc-obsidian-mem] Failed to acquire lock on retry, skipping`);
			return;
		}
	}

	// Step 5: Spawn background processor and exit immediately
	try {
		const __filename = fileURLToPath(import.meta.url);
		const __dirname = dirname(__filename);
		const processorPath = join(__dirname, "../../src/session-end/run-session-end.ts");

		const child = spawn("bun", ["run", processorPath, sessionId], {
			detached: true,
			stdio: "ignore",
			windowsHide: true, // Prevent cmd popup on Windows
		});

		child.unref();

		console.error(`[cc-obsidian-mem] Background session-end started (pid=${child.pid})`);

		// Wait briefly to verify spawn succeeded
		const verifyDelay = config.processing?.spawnVerifyDelayMs ?? 100;
		await new Promise((resolve) => setTimeout(resolve, verifyDelay));
	} catch (error) {
		console.error("[cc-obsidian-mem] Failed to spawn background processor:", error);
		// Release lock on spawn failure
		const { releaseLock } = await import("../../src/session-end/process-lock.js");
		releaseLock(sessionId);
	}
}

main();
