/**
 * AI-based semantic matching for knowledge notes
 * Uses Claude CLI to find semantically similar notes
 */

import { spawnSync } from "child_process";
import { createLogger } from "../shared/logger.js";
import { AGENT_SESSION_MARKER, validateModel } from "../shared/config.js";
import type { Config } from "../shared/types.js";

export interface NoteInfo {
	path: string;
	title: string;
	category: string;
}

export interface SemanticMatch {
	path: string;
	category: string;
	title: string;
	confidence: "high" | "medium" | "low";
	genericTitle: string;
}

export interface DuplicateGroup {
	topic: string;
	notes: NoteInfo[];
	confidence: "high" | "medium" | "low";
}

interface AIMatchResponse {
	match: {
		index: number | null;
		confidence: "high" | "medium" | "low";
	};
	genericTitle: string;
}

interface AIGenericTitleResponse {
	genericTitle: string;
}

interface AIDuplicateGroupsResponse {
	groups: number[][];
	genericTitles: string[];
}

/**
 * Find semantically similar note using AI
 * @param title - The new note title to match
 * @param existingNotes - List of existing notes collected by caller
 * @param config - Full config object
 * @returns SemanticMatch or null if no match found or on error
 */
export function findSemanticMatch(
	title: string,
	existingNotes: NoteInfo[],
	config: Config
): SemanticMatch | null {
	const logger = createLogger({ verbose: config.logging?.verbose });

	if (!config.ai?.enabled) {
		return null;
	}

	if (existingNotes.length === 0) {
		return null;
	}

	// Build numbered list of existing notes (0-based for direct array indexing)
	const numberedList = existingNotes
		.map((note, i) => `${i}. [${note.category}] "${note.title}"`)
		.join("\n");

	const prompt = `You are analyzing note titles for semantic similarity.

NEW TITLE: "${title}"

EXISTING NOTES (0-indexed):
${numberedList}

Respond with JSON only:
{"match": {"index": <0-based number or null>, "confidence": "high"|"medium"|"low"}, "genericTitle": "<suggested generic title>"}

Rules:
- Return the 0-based index (0 for the first note, 1 for the second, etc.)
- high: Same topic, just different wording
- medium: Related topic, could reasonably be combined
- low: Different topics
- null index if no match`;

	try {
		const model = validateModel(config.ai?.model);
		const timeout = config.ai?.timeout ?? 30000;

		const result = spawnSync("claude", [
			"-p", "-",
			"--model", model,
			"--no-session-persistence",
			"--output-format", "text"
		], {
			input: prompt,
			encoding: "utf-8",
			timeout,
			maxBuffer: 1024 * 1024,
			env: { ...process.env, [AGENT_SESSION_MARKER]: "1" },
			windowsHide: true,
		});

		if (result.status !== 0 || result.error) {
			logger.debug("AI matching failed", {
				error: result.stderr || result.error?.message
			});
			return null;
		}

		const response = result.stdout.trim();
		return parseMatchResponse(response, existingNotes, logger);
	} catch (error) {
		logger.debug("AI matching error", { error: String(error) });
		return null;
	}
}

/**
 * Suggest a generic title that encompasses multiple specific titles
 * @param titles - List of titles to generalize
 * @param config - Full config object
 * @returns AI-suggested generic title or first title as fallback
 */
