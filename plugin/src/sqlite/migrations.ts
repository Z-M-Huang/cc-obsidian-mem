/**
 * SQLite database schema migrations
 * Creates tables with proper indexes and foreign keys
 */

import type { Database } from "bun:sqlite";

/**
 * Run all migrations to create/update database schema
 */
export function runMigrations(db: Database): void {
	// Enable foreign keys
	db.run("PRAGMA foreign_keys = ON");

	// Create sessions table
	db.run(`
		CREATE TABLE IF NOT EXISTS sessions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL UNIQUE,
			project TEXT NOT NULL,
			started_at TEXT NOT NULL,
			started_at_epoch INTEGER NOT NULL,
			completed_at TEXT,
			completed_at_epoch INTEGER,
			status TEXT NOT NULL CHECK(status IN ('active', 'completed', 'failed')),
			processing_started_at INTEGER
		)
	`);

	// Add processing_started_at column if it doesn't exist (migration)
	try {
		db.run(`
			ALTER TABLE sessions ADD COLUMN processing_started_at INTEGER
		`);
	} catch {
		// Column already exists or other error - ignore
	}

	// Create user_prompts table
	db.run(`
		CREATE TABLE IF NOT EXISTS user_prompts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL,
			prompt_number INTEGER NOT NULL,
			prompt_text TEXT NOT NULL,
			created_at TEXT NOT NULL,
			created_at_epoch INTEGER NOT NULL,
			FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
		)
	`);

	// Create tool_uses table
	db.run(`
		CREATE TABLE IF NOT EXISTS tool_uses (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL,
			prompt_number INTEGER NOT NULL,
			tool_name TEXT NOT NULL,
			tool_input TEXT NOT NULL,
			tool_output TEXT NOT NULL,
			tool_output_truncated INTEGER NOT NULL DEFAULT 0,
			tool_output_hash TEXT,
			duration_ms INTEGER,
			cwd TEXT,
			created_at TEXT NOT NULL,
			created_at_epoch INTEGER NOT NULL,
			FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
		)
	`);

	// Create file_reads table
	db.run(`
		CREATE TABLE IF NOT EXISTS file_reads (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL,
			file_path TEXT NOT NULL,
			content_hash TEXT NOT NULL,
			content_snippet TEXT,
			line_count INTEGER,
			created_at TEXT NOT NULL,
			created_at_epoch INTEGER NOT NULL,
			FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
		)
	`);

	// Create session_summaries table
	db.run(`
		CREATE TABLE IF NOT EXISTS session_summaries (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL UNIQUE,
			project TEXT NOT NULL,
			request TEXT,
			investigated TEXT,
			learned TEXT,
			completed TEXT,
			next_steps TEXT,
			written_to_vault INTEGER NOT NULL DEFAULT 0,
			written_notes TEXT,
			error_message TEXT,
			created_at TEXT NOT NULL,
			created_at_epoch INTEGER NOT NULL,
			FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
		)
	`);

	// Create observations table (structured observations from SDK agent)
	db.run(`
		CREATE TABLE IF NOT EXISTS observations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL,
			project TEXT NOT NULL,
			type TEXT NOT NULL CHECK(type IN ('decision', 'bugfix', 'feature', 'refactor', 'discovery', 'change', 'error', 'pattern')),
			title TEXT NOT NULL,
			subtitle TEXT,
			facts TEXT,
			concepts TEXT,
			narrative TEXT,
			files_read TEXT,
			files_modified TEXT,
			discovery_tokens INTEGER,
			created_at TEXT NOT NULL,
			created_at_epoch INTEGER NOT NULL,
			FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
		)
	`);

	// Create pending_messages table (claim-and-delete work queue)
	db.run(`
		CREATE TABLE IF NOT EXISTS pending_messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL,
			message_type TEXT NOT NULL CHECK(message_type IN ('tool_use', 'prompt', 'summary_request')),
			payload TEXT NOT NULL,
			claimed_at TEXT,
			claimed_at_epoch INTEGER,
			created_at TEXT NOT NULL,
			created_at_epoch INTEGER NOT NULL,
			FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
		)
	`);

	// Create indexes for faster queries
	createIndexes(db);

	// Create FTS5 virtual tables for full-text search
	createFTS5Tables(db);
}

/**
 * Create indexes for faster queries
 */
