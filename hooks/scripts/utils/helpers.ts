import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { ProjectInfo, Observation, PostToolUseInput, ProjectContext } from '../../../src/shared/types.js';
import { LANGUAGE_MAP } from '../../../src/shared/constants.js';

/**
 * Get project info from the current working directory
 */
export async function getProjectInfo(cwd: string): Promise<ProjectInfo> {
  const info: ProjectInfo = {
    name: path.basename(cwd),
    path: cwd,
  };

  // Try to get git info
  const gitDir = path.join(cwd, '.git');
  if (fs.existsSync(gitDir)) {
    try {
      // Get remote URL
      const configPath = path.join(gitDir, 'config');
      if (fs.existsSync(configPath)) {
        const config = fs.readFileSync(configPath, 'utf-8');
        const remoteMatch = config.match(/\[remote "origin"\][\s\S]*?url = (.+)/);
        if (remoteMatch) {
          info.gitRemote = remoteMatch[1].trim();
          // Extract repo name from URL
          const repoMatch = info.gitRemote.match(/[:/]([^/]+\/[^/.]+)(\.git)?$/);
          if (repoMatch) {
            info.name = repoMatch[1].replace('/', '_');
          }
        }
      }

      // Get current branch
      const headPath = path.join(gitDir, 'HEAD');
      if (fs.existsSync(headPath)) {
        const head = fs.readFileSync(headPath, 'utf-8').trim();
        const branchMatch = head.match(/ref: refs\/heads\/(.+)/);
        if (branchMatch) {
          info.gitBranch = branchMatch[1];
        }
      }
    } catch {
      // Ignore git errors
    }
  }

  return info;
}

/**
 * Generate a unique observation ID
 */
export function generateObservationId(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString('hex');
  return `${timestamp}-${random}`;
}

/**
 * Check if an action is significant enough to capture.
 * Uses fixed heuristics: file changes, errors, and non-trivial bash commands.
 */
export function isSignificantAction(input: PostToolUseInput): boolean {
  // Always capture errors
  if (input.tool_response.isError) {
    return true;
  }

  // For file operations, check if it's a meaningful change
  if (input.tool_name === 'Write' || input.tool_name === 'Edit' || input.tool_name === 'MultiEdit') {
    return true; // All file changes are significant
  }

  // For bash commands, filter out trivial commands
  if (input.tool_name === 'Bash') {
    const command = (input.tool_input.command as string || '').toLowerCase();

    // Skip trivial commands
    const trivialCommands = ['ls', 'pwd', 'cd', 'echo', 'cat', 'head', 'tail', 'wc'];
    if (trivialCommands.some(c => command.startsWith(c + ' ') || command === c)) {
      return false;
    }

    // Keep significant commands
    const significantPatterns = [
      'npm', 'yarn', 'pnpm', 'bun',
      'git',
      'docker',
      'make',
      'cargo',
      'go ',
      'python',
      'pip',
      'test',
      'build',
      'deploy',
    ];

    return significantPatterns.some(p => command.includes(p));
  }

  return false;
}

/**
 * Extract file info from a tool use
 */
export function extractFileInfo(
  input: Record<string, unknown>,
  response: { content: Array<{ type: string; text?: string }>; isError?: boolean }
): {
  path: string;
  language: string;
  changeType: 'create' | 'modify' | 'delete';
  linesAdded?: number;
  linesRemoved?: number;
} {
  const filePath = (input.file_path as string) || (input.path as string) || 'unknown';
  const ext = path.extname(filePath);
  const language = LANGUAGE_MAP[ext] || 'unknown';

  // Determine change type from response
  let changeType: 'create' | 'modify' | 'delete' = 'modify';
  const responseText = response.content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join(' ')
    .toLowerCase();

  if (responseText.includes('created')) {
    changeType = 'create';
  } else if (responseText.includes('deleted')) {
    changeType = 'delete';
  }

  return {
    path: filePath,
    language,
    changeType,
  };
}

/**
 * Extract command info from a bash tool use
 */
export function extractCommandInfo(
  input: Record<string, unknown>,
  response: { content: Array<{ type: string; text?: string }>; isError?: boolean },
  bashOutputConfig?: { enabled: boolean; maxLength: number }
): {
  command: string;
  exitCode: number;
  output?: string;
  isError: boolean;
} {
  const command = (input.command as string) || '';
  const rawOutput = response.content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('\n');

  // Try to extract exit code from output
  let exitCode = response.isError ? 1 : 0;
  const exitCodeMatch = rawOutput.match(/exit code[:\s]+(\d+)/i);
  if (exitCodeMatch) {
    exitCode = parseInt(exitCodeMatch[1], 10);
  }

  // Respect bashOutput config settings
  const captureOutput = bashOutputConfig?.enabled ?? true;
  const maxLength = bashOutputConfig?.maxLength ?? 5000;

  return {
    command,
    exitCode,
    output: captureOutput ? rawOutput.substring(0, maxLength) : undefined,
    isError: response.isError || exitCode !== 0,
  };
}

/**
 * Extract error info from a failed tool response
 */
export function extractErrorInfo(
  toolName: string,
  input: Record<string, unknown>,
  response: { content: Array<{ type: string; text?: string }>; isError?: boolean }
): {
  type: string;
  message: string;
  file?: string;
  context?: string;
} {
  const output = response.content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('\n');

  // Try to extract error type and message
  let type = 'UnknownError';
  let message = output.substring(0, 500);

  // Common error patterns
  const errorPatterns = [
    /(\w+Error):\s*(.+)/,
    /error\[E\d+\]:\s*(.+)/i,
    /error:\s*(.+)/i,
    /failed:\s*(.+)/i,
  ];

  for (const pattern of errorPatterns) {
    const match = output.match(pattern);
    if (match) {
      if (match[2]) {
        type = match[1];
        message = match[2];
      } else {
        message = match[1];
      }
      break;
    }
  }

  const result: {
    type: string;
    message: string;
    file?: string;
    context?: string;
  } = { type, message };

  // Try to extract file from input
  if (input.file_path) {
    result.file = input.file_path as string;
  } else if (input.path) {
    result.file = input.path as string;
  }

  // Add context
  if (toolName === 'Bash') {
    result.context = `Command: ${(input.command as string || '').substring(0, 100)}`;
  }

  return result;
}

/**
 * Format project context for injection into Claude's conversation
 */
export function formatContextForInjection(context: {
  content: string;
  formatted?: string;
}): string {
  if (context.formatted) {
    return context.formatted;
  }

  return context.content;
}

/**
 * Read JSON from stdin
 */
export async function readStdinJson<T>(): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString('utf-8');
  return JSON.parse(text) as T;
}
