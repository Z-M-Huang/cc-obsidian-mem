#!/usr/bin/env bun

/**
 * Setup CLI for cc-obsidian-mem
 * Interactive configuration wizard
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { homedir, tmpdir } from "os";
import type { Config } from "../shared/types.js";
import { initDatabase, closeDatabase } from "../sqlite/database.js";
import { createLogger } from "../shared/logger.js";

const CONFIG_DIR = join(homedir(), ".cc-obsidian-mem");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

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
		max_output_size: 100 * 1024,
	},
	logging: {
		verbose: false,
		logDir: tmpdir(),
	},
	canvas: {
		enabled: false,
		autoGenerate: false,
		updateStrategy: "skip",
	},
};

async function prompt(question: string, defaultValue?: string): Promise<string> {
	const suffix = defaultValue ? ` [${defaultValue}]` : "";
	process.stdout.write(`${question}${suffix}: `);

	for await (const line of console) {
		const answer = line.trim();
		return answer || defaultValue || "";
	}
	return defaultValue || "";
}

async function promptYesNo(question: string, defaultYes: boolean = false): Promise<boolean> {
	const suffix = defaultYes ? " [Y/n]" : " [y/N]";
	process.stdout.write(`${question}${suffix}: `);

	for await (const line of console) {
		const answer = line.trim().toLowerCase();
		if (answer === "") return defaultYes;
		return answer === "y" || answer === "yes";
	}
	return defaultYes;
}

async function initDatabaseOnly(): Promise<void> {
	console.log("\n=== Database Initialization ===\n");

	if (!existsSync(CONFIG_FILE)) {
		console.error(`Config not found at ${CONFIG_FILE}`);
		console.error("Run setup first without --init-db flag");
		process.exit(1);
	}

	const config = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
	const logger = createLogger({ verbose: false });
	const dbPath = config.sqlite?.path || join(CONFIG_DIR, "sessions.db");

	console.log(`Initializing database: ${dbPath}`);

	try {
		const db = initDatabase(dbPath, logger);
		closeDatabase(db, logger);
		console.log("Database initialized successfully!");
	} catch (error) {
		console.error("Failed to initialize database:", error);
		process.exit(1);
	}
}

async function main() {
	// Check for --init-db flag
	if (process.argv.includes("--init-db")) {
		await initDatabaseOnly();
		return;
	}

	console.log("\n=== cc-obsidian-mem Setup ===\n");

	// Check for existing config
	if (existsSync(CONFIG_FILE)) {
		console.log(`Found existing config at ${CONFIG_FILE}`);
		const overwrite = await promptYesNo("Do you want to reconfigure?", false);
		if (!overwrite) {
			console.log("Setup cancelled. Existing config preserved.");
			process.exit(0);
		}
	}

	// Ensure config directory exists
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true });
		console.log(`Created config directory: ${CONFIG_DIR}`);
	}

	const config: Config = { ...DEFAULT_CONFIG };

	// Vault configuration
	console.log("\n--- Vault Configuration ---\n");
	console.log("The vault is where your knowledge notes will be stored.");
	console.log("This can be an existing Obsidian vault or a new directory.\n");

	const vaultPath = await prompt(
		"Vault path",
		DEFAULT_CONFIG.vault.path
	);
	config.vault.path = vaultPath.startsWith("~")
		? vaultPath.replace("~", homedir())
		: vaultPath;

	const memFolder = await prompt(
		"Memory folder name (inside vault)",
		DEFAULT_CONFIG.vault.memFolder
	);
	config.vault.memFolder = memFolder;

	// Create vault directory if it doesn't exist
	const fullVaultPath = join(config.vault.path, config.vault.memFolder || "_claude-mem");
	if (!existsSync(fullVaultPath)) {
		const createVault = await promptYesNo(
			`Vault directory doesn't exist. Create ${fullVaultPath}?`,
			true
		);
		if (createVault) {
			mkdirSync(fullVaultPath, { recursive: true });
			console.log(`Created vault directory: ${fullVaultPath}`);
		}
	}

	// SQLite configuration
	console.log("\n--- Database Configuration ---\n");

	const sqlitePath = await prompt(
		"SQLite database path",
		DEFAULT_CONFIG.sqlite.path
	);
	config.sqlite = {
		...DEFAULT_CONFIG.sqlite,
		path: sqlitePath.startsWith("~")
			? sqlitePath.replace("~", homedir())
			: sqlitePath,
	};

	// Logging configuration
	console.log("\n--- Logging Configuration ---\n");

	const verboseLogging = await promptYesNo("Enable verbose logging?", false);
	config.logging = {
		verbose: verboseLogging,
	};

	// Canvas configuration
	console.log("\n--- Canvas Configuration ---\n");
	console.log("Canvas generates visual diagrams of your knowledge in Obsidian.\n");

	const enableCanvas = await promptYesNo("Enable canvas generation?", false);
	config.canvas = {
		enabled: enableCanvas,
		autoGenerate: enableCanvas,
		updateStrategy: "skip",
	};

	// Default project
	console.log("\n--- Default Project ---\n");

	const defaultProject = await prompt(
		"Default project name (optional, press Enter to skip)",
		""
	);
	if (defaultProject) {
		config.defaultProject = defaultProject;
	}

	// Write config
	const configJson = JSON.stringify(config, null, 2);
	writeFileSync(CONFIG_FILE, configJson, "utf-8");
	console.log(`\nConfig saved to: ${CONFIG_FILE}`);

	// Initialize database
	console.log("\n--- Database Initialization ---\n");
	console.log("Initializing SQLite database...");

	const logger = createLogger({ verbose: false });
	const dbPath = config.sqlite.path || join(CONFIG_DIR, "sessions.db");

	try {
		const db = initDatabase(dbPath, logger);
		closeDatabase(db, logger);
		console.log(`Database initialized: ${dbPath}`);
	} catch (error) {
		console.error("Failed to initialize database:", error);
		process.exit(1);
	}

	console.log("\n=== Setup Complete ===\n");
	console.log(`Config: ${CONFIG_FILE}`);
	console.log(`Vault: ${config.vault.path}/${config.vault.memFolder}`);
	console.log(`Database: ${dbPath}`);
	console.log("\nYou can edit the config file manually at any time.");
	console.log("\nRestart Claude Code to load the new configuration.\n");
}

main().catch((error) => {
	console.error("Setup failed:", error);
	process.exit(1);
});
