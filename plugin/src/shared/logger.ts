/**
 * Structured logger with session context and file rotation
 * Logs to session-specific files in temp directory
 */

import { appendFileSync, existsSync, mkdirSync, statSync, unlinkSync } from "fs";
import { readdir, stat, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { LogContext, LogLevel } from "./types.js";

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
const LOG_RETENTION_HOURS = 24;

export class Logger {
	private logDir: string;
	private sessionId?: string;
	private verbose: boolean;

	constructor(options?: { logDir?: string; sessionId?: string; verbose?: boolean }) {
		this.logDir = options?.logDir ?? tmpdir();
		this.sessionId = options?.sessionId;
		this.verbose = options?.verbose ?? false;

		// Ensure log directory exists
		if (!existsSync(this.logDir)) {
			mkdirSync(this.logDir, { recursive: true });
		}
	}

	/**
	 * Set session ID for this logger instance
	 */
	setSessionId(sessionId: string): void {
		this.sessionId = sessionId;
	}

	/**
	 * Log debug message (only if verbose enabled)
	 */
	debug(message: string, context?: LogContext): void {
		if (this.verbose) {
			this.log("debug", message, context);
		}
	}

	/**
	 * Log info message
	 */
	info(message: string, context?: LogContext): void {
		this.log("info", message, context);
	}

	/**
	 * Log warning message
	 */
	warn(message: string, context?: LogContext): void {
		this.log("warn", message, context);
	}

	/**
	 * Log error message
	 */
	error(message: string, context?: LogContext): void {
		this.log("error", message, context);
	}

	/**
	 * Core logging function
	 */
	private log(level: LogLevel, message: string, context?: LogContext): void {
		const timestamp = new Date().toISOString();
		const sessionId = context?.sessionId ?? this.sessionId ?? "no-session";

		const logEntry = {
			timestamp,
			level,
			sessionId,
			message,
			...context,
		};

		const logLine = JSON.stringify(logEntry) + "\n";

		// Write to session-specific log file
		const logFile = this.getLogFile(sessionId);

		try {
			// Rotate if needed
			if (existsSync(logFile)) {
				const stats = statSync(logFile);
				if (stats.size > MAX_LOG_SIZE) {
					this.rotateLog(logFile);
				}
			}

			appendFileSync(logFile, logLine);
		} catch {
			// Silently swallow - cannot write to stdout/stderr in MCP stdio context
		}
	}

	/**
	 * Get log file path for session
	 */
	private getLogFile(sessionId: string): string {
		return join(this.logDir, `cc-obsidian-mem-${sessionId}.log`);
	}

	/**
	 * Rotate log file when it exceeds max size
	 */
	private rotateLog(logFile: string): void {
		const rotatedFile = `${logFile}.old`;
		try {
			if (existsSync(rotatedFile)) {
				unlinkSync(rotatedFile);
			}
			// Simple rotation: delete old, keep current
			// For session logs, we don't need complex rotation
			unlinkSync(logFile);
		} catch {
			// Silently swallow - cannot write to stdout/stderr in MCP stdio context
		}
	}

	/**
	 * Clean logs older than retention period (async)
	 */
	async cleanOldLogsAsync(): Promise<void> {
		try {
			const now = Date.now();
			const files = await readdir(this.logDir);

			for (const file of files) {
				if (file.startsWith("cc-obsidian-mem-") && file.endsWith(".log")) {
					const filePath = join(this.logDir, file);
					try {
						const stats = await stat(filePath);
						const ageHours = (now - stats.mtimeMs) / (1000 * 60 * 60);

						if (ageHours > LOG_RETENTION_HOURS) {
							await unlink(filePath);
						}
					} catch {
						// Silently skip individual files
					}
				}
			}
		} catch {
			// Silently swallow - log cleanup is best-effort
		}
	}
}

/**
 * Create a logger instance
 */
export function createLogger(options?: {
	logDir?: string;
	sessionId?: string;
	verbose?: boolean;
}): Logger {
	return new Logger(options);
}
