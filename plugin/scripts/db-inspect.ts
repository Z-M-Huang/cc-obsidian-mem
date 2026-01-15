#!/usr/bin/env bun

/**
 * Database Inspection Script
 *
 * Usage:
 *   bun scripts/db-inspect.ts                    # Show all tables summary
 *   bun scripts/db-inspect.ts sessions           # Show sessions table
 *   bun scripts/db-inspect.ts prompts            # Show user_prompts table
 *   bun scripts/db-inspect.ts tools              # Show tool_uses table
 *   bun scripts/db-inspect.ts pending            # Show pending_messages table
 *   bun scripts/db-inspect.ts observations       # Show observations table
 *   bun scripts/db-inspect.ts summaries          # Show session_summaries table
 *   bun scripts/db-inspect.ts files              # Show file_reads table
 *   bun scripts/db-inspect.ts audit              # Full data audit - check all tables for issues
 *   bun scripts/db-inspect.ts validate           # Test validation schemas
 *   bun scripts/db-inspect.ts cleanup            # Clean up stale data
 *   bun scripts/db-inspect.ts recent             # Quick view of recent activity across all tables
 *   bun scripts/db-inspect.ts check              # Validate plugin installation and schema
 */

import { Database } from "bun:sqlite";
import { existsSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import {
	SessionStartPayloadSchema,
	UserPromptSubmitPayloadSchema,
	PostToolUsePayloadSchema,
} from "../src/shared/validation.js";

const CONFIG_DIR = join(homedir(), ".cc-obsidian-mem");
const DB_PATH = join(CONFIG_DIR, "sessions.db");
const LOCKS_DIR = join(CONFIG_DIR, "locks");

function getDb(): Database | null {
	if (!existsSync(DB_PATH)) {
		console.error(`❌ Database not found at: ${DB_PATH}`);
		return null;
	}
	return new Database(DB_PATH, { readonly: true });
}

function getWritableDb(): Database | null {
	if (!existsSync(DB_PATH)) {
		console.error(`❌ Database not found at: ${DB_PATH}`);
		return null;
	}
	return new Database(DB_PATH);
}

function showSummary() {
	const db = getDb();
	if (!db) return;

	console.log("📊 Database Summary");
	console.log("=".repeat(60));
	console.log(`📁 Path: ${DB_PATH}`);
	console.log("");

	const tables = [
		{ name: "sessions", query: "SELECT COUNT(*) as count FROM sessions" },
		{ name: "user_prompts", query: "SELECT COUNT(*) as count FROM user_prompts" },
		{ name: "tool_uses", query: "SELECT COUNT(*) as count FROM tool_uses" },
		{ name: "file_reads", query: "SELECT COUNT(*) as count FROM file_reads" },
		{ name: "observations", query: "SELECT COUNT(*) as count FROM observations" },
		{ name: "pending_messages", query: "SELECT COUNT(*) as count FROM pending_messages" },
		{ name: "session_summaries", query: "SELECT COUNT(*) as count FROM session_summaries" },
	];

	console.log("📋 Table Counts:");
	for (const t of tables) {
		try {
			const result = db.query(t.query).get() as { count: number };
			const status = result.count > 0 ? "✅" : "⚪";
			console.log(`  ${status} ${t.name.padEnd(20)} ${result.count}`);
		} catch (e) {
			console.log(`  ❌ ${t.name.padEnd(20)} Error: ${e}`);
		}
	}

	// Show active vs completed sessions
	console.log("\n📈 Session Status:");
	const statusQuery = db.query(`
		SELECT status, COUNT(*) as count
		FROM sessions
		GROUP BY status
	`).all() as Array<{ status: string; count: number }>;

	for (const s of statusQuery) {
		console.log(`  ${s.status.padEnd(12)} ${s.count}`);
	}

	// Show projects
	console.log("\n🗂️  Projects:");
	const projectQuery = db.query(`
		SELECT project, COUNT(*) as count
		FROM sessions
		GROUP BY project
		ORDER BY count DESC
	`).all() as Array<{ project: string; count: number }>;

	for (const p of projectQuery) {
		console.log(`  ${p.project.padEnd(20)} ${p.count} sessions`);
	}

	// Show pending message types
	const pendingCount = db.query("SELECT COUNT(*) as count FROM pending_messages").get() as { count: number };
	if (pendingCount.count > 0) {
		console.log("\n⏳ Pending Messages by Type:");
		const pendingQuery = db.query(`
			SELECT message_type, COUNT(*) as count,
				   SUM(CASE WHEN claimed_at IS NOT NULL THEN 1 ELSE 0 END) as claimed
			FROM pending_messages
			GROUP BY message_type
		`).all() as Array<{ message_type: string; count: number; claimed: number }>;

		for (const p of pendingQuery) {
			console.log(`  ${p.message_type.padEnd(16)} ${p.count} total, ${p.claimed} claimed`);
		}
	}

	db.close();
}

function showSessions() {
	const db = getDb();
	if (!db) return;

	console.log("📋 Sessions (last 20)");
	console.log("=".repeat(100));

	const sessions = db.query(`
		SELECT id, session_id, project, status, started_at, completed_at
		FROM sessions
		ORDER BY started_at_epoch DESC
		LIMIT 20
	`).all() as Array<{
		id: number;
		session_id: string;
		project: string;
		status: string;
		started_at: string;
		completed_at: string | null;
	}>;

	for (const s of sessions) {
		const statusIcon = s.status === "active" ? "🟢" : s.status === "completed" ? "✅" : "❌";
		const time = new Date(s.started_at).toLocaleString();
		console.log(`${statusIcon} [${s.id}] ${s.session_id.substring(0, 8)}... | ${s.project.padEnd(16)} | ${time}`);
	}

	db.close();
}

function showPrompts() {
	const db = getDb();
	if (!db) return;

	console.log("💬 User Prompts (last 20)");
	console.log("=".repeat(100));

	const prompts = db.query(`
		SELECT id, session_id, prompt_number, substr(prompt_text, 1, 60) as preview, created_at
		FROM user_prompts
		ORDER BY created_at_epoch DESC
		LIMIT 20
	`).all() as Array<{
		id: number;
		session_id: string;
		prompt_number: number;
		preview: string;
		created_at: string;
	}>;

	if (prompts.length === 0) {
		console.log("⚪ No prompts recorded");
	} else {
		for (const p of prompts) {
			const time = new Date(p.created_at).toLocaleString();
			console.log(`[${p.id}] #${p.prompt_number} | ${p.session_id.substring(0, 8)}... | ${p.preview}...`);
		}
	}

	db.close();
}

function showTools() {
	const db = getDb();
	if (!db) return;

	console.log("🔧 Tool Uses (last 20)");
	console.log("=".repeat(100));

	const tools = db.query(`
		SELECT id, session_id, prompt_number, tool_name, duration_ms, created_at
		FROM tool_uses
		ORDER BY created_at_epoch DESC
		LIMIT 20
	`).all() as Array<{
		id: number;
		session_id: string;
		prompt_number: number;
		tool_name: string;
		duration_ms: number | null;
		created_at: string;
	}>;

	if (tools.length === 0) {
		console.log("⚪ No tool uses recorded");
	} else {
		for (const t of tools) {
			const time = new Date(t.created_at).toLocaleString();
			const duration = t.duration_ms ? `${t.duration_ms}ms` : "N/A";
			console.log(`[${t.id}] ${t.tool_name.padEnd(12)} | #${t.prompt_number} | ${duration.padEnd(8)} | ${t.session_id.substring(0, 8)}...`);
		}
	}

	db.close();
}

function showPending() {
	const db = getDb();
	if (!db) return;

	console.log("⏳ Pending Messages");
	console.log("=".repeat(100));

	const pending = db.query(`
		SELECT id, session_id, message_type,
			   substr(payload, 1, 50) as payload_preview,
			   claimed_at, created_at
		FROM pending_messages
		ORDER BY created_at_epoch DESC
		LIMIT 30
	`).all() as Array<{
		id: number;
		session_id: string;
		message_type: string;
		payload_preview: string;
		claimed_at: string | null;
		created_at: string;
	}>;

	if (pending.length === 0) {
		console.log("⚪ No pending messages");
	} else {
		for (const p of pending) {
			const status = p.claimed_at ? "🔒" : "⏳";
			const time = new Date(p.created_at).toLocaleString();
			console.log(`${status} [${p.id}] ${p.message_type.padEnd(16)} | ${p.session_id.substring(0, 8)}... | ${time}`);
		}
	}

	db.close();
}

function showObservations() {
	const db = getDb();
	if (!db) return;

	console.log("🔍 Observations (last 20)");
	console.log("=".repeat(100));

	const observations = db.query(`
		SELECT id, session_id, project, type, title, created_at
		FROM observations
		ORDER BY created_at_epoch DESC
		LIMIT 20
	`).all() as Array<{
		id: number;
		session_id: string;
		project: string;
		type: string;
		title: string;
		created_at: string;
	}>;

	if (observations.length === 0) {
		console.log("⚪ No observations recorded");
	} else {
		for (const o of observations) {
			const time = new Date(o.created_at).toLocaleString();
			console.log(`[${o.id}] ${o.type.padEnd(10)} | ${o.project.padEnd(16)} | ${o.title.substring(0, 40)}`);
		}
	}

	db.close();
}

function validateSchemas() {
	console.log("🧪 Testing Validation Schemas");
	console.log("=".repeat(60));

	// Test SessionStart
	console.log("\n1️⃣  SessionStartPayloadSchema");
	const sessionInputs = [
		{ session_id: "test-123", cwd: "/some/path" },
		{ sessionId: "test-123", cwd: "/some/path" }, // Wrong format
	];
	for (const input of sessionInputs) {
		try {
			const result = SessionStartPayloadSchema.parse(input);
			console.log(`   ✅ Input: ${JSON.stringify(input)}`);
			console.log(`      Output: ${JSON.stringify(result)}`);
		} catch (e: any) {
			console.log(`   ❌ Input: ${JSON.stringify(input)}`);
			console.log(`      Error: ${e.message?.substring(0, 80)}`);
		}
	}

	// Test UserPromptSubmit
	console.log("\n2️⃣  UserPromptSubmitPayloadSchema");
	const promptInputs = [
		{ session_id: "test-123", prompt: "Hello world" },
		{ sessionId: "test-123", promptText: "Hello world" }, // Wrong format
	];
	for (const input of promptInputs) {
		try {
			const result = UserPromptSubmitPayloadSchema.parse(input);
			console.log(`   ✅ Input: ${JSON.stringify(input)}`);
			console.log(`      Output: ${JSON.stringify(result)}`);
		} catch (e: any) {
			console.log(`   ❌ Input: ${JSON.stringify(input)}`);
			console.log(`      Error: ${e.message?.substring(0, 80)}`);
		}
	}

	// Test PostToolUse
	console.log("\n3️⃣  PostToolUsePayloadSchema");
	const toolInputs = [
		{
			session_id: "test-123",
			tool_name: "Read",
			tool_input: { file_path: "test.ts" },
			tool_response: { content: "file content" },
		},
		{
			session_id: "test-123",
			tool_name: "Read",
			tool_input: '{"file_path": "test.ts"}',
			tool_response: '{"content": "file content"}',
		},
	];
	for (const input of toolInputs) {
		try {
			const result = PostToolUsePayloadSchema.parse(input);
			console.log(`   ✅ Input type: tool_input=${typeof input.tool_input}, tool_response=${typeof input.tool_response}`);
			console.log(`      Output: toolInput=${typeof result.toolInput}, toolOutput=${typeof result.toolOutput}`);
		} catch (e: any) {
			console.log(`   ❌ Input: ${JSON.stringify(input).substring(0, 60)}...`);
			console.log(`      Error: ${e.message?.substring(0, 80)}`);
		}
	}
}

function showSummaries() {
	const db = getDb();
	if (!db) return;

	console.log("📝 Session Summaries");
	console.log("=".repeat(100));

	const summaries = db.query(`
		SELECT id, session_id, project,
			   substr(request, 1, 50) as request_preview,
			   written_to_vault, created_at
		FROM session_summaries
		ORDER BY created_at_epoch DESC
		LIMIT 20
	`).all() as Array<{
		id: number;
		session_id: string;
		project: string;
		request_preview: string | null;
		written_to_vault: number;
		created_at: string;
	}>;

	if (summaries.length === 0) {
		console.log("⚪ No session summaries recorded");
	} else {
		for (const s of summaries) {
			const vaultIcon = s.written_to_vault ? "✅" : "⚪";
			const time = new Date(s.created_at).toLocaleString();
			console.log(`${vaultIcon} [${s.id}] ${s.session_id.substring(0, 8)}... | ${s.project.padEnd(16)} | ${s.request_preview || "N/A"}`);
		}
	}

	db.close();
}

function showFiles() {
	const db = getDb();
	if (!db) return;

	console.log("📂 File Reads");
	console.log("=".repeat(100));

	const files = db.query(`
		SELECT id, session_id, file_path, line_count, created_at
		FROM file_reads
		ORDER BY created_at_epoch DESC
		LIMIT 20
	`).all() as Array<{
		id: number;
		session_id: string;
		file_path: string;
		line_count: number | null;
		created_at: string;
	}>;

	if (files.length === 0) {
		console.log("⚪ No file reads recorded");
	} else {
		for (const f of files) {
			const time = new Date(f.created_at).toLocaleString();
			const lines = f.line_count ? `${f.line_count} lines` : "N/A";
			console.log(`[${f.id}] ${f.session_id.substring(0, 8)}... | ${lines.padEnd(12)} | ${f.file_path}`);
		}
	}

	db.close();
}

function runAudit() {
	const db = getDb();
	if (!db) return;

	console.log("🔍 Full Data Audit");
	console.log("=".repeat(80));

	// 1. Sessions audit
	console.log("\n📋 SESSIONS TABLE");
	console.log("-".repeat(80));

	const sessionStats = db.query(`
		SELECT
			COUNT(*) as total,
			SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
			SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
			SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
			MIN(started_at) as oldest,
			MAX(started_at) as newest
		FROM sessions
	`).get() as {
		total: number;
		active: number;
		completed: number;
		failed: number;
		oldest: string;
		newest: string;
	};

	console.log(`Total: ${sessionStats.total} | Active: ${sessionStats.active} | Completed: ${sessionStats.completed} | Failed: ${sessionStats.failed}`);
	console.log(`Date range: ${sessionStats.oldest} → ${sessionStats.newest}`);

	if (sessionStats.active > 0 && sessionStats.completed === 0) {
		console.log("⚠️  WARNING: All sessions are 'active' - session-end hook may not be working");
	}

	// Sample session data
	console.log("\nSample session (most recent):");
	const sampleSession = db.query("SELECT * FROM sessions ORDER BY started_at_epoch DESC LIMIT 1").get();
	console.log(JSON.stringify(sampleSession, null, 2));

	// 2. User Prompts audit
	console.log("\n💬 USER_PROMPTS TABLE");
	console.log("-".repeat(80));

	const promptCount = db.query("SELECT COUNT(*) as count FROM user_prompts").get() as { count: number };
	console.log(`Total records: ${promptCount.count}`);

	if (promptCount.count === 0) {
		console.log("⚠️  WARNING: No prompts recorded - user-prompt-submit hook may not be working");
		console.log("   Expected: Should have prompts for each user message in a session");
	} else {
		const samplePrompt = db.query("SELECT * FROM user_prompts ORDER BY created_at_epoch DESC LIMIT 1").get();
		console.log("\nSample prompt (most recent):");
		console.log(JSON.stringify(samplePrompt, null, 2));
	}

	// 3. Tool Uses audit
	console.log("\n🔧 TOOL_USES TABLE");
	console.log("-".repeat(80));

	const toolCount = db.query("SELECT COUNT(*) as count FROM tool_uses").get() as { count: number };
	console.log(`Total records: ${toolCount.count}`);

	if (toolCount.count === 0) {
		console.log("⚠️  WARNING: No tool uses recorded - post-tool-use hook may not be working");
		console.log("   Expected: Should have records for Read, Edit, Bash, Grep, etc.");
	} else {
		// Tool distribution
		const toolDist = db.query(`
			SELECT tool_name, COUNT(*) as count
			FROM tool_uses
			GROUP BY tool_name
			ORDER BY count DESC
			LIMIT 10
		`).all() as Array<{ tool_name: string; count: number }>;

		console.log("\nTool distribution:");
		for (const t of toolDist) {
			console.log(`  ${t.tool_name.padEnd(20)} ${t.count}`);
		}

		const sampleTool = db.query("SELECT * FROM tool_uses ORDER BY created_at_epoch DESC LIMIT 1").get();
		console.log("\nSample tool use (most recent):");
		console.log(JSON.stringify(sampleTool, null, 2));
	}

	// 4. File Reads audit
	console.log("\n📂 FILE_READS TABLE");
	console.log("-".repeat(80));

	const fileCount = db.query("SELECT COUNT(*) as count FROM file_reads").get() as { count: number };
	console.log(`Total records: ${fileCount.count}`);

	if (fileCount.count === 0) {
		console.log("⚠️  WARNING: No file reads recorded");
		console.log("   Expected: Should have records when Read tool is used");
	} else {
		const sampleFile = db.query("SELECT * FROM file_reads ORDER BY created_at_epoch DESC LIMIT 1").get();
		console.log("\nSample file read (most recent):");
		console.log(JSON.stringify(sampleFile, null, 2));
	}

	// 5. Observations audit
	console.log("\n🔍 OBSERVATIONS TABLE");
	console.log("-".repeat(80));

	const obsCount = db.query("SELECT COUNT(*) as count FROM observations").get() as { count: number };
	console.log(`Total records: ${obsCount.count}`);

	if (obsCount.count === 0) {
		console.log("ℹ️  INFO: No observations yet - these are created by SDK agent processing");
	} else {
		const obsDist = db.query(`
			SELECT type, COUNT(*) as count
			FROM observations
			GROUP BY type
			ORDER BY count DESC
		`).all() as Array<{ type: string; count: number }>;

		console.log("\nObservation types:");
		for (const o of obsDist) {
			console.log(`  ${o.type.padEnd(15)} ${o.count}`);
		}
	}

	// 6. Pending Messages audit
	console.log("\n⏳ PENDING_MESSAGES TABLE");
	console.log("-".repeat(80));

	const pendingStats = db.query(`
		SELECT
			COUNT(*) as total,
			SUM(CASE WHEN claimed_at IS NULL THEN 1 ELSE 0 END) as unclaimed,
			SUM(CASE WHEN claimed_at IS NOT NULL THEN 1 ELSE 0 END) as claimed
		FROM pending_messages
	`).get() as { total: number; unclaimed: number; claimed: number };

	console.log(`Total: ${pendingStats.total} | Unclaimed: ${pendingStats.unclaimed} | Claimed: ${pendingStats.claimed}`);

	if (pendingStats.claimed > 0 && pendingStats.claimed === pendingStats.total) {
		console.log("⚠️  WARNING: All messages are claimed but not deleted - worker may not be completing processing");
	}

	const pendingTypes = db.query(`
		SELECT message_type, COUNT(*) as count
		FROM pending_messages
		GROUP BY message_type
	`).all() as Array<{ message_type: string; count: number }>;

	console.log("\nMessage types:");
	for (const p of pendingTypes) {
		console.log(`  ${p.message_type.padEnd(16)} ${p.count}`);
	}

	// Only show prompt and tool_use if they exist
	const hasPromptMessages = pendingTypes.some(p => p.message_type === "prompt");
	const hasToolMessages = pendingTypes.some(p => p.message_type === "tool_use");

	if (!hasPromptMessages && !hasToolMessages) {
		console.log("\n⚠️  Only 'summary_request' messages - no 'prompt' or 'tool_use' messages being enqueued");
	}

	// 7. Session Summaries audit
	console.log("\n📝 SESSION_SUMMARIES TABLE");
	console.log("-".repeat(80));

	const summaryCount = db.query("SELECT COUNT(*) as count FROM session_summaries").get() as { count: number };
	console.log(`Total records: ${summaryCount.count}`);

	if (summaryCount.count === 0) {
		console.log("ℹ️  INFO: No session summaries yet");
	} else {
		const sampleSummary = db.query("SELECT * FROM session_summaries ORDER BY created_at_epoch DESC LIMIT 1").get();
		console.log("\nSample summary (most recent):");
		console.log(JSON.stringify(sampleSummary, null, 2));
	}

	// Summary
	console.log("\n" + "=".repeat(80));
	console.log("📊 AUDIT SUMMARY");
	console.log("=".repeat(80));

	const issues: string[] = [];

	if (sessionStats.active > 0 && sessionStats.completed === 0) {
		issues.push("Sessions never marked as completed");
	}
	if (promptCount.count === 0) {
		issues.push("No user prompts being recorded");
	}
	if (toolCount.count === 0) {
		issues.push("No tool uses being recorded");
	}
	if (pendingStats.claimed === pendingStats.total && pendingStats.total > 0) {
		issues.push("Pending messages claimed but never deleted");
	}

	if (issues.length === 0) {
		console.log("✅ No issues detected - all tables have expected data");
	} else {
		console.log("⚠️  Issues found:");
		for (const issue of issues) {
			console.log(`   - ${issue}`);
		}
	}

	db.close();
}

function showRecent() {
	const db = getDb();
	if (!db) return;

	console.log("📊 Recent Activity Overview");
	console.log("=".repeat(80));
	console.log(`📁 Database: ${DB_PATH}`);
	console.log("");

	// Recent sessions (last 5)
	console.log("🗂️  Recent Sessions (last 5)");
	console.log("-".repeat(80));
	const sessions = db.query(`
		SELECT id, session_id, project, status, started_at
		FROM sessions
		ORDER BY started_at_epoch DESC
		LIMIT 5
	`).all() as Array<{
		id: number;
		session_id: string;
		project: string;
		status: string;
		started_at: string;
	}>;

	if (sessions.length === 0) {
		console.log("  (none)");
	} else {
		for (const s of sessions) {
			const statusIcon = s.status === "active" ? "🟢" : s.status === "completed" ? "✅" : "❌";
			const shortId = s.session_id.substring(0, 8);
			const time = new Date(s.started_at).toLocaleString();
			console.log(`  ${statusIcon} ${shortId}  ${s.project.padEnd(18)}  ${time}`);
		}
	}

	// Recent prompts (last 5)
	console.log("\n💬 Recent User Prompts (last 5)");
	console.log("-".repeat(80));
	const prompts = db.query(`
		SELECT p.session_id, p.prompt_number, substr(p.prompt_text, 1, 60) as preview,
		       p.created_at, s.project
		FROM user_prompts p
		LEFT JOIN sessions s ON p.session_id = s.session_id
		ORDER BY p.created_at_epoch DESC
		LIMIT 5
	`).all() as Array<{
		session_id: string;
		prompt_number: number;
		preview: string;
		created_at: string;
		project: string | null;
	}>;

	if (prompts.length === 0) {
		console.log("  (none)");
	} else {
		for (const p of prompts) {
			const shortId = p.session_id.substring(0, 8);
			const proj = (p.project || "unknown").padEnd(18);
			const preview = p.preview.replace(/\n/g, " ").substring(0, 50);
			console.log(`  ${shortId}  ${proj}  #${p.prompt_number}: ${preview}...`);
		}
	}

	// Recent tool uses (last 10)
	console.log("\n🔧 Recent Tool Uses (last 10)");
	console.log("-".repeat(80));
	const tools = db.query(`
		SELECT t.session_id, t.tool_name, t.duration_ms, t.created_at, s.project
		FROM tool_uses t
		LEFT JOIN sessions s ON t.session_id = s.session_id
		ORDER BY t.created_at_epoch DESC
		LIMIT 10
	`).all() as Array<{
		session_id: string;
		tool_name: string;
		duration_ms: number | null;
		created_at: string;
		project: string | null;
	}>;

	if (tools.length === 0) {
		console.log("  (none)");
	} else {
		for (const t of tools) {
			const shortId = t.session_id.substring(0, 8);
			const proj = (t.project || "unknown").padEnd(18);
			const duration = t.duration_ms ? `${t.duration_ms}ms`.padEnd(8) : "N/A     ";
			console.log(`  ${shortId}  ${proj}  ${t.tool_name.padEnd(14)}  ${duration}`);
		}
	}

	// Recent file reads (last 5)
	console.log("\n📂 Recent File Reads (last 5)");
	console.log("-".repeat(80));
	const files = db.query(`
		SELECT f.session_id, f.file_path, f.line_count, s.project
		FROM file_reads f
		LEFT JOIN sessions s ON f.session_id = s.session_id
		ORDER BY f.created_at_epoch DESC
		LIMIT 5
	`).all() as Array<{
		session_id: string;
		file_path: string;
		line_count: number | null;
		project: string | null;
	}>;

	if (files.length === 0) {
		console.log("  (none)");
	} else {
		for (const f of files) {
			const shortId = f.session_id.substring(0, 8);
			const lines = f.line_count ? `${f.line_count}L`.padEnd(6) : "N/A   ";
			// Truncate path from the left if too long
			let path = f.file_path;
			if (path.length > 50) {
				path = "..." + path.substring(path.length - 47);
			}
			console.log(`  ${shortId}  ${lines}  ${path}`);
		}
	}

	// Pending messages summary
	console.log("\n⏳ Pending Messages");
	console.log("-".repeat(80));
	const pending = db.query(`
		SELECT message_type,
		       COUNT(*) as total,
		       SUM(CASE WHEN claimed_at IS NULL THEN 1 ELSE 0 END) as unclaimed
		FROM pending_messages
		GROUP BY message_type
	`).all() as Array<{ message_type: string; total: number; unclaimed: number }>;

	if (pending.length === 0) {
		console.log("  (none)");
	} else {
		for (const p of pending) {
			const status = p.unclaimed > 0 ? "⏳" : "✅";
			console.log(`  ${status} ${p.message_type.padEnd(16)}  ${p.total} total, ${p.unclaimed} unclaimed`);
		}
	}

	db.close();
}

function cleanup() {
	const db = getWritableDb();
	if (!db) return;

	console.log("🧹 Cleanup Operations");
	console.log("=".repeat(60));

	// Delete claimed pending messages older than 1 hour
	const oneHourAgo = Date.now() - 60 * 60 * 1000;
	const deletedPending = db.run(`
		DELETE FROM pending_messages
		WHERE claimed_at IS NOT NULL
		AND claimed_at_epoch < ?
	`, [oneHourAgo]);
	console.log(`✅ Deleted ${deletedPending.changes} stale claimed pending messages`);

	// Mark orphan active sessions as failed (older than 24 hours)
	const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
	const updatedSessions = db.run(`
		UPDATE sessions
		SET status = 'failed',
			completed_at = datetime('now'),
			completed_at_epoch = ?
		WHERE status = 'active'
		AND started_at_epoch < ?
	`, [Date.now(), oneDayAgo]);
	console.log(`✅ Marked ${updatedSessions.changes} orphan sessions as failed`);

	db.close();
}

function checkPluginSetup() {
	console.log("🔍 Plugin Installation Check");
	console.log("=".repeat(80));

	const issues: string[] = [];
	const warnings: string[] = [];

	// 1. Check config directory
	console.log("\n📁 Config Directory");
	console.log("-".repeat(80));
	console.log(`  Path: ${CONFIG_DIR}`);
	if (existsSync(CONFIG_DIR)) {
		console.log("  ✅ Exists");
	} else {
		console.log("  ❌ Missing");
		issues.push("Config directory does not exist");
	}

	// 2. Check database
	console.log("\n💾 Database");
	console.log("-".repeat(80));
	console.log(`  Path: ${DB_PATH}`);
	if (existsSync(DB_PATH)) {
		console.log("  ✅ Exists");
	} else {
		console.log("  ❌ Missing");
		issues.push("Database file does not exist");
	}

	// 3. Check locks directory
	console.log("\n🔒 Locks Directory");
	console.log("-".repeat(80));
	console.log(`  Path: ${LOCKS_DIR}`);
	if (existsSync(LOCKS_DIR)) {
		console.log("  ✅ Exists");
		try {
			const lockFiles = readdirSync(LOCKS_DIR).filter(f => f.endsWith(".lock"));
			console.log(`  📋 Lock files: ${lockFiles.length}`);
			if (lockFiles.length > 0) {
				for (const f of lockFiles) {
					console.log(`     - ${f}`);
				}
			}
		} catch (e) {
			console.log(`  ⚠️  Cannot read directory: ${e}`);
		}
	} else {
		console.log("  ⚠️  Missing (will be created on first session-end)");
		warnings.push("Locks directory does not exist yet (normal for fresh install)");
	}

	// 4. Check database schema
	if (existsSync(DB_PATH)) {
		const db = getDb();
		if (db) {
			console.log("\n📊 Database Schema");
			console.log("-".repeat(80));

			// Check sessions table columns
			try {
				const tableInfo = db.query("PRAGMA table_info(sessions)").all() as Array<{
					cid: number;
					name: string;
					type: string;
					notnull: number;
					dflt_value: string | null;
					pk: number;
				}>;

				const columns = tableInfo.map(c => c.name);
				console.log("  Sessions table columns:");
				for (const col of tableInfo) {
					console.log(`    - ${col.name.padEnd(25)} ${col.type.padEnd(10)} ${col.notnull ? "NOT NULL" : "NULL"}`);
				}

				// Check for processing_started_at column (new in v4)
				if (columns.includes("processing_started_at")) {
					console.log("\n  ✅ processing_started_at column exists (v4 migration applied)");
				} else {
					console.log("\n  ❌ processing_started_at column MISSING (v4 migration not applied)");
					issues.push("Database missing processing_started_at column - migration may have failed");
				}
			} catch (e) {
				console.log(`  ❌ Failed to read schema: ${e}`);
				issues.push("Cannot read database schema");
			}

			// 5. Check recent sessions with new column
			console.log("\n📋 Recent Sessions (with processing_started_at)");
			console.log("-".repeat(80));
			try {
				const sessions = db.query(`
					SELECT session_id, project, status, processing_started_at, started_at
					FROM sessions
					ORDER BY started_at_epoch DESC
					LIMIT 5
				`).all() as Array<{
					session_id: string;
					project: string;
					status: string;
					processing_started_at: number | null;
					started_at: string;
				}>;

				if (sessions.length === 0) {
					console.log("  (no sessions yet)");
				} else {
					for (const s of sessions) {
						const statusIcon = s.status === "active" ? "🟢" : s.status === "completed" ? "✅" : "❌";
						const procTime = s.processing_started_at
							? new Date(s.processing_started_at).toLocaleString()
							: "NULL";
						console.log(`  ${statusIcon} ${s.session_id.substring(0, 8)}... | ${s.project.padEnd(18)} | proc: ${procTime}`);
					}
				}
			} catch (e) {
				console.log(`  ❌ Query failed: ${e}`);
			}

			db.close();
		}
	}

	// Summary
	console.log("\n" + "=".repeat(80));
	console.log("📊 CHECK SUMMARY");
	console.log("=".repeat(80));

	if (issues.length === 0 && warnings.length === 0) {
		console.log("✅ All checks passed - plugin is correctly installed");
	} else {
		if (issues.length > 0) {
			console.log("\n❌ Issues found:");
			for (const issue of issues) {
				console.log(`   - ${issue}`);
			}
		}
		if (warnings.length > 0) {
			console.log("\n⚠️  Warnings:");
			for (const warning of warnings) {
				console.log(`   - ${warning}`);
			}
		}
	}
}

// Main
const command = process.argv[2] || "summary";

switch (command) {
	case "sessions":
		showSessions();
		break;
	case "prompts":
		showPrompts();
		break;
	case "tools":
		showTools();
		break;
	case "pending":
		showPending();
		break;
	case "observations":
		showObservations();
		break;
	case "summaries":
		showSummaries();
		break;
	case "files":
		showFiles();
		break;
	case "audit":
		runAudit();
		break;
	case "validate":
		validateSchemas();
		break;
	case "cleanup":
		cleanup();
		break;
	case "recent":
		showRecent();
		break;
	case "check":
		checkPluginSetup();
		break;
	case "summary":
	default:
		showSummary();
		break;
}
