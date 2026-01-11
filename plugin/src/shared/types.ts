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
    model: string; // Agent SDK model: 'sonnet', 'opus', 'haiku', or full model ID
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
  /**
   * TechKB integration settings
   * Enables writing to a Johnny Decimal-style knowledge base structure
   */
  techkb?: TechKBConfig;
}

/**
 * TechKB integration configuration
 * Allows cc-obsidian-mem to write to a Johnny Decimal-style vault structure
 */
export interface TechKBConfig {
  /** Enable TechKB integration */
  enabled: boolean;
  /**
   * Base path to TechKB folder relative to vault root
   * e.g., "TechKB" for vault/TechKB/
   */
  basePath: string;
  /**
   * Project folder within TechKB (where _claude-mem project folders go)
   * e.g., "10-projects" for vault/TechKB/10-projects/{project}/_claude-mem/
   */
  projectFolder: string;
  /**
   * Category mapping from content types to TechKB paths
   * Keys are category names, values are paths relative to TechKB basePath
   * e.g., { "infrastructure": "30-infrastructure", "hardware": "80-reference/hardware" }
   */
  categoryMapping: Record<string, string>;
  /**
   * Default frontmatter fields to add to TechKB notes
   * These will be merged with note-specific frontmatter
   */
  defaultFrontmatter?: Record<string, unknown>;
}

/**
 * TechKB category definition for use in tools
 */
export interface TechKBCategory {
  /** Category identifier (key in categoryMapping) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Path relative to TechKB basePath */
  path: string;
  /** Description of what belongs in this category */
  description?: string;
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
  /** Knowledge paths captured during pre-compact, to be linked at session end */
  preCompactKnowledge?: string[];
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

export type NoteStatus = 'active' | 'superseded' | 'draft';

export interface NoteFrontmatter {
  type: NoteType;
  title?: string;
  project?: string;
  created: string;
  updated: string;
  tags: string[];
  aliases?: string[];
  /** Note status - active (default), superseded, or draft */
  status?: NoteStatus;
  /** Wikilink to the note that supersedes this one */
  superseded_by?: string;
  /** Wikilinks to notes that this note supersedes */
  supersedes?: string[];
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
  /** Note status - active (default), superseded, or draft */
  status?: NoteStatus;
  /** Path to note that supersedes this one (for marking as superseded) */
  superseded_by?: string;
  /** Paths to notes that this note supersedes */
  supersedes?: string[];
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

