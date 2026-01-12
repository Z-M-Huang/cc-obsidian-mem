import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadConfig } from './config.js';

/**
 * Logger interface
 */
export interface Logger {
  debug(message: string, context?: unknown): void;
  info(message: string, context?: unknown): void;
  error(message: string, error?: Error): void;
}

/**
 * Sensitive property names to redact (case-insensitive)
 */
const SENSITIVE_KEYS = [
  'apikey', 'api_key', 'password', 'secret', 'token',
  'authorization', 'bearer', 'credential', 'private_key',
  'privatekey', 'auth', 'pwd', 'pass'
];

/**
 * Sensitive value patterns to redact
 */
const SENSITIVE_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g,
  /Bearer\s+[a-zA-Z0-9._-]{20,}/gi,
  /ghp_[a-zA-Z0-9]{36}/g,
  /gho_[a-zA-Z0-9]{36}/g,
  /xox[baprs]-[a-zA-Z0-9-]+/g,
  /AKIA[0-9A-Z]{16}/g,
  /eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g,
  // URL credentials (https://user:token@host, x-access-token patterns)
  /https?:\/\/[^:]+:[^@]+@[^\s]+/gi,
  /x-access-token:[^@]+@/gi,
];

/**
 * Create a logger instance with session context
 */
export function createLogger(source: string, sessionId?: string): Logger {
  const config = loadConfig();
  const verbose = config.logging?.verbose ?? false;
  const logDir = config.logging?.logDir || os.tmpdir();

  // Ensure log directory exists
  const actualLogDir = ensureLogDirectory(logDir);

  // Determine log file path
  const logFile = sessionId
    ? path.join(actualLogDir, `cc-obsidian-mem-${sanitizeSessionId(sessionId)}.log`)
    : path.join(actualLogDir, 'cc-obsidian-mem-mcp.log');

  return {
    debug(message: string, context?: unknown): void {
      if (!verbose) return;
      writeLog(logFile, 'DEBUG', source, message, context);
    },

    info(message: string, context?: unknown): void {
      writeLog(logFile, 'INFO', source, message, context);
    },

    error(message: string, error?: Error): void {
      // Sanitize error message to prevent leaking sensitive data
      const sanitizedMessage = sanitizeString(message);
      const sanitizedError = error ? sanitizeString(error.message) : '';
      const errorMessage = sanitizedError ? `${sanitizedMessage}: ${sanitizedError}` : sanitizedMessage;
      writeLog(logFile, 'ERROR', source, errorMessage);
    },
  };
}

/**
 * Ensure log directory exists, fall back to tmpdir on failure
 */
function ensureLogDirectory(logDir: string): string {
  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
    }

    // Test write access
    const testFile = path.join(logDir, `.write-test-${Date.now()}`);
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);

    return logDir;
  } catch (error) {
    const fallback = os.tmpdir();
    console.warn(`[logger] Cannot use logDir ${logDir}, falling back to ${fallback}:`, error);
    return fallback;
  }
}

/**
 * Sanitize session ID for use in filename (prevent path traversal)
 */
function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9-_]/g, '_');
}

/**
 * Write a log entry to file
 */
function writeLog(logFile: string, level: string, source: string, message: string, context?: unknown): void {
  try {
    const timestamp = new Date().toISOString();
    const contextStr = context ? ` ${sanitizeContext(context)}` : '';
    const line = `[${timestamp}] [${level}] [${source}] ${message}${contextStr}\n`;

    // For MCP log file, check rotation
    if (logFile.includes('cc-obsidian-mem-mcp.log')) {
      rotateLogIfNeeded(logFile);
    }

    fs.appendFileSync(logFile, line, { mode: 0o600 });
  } catch (error) {
    // Silently fail to match hook pattern - never throw
  }
}

/**
 * Rotate MCP log file if it exceeds size limit
 */
function rotateLogIfNeeded(logFile: string): void {
  try {
    const maxSize = 10 * 1024 * 1024; // 10MB
    const stats = fs.statSync(logFile);

    if (stats.size > maxSize) {
      // Read last 1000 lines
      const content = fs.readFileSync(logFile, 'utf-8');
      const lines = content.split('\n');
      const lastLines = lines.slice(-1000).join('\n');

      // Truncate and write back
      fs.writeFileSync(logFile, lastLines, { mode: 0o600 });
    }
  } catch (error) {
    // Silently fail
  }
}

/**
 * Sanitize context object before logging
 */
function sanitizeContext(context: unknown): string {
  try {
    const sanitized = recursiveSanitize(context);
    return JSON.stringify(sanitized, getCircularReplacer());
  } catch (error) {
    return '[Unable to serialize context]';
  }
}

/**
 * Recursively sanitize an object, redacting sensitive data
 * Uses WeakSet to track circular references during recursion
 */
function recursiveSanitize(obj: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }

  if (Array.isArray(obj)) {
    // Check for circular reference before recursing
    if (seen.has(obj)) {
      return '[Circular]';
    }
    seen.add(obj);
    return obj.map(item => recursiveSanitize(item, seen));
  }

  if (typeof obj === 'object') {
    // Check for circular reference before recursing
    if (seen.has(obj)) {
      return '[Circular]';
    }
    seen.add(obj);

    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Check if key name is sensitive (case-insensitive)
      if (SENSITIVE_KEYS.includes(key.toLowerCase())) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = recursiveSanitize(value, seen);
      }
    }
    return sanitized;
  }

  return obj;
}

/**
 * Sanitize a string by redacting sensitive patterns
 */
function sanitizeString(str: string): string {
  let result = str;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

/**
 * Get a replacer function for JSON.stringify that handles circular references
 */
function getCircularReplacer() {
  const seen = new WeakSet();
  return (_key: string, value: unknown) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  };
}

/**
 * Clean up old session log files (called from session-end hook)
 */
export function cleanupOldLogs(maxAgeHours: number = 24): void {
  try {
    const config = loadConfig();
    const logDir = config.logging?.logDir || os.tmpdir();

    if (!fs.existsSync(logDir)) return;

    const now = Date.now();
    const maxAge = maxAgeHours * 60 * 60 * 1000;
    const files = fs.readdirSync(logDir);

    for (const file of files) {
      // Only delete session logs matching the pattern, never MCP log
      if (file.startsWith('cc-obsidian-mem-') &&
          file.endsWith('.log') &&
          file !== 'cc-obsidian-mem-mcp.log') {

        const filePath = path.join(logDir, file);
        try {
          const stats = fs.statSync(filePath);
          if (now - stats.mtimeMs > maxAge) {
            fs.unlinkSync(filePath);
          }
        } catch {
          // Skip file if we can't stat/delete it
        }
      }
    }
  } catch (error) {
    // Silently fail
  }
}
