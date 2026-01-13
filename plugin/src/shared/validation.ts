/**
 * Input validation using Zod schemas
 * Prevents invalid data from entering the system
 */

import { z } from "zod";

// ============================================================================
// Hook Payload Schemas
// ============================================================================

// Claude Code sends snake_case fields, so we accept both formats
export const SessionStartPayloadSchema = z.object({
	session_id: z.string().min(1),
	cwd: z.string().min(1),
}).transform((data) => ({
	sessionId: data.session_id,
	cwd: data.cwd,
}));

export const UserPromptSubmitPayloadSchema = z.object({
	session_id: z.string().min(1),
	prompt_number: z.number().int().positive(),
	prompt: z.string(),
}).transform((data) => ({
	sessionId: data.session_id,
	promptNumber: data.prompt_number,
	promptText: data.prompt,
}));

export const PostToolUsePayloadSchema = z.object({
	session_id: z.string().min(1),
	prompt_number: z.number().int().positive(),
	tool_name: z.string().min(1),
	tool_input: z.string(),
	tool_response: z.string(),
	duration_ms: z.number().int().nonnegative().optional(),
	cwd: z.string().optional(),
}).transform((data) => ({
	sessionId: data.session_id,
	promptNumber: data.prompt_number,
	toolName: data.tool_name,
	toolInput: data.tool_input,
	toolOutput: data.tool_response,
	durationMs: data.duration_ms,
	cwd: data.cwd,
}));

export const StopPayloadSchema = z.object({
	session_id: z.string().min(1),
}).transform((data) => ({
	sessionId: data.session_id,
}));

// ============================================================================
// MCP Tool Argument Schemas
// ============================================================================

export const MemSearchArgsSchema = z.object({
	query: z.string().min(1),
	type: z.enum(["error", "decision", "pattern", "file", "learning", "knowledge"]).optional(),
	limit: z.number().int().positive().max(100).optional(),
});

export const MemReadArgsSchema = z.object({
	path: z.string().min(1),
	section: z.string().optional(),
});

export const MemWriteArgsSchema = z.object({
	type: z.enum(["error", "decision", "pattern", "file", "learning"]),
	title: z.string().min(1).max(200),
	content: z.string().min(1),
	project: z.string().min(1).max(100).optional(),
	tags: z.array(z.string()).optional(),
	status: z.enum(["active", "superseded", "draft"]).optional(),
});

export const MemSupersedeArgsSchema = z.object({
	oldNotePath: z.string().min(1),
	type: z.enum(["error", "decision", "pattern", "file", "learning"]),
	title: z.string().min(1).max(200),
	content: z.string().min(1),
	project: z.string().min(1).max(100).optional(),
	tags: z.array(z.string()).optional(),
});

export const MemProjectContextArgsSchema = z.object({
	project: z.string().min(1).max(100),
	includeErrors: z.boolean().optional(),
	includeDecisions: z.boolean().optional(),
	includePatterns: z.boolean().optional(),
	generateCanvas: z.boolean().optional(),
});

// ============================================================================
// Config Schema
// ============================================================================

export const ConfigSchema = z.object({
	vault: z.object({
		path: z.string().min(1),
		memFolder: z.string().min(1).optional(),
	}),
	sqlite: z.object({
		path: z.string().min(1).optional(),
		retention: z.object({
			sessions: z.number().int().positive().optional(),
			orphan_timeout_hours: z.number().int().positive().optional(),
			file_reads_per_file: z.number().int().positive().optional(),
		}).optional(),
		max_output_size: z.number().int().positive().optional(),
	}).optional(),
	logging: z.object({
		verbose: z.boolean().optional(),
		logDir: z.string().optional(),
	}).optional(),
	canvas: z.object({
		enabled: z.boolean().optional(),
		autoGenerate: z.boolean().optional(),
		updateStrategy: z.enum(["always", "skip"]).optional(),
	}).optional(),
	defaultProject: z.string().optional(),
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Validate and parse data with a schema
 * Throws ZodError if validation fails
 */
export function validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
	return schema.parse(data);
}

/**
 * Safely validate data, returning null if validation fails
 */
export function safeValidate<T>(schema: z.ZodSchema<T>, data: unknown): T | null {
	const result = schema.safeParse(data);
	return result.success ? result.data : null;
}
