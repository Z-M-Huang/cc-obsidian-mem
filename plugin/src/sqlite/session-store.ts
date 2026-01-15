/**
 * Session store with SQLite backend
 * Provides CRUD operations for sessions, prompts, tool uses, and file reads
 */

import type { Database } from "bun:sqlite";
import { createHash } from "crypto";
import type {
	Session,
	UserPrompt,
	ToolUse,
	FileRead,
	SessionSummary,
} from "../shared/types.js";
import { retryWithBackoff } from "../shared/database-utils.js";
import { redactSensitiveData, truncateContent } from "../shared/security.js";

// ============================================================================
// Session Operations
// ============================================================================

/**
 * Create a new session
 */
export function createSession(
	db: Database,
	sessionId: string,
	project: string
): Session {
	const now = new Date().toISOString();
	const nowEpoch = Date.now();

	return retryWithBackoff(() => {
		const stmt = db.prepare(`
			INSERT INTO sessions (session_id, project, started_at, started_at_epoch, status)
			VALUES (?, ?, ?, ?, ?)
		`);

		stmt.run(sessionId, project, now, nowEpoch, "active");

		return getSession(db, sessionId)!;
	});
}

/**
 * Get session by ID
 */
export function getSession(db: Database, sessionId: string): Session | null {
	return retryWithBackoff(() => {
		const stmt = db.prepare("SELECT * FROM sessions WHERE session_id = ?");
		return stmt.get(sessionId) as Session | null;
	});
}

/**
 * Update session status
 */
export function updateSessionStatus(
	db: Database,
	sessionId: string,
	status: "active" | "completed" | "failed"
): void {
	retryWithBackoff(() => {
		const now = new Date().toISOString();
		const nowEpoch = Date.now();

		const stmt = db.prepare(`
			UPDATE sessions
			SET status = ?, completed_at = ?, completed_at_epoch = ?
			WHERE session_id = ?
		`);

		stmt.run(status, now, nowEpoch, sessionId);
	});
}

/**
 * Mark session as processing (set processing_started_at timestamp)
 */
export function markSessionProcessing(
	db: Database,
	sessionId: string
): void {
	retryWithBackoff(() => {
		const nowEpoch = Date.now();

		const stmt = db.prepare(`
			UPDATE sessions
			SET processing_started_at = ?
			WHERE session_id = ?
		`);

		stmt.run(nowEpoch, sessionId);
	});
}

/**
 * Get sessions that have been processing for too long
 * Used for cleanup of stale background processes
 */
export function getStaleProcessingSessions(
	db: Database,
	timeoutMinutes: number
): Session[] {
	return retryWithBackoff(() => {
		const cutoffEpoch = Date.now() - timeoutMinutes * 60 * 1000;

		const stmt = db.prepare(`
			SELECT * FROM sessions
			WHERE status = ?
			  AND processing_started_at IS NOT NULL
			  AND processing_started_at < ?
		`);

		return stmt.all("active", cutoffEpoch) as Session[];
	});
}

/**
 * Atomically mark stale processing sessions as failed
 * Uses WHERE clause to prevent race with background processes that just started
 */
export function cleanupStaleProcessingSessions(
	db: Database,
	timeoutMinutes: number
): number {
	return retryWithBackoff(() => {
		const cutoffEpoch = Date.now() - timeoutMinutes * 60 * 1000;
		const now = new Date().toISOString();
		const nowEpoch = Date.now();

		const stmt = db.prepare(`
			UPDATE sessions
			SET status = ?, completed_at = ?, completed_at_epoch = ?
			WHERE status = ?
			  AND processing_started_at IS NOT NULL
			  AND processing_started_at < ?
		`);

		const result = stmt.run("failed", now, nowEpoch, "active", cutoffEpoch);
		return result.changes;
	});
}

/**
 * Get all active sessions
 */
export function getActiveSessions(db: Database): Session[] {
	return retryWithBackoff(() => {
		const stmt = db.prepare("SELECT * FROM sessions WHERE status = ?");
		return stmt.all("active") as Session[];
	});
}

/**
 * Get orphan sessions (active but older than timeout)
 */
export function getOrphanSessions(
	db: Database,
	timeoutHours: number
): Session[] {
	return retryWithBackoff(() => {
		const cutoffEpoch = Date.now() - timeoutHours * 60 * 60 * 1000;

		const stmt = db.prepare(`
			SELECT * FROM sessions
			WHERE status = ? AND started_at_epoch < ?
		`);

		return stmt.all("active", cutoffEpoch) as Session[];
	});
}

/**
 * Delete session and all related data
 */
export function deleteSession(db: Database, sessionId: string): void {
	retryWithBackoff(() => {
		// Foreign keys will cascade delete related records
		const stmt = db.prepare("DELETE FROM sessions WHERE session_id = ?");
		stmt.run(sessionId);
	});
}

/**
 * Clean up old sessions beyond retention limit
 */