function createIndexes(db: Database): void {
	// Session indexes
	db.run("CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id)");
	db.run("CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project)");
	db.run("CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)");
	db.run("CREATE INDEX IF NOT EXISTS idx_sessions_started_at_epoch ON sessions(started_at_epoch)");

	// User prompts indexes
	db.run("CREATE INDEX IF NOT EXISTS idx_user_prompts_session_id ON user_prompts(session_id)");
	db.run("CREATE INDEX IF NOT EXISTS idx_user_prompts_session_prompt ON user_prompts(session_id, prompt_number)");

	// Tool uses indexes
	db.run("CREATE INDEX IF NOT EXISTS idx_tool_uses_session_id ON tool_uses(session_id)");
	db.run("CREATE INDEX IF NOT EXISTS idx_tool_uses_session_prompt ON tool_uses(session_id, prompt_number)");
	db.run("CREATE INDEX IF NOT EXISTS idx_tool_uses_tool_name ON tool_uses(tool_name)");

	// File reads indexes
	db.run("CREATE INDEX IF NOT EXISTS idx_file_reads_session_id ON file_reads(session_id)");
	db.run("CREATE INDEX IF NOT EXISTS idx_file_reads_file_path ON file_reads(file_path)");
	db.run("CREATE INDEX IF NOT EXISTS idx_file_reads_content_hash ON file_reads(content_hash)");

	// Session summaries indexes
	db.run("CREATE INDEX IF NOT EXISTS idx_session_summaries_session_id ON session_summaries(session_id)");
	db.run("CREATE INDEX IF NOT EXISTS idx_session_summaries_project ON session_summaries(project)");

	// Observations indexes
	db.run("CREATE INDEX IF NOT EXISTS idx_observations_session_id ON observations(session_id)");
	db.run("CREATE INDEX IF NOT EXISTS idx_observations_project ON observations(project)");
	db.run("CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type)");
	db.run("CREATE INDEX IF NOT EXISTS idx_observations_created_at_epoch ON observations(created_at_epoch)");
	db.run("CREATE INDEX IF NOT EXISTS idx_observations_title ON observations(title)");

	// Pending messages indexes
	db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_session_id ON pending_messages(session_id)");
	db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_message_type ON pending_messages(message_type)");
	db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_claimed_at ON pending_messages(claimed_at)");
	db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_created_at_epoch ON pending_messages(created_at_epoch)");
}

/**
 * Create FTS5 virtual tables and triggers for full-text search
 */
function createFTS5Tables(db: Database): void {
	// FTS5 table for user_prompts
	db.run(`
		CREATE VIRTUAL TABLE IF NOT EXISTS user_prompts_fts USING fts5(
			session_id,
			prompt_text,
			content=user_prompts,
			content_rowid=id
		)
	`);

	// FTS5 table for tool_uses
	db.run(`
		CREATE VIRTUAL TABLE IF NOT EXISTS tool_uses_fts USING fts5(
			session_id,
			tool_name,
			tool_input,
			tool_output,
			content=tool_uses,
			content_rowid=id
		)
	`);

	// FTS5 table for observations
	db.run(`
		CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
			session_id,
			title,
			subtitle,
			narrative,
			facts,
			concepts,
			content=observations,
			content_rowid=id
		)
	`);

	// Triggers to keep FTS5 tables in sync
	createFTS5Triggers(db);
}

/**
 * Create triggers to keep FTS5 tables synchronized
 */
function createFTS5Triggers(db: Database): void {
	// User prompts triggers
	db.run(`
		CREATE TRIGGER IF NOT EXISTS user_prompts_ai AFTER INSERT ON user_prompts BEGIN
			INSERT INTO user_prompts_fts(rowid, session_id, prompt_text)
			VALUES (new.id, new.session_id, new.prompt_text);
		END
	`);

	db.run(`
		CREATE TRIGGER IF NOT EXISTS user_prompts_ad AFTER DELETE ON user_prompts BEGIN
			DELETE FROM user_prompts_fts WHERE rowid = old.id;
		END
	`);

	db.run(`
		CREATE TRIGGER IF NOT EXISTS user_prompts_au AFTER UPDATE ON user_prompts BEGIN
			UPDATE user_prompts_fts SET
				session_id = new.session_id,
				prompt_text = new.prompt_text
			WHERE rowid = new.id;
		END
	`);

	// Tool uses triggers
	db.run(`
		CREATE TRIGGER IF NOT EXISTS tool_uses_ai AFTER INSERT ON tool_uses BEGIN
			INSERT INTO tool_uses_fts(rowid, session_id, tool_name, tool_input, tool_output)
			VALUES (new.id, new.session_id, new.tool_name, new.tool_input, new.tool_output);
		END
	`);

	db.run(`
		CREATE TRIGGER IF NOT EXISTS tool_uses_ad AFTER DELETE ON tool_uses BEGIN
			DELETE FROM tool_uses_fts WHERE rowid = old.id;
		END
	`);

	db.run(`
		CREATE TRIGGER IF NOT EXISTS tool_uses_au AFTER UPDATE ON tool_uses BEGIN
			UPDATE tool_uses_fts SET
				session_id = new.session_id,
				tool_name = new.tool_name,
				tool_input = new.tool_input,
				tool_output = new.tool_output
			WHERE rowid = new.id;
		END
	`);

	// Observations triggers
	db.run(`
		CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
			INSERT INTO observations_fts(rowid, session_id, title, subtitle, narrative, facts, concepts)
			VALUES (new.id, new.session_id, new.title, new.subtitle, new.narrative, new.facts, new.concepts);
		END
	`);

	db.run(`
		CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
			DELETE FROM observations_fts WHERE rowid = old.id;
		END
	`);

	db.run(`
		CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
			UPDATE observations_fts SET
				session_id = new.session_id,
				title = new.title,
				subtitle = new.subtitle,
				narrative = new.narrative,
				facts = new.facts,
				concepts = new.concepts
			WHERE rowid = new.id;
		END
	`);
}
