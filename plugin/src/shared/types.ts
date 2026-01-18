/**
 * TypeScript type definitions for cc-obsidian-mem v2
 * SQLite + Obsidian architecture
 */

// ============================================================================
// Configuration Types
// ============================================================================

export interface ProcessingConfig {
	stalenessTimeoutMinutes: number;
	pidValidationTimeoutMs: number;
	spawnVerifyDelayMs: number;
}

export interface StylingConfig {
	enabled?: boolean;
	graphColors?: boolean;
	cssSnippet?: boolean;
	canvasColors?: boolean;
	colors?: Partial<ColorMap>;
}

export interface ColorInfo {
	hex: string;
	rgb_int: number;
	canvas_preset: string;
}

export type ColorMap = Record<string, ColorInfo>;

export interface StylingResult {
	success: boolean;
	cssCreated?: boolean;
	graphUpdated?: boolean;
	error?: string;
	reason?: string;
}

export interface Config {
	vault: {
		path: string;
		memFolder?: string;
	};
	sqlite: {
		path?: string;
		retention?: {
			sessions?: number;
			orphan_timeout_hours?: number;
			file_reads_per_file?: number;
		};
		max_output_size?: number;
	};
	logging?: {
		verbose?: boolean;
		logDir?: string;
	};
	canvas?: {
		enabled?: boolean;
		autoGenerate?: boolean;
		updateStrategy?: "always" | "skip";
	};
	styling?: StylingConfig;
	processing?: ProcessingConfig;
	defaultProject?: string;
}

// ============================================================================
// Database Record Types
// ============================================================================

export interface Session {
	id: number;
	session_id: string;
	project: string;
	started_at: string;
	started_at_epoch: number;
	completed_at: string | null;
	completed_at_epoch: number | null;
	status: "active" | "completed" | "failed";
}

export interface UserPrompt {
	id: number;
	session_id: string;
	prompt_number: number;
	prompt_text: string;
	created_at: string;
	created_at_epoch: number;
}

export interface ToolUse {
	id: number;
	session_id: string;
	prompt_number: number;
	tool_name: string;
	tool_input: string;
	tool_output: string;
	tool_output_truncated: number;
	tool_output_hash: string | null;
	duration_ms: number | null;
	cwd: string | null;
	created_at: string;
	created_at_epoch: number;
}

export interface FileRead {
	id: number;
	session_id: string;
	file_path: string;
	content_hash: string;
	content_snippet: string | null;
	line_count: number | null;
	created_at: string;
	created_at_epoch: number;
}

export interface SessionSummary {
	id: number;
	session_id: string;
	project: string;
	request: string | null;
	investigated: string | null;
	learned: string | null;
	completed: string | null;
	next_steps: string | null;
	written_to_vault: number;
	written_notes: string | null;
	error_message: string | null;
	created_at: string;
	created_at_epoch: number;
}

// ============================================================================
// Hook Payload Types
// ============================================================================

export interface SessionStartPayload {
	sessionId: string;
	cwd: string;
}

export interface UserPromptSubmitPayload {
	sessionId: string;
	promptNumber: number;
	promptText: string;
}

export interface PostToolUsePayload {
	sessionId: string;
	promptNumber: number;
	toolName: string;
	toolInput: string;
	toolOutput: string;
	durationMs?: number;
	cwd?: string;
}

export interface StopPayload {
	sessionId: string;
}

// ============================================================================
// MCP Tool Types
// ============================================================================

export interface MemSearchArgs {
	query: string;
	type?: "error" | "decision" | "pattern" | "file" | "learning" | "knowledge";
	limit?: number;
}

export interface MemReadArgs {
	path: string;
	section?: string;
}

export interface MemWriteArgs {
	type: "error" | "decision" | "pattern" | "file" | "learning";
	title: string;
	content: string;
	project?: string;
	tags?: string[];
	status?: "active" | "superseded" | "draft";
}

export interface MemSupersedeArgs {
	oldNotePath: string;
	type: "error" | "decision" | "pattern" | "file" | "learning";
	title: string;
	content: string;
	project?: string;
	tags?: string[];
}

export interface MemProjectContextArgs {
	project: string;
	includeErrors?: boolean;
	includeDecisions?: boolean;
	includePatterns?: boolean;
	generateCanvas?: boolean;
}

// ============================================================================
// Observation Types (Real-time SDK extraction)
// ============================================================================

export type ObservationType =
	| "decision"
	| "bugfix"
	| "feature"
	| "refactor"
	| "discovery"
	| "change"
	| "error"
	| "pattern";

