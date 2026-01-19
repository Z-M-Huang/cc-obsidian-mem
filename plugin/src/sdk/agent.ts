/**
 * SDK Agent for Real-time Observation Extraction
 * Processes tool uses and extracts structured observations using Claude
 */

import type { Database } from "bun:sqlite";
import type { PendingMessage, ParsedObservation, ModeConfig } from "../shared/types.js";
import type { Logger } from "../shared/logger.js";
import { parsePayload } from "../sqlite/pending-store.js";
import { createObservations } from "../sqlite/observations-store.js";
import { upsertSessionSummary, getSession } from "../sqlite/session-store.js";
import { parseObservations, parseSummary } from "./parser.js";
import {
	loadModeConfig,
	buildInitPrompt,
	buildObservationPrompt,
	buildSummaryPrompt,
	buildContinuationPrompt,
	buildObservationFormatInstructions,
} from "../shared/mode-config.js";
import { AGENT_SESSION_MARKER, checkClaudeVersion, MIN_CLAUDE_VERSION } from "../shared/config.js";
import { spawnSync } from "child_process";

// Track if we've already warned about version
let versionCheckDone = false;

// ============================================================================
// Types
// ============================================================================

interface ToolUsePayload {
	tool_name: string;
	tool_input: string;
	tool_output: string;
	duration_ms?: number;
	cwd?: string;
	created_at_epoch: number;
}

interface PromptPayload {
	prompt_text: string;
	prompt_number: number;
}

interface SummaryRequestPayload {
	last_assistant_message?: string;
}

interface AgentContext {
	sessionId: string;
	project: string;
	mode: ModeConfig;
	promptNumber: number;
	conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
}

// ============================================================================
// Agent State Management
// ============================================================================

const agentContexts = new Map<string, AgentContext>();

/**
 * Get or create agent context for a session
 */
function getAgentContext(sessionId: string, project: string): AgentContext {
	let context = agentContexts.get(sessionId);
	if (!context) {
		context = {
			sessionId,
			project,
			mode: loadModeConfig(),
			promptNumber: 0,
			conversationHistory: [],
		};
		agentContexts.set(sessionId, context);
	}
	return context;
}

/**
 * Clear agent context for a session
 */
export function clearAgentContext(sessionId: string): void {
	agentContexts.delete(sessionId);
}

// ============================================================================
// Message Processing
// ============================================================================

/**
 * Process a batch of pending messages
 * Returns observations extracted from the batch
 */
export function processMessages(
	db: Database,
	messages: PendingMessage[],
	project: string,
	logger: Logger
): ParsedObservation[] {
	if (messages.length === 0) return [];

	const sessionId = messages[0].session_id;
	const context = getAgentContext(sessionId, project);

	// Group messages by type
	const toolUses: PendingMessage[] = [];
	const prompts: PendingMessage[] = [];
	const summaryRequests: PendingMessage[] = [];

	for (const msg of messages) {
		switch (msg.message_type) {
			case "tool_use":
				toolUses.push(msg);
				break;
			case "prompt":
				prompts.push(msg);
				break;
			case "summary_request":
				summaryRequests.push(msg);
				break;
		}
	}

	const allObservations: ParsedObservation[] = [];

	// Process prompts first (they set context)
	for (const msg of prompts) {
		const payload = parsePayload<PromptPayload>(msg);
		context.promptNumber = payload.prompt_number;

		// Build and add to conversation
		const prompt =
			context.promptNumber === 1
				? buildInitPrompt(project, sessionId, payload.prompt_text, context.mode)
				: buildContinuationPrompt(
						payload.prompt_text,
						context.promptNumber,
						sessionId,
						context.mode
					);

		context.conversationHistory.push({ role: "user", content: prompt });
		logger.debug("Added prompt to context", { promptNumber: context.promptNumber });
	}

	// Process tool uses
	if (toolUses.length > 0) {
		const observations = processToolUses(toolUses, context, logger);
		allObservations.push(...observations);

		// Store observations in database
		if (observations.length > 0) {
			createObservations(db, sessionId, project, observations);
			logger.info("Created observations", { count: observations.length });
		}
	}

	// Process summary requests
	for (const msg of summaryRequests) {
		const payload = parsePayload<SummaryRequestPayload>(msg);
		processSummaryRequest(db, sessionId, project, payload, context, logger);
	}

	return allObservations;
}

/**
 * Process tool uses and extract observations
 */
function processToolUses(
	messages: PendingMessage[],
	context: AgentContext,
	logger: Logger
): ParsedObservation[] {
	// Build observation prompts for all tool uses
	const toolPrompts: string[] = [];

	for (const msg of messages) {
		const payload = parsePayload<ToolUsePayload>(msg);
		const obsPrompt = buildObservationPrompt(payload);
		toolPrompts.push(obsPrompt);
	}

	// Combine into a single prompt
	const combinedPrompt = toolPrompts.join("\n\n");
	context.conversationHistory.push({ role: "user", content: combinedPrompt });

	// Call Claude to analyze
	const response = callClaude(context, logger);
	if (!response) {
		return [];
	}

	// Parse observations from response
	const observations = parseObservations(response, context.mode.observation_types[0]?.id || "discovery");

	logger.debug("Parsed observations from response", {
		count: observations.length,
		types: observations.map((o) => o.type),
	});

	return observations;
}

/**
 * Process a summary request
 */