export function cleanupOldSessions(db: Database, retentionCount: number): void {
	retryWithBackoff(() => {
		// Get sessions to delete (oldest completed/failed sessions beyond retention)
		const stmt = db.prepare(`
			SELECT session_id FROM sessions
			WHERE status IN ('completed', 'failed')
			ORDER BY completed_at_epoch DESC
			LIMIT -1 OFFSET ?
		`);

		const sessionsToDelete = stmt.all(retentionCount) as Array<{
			session_id: string;
		}>;

		// Delete each session
		const deleteStmt = db.prepare("DELETE FROM sessions WHERE session_id = ?");
		for (const session of sessionsToDelete) {
			deleteStmt.run(session.session_id);
		}
	});
}

// ============================================================================
// User Prompt Operations
// ============================================================================

/**
 * Add user prompt
 */
export function addUserPrompt(
	db: Database,
	sessionId: string,
	promptNumber: number,
	promptText: string
): void {
	retryWithBackoff(() => {
		const now = new Date().toISOString();
		const nowEpoch = Date.now();

		const stmt = db.prepare(`
			INSERT INTO user_prompts (session_id, prompt_number, prompt_text, created_at, created_at_epoch)
			VALUES (?, ?, ?, ?, ?)
		`);

		stmt.run(sessionId, promptNumber, promptText, now, nowEpoch);
	});
}

/**
 * Get all prompts for a session
 */
export function getSessionPrompts(
	db: Database,
	sessionId: string
): UserPrompt[] {
	return retryWithBackoff(() => {
		const stmt = db.prepare(`
			SELECT * FROM user_prompts
			WHERE session_id = ?
			ORDER BY prompt_number ASC
		`);

		return stmt.all(sessionId) as UserPrompt[];
	});
}

/**
 * Get the next prompt number for a session
 * Returns 1 if no prompts exist, otherwise max + 1
 */
export function getNextPromptNumber(db: Database, sessionId: string): number {
	return retryWithBackoff(() => {
		const stmt = db.prepare(`
			SELECT MAX(prompt_number) as max_num FROM user_prompts
			WHERE session_id = ?
		`);

		const result = stmt.get(sessionId) as { max_num: number | null } | null;
		return (result?.max_num ?? 0) + 1;
	});
}

/**
 * Get the current prompt number for a session (for tool uses)
 * Returns the max prompt number, or 1 if no prompts recorded yet
 */
export function getCurrentPromptNumber(db: Database, sessionId: string): number {
	return retryWithBackoff(() => {
		const stmt = db.prepare(`
			SELECT MAX(prompt_number) as max_num FROM user_prompts
			WHERE session_id = ?
		`);

		const result = stmt.get(sessionId) as { max_num: number | null } | null;
		return result?.max_num ?? 1;
	});
}

// ============================================================================
// Tool Use Operations
// ============================================================================

/**
 * Add tool use with automatic truncation and redaction
 */
