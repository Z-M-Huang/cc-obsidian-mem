/**
 * Port numbers
 */
export const DEFAULT_WORKER_PORT = 37781;
export const DEFAULT_MCP_PORT = 37780;

/**
 * File paths
 */
export const MEM_FOLDER_NAME = '_claude-mem';
export const TEMPLATES_FOLDER = 'templates';
export const PROJECTS_FOLDER = 'projects';
export const GLOBAL_FOLDER = 'global';

/**
 * Note types
 */
export const NOTE_TYPES = [
  'session',
  'error',
  'decision',
  'pattern',
  'file',
  'learning',
] as const;

/**
 * Template file names
 */
export const TEMPLATE_FILES = {
  session: 'session.md',
  error: 'error.md',
  decision: 'decision.md',
  pattern: 'pattern.md',
  file: 'file-knowledge.md',
  learning: 'learning.md',
} as const;

/**
 * Callout types for Obsidian
 */
export const CALLOUT_TYPES = {
  info: 'info',
  note: 'note',
  warning: 'warning',
  danger: 'danger',
  success: 'success',
  tip: 'tip',
  question: 'question',
  example: 'example',
  quote: 'quote',
} as const;

/**
 * Tool names we capture
 */
export const CAPTURED_TOOLS = ['Write', 'Edit', 'MultiEdit', 'Bash'] as const;

/**
 * Language detection by file extension
 */
export const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'zsh',
  '.fish': 'fish',
  '.sql': 'sql',
  '.md': 'markdown',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.xml': 'xml',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.vue': 'vue',
  '.svelte': 'svelte',
};

/**
 * Date format for note filenames
 */
export const DATE_FORMAT = 'YYYY-MM-DD';
export const DATETIME_FORMAT = 'YYYY-MM-DD_HH-mm-ss';

/**
 * API endpoints for worker service
 */
export const WORKER_ENDPOINTS = {
  health: '/health',
  sessionStart: '/session/start',
  sessionEnd: '/session/end',
  sessionCurrent: '/session/current',
  sessionSummarize: '/session/summarize',
  observationCapture: '/observation/capture',
  contextProject: '/context/project',
  searchSemantic: '/search/semantic',
} as const;
