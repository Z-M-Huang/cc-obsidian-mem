/**
 * Configuration management for cc-obsidian-mem
 * Loads config from ~/.cc-obsidian-mem/config.json with defaults
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { Config } from "./types.js";

const CONFIG_DIR = join(homedir(), ".cc-obsidian-mem");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
export const LOCKS_DIR = join(CONFIG_DIR, "locks");

export const VALID_MODELS = ["sonnet", "haiku", "opus"] as const;

const DEFAULT_CONFIG: Config = {
	vault: {
		path: join(homedir(), "_claude-mem"),
		memFolder: "_claude-mem",
	},
	sqlite: {
		path: join(CONFIG_DIR, "sessions.db"),
		retention: {
			sessions: 50,
			orphan_timeout_hours: 24,
			file_reads_per_file: 5,
		},
		max_output_size: 100 * 1024, // 100KB
	},
	logging: {
		verbose: false,
		logDir: undefined, // Falls back to os.tmpdir()
	},
	canvas: {
		enabled: false,
		autoGenerate: false,
		updateStrategy: "skip",
	},
	styling: {
		enabled: true,
		graphColors: true,
		cssSnippet: true,
		canvasColors: true,
	},
	processing: {
		stalenessTimeoutMinutes: 30,
		pidValidationTimeoutMs: 500,
		spawnVerifyDelayMs: 100,
	},
	deduplication: {
		enabled: true,
		threshold: 0.6,
	},
	ai: {
		enabled: true,
		model: "sonnet",
		timeout: 30000,
	},
};

/**
 * Load configuration from file with defaults
 */
export function loadConfig(): Config {
	if (!existsSync(CONFIG_FILE)) {
		return DEFAULT_CONFIG;
	}

	try {
		const userConfig = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
		return mergeConfig(DEFAULT_CONFIG, userConfig);
	} catch {
		// Silently return defaults - cannot write to stdout/stderr in MCP stdio context
		return DEFAULT_CONFIG;
	}
}

/**
 * Validate model name against allowlist
 * @returns validated model or 'sonnet' default if invalid
 */
export function validateModel(model: unknown): "sonnet" | "haiku" | "opus" {
	if (typeof model === "string" && VALID_MODELS.includes(model as "sonnet" | "haiku" | "opus")) {
		return model as "sonnet" | "haiku" | "opus";
	}
	return "sonnet";
}

/**
 * Deep merge user config with defaults
 */
function mergeConfig(defaults: Config, user: Partial<Config>): Config {
	// Validate and clamp deduplication threshold
	let deduplication = { ...defaults.deduplication, ...user.deduplication };
	if (deduplication.threshold !== undefined) {
		if (typeof deduplication.threshold !== "number" || isNaN(deduplication.threshold)) {
			deduplication.threshold = 0.6;
		} else {
			deduplication.threshold = Math.max(0, Math.min(1, deduplication.threshold));
		}
	}

	// Validate AI config
	let ai = { ...defaults.ai, ...user.ai };
	if (ai.enabled !== undefined && typeof ai.enabled !== "boolean") {
		ai.enabled = true;
	}
	if (ai.model !== undefined) {
		ai.model = validateModel(ai.model);
	}
	if (ai.timeout !== undefined) {
		if (typeof ai.timeout !== "number" || isNaN(ai.timeout) || ai.timeout <= 0) {
			ai.timeout = 30000;
		}
	}

	return {
		vault: { ...defaults.vault, ...user.vault },
		sqlite: {
			...defaults.sqlite,
			...user.sqlite,
			retention: {
				...defaults.sqlite.retention,
				...user.sqlite?.retention,
			},
		},
		logging: { ...defaults.logging, ...user.logging },
		canvas: { ...defaults.canvas, ...user.canvas },
		styling: { ...defaults.styling, ...user.styling },
		processing: { ...defaults.processing!, ...user.processing },
		deduplication,
		ai,
		defaultProject: user.defaultProject ?? defaults.defaultProject,
	};
}

/**
 * Get config directory path
 */
export function getConfigDir(): string {
	return CONFIG_DIR;
}

/**
 * Environment variable set when spawning claude from SDK agent or summarizer
 * to prevent recursive hook execution
 */
export const AGENT_SESSION_MARKER = "CC_MEM_AGENT_SESSION";

/**
 * Check if current session is an agent-spawned session
 * @returns true if running in an agent session (should skip hooks)
 */
export function isAgentSession(): boolean {
	return process.env[AGENT_SESSION_MARKER] === "1";
}

/**
 * Minimum Claude CLI version required for --no-session-persistence flag
 * This flag prevents internal Claude calls from polluting user's session history
 */
export const MIN_CLAUDE_VERSION = "1.0.29";

/**
 * Parse Claude CLI version from output string
 * Handles various formats: "1.0.29 (Claude Code)", "Claude Code v1.0.29", etc.
 * Prefers version near "Claude" keyword to avoid matching other versions (Node, Bun)
 * @returns version string or null if not found
 */
export function parseClaudeVersionOutput(output: string): string | null {
	// First try: version followed by "(Claude" - most reliable (case-insensitive)
	let match = output.match(/(\d+\.\d+\.\d+)\s*\(Claude/i);
	// Fallback: version after "Claude" keyword
	if (!match) {
		match = output.match(/Claude[^0-9]*(\d+\.\d+\.\d+)/i);
	}
	// Last resort: any semver (may match wrong version if other tools print versions)
	if (!match) {
		match = output.match(/(\d+\.\d+\.\d+)/);
	}
	return match?.[1] ?? null;
}

/**
 * Check if installed Claude CLI version meets minimum requirement
 * @returns { supported: boolean, version: string | null, error?: string }
 */
export function checkClaudeVersion(): { supported: boolean; version: string | null; error?: string } {
	try {
		const { spawnSync } = require("child_process");
		const result = spawnSync("claude", ["--version"], {
			encoding: "utf-8",
			timeout: 5000,
			windowsHide: true,
			// Prevent hooks from triggering on version check
			env: { ...process.env, [AGENT_SESSION_MARKER]: "1" },
		});

		if (result.error || result.status !== 0) {
			return { supported: false, version: null, error: "Claude CLI not found or failed to run" };
		}

		// Parse version from output
		const output = (result.stdout || "") + (result.stderr || "");
		const installedVersion = parseClaudeVersionOutput(output);

		if (!installedVersion) {
			return { supported: false, version: null, error: "Could not parse Claude CLI version" };
		}
		const supported = compareVersions(installedVersion, MIN_CLAUDE_VERSION) >= 0;

		return { supported, version: installedVersion };
	} catch (error) {
		return { supported: false, version: null, error: (error as Error).message };
	}
}

/**
 * Compare two semver versions
 * @returns negative if a < b, 0 if equal, positive if a > b
 */
export function compareVersions(a: string, b: string): number {
	const partsA = a.split(".").map(Number);
	const partsB = b.split(".").map(Number);

	for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
		const partA = partsA[i] || 0;
		const partB = partsB[i] || 0;
		if (partA !== partB) {
			return partA - partB;
		}
	}
	return 0;
}
