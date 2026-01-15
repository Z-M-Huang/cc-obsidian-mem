/**
 * AI-powered summarization engine
 * Reads session data from SQLite and extracts knowledge to Obsidian vault
 */

import { Database } from "bun:sqlite";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { initDatabase, closeDatabase } from "../sqlite/database.js";
import {
	getSession,
	getSessionPrompts,
	getSessionToolUses,
	getSessionFileReads,
	upsertSessionSummary,
} from "../sqlite/session-store.js";
import { loadConfig, getConfigDir, AGENT_SESSION_MARKER } from "../shared/config.js";
import { createLogger, Logger } from "../shared/logger.js";
import {
	ensureProjectStructure,
	buildParentLink,
	findExistingTopicNote,
	appendToExistingNote,
} from "../vault/vault-manager.js";
import { generateFilename } from "../vault/note-builder.js";
import {
	KNOWLEDGE_EXTRACTION_SYSTEM_PROMPT,
	buildSessionPrompt,
} from "./prompts.js";
import type { CompletionMarker } from "../shared/types.js";

interface ExtractedKnowledge {
	decisions: Array<{ title: string; content: string; tags: string[] }>;
	patterns: Array<{ title: string; content: string; tags: string[] }>;
	errors: Array<{ title: string; content: string; solution: string; tags: string[] }>;
	learnings: Array<{ title: string; content: string; tags: string[] }>;
	qa: Array<{ question: string; answer: string; tags: string[] }>;
}

/**
 * Run summarization for a session
 * @param sessionId - Session ID to summarize
 * @param logger - Logger instance
 * @param db - Optional database connection (if not provided, will open new connection)
 */