export function suggestGenericTitle(
	titles: string[],
	config: Config
): string {
	const logger = createLogger({ verbose: config.logging?.verbose });

	if (!config.ai?.enabled) {
		return titles[0] ?? "Untitled";
	}

	if (titles.length === 0) {
		return "Untitled";
	}

	if (titles.length === 1) {
		return titles[0];
	}

	const titlesList = titles.map((t, i) => `${i + 1}. "${t}"`).join("\n");

	const prompt = `Suggest a short, generic title that encompasses all these specific titles:
${titlesList}

Respond with JSON: {"genericTitle": "<title>"}`;

	try {
		const model = validateModel(config.ai?.model);
		const timeout = config.ai?.timeout ?? 30000;

		const result = spawnSync("claude", [
			"-p", "-",
			"--model", model,
			"--no-session-persistence",
			"--output-format", "text"
		], {
			input: prompt,
			encoding: "utf-8",
			timeout,
			maxBuffer: 1024 * 1024,
			env: { ...process.env, [AGENT_SESSION_MARKER]: "1" },
			windowsHide: true,
		});

		if (result.status !== 0 || result.error) {
			logger.debug("AI generic title suggestion failed", {
				error: result.stderr || result.error?.message
			});
			return titles[0];
		}

		const response = result.stdout.trim();
		return parseGenericTitleResponse(response, titles, logger);
	} catch (error) {
		logger.debug("AI generic title error", { error: String(error) });
		return titles[0];
	}
}

/**
 * Find groups of semantically similar notes (duplicates)
 * @param notes - Notes to analyze
 * @param config - Full config object
 * @returns Array of duplicate groups
 */
export function findDuplicateGroups(
	notes: NoteInfo[],
	config: Config
): DuplicateGroup[] {
	const logger = createLogger({ verbose: config.logging?.verbose });

	if (!config.ai?.enabled) {
		return [];
	}

	if (notes.length < 2) {
		return [];
	}

	// Build numbered list (0-based for direct array indexing)
	const numberedList = notes
		.map((note, i) => `${i}. [${note.category}] "${note.title}"`)
		.join("\n");

	const prompt = `Group these notes by semantic similarity (same topic, different wording).

NOTES (0-indexed):
${numberedList}

Respond with JSON using 0-based indices: {"groups": [[0,2,4], [1,3]], "genericTitles": ["Title for group 1", "Title for group 2"]}`;

	try {
		const model = validateModel(config.ai?.model);
		const timeout = config.ai?.timeout ?? 30000;

		const result = spawnSync("claude", [
			"-p", "-",
			"--model", model,
			"--no-session-persistence",
			"--output-format", "text"
		], {
			input: prompt,
			encoding: "utf-8",
			timeout,
			maxBuffer: 2 * 1024 * 1024,
			env: { ...process.env, [AGENT_SESSION_MARKER]: "1" },
			windowsHide: true,
		});

		if (result.status !== 0 || result.error) {
			logger.debug("AI duplicate detection failed", {
				error: result.stderr || result.error?.message
			});
			return [];
		}

		const response = result.stdout.trim();
		return parseDuplicateGroupsResponse(response, notes, logger);
	} catch (error) {
		logger.debug("AI duplicate detection error", { error: String(error) });
		return [];
	}
}

/**
 * Parse AI response for semantic matching
 * Uses unknown type and type guards for safety
 */
function parseMatchResponse(
	response: string,
	notes: NoteInfo[],
	logger: ReturnType<typeof createLogger>
): SemanticMatch | null {
	try {
		// Parse as unknown first
		const parsed: unknown = JSON.parse(response);

		// Type guard: check structure
		if (!isAIMatchResponse(parsed)) {
			logger.debug("Invalid AI match response structure", { response });
			return null;
		}

		// No match
		if (parsed.match.index === null) {
			return null;
		}

		// Validate index bounds
		if (parsed.match.index < 0 || parsed.match.index >= notes.length) {
			logger.debug("AI match index out of bounds", {
				index: parsed.match.index,
				notesLength: notes.length
			});
			return null;
		}

		// Validate genericTitle
		const genericTitle = validateTitle(parsed.genericTitle);
		if (!genericTitle) {
			logger.debug("Invalid generic title from AI", {
				genericTitle: parsed.genericTitle
			});
			return null;
		}

		const note = notes[parsed.match.index];
		return {
			path: note.path,
			category: note.category,
			title: note.title,
			confidence: parsed.match.confidence,
			genericTitle,
		};
	} catch (error) {
		logger.debug("Failed to parse AI match response", {
			error: String(error)
		});
		return null;
	}
}