export function addToolUse(
	db: Database,
	sessionId: string,
	promptNumber: number,
	toolName: string,
	toolInput: string,
	toolOutput: string,
	maxOutputSize: number,
	durationMs?: number,
	cwd?: string
): void {
	retryWithBackoff(() => {
		const now = new Date().toISOString();
		const nowEpoch = Date.now();

		// Redact sensitive data from input and output
		const redactedInput = redactSensitiveData(toolInput);
		let redactedOutput = redactSensitiveData(toolOutput);

		// Truncate output if needed
		const { content: finalOutput, truncated } = truncateContent(
			redactedOutput,
			maxOutputSize
		);

		// Generate hash of original output if truncated
		const outputHash = truncated
			? createHash("sha256").update(redactedOutput).digest("hex")
			: null;

		const stmt = db.prepare(`
			INSERT INTO tool_uses (
				session_id, prompt_number, tool_name, tool_input, tool_output,
				tool_output_truncated, tool_output_hash, duration_ms, cwd,
				created_at, created_at_epoch
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);

		stmt.run(
			sessionId,
			promptNumber,
			toolName,
			redactedInput,
			finalOutput,
			truncated ? 1 : 0,
			outputHash,
			durationMs ?? null,
			cwd ?? null,
			now,
			nowEpoch
		);
	});
}

/**
 * Get all tool uses for a session
 */
export function getSessionToolUses(db: Database, sessionId: string): ToolUse[] {
	return retryWithBackoff(() => {
		const stmt = db.prepare(`
			SELECT * FROM tool_uses
			WHERE session_id = ?
			ORDER BY prompt_number ASC, created_at_epoch ASC
		`);

		return stmt.all(sessionId) as ToolUse[];
	});
}

/**
 * Get tool uses for a specific prompt
 */
export function getPromptToolUses(
	db: Database,
	sessionId: string,
	promptNumber: number
): ToolUse[] {
	return retryWithBackoff(() => {
		const stmt = db.prepare(`
			SELECT * FROM tool_uses
			WHERE session_id = ? AND prompt_number = ?
			ORDER BY created_at_epoch ASC
		`);

		return stmt.all(sessionId, promptNumber) as ToolUse[];
	});
}

// ============================================================================
// File Read Operations
// ============================================================================

/**
 * Add file read record with deduplication
 */
export function addFileRead(
	db: Database,
	sessionId: string,
	filePath: string,
	content: string,
	maxReadsPerFile: number
): void {
	retryWithBackoff(() => {
		const now = new Date().toISOString();
		const nowEpoch = Date.now();

		// Generate content hash
		const contentHash = createHash("sha256").update(content).digest("hex");

		// Check for duplicate
		const existingStmt = db.prepare(`
			SELECT id FROM file_reads
			WHERE session_id = ? AND file_path = ? AND content_hash = ?
		`);

		const existing = existingStmt.get(sessionId, filePath, contentHash);
		if (existing) {
			// Already recorded this exact read
			return;
		}

		// Create snippet (first 1KB)
		const contentSnippet =
			content.length > 1024 ? content.substring(0, 1024) : content;

		// Count lines
		const lineCount = content.split("\n").length;

		// Add new read
		const insertStmt = db.prepare(`
			INSERT INTO file_reads (
				session_id, file_path, content_hash, content_snippet,
				line_count, created_at, created_at_epoch
			)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`);

		insertStmt.run(
			sessionId,
			filePath,
			contentHash,
			contentSnippet,
			lineCount,
			now,
			nowEpoch
		);

		// Enforce max reads per file
		cleanupExcessFileReads(db, sessionId, filePath, maxReadsPerFile);
	});
}

/**
 * Clean up excess file reads beyond limit
 */
function cleanupExcessFileReads(
	db: Database,
	sessionId: string,
	filePath: string,
	maxReads: number
): void {
	const stmt = db.prepare(`
		SELECT id FROM file_reads
		WHERE session_id = ? AND file_path = ?
		ORDER BY created_at_epoch DESC
		LIMIT -1 OFFSET ?
	`);

	const oldReads = stmt.all(sessionId, filePath, maxReads) as Array<{
		id: number;
	}>;

	if (oldReads.length > 0) {
		const deleteStmt = db.prepare("DELETE FROM file_reads WHERE id = ?");
		for (const read of oldReads) {
			deleteStmt.run(read.id);
		}
	}
}

/**
 * Get all file reads for a session
 */
export function getSessionFileReads(db: Database, sessionId: string): FileRead[] {
	return retryWithBackoff(() => {
		const stmt = db.prepare(`
			SELECT * FROM file_reads
			WHERE session_id = ?
			ORDER BY created_at_epoch ASC
		`);

		return stmt.all(sessionId) as FileRead[];
	});
}

// ============================================================================
// Session Summary Operations
// ============================================================================

/**
 * Create or update session summary
 */
export function upsertSessionSummary(
	db: Database,
	sessionId: string,
	project: string,
	summary: Partial<Omit<SessionSummary, "id" | "session_id" | "project" | "created_at" | "created_at_epoch">>
): void {
	retryWithBackoff(() => {
		const now = new Date().toISOString();
		const nowEpoch = Date.now();

		const stmt = db.prepare(`
			INSERT INTO session_summaries (
				session_id, project, request, investigated, learned, completed,
				next_steps, written_to_vault, written_notes, error_message,
				created_at, created_at_epoch
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(session_id) DO UPDATE SET
				request = excluded.request,
				investigated = excluded.investigated,
				learned = excluded.learned,
				completed = excluded.completed,
				next_steps = excluded.next_steps,
				written_to_vault = excluded.written_to_vault,
				written_notes = excluded.written_notes,
				error_message = excluded.error_message
		`);

		stmt.run(
			sessionId,
			project,
			summary.request ?? null,
			summary.investigated ?? null,
			summary.learned ?? null,
			summary.completed ?? null,
			summary.next_steps ?? null,
			summary.written_to_vault ?? 0,
			summary.written_notes ?? null,
			summary.error_message ?? null,
			now,
			nowEpoch
		);
	});
}

/**
 * Get session summary
 */
export function getSessionSummary(
	db: Database,
	sessionId: string
): SessionSummary | null {
	return retryWithBackoff(() => {
		const stmt = db.prepare(
			"SELECT * FROM session_summaries WHERE session_id = ?"
		);
		return stmt.get(sessionId) as SessionSummary | null;
	});
}

// ============================================================================
// Full-Text Search Operations
// ============================================================================

/**
 * Search user prompts using FTS5
 */
export function searchPrompts(
	db: Database,
	query: string,
	limit: number = 50
): UserPrompt[] {
	return retryWithBackoff(() => {
		const stmt = db.prepare(`
			SELECT p.* FROM user_prompts p
			INNER JOIN user_prompts_fts f ON p.id = f.rowid
			WHERE user_prompts_fts MATCH ?
			ORDER BY rank
			LIMIT ?
		`);

		return stmt.all(query, limit) as UserPrompt[];
	});
}

/**
 * Search tool uses using FTS5
 */
export function searchToolUses(
	db: Database,
	query: string,
	limit: number = 50
): ToolUse[] {
	return retryWithBackoff(() => {
		const stmt = db.prepare(`
			SELECT t.* FROM tool_uses t
			INNER JOIN tool_uses_fts f ON t.id = f.rowid
			WHERE tool_uses_fts MATCH ?
			ORDER BY rank
			LIMIT ?
		`);

		return stmt.all(query, limit) as ToolUse[];
	});
}