export async function summarizeSession(
	sessionId: string,
	logger: Logger,
	db?: Database
): Promise<{ success: boolean; error?: string; writtenNotes: string[] }> {
	const config = loadConfig();
	const writtenNotes: string[] = [];
	let ownDb = false;

	try {
		// Initialize database if not provided
		if (!db) {
			db = initDatabase(config.sqlite.path!, logger);
			ownDb = true;
		}

		// Get session
		const session = getSession(db!, sessionId);
		if (!session) {
			if (ownDb) closeDatabase(db!, logger);
			return { success: false, error: "Session not found", writtenNotes: [] };
		}

		// Get session data
		const prompts = getSessionPrompts(db!, sessionId);
		const toolUses = getSessionToolUses(db!, sessionId);
		const fileReads = getSessionFileReads(db!, sessionId);

		logger.info("Retrieved session data", {
			prompts: prompts.length,
			toolUses: toolUses.length,
			fileReads: fileReads.length,
		});

		// Check if there's enough data to summarize
		if (prompts.length === 0 && toolUses.length < 5) {
			logger.info("Insufficient data for summarization, skipping");
			upsertSessionSummary(db!, sessionId, session.project, {
				written_to_vault: 1,
				written_notes: JSON.stringify([]),
			});
			if (ownDb) closeDatabase(db!, logger);
			return { success: true, writtenNotes: [] };
		}

		// Build user prompt with session data
		const userPrompt = buildSessionPrompt({
			project: session.project,
			prompts: prompts.map((p) => ({
				prompt_text: p.prompt_text,
				created_at: p.created_at,
			})),
			toolUses: toolUses.map((t) => ({
				tool_name: t.tool_name,
				tool_input: t.tool_input,
				tool_output: t.tool_output,
				created_at: t.created_at,
			})),
			fileReads: fileReads.map((f) => ({
				file_path: f.file_path,
				content_snippet: f.content_snippet || "",
				created_at: f.created_at,
			})),
		});

		logger.debug("Built prompts for Claude CLI", {
			systemPromptLength: KNOWLEDGE_EXTRACTION_SYSTEM_PROMPT.length,
			userPromptLength: userPrompt.length,
		});

		// Call Claude via CLI with proper system prompt separation
		const claudeOutput = await invokeClaudeCLI(
			KNOWLEDGE_EXTRACTION_SYSTEM_PROMPT,
			userPrompt,
			logger
		);

		// Parse JSON response
		const knowledge = parseKnowledgeResponse(claudeOutput, logger);

		if (!knowledge) {
			throw new Error("Failed to parse knowledge from Claude response");
		}

		// Write knowledge to vault
		const vaultPath = config.vault.path;
		const memFolder = config.vault.memFolder || "_claude-mem";

		// Ensure project structure exists and get normalized slug
		const projectSlug = ensureProjectStructure(session.project);
		const projectPath = join(vaultPath, memFolder, "projects", projectSlug);

		// Write each type of knowledge (use slug for consistent paths)
		if (knowledge.decisions.length > 0) {
			for (const decision of knowledge.decisions) {
				const notePath = writeKnowledgeNote(
					projectPath,
					"decisions",
					decision.title,
					decision.content,
					decision.tags,
					projectSlug,
					memFolder
				);
				if (notePath) {
					writtenNotes.push(notePath);
				}
			}
		}

		if (knowledge.patterns.length > 0) {
			for (const pattern of knowledge.patterns) {
				const notePath = writeKnowledgeNote(
					projectPath,
					"patterns",
					pattern.title,
					pattern.content,
					pattern.tags,
					projectSlug,
					memFolder
				);
				if (notePath) {
					writtenNotes.push(notePath);
				}
			}
		}

		if (knowledge.errors.length > 0) {
			for (const error of knowledge.errors) {
				const content = `${error.content}\n\n## Solution\n${error.solution}`;
				const notePath = writeKnowledgeNote(
					projectPath,
					"errors",
					error.title,
					content,
					error.tags,
					projectSlug,
					memFolder
				);
				if (notePath) {
					writtenNotes.push(notePath);
				}
			}
		}

		if (knowledge.learnings.length > 0) {
			for (const learning of knowledge.learnings) {
				const notePath = writeKnowledgeNote(
					projectPath,
					"research",
					learning.title,
					learning.content,
					learning.tags,
					projectSlug,
					memFolder
				);
				if (notePath) {
					writtenNotes.push(notePath);
				}
			}
		}

		if (knowledge.qa.length > 0) {
			for (const qa of knowledge.qa) {
				const content = `## Question\n${qa.question}\n\n## Answer\n${qa.answer}`;
				const notePath = writeKnowledgeNote(
					projectPath,
					"research",
					`QA: ${qa.question.substring(0, 50)}`,
					content,
					qa.tags,
					projectSlug,
					memFolder
				);
				if (notePath) {
					writtenNotes.push(notePath);
				}
			}
		}

		// Update session summary
		upsertSessionSummary(db!, sessionId, session.project, {
			written_to_vault: 1,
			written_notes: JSON.stringify(writtenNotes),
		});

		logger.info("Summarization completed", { notesWritten: writtenNotes.length });

		if (ownDb) closeDatabase(db!, logger);
		return { success: true, writtenNotes };
	} catch (error) {
		logger.error("Summarization failed", { error });
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
			writtenNotes,
		};
	}
}

/**
 * Invoke Claude CLI with proper system prompt separation
 */
async function invokeClaudeCLI(
	systemPrompt: string,
	userPrompt: string,
	logger: Logger
): Promise<string> {
	return new Promise((resolve, reject) => {
		// Use --system-prompt for extraction instructions, stdin for session data
		const args = [
			"-p",
			"--system-prompt",
			systemPrompt,
			"--output-format",
			"text",
		];

		logger.debug("Invoking Claude CLI", { argsCount: args.length });

		const child = spawn("claude", args, {
			stdio: ["pipe", "pipe", "pipe"], // Enable stdin
			env: { ...process.env, [AGENT_SESSION_MARKER]: "1" },
			windowsHide: true, // Prevent cmd popup on Windows
		});

		// Write session data to stdin
		child.stdin.write(userPrompt);
		child.stdin.end();

		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (data) => {
			stdout += data.toString();
		});

		child.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		child.on("close", (code) => {
			if (code === 0) {
				logger.debug("Claude CLI completed successfully", {
					stdoutLength: stdout.length,
					stderrLength: stderr.length,
				});
				resolve(stdout);
			} else {
				logger.error("Claude CLI failed", { code, stderr: stderr.substring(0, 500) });
				reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
			}
		});

		child.on("error", (error) => {
			reject(error);
		});

		// Timeout after 5 minutes
		setTimeout(() => {
			child.kill("SIGTERM");
			reject(new Error("Claude CLI timeout after 5 minutes"));
		}, 5 * 60 * 1000);
	});
}