/**
 * Parse AI response for generic title suggestion
 */
function parseGenericTitleResponse(
	response: string,
	fallbackTitles: string[],
	logger: ReturnType<typeof createLogger>
): string {
	try {
		const parsed: unknown = JSON.parse(response);

		if (!isAIGenericTitleResponse(parsed)) {
			logger.debug("Invalid AI generic title response structure", { response });
			return fallbackTitles[0];
		}

		const title = validateTitle(parsed.genericTitle);
		if (!title) {
			logger.debug("Invalid generic title from AI", {
				genericTitle: parsed.genericTitle
			});
			return fallbackTitles[0];
		}

		return title;
	} catch (error) {
		logger.debug("Failed to parse AI generic title response", {
			error: String(error)
		});
		return fallbackTitles[0];
	}
}

/**
 * Parse AI response for duplicate groups
 */
function parseDuplicateGroupsResponse(
	response: string,
	notes: NoteInfo[],
	logger: ReturnType<typeof createLogger>
): DuplicateGroup[] {
	try {
		const parsed: unknown = JSON.parse(response);

		if (!isAIDuplicateGroupsResponse(parsed)) {
			logger.debug("Invalid AI duplicate groups response structure", { response });
			return [];
		}

		const groups: DuplicateGroup[] = [];

		for (let i = 0; i < parsed.groups.length; i++) {
			const indices = parsed.groups[i];
			const genericTitle = parsed.genericTitles[i];

			if (!Array.isArray(indices) || indices.length < 2) {
				continue;
			}

			// Validate all indices
			const validIndices = indices.filter(
				idx => typeof idx === "number" && idx >= 0 && idx < notes.length
			);

			if (validIndices.length < 2) {
				continue;
			}

			const groupNotes = validIndices.map(idx => notes[idx]);

			groups.push({
				topic: validateTitle(genericTitle) ?? `Group ${i + 1}`,
				notes: groupNotes,
				confidence: "high", // Assume high confidence from AI
			});
		}

		return groups;
	} catch (error) {
		logger.debug("Failed to parse AI duplicate groups response", {
			error: String(error)
		});
		return [];
	}
}

/**
 * Type guard for AIMatchResponse
 */
function isAIMatchResponse(value: unknown): value is AIMatchResponse {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const obj = value as Record<string, unknown>;

	// Check match field
	if (typeof obj.match !== "object" || obj.match === null) {
		return false;
	}

	const match = obj.match as Record<string, unknown>;

	// index can be number or null
	if (typeof match.index !== "number" && match.index !== null) {
		return false;
	}

	// confidence must be one of the valid values
	if (
		match.confidence !== "high" &&
		match.confidence !== "medium" &&
		match.confidence !== "low"
	) {
		return false;
	}

	// genericTitle must be string
	if (typeof obj.genericTitle !== "string") {
		return false;
	}

	return true;
}

/**
 * Type guard for AIGenericTitleResponse
 */
function isAIGenericTitleResponse(value: unknown): value is AIGenericTitleResponse {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const obj = value as Record<string, unknown>;
	return typeof obj.genericTitle === "string";
}

/**
 * Type guard for AIDuplicateGroupsResponse
 */
function isAIDuplicateGroupsResponse(value: unknown): value is AIDuplicateGroupsResponse {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const obj = value as Record<string, unknown>;

	if (!Array.isArray(obj.groups) || !Array.isArray(obj.genericTitles)) {
		return false;
	}

	return true;
}

/**
 * Validate and sanitize title
 * Returns null if invalid
 */
function validateTitle(title: unknown): string | null {
	if (typeof title !== "string") {
		return null;
	}

	const trimmed = title.trim();

	// Must be non-empty
	if (trimmed.length === 0) {
		return null;
	}

	// Max 100 chars
	if (trimmed.length > 100) {
		return trimmed.substring(0, 100);
	}

	return trimmed;
}
