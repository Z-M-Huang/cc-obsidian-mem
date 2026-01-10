/**
 * Configuration types for cc-obsidian-mem
 */

export interface Config {
  vault: {
    path: string;
    memFolder: string;
  };
  capture: {
    fileEdits: boolean;
    bashCommands: boolean;
    bashOutput: {
      enabled: boolean;
      maxLength: number;
    };
    errors: boolean;
    decisions: boolean;
  };
  summarization: {
    enabled: boolean;
    model: string;
    apiKeyEnvVar: string;
    sessionSummary: boolean;
    errorSummary: boolean;
  };
  contextInjection: {
    enabled: boolean;
    maxTokens: number;
    includeRecentSessions: number;
    includeRelatedErrors: boolean;
    includeProjectPatterns: boolean;
  };
}

/**
 * Session types
 */

export interface Session {
  id: string;
  project: string;
  projectPath: string;
  startTime: string;
  endTime?: string;
  durationMinutes?: number;
  status: 'active' | 'completed' | 'stopped';
  observations: Observation[];
  summary?: string;
  filesModified: string[];
  commandsRun: number;
  errorsEncountered: number;
}

export interface Observation {
  id: string;
  timestamp: string;
  type: ObservationType;
  tool: string;
  isError: boolean;
  data: FileEditData | CommandData | ErrorData | Record<string, unknown>;
}

export type ObservationType = 'file_edit' | 'command' | 'error' | 'decision' | 'other';

export interface FileEditData {
  path: string;
  language: string;
  changeType: 'create' | 'modify' | 'delete';
  linesAdded?: number;
  linesRemoved?: number;
  summary?: string;
}

export interface CommandData {
  command: string;
  exitCode: number;
  output?: string;
  duration?: number;
}

export interface ErrorData {
  type: string;
  message: string;
  stack?: string;
  file?: string;
  line?: number;
  context?: string;
  resolution?: string;
}

/**
 * Search types
 */

export interface SearchQuery {
  query: string;
  project?: string;
  type?: NoteType;
  tags?: string[];
  dateRange?: {
    start?: string;
    end?: string;
  };
  limit?: number;
  semantic?: boolean;
}

export interface SearchResult {
  id: string;
  title: string;
  type: string;
  path: string;
  snippet: string;
  score: number;
  metadata: {
    project?: string;
    date?: string;
    tags?: string[];
  };
}

/**
 * Note types
 */

export type NoteType = 'session' | 'error' | 'decision' | 'pattern' | 'file' | 'learning';

export interface NoteFrontmatter {
  type: NoteType;
  title?: string;
  project?: string;
  created: string;
  updated: string;
  tags: string[];
  aliases?: string[];
  [key: string]: unknown;
}

export interface Note {
  path: string;
  frontmatter: NoteFrontmatter;
  content: string;
  title: string;
}

export interface WriteNoteInput {
  type: NoteType;
  title: string;
  content: string;
  project?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  path?: string;
  append?: boolean;
  /** When true, preserves existing frontmatter fields (created, user tags, custom metadata) */
  preserveFrontmatter?: boolean;
}

/**
 * Project context types
 */

export interface ProjectInfo {
  name: string;
  path: string;
  gitRemote?: string;
  gitBranch?: string;
}

export interface ProjectContext {
  project: string;
  summary: string;
  recentSessions: Array<{
    id: string;
    date: string;
    summary: string;
    keyActions: string[];
  }>;
  unresolvedErrors: Array<{
    type: string;
    message: string;
    lastSeen: string;
  }>;
  activeDecisions: Array<{
    title: string;
    decision: string;
  }>;
  patterns: Array<{
    name: string;
    description: string;
  }>;
}

/**
 * Hook input types
 */

export interface SessionStartInput {
  session_id: string;
  cwd: string;
  transcript_path: string;
}

export interface PostToolUseInput {
  session_id: string;
  cwd: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: {
    content: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
}

export interface SessionEndInput {
  session_id: string;
  cwd: string;
  transcript_path: string;
}