export interface Observation {
	id: number;
	session_id: string;
	project: string;
	type: ObservationType;
	title: string;
	subtitle: string | null;
	facts: string | null; // JSON array as string
	concepts: string | null; // JSON array as string
	narrative: string | null;
	files_read: string | null; // JSON array as string
	files_modified: string | null; // JSON array as string
	discovery_tokens: number | null;
	created_at: string;
	created_at_epoch: number;
}

export interface ParsedObservation {
	type: ObservationType;
	title: string;
	subtitle?: string;
	facts: string[];
	concepts: string[];
	narrative?: string;
	files_read: string[];
	files_modified: string[];
}

// ============================================================================
// Pending Message Types (Claim-and-delete queue)
// ============================================================================

export type PendingMessageType = "tool_use" | "prompt" | "summary_request";

export interface PendingMessage {
	id: number;
	session_id: string;
	message_type: PendingMessageType;
	payload: string; // JSON serialized
	claimed_at: string | null;
	claimed_at_epoch: number | null;
	created_at: string;
	created_at_epoch: number;
}

// ============================================================================
// Mode Configuration Types (Pluggable observation types)
// ============================================================================

export interface ObservationTypeConfig {
	id: ObservationType;
	label: string;
	description: string;
	emoji: string;
}

export interface ConceptConfig {
	id: string;
	label: string;
	description: string;
}

export interface ModePrompts {
	system_identity: string;
	observer_role: string;
	spatial_awareness: string;
	recording_focus: string;
	skip_guidance: string;
	output_format_header: string;
	type_guidance: string;
	field_guidance: string;
	concept_guidance: string;
	format_examples: string;
	footer: string;
	header_memory_start: string;
	header_memory_continued: string;
	continuation_greeting: string;
	continuation_instruction: string;
	header_summary_checkpoint: string;
	summary_instruction: string;
	summary_context_label: string;
	summary_format_instruction: string;
	summary_footer: string;
	xml_title_placeholder: string;
	xml_subtitle_placeholder: string;
	xml_fact_placeholder: string;
	xml_narrative_placeholder: string;
	xml_concept_placeholder: string;
	xml_file_placeholder: string;
	xml_summary_request_placeholder: string;
	xml_summary_investigated_placeholder: string;
	xml_summary_learned_placeholder: string;
	xml_summary_completed_placeholder: string;
	xml_summary_next_steps_placeholder: string;
	xml_summary_notes_placeholder: string;
}

export interface ModeConfig {
	id: string;
	name: string;
	description: string;
	observation_types: ObservationTypeConfig[];
	observation_concepts: ConceptConfig[];
	prompts: ModePrompts;
}

// ============================================================================
// SDK Session Types
// ============================================================================

export interface SDKSession {
	id: number;
	session_id: string;
	memory_session_id: string | null;
	project: string;
	user_prompt: string;
	worker_port: number | null;
	prompt_counter: number;
	last_assistant_message: string | null;
}

// ============================================================================
// Context Types
// ============================================================================

export interface ContextInput {
	cwd?: string;
	session_id?: string;
	projects?: string[];
}

export interface ContextConfig {
	observationCount: number;
	sessionCount: number;
	fullObservationCount: number;
	maxTokens: number;
}

export interface TokenEconomics {
	totalObservations: number;
	estimatedTokens: number;
	truncated: boolean;
}

// ============================================================================
// Fallback Storage Types
// ============================================================================

export interface FallbackSession {
	session_id: string;
	project: string;
	started_at: string;
	started_at_epoch: number;
	status: "active" | "completed" | "failed";
}

export interface FallbackData {
	session: FallbackSession;
	prompts: Array<Omit<UserPrompt, "id">>;
	tool_uses: Array<Omit<ToolUse, "id">>;
	file_reads: Array<Omit<FileRead, "id">>;
}

// ============================================================================
// Completion Marker Types
// ============================================================================

export interface CompletionMarker {
	completed_at: string;
	written_notes: string[];
	success: boolean;
	error_message?: string;
}

// ============================================================================
// Logger Types
// ============================================================================

export interface LogContext {
	sessionId?: string;
	project?: string;
	[key: string]: unknown;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

// ============================================================================
// Knowledge Note Types (for Obsidian vault)
// ============================================================================

export type NoteType = "error" | "decision" | "pattern" | "file" | "learning";
export type NoteStatus = "active" | "superseded" | "draft";

export interface NoteFrontmatter {
	type: NoteType;
	title: string;
	project: string;
	created: string;
	updated?: string;
	tags: string[];
	status?: NoteStatus;
	superseded_by?: string;
	supersedes?: string[];
	parent?: string;
	[key: string]: unknown;
}
