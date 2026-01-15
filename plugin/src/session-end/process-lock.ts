/**
 * Process Lock File Management
 *
 * Implements two-phase locking for background session processing:
 * 1. Reservation Phase: Stop hook creates lock with status='reserved'
 * 2. Claim Phase: Background process updates lock with its PID and status='running'
 *
 * Features:
 * - Atomic lock file creation with O_EXCL
 * - Zod schema validation for lock file contents
 * - Cross-platform PID validation with start-time checking
 * - Windows-compatible atomic writes
 * - Session ID sanitization for path safety
 */

import { existsSync, mkdirSync, openSync, writeSync, closeSync, readFileSync, unlinkSync, renameSync, readdirSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { platform } from "os";
import { z } from "zod";
import { LOCKS_DIR } from "../shared/config.js";

// ============================================================================
// Lock File Schema
// ============================================================================

const ReservedLockSchema = z.object({
	sessionId: z.string().min(1),
	status: z.literal("reserved"),
	reservedAt: z.number()
		.refine((val) => val > Date.now() - 5 * 60 * 1000, "Reservation too old (>5min)")
		.refine((val) => val <= Date.now() + 60 * 1000, "Reservation in future"),
});

const RunningLockSchema = z.object({
	sessionId: z.string().min(1),
	status: z.literal("running"),
	pid: z.number().int().positive(),
	startedAt: z.number()
		.refine((val) => val > Date.now() - 24 * 60 * 60 * 1000, "Start time too old (>24h)")
		.refine((val) => val <= Date.now() + 60 * 1000, "Start time in future"),
});

export const LockFileSchema = z.union([ReservedLockSchema, RunningLockSchema]);

export type LockInfo = z.infer<typeof LockFileSchema>;

// ============================================================================
// Session ID Sanitization
// ============================================================================

/**
 * Sanitize session ID for safe use in file paths
 * Prevents path traversal attacks
 */
export function sanitizeSessionId(sessionId: string): string {
	return sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

// ============================================================================
// Directory Management
// ============================================================================

/**
 * Ensure locks directory exists
 */
export function ensureLocksDir(): void {
	if (!existsSync(LOCKS_DIR)) {
		mkdirSync(LOCKS_DIR, { recursive: true, mode: 0o700 });
	}
}

/**
 * Get lock file path for a session
 */
function getLockPath(sessionId: string): string {
	const safeName = sanitizeSessionId(sessionId);
	return join(LOCKS_DIR, `${safeName}.lock`);
}

// ============================================================================
// Lock File Reading
// ============================================================================

/**
 * Read and validate lock file
 * Returns null if file doesn't exist or is invalid
 * Invalid files are deleted automatically
 */
export function readLockFile(sessionId: string): LockInfo | null {
	const lockPath = getLockPath(sessionId);

	if (!existsSync(lockPath)) {
		return null;
	}

	try {
		const content = readFileSync(lockPath, "utf-8");
		const parsed = JSON.parse(content);
		const validated = LockFileSchema.parse(parsed);
		return validated;
	} catch (error) {
		// Invalid lock file - delete it
		try {
			unlinkSync(lockPath);
		} catch {
			// Ignore deletion errors
		}
		return null;
	}
}

// ============================================================================
// Reservation Phase (Stop Hook)
// ============================================================================

/**
 * Acquire reservation lock atomically
 * Returns true if lock was acquired, false if already locked
 */
export function acquireReservationLock(sessionId: string): boolean {
	ensureLocksDir();
	const lockPath = getLockPath(sessionId);

	// Try atomic creation with O_EXCL
	try {
		const fd = openSync(lockPath, "wx", 0o600);

		const lockData: LockInfo = {
			sessionId,
			status: "reserved",
			reservedAt: Date.now(),
		};

		const content = JSON.stringify(lockData, null, 2);
		writeSync(fd, content);
		closeSync(fd);

		return true;
	} catch (error: any) {
		if (error.code === "EEXIST") {
			// Lock already exists - check if it's stale
			const existing = readLockFile(sessionId);

			if (!existing) {
				// Invalid/stale lock was deleted, retry
				return acquireReservationLock(sessionId);
			}

			if (existing.status === "reserved") {
				// Check if reservation expired (>5min)
				const age = Date.now() - existing.reservedAt;
				if (age > 5 * 60 * 1000) {
					// Expired reservation - remove and retry
					try {
						unlinkSync(lockPath);
						return acquireReservationLock(sessionId);
					} catch {
						return false;
					}
				}
			}

			if (existing.status === "running") {
				// Check if process is still alive
				const alive = isProcessAlive(existing.pid);
				if (!alive) {
					// Dead process - remove lock and retry
					try {
						unlinkSync(lockPath);
						return acquireReservationLock(sessionId);
					} catch {
						return false;
					}
				}
			}

			// Valid lock exists
			return false;
		}

		// Other error (EPERM, etc.)
		return false;
	}
}

// ============================================================================
// Claim Phase (Background Process)
// ============================================================================

/**
 * Claim a reserved lock by updating it with own PID
 * Returns true if claim succeeded, false otherwise
 */
export function claimLock(sessionId: string): boolean {
	const lockPath = getLockPath(sessionId);

	// Verify lock exists and is reserved
	const existing = readLockFile(sessionId);
	if (!existing || existing.status !== "reserved") {
		return false;
	}

	// Prepare running lock data
	const lockData: LockInfo = {
		sessionId,
		status: "running",
		pid: process.pid,
		startedAt: Date.now(),
	};

	const content = JSON.stringify(lockData, null, 2);

	// Use atomic write with rename on all platforms
	const tmpPath = lockPath + ".tmp";
	let retries = 3;

	while (retries > 0) {
		try {
			const fd = openSync(tmpPath, "w", 0o600);
			writeSync(fd, content);
			closeSync(fd);

			renameSync(tmpPath, lockPath);
			return true;
		} catch (error: any) {
			if (error.code === "EBUSY" && retries > 1) {
				// Windows file busy - retry with delay
				retries--;
				const delay = 50;
				const start = Date.now();
				while (Date.now() - start < delay) {
					// Busy wait
				}
				continue;
			}

			if (error.code === "EPERM") {
				// Antivirus interference - log and fail
				console.error("[process-lock] EPERM during claim - antivirus interference?");
				return false;
			}

			return false;
		}
	}

	return false;
}

// ============================================================================
// Lock Release
// ============================================================================

/**
 * Release lock file
 */
export function releaseLock(sessionId: string): void {
	const lockPath = getLockPath(sessionId);
	try {
		if (existsSync(lockPath)) {
			unlinkSync(lockPath);
		}
	} catch {
		// Ignore errors
	}
}

// ============================================================================
// Process Validation
// ============================================================================

/**
 * Check if process exists (basic check)
 */
export function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * Validate PID is a safe integer for use in shell commands
 * Prevents command injection attacks
 */
function isValidPid(pid: number): boolean {
	return Number.isInteger(pid) && pid > 0 && pid <= 2147483647;
}

/**
 * Get process start time in Unix timestamp (milliseconds)
 * Returns null if unable to determine
 */
export function getProcessStartTime(pid: number): number | null {
	// Validate PID to prevent command injection
	if (!isValidPid(pid)) {
		console.warn(`[process-lock] Invalid PID: ${pid}`);
		return null;
	}

	const os = platform();

	try {
		if (os === "linux") {
			return getLinuxProcessStartTime(pid);
		} else if (os === "darwin") {
			return getMacOSProcessStartTime(pid);
		} else if (os === "win32") {
			return getWindowsProcessStartTime(pid);
		} else {
			console.warn(`[process-lock] Unknown platform ${os}, start-time validation unavailable`);
			return null;
		}
	} catch (error) {
		console.warn(`[process-lock] Failed to get process start time for PID ${pid}:`, error);
		return null;
	}
}

/**
 * Linux: Parse /proc/{pid}/stat for start time
 * Field 22 is starttime in clock ticks since boot
 */
function getLinuxProcessStartTime(pid: number): number | null {
	try {
		// Read /proc/{pid}/stat
		const statContent = readFileSync(`/proc/${pid}/stat`, "utf-8");

		// Parse field 22 (starttime in clock ticks)
		// Format: pid (comm) state ppid ... starttime ...
		// The comm field can contain spaces and parentheses, so we need to find the last ')' first
		const lastParen = statContent.lastIndexOf(")");
		if (lastParen === -1) return null;

		const fields = statContent.substring(lastParen + 1).trim().split(/\s+/);
		// After "), the fields are: state ppid ... field19 field20 field21 starttime(field22)
		// So starttime is at index 19 (0-indexed after the split)
		if (fields.length < 20) return null;

		const starttimeTicks = parseInt(fields[19], 10);
		if (isNaN(starttimeTicks)) return null;

		// Get system boot time from /proc/stat
		const statFileContent = readFileSync("/proc/stat", "utf-8");
		const btimeMatch = statFileContent.match(/^btime (\d+)$/m);
		if (!btimeMatch) return null;

		const bootTime = parseInt(btimeMatch[1], 10);

		// Get clock ticks per second (usually 100)
		const ticksPerSecond = 100; // Could use sysconf(_SC_CLK_TCK) but 100 is standard

		// Convert to Unix timestamp (milliseconds)
		const startTimeSec = bootTime + (starttimeTicks / ticksPerSecond);
		return Math.floor(startTimeSec * 1000);
	} catch {
		return null;
	}
}

/**
 * macOS: Use ps command to get start time
 */
function getMacOSProcessStartTime(pid: number): number | null {
	try {
		const output = execSync(`ps -p ${pid} -o lstart=`, {
			encoding: "utf-8",
			timeout: 500,
			windowsHide: true,
		}).trim();

		// Parse human-readable date
		const parsed = Date.parse(output);
		if (isNaN(parsed)) return null;

		return parsed;
	} catch {
		return null;
	}
}

/**
 * Windows: Use PowerShell to get process start time
 */
function getWindowsProcessStartTime(pid: number): number | null {
	try {
		const output = execSync(
			`powershell -NoProfile -Command "(Get-Process -Id ${pid}).StartTime.ToFileTimeUtc()"`,
			{
				encoding: "utf-8",
				timeout: 500,
				windowsHide: true,
			}
		).trim();

		// Convert Windows FILETIME to Unix timestamp
		// FILETIME is 100-nanosecond intervals since Jan 1, 1601
		// Unix timestamp is milliseconds since Jan 1, 1970
		const filetime = parseInt(output, 10);
		if (isNaN(filetime)) return null;

		// Convert to Unix timestamp
		const unixEpochFiletime = 116444736000000000n; // Jan 1, 1970 in FILETIME units
		const filetimeBigInt = BigInt(filetime);
		const unixMs = Number((filetimeBigInt - unixEpochFiletime) / 10000n);

		return unixMs;
	} catch {
		return null;
	}
}

/**
 * Check if process is alive and matches expected start time
 * Returns true if alive and start time matches (within tolerance)
 * Returns false if dead or start time mismatch
 * Uses timeout to prevent blocking
 */
export async function isProcessAliveWithStartTime(
	pid: number,
	expectedStartTime: number,
	timeoutMs: number
): Promise<boolean> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			// Timeout - treat as alive (conservative)
			resolve(true);
		}, timeoutMs);

		try {
			// Basic existence check
			if (!isProcessAlive(pid)) {
				clearTimeout(timer);
				resolve(false);
				return;
			}

			// Start time validation
			const actualStartTime = getProcessStartTime(pid);

			if (actualStartTime === null) {
				// Can't validate start time - fall back to existence check
				console.warn(`[process-lock] Start time validation unavailable for PID ${pid}, using existence-only check`);
				clearTimeout(timer);
				resolve(true); // Conservative: assume alive
				return;
			}

			// Allow 1-second tolerance for clock differences
			const diff = Math.abs(actualStartTime - expectedStartTime);
			const matches = diff < 1000;

			clearTimeout(timer);
			resolve(matches);
		} catch {
			clearTimeout(timer);
			resolve(false);
		}
	});
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Clean up stale lock files
 * Removes locks for dead processes or expired reservations
 * Returns list of cleaned session IDs
 */
export function cleanupStaleLocks(maxAgeMs: number): string[] {
	ensureLocksDir();
	const cleaned: string[] = [];

	try {
		const files = readdirSync(LOCKS_DIR);

		for (const file of files) {
			if (!file.endsWith(".lock")) continue;

			const sessionId = file.replace(".lock", "");
			const lockPath = join(LOCKS_DIR, file);

			try {
				const lock = readLockFile(sessionId);

				if (!lock) {
					// Invalid lock - already deleted by readLockFile
					cleaned.push(sessionId);
					continue;
				}

				if (lock.status === "reserved") {
					// Check reservation age
					const age = Date.now() - lock.reservedAt;
					if (age > maxAgeMs) {
						unlinkSync(lockPath);
						cleaned.push(sessionId);
					}
				} else if (lock.status === "running") {
					// Check if process is alive
					const alive = isProcessAlive(lock.pid);
					if (!alive) {
						unlinkSync(lockPath);
						cleaned.push(sessionId);
					}
				}
			} catch {
				// Error processing this lock - skip
			}
		}
	} catch {
		// Error reading directory
	}

	return cleaned;
}