/**
 * Parse knowledge JSON from Claude response
 */
function parseKnowledgeResponse(
	response: string,
	logger: Logger
): ExtractedKnowledge | null {
	logger.debug("parseKnowledgeResponse called", {
		responseLength: response?.length ?? 0,
		responsePreview: response?.substring(0, 200) ?? "null/undefined",
	});

	if (!response || response.trim().length === 0) {
		logger.warn("Empty response from Claude CLI");
		return null;
	}

	try {
		// Try to find JSON in the response
		const jsonMatch = response.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			logger.warn("No JSON found in response", {
				responsePreview: response.substring(0, 500),
			});
			return null;
		}

		logger.debug("Found JSON in response", {
			jsonLength: jsonMatch[0].length,
		});

		const parsed = JSON.parse(jsonMatch[0]);

		// Validate structure
		const result = {
			decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
			patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
			errors: Array.isArray(parsed.errors) ? parsed.errors : [],
			learnings: Array.isArray(parsed.learnings) ? parsed.learnings : [],
			qa: Array.isArray(parsed.qa) ? parsed.qa : [],
		};

		logger.debug("Parsed knowledge", {
			decisions: result.decisions.length,
			patterns: result.patterns.length,
			errors: result.errors.length,
			learnings: result.learnings.length,
			qa: result.qa.length,
		});

		return result;
	} catch (error) {
		logger.error("Failed to parse knowledge response", {
			error: (error as Error).message,
			responsePreview: response.substring(0, 500),
		});
		return null;
	}
}

/**
 * Ensure project directories exist
 */
function ensureDirectories(projectPath: string): void {
	const dirs = ["decisions", "patterns", "errors", "research", "sessions"];
	for (const dir of dirs) {
		const dirPath = join(projectPath, dir);
		if (!existsSync(dirPath)) {
			mkdirSync(dirPath, { recursive: true });
		}
	}
}

/**
 * Write a knowledge note to the vault (with topic-based deduplication)
 * Checks for existing notes with same topic slug and appends if found
 */
function writeKnowledgeNote(
	projectPath: string,
	category: string,
	title: string,
	content: string,
	tags: string[],
	project: string,
	memFolder: string
): string | null {
	try {
		// Check for existing note with same topic
		const existingNotePath = findExistingTopicNote(projectPath, category, title);

		if (existingNotePath) {
			// Append to existing note
			const success = appendToExistingNote(existingNotePath, content, tags);
			return success ? existingNotePath : null;
		}

		// Create new note with topic-based filename
		const filename = generateFilename(title);
		const filePath = join(projectPath, category, filename);

		const parentLink = buildParentLink(memFolder, project, category);
		const frontmatter = `---
type: ${category === "research" ? "learning" : category.slice(0, -1)}
title: "${title.replace(/"/g, '\\"')}"
project: "${project}"
created: ${new Date().toISOString()}
tags: [${tags.map((t) => `"${t}"`).join(", ")}]
status: active
parent: "${parentLink}"
entry_count: 1
---

`;

		const fullContent = frontmatter + content;
		writeFileSync(filePath, fullContent, "utf-8");

		return filePath;
	} catch (error) {
		console.error("Failed to write knowledge note", { error, projectPath, category, title });
		return null;
	}
}

/**
 * Write completion marker
 */
export function writeCompletionMarker(
	sessionId: string,
	success: boolean,
	writtenNotes: string[],
	errorMessage?: string
): void {
	const markerDir = join(getConfigDir(), "completed");
	if (!existsSync(markerDir)) {
		mkdirSync(markerDir, { recursive: true });
	}

	const marker: CompletionMarker = {
		completed_at: new Date().toISOString(),
		written_notes: writtenNotes,
		success,
		error_message: errorMessage,
	};

	const markerPath = join(markerDir, `${sessionId}.marker`);
	writeFileSync(markerPath, JSON.stringify(marker, null, 2), "utf-8");
}