function processSummaryRequest(
	db: Database,
	sessionId: string,
	project: string,
	payload: SummaryRequestPayload,
	context: AgentContext,
	logger: Logger
): void {
	const summaryPrompt = buildSummaryPrompt(
		payload.last_assistant_message || "",
		context.mode
	);

	context.conversationHistory.push({ role: "user", content: summaryPrompt });

	// Don't include observation format instructions for summary requests
	const response = callClaude(context, logger, { includeObservationFormat: false });
	if (!response) {
		logger.warn("No response from Claude for summary");
		return;
	}

	const summary = parseSummary(response);
	if (summary.skip) {
		logger.debug("Summary skipped by agent");
		return;
	}

	// Store summary
	upsertSessionSummary(db, sessionId, project, {
		request: summary.request,
		investigated: summary.investigated,
		learned: summary.learned,
		completed: summary.completed,
		next_steps: summary.next_steps,
	});

	logger.info("Stored session summary");
}

// ============================================================================
// Claude Invocation
// ============================================================================

interface CallClaudeOptions {
	includeObservationFormat?: boolean;
}

/**
 * Call Claude using CLI to avoid hook deadlock
 * Uses claude -p for single-turn prompts
 */
function callClaude(
	context: AgentContext,
	logger: Logger,
	options: CallClaudeOptions = { includeObservationFormat: true }
): string | null {
	// One-time version check with warning
	if (!versionCheckDone) {
		versionCheckDone = true;
		const versionInfo = checkClaudeVersion();
		if (!versionInfo.supported) {
			logger.warn("Claude CLI version check failed", {
				installed: versionInfo.version,
				required: MIN_CLAUDE_VERSION,
				reason: versionInfo.error,
				hint: `Claude CLI ${MIN_CLAUDE_VERSION}+ required for --no-session-persistence flag. ` +
					`Please upgrade: npm install -g @anthropic-ai/claude-code`,
			});
		}
	}

	// Build the full prompt from conversation history
	const lastUserMessage = context.conversationHistory
		.filter((m) => m.role === "user")
		.pop();

	if (!lastUserMessage) {
		logger.warn("No user message in conversation history");
		return null;
	}

	try {
		// Build system prompt with context
		const systemPrompt = context.mode.prompts.system_identity;

		// Only include observation format instructions when extracting observations
		// Summary requests have their own format defined in the prompt
		let fullPrompt: string;
		if (options.includeObservationFormat) {
			const formatInstructions = buildObservationFormatInstructions(context.mode);
			fullPrompt = `${systemPrompt}\n\n${formatInstructions}\n\n${lastUserMessage.content}`;
		} else {
			fullPrompt = `${systemPrompt}\n\n${lastUserMessage.content}`;
		}

		// Call Claude CLI with stdin input instead of temp file
		// Using "-p -" reads prompt from stdin, avoiding file path storage in session history
		// CRITICAL: --no-session-persistence prevents this session from being stored
		// Without it, --continue would pick up this agent session instead of user's actual conversation
		const result = spawnSync("claude", ["-p", "-", "--no-session-persistence", "--output-format", "text"], {
			input: fullPrompt,
			encoding: "utf-8",
			timeout: 120000, // 2 minute timeout
			maxBuffer: 10 * 1024 * 1024, // 10MB buffer
			env: { ...process.env, [AGENT_SESSION_MARKER]: "1" },
			windowsHide: true, // Prevent cmd popup on Windows
		});

		if (result.error) {
			logger.error("Claude CLI error", { error: result.error.message });
			return null;
		}

		if (result.status !== 0) {
			logger.error("Claude CLI failed", {
				status: result.status,
				stderr: result.stderr?.substring(0, 500),
			});
			return null;
		}

		const response = result.stdout?.trim();
		if (response) {
			// Add to conversation history
			context.conversationHistory.push({ role: "assistant", content: response });
		}

		return response || null;
	} catch (error) {
		logger.error("Error calling Claude", { error: (error as Error).message });
		return null;
	}
}

// ============================================================================
// Single Message Processing (for sync use)
// ============================================================================

/**
 * Process a single tool use and extract observations immediately
 * Use this for critical operations that need sync processing
 */
export function processSingleToolUse(
	db: Database,
	sessionId: string,
	project: string,
	toolUse: ToolUsePayload,
	logger: Logger
): ParsedObservation[] {
	const context = getAgentContext(sessionId, project);

	const obsPrompt = buildObservationPrompt(toolUse);
	context.conversationHistory.push({ role: "user", content: obsPrompt });

	const response = callClaude(context, logger);
	if (!response) {
		return [];
	}

	const observations = parseObservations(response);

	if (observations.length > 0) {
		createObservations(db, sessionId, project, observations);
	}

	return observations;
}

// ============================================================================
// Batch Processing Entry Point
// ============================================================================

/**
 * Process all pending messages for a session
 */
export function processSessionMessages(
	db: Database,
	sessionId: string,
	logger: Logger
): { observations: ParsedObservation[]; processed: number } {
	// Import here to avoid circular dependency
	const { claimAllMessages, deleteMessages } = require("../sqlite/pending-store.js");

	// Get session for project info
	const session = getSession(db, sessionId);
	if (!session) {
		logger.error("Session not found", { sessionId });
		return { observations: [], processed: 0 };
	}

	// Claim all pending messages
	const messages = claimAllMessages(db, sessionId);
	if (messages.length === 0) {
		return { observations: [], processed: 0 };
	}

	logger.info("Processing pending messages", { count: messages.length });

	try {
		// Process messages
		const observations = processMessages(db, messages, session.project, logger);

		// Delete processed messages
		deleteMessages(
			db,
			messages.map((m: PendingMessage) => m.id)
		);

		return { observations, processed: messages.length };
	} catch (error) {
		// Release messages on failure
		const { releaseMessages } = require("../sqlite/pending-store.js");
		releaseMessages(
			db,
			messages.map((m: PendingMessage) => m.id)
		);

		logger.error("Error processing messages", { error: (error as Error).message });
		throw error;
	}
}
