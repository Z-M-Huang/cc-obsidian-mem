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
	processing: {
		stalenessTimeoutMinutes: 30,
		pidValidationTimeoutMs: 500,
		spawnVerifyDelayMs: 100,
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
	} catch (error) {
		console.warn(
			`Failed to load config from ${CONFIG_FILE}, using defaults:`,
			error
		);
		return DEFAULT_CONFIG;
	}
}

/**
 * Deep merge user config with defaults
 */
function mergeConfig(defaults: Config, user: Partial<Config>): Config {
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
		processing: { ...defaults.processing!, ...user.processing },
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
