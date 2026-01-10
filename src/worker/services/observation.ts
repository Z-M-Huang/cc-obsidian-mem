import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Observation, ErrorData, Config } from '../../shared/types.js';
import { VaultManager } from '../../mcp-server/utils/vault.js';
import { stringifyFrontmatter, generateFrontmatter, parseFrontmatter, mergeFrontmatter } from '../../mcp-server/utils/frontmatter.js';
import { sanitizeProjectName } from '../../shared/config.js';
import { SessionManager } from './session.js';
import { Summarizer } from './summarizer.js';

export class ObservationProcessor {
  private vault: VaultManager;
  private sessionManager: SessionManager;
  private summarizer: Summarizer;
  private config: Config;

  constructor(
    vault: VaultManager,
    sessionManager: SessionManager,
    summarizer: Summarizer,
    config: Config
  ) {
    this.vault = vault;
    this.sessionManager = sessionManager;
    this.summarizer = summarizer;
    this.config = config;
  }

  /**
   * Process an observation from a hook
   */
  async process(sessionId: string, observation: Observation): Promise<void> {
    // Add to session
    this.sessionManager.addObservation(sessionId, observation);

    // Handle errors specially - create/update error notes
    if (observation.type === 'error' || observation.isError) {
      await this.processError(sessionId, observation);
    }

    // Handle file edits - update file knowledge
    if (observation.type === 'file_edit') {
      await this.processFileEdit(sessionId, observation);
    }
  }

  /**
   * Process an error observation
   */
  private async processError(sessionId: string, observation: Observation): Promise<void> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) return;

    const errorData = observation.data as ErrorData;
    const errorHash = this.hashError(errorData);

    const projectPath = path.join(
      this.vault.getMemPath(),
      'projects',
      sanitizeProjectName(session.project),
      'errors'
    );

    // Ensure directory exists
    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true });
    }

    const errorFilePath = path.join(projectPath, `${errorHash}.md`);

    if (fs.existsSync(errorFilePath)) {
      // Update existing error note
      await this.updateErrorNote(errorFilePath, observation, sessionId);
    } else {
      // Create new error note
      await this.createErrorNote(errorFilePath, observation, session.project, sessionId);
    }
  }

  /**
   * Create a new error note
   */
  private async createErrorNote(
    filePath: string,
    observation: Observation,
    project: string,
    sessionId: string
  ): Promise<void> {
    const errorData = observation.data as ErrorData;

    const frontmatter = generateFrontmatter('error', {
      title: `Error: ${errorData.type || 'Unknown'}`,
      project,
      tags: ['error', `error/${this.categorizeError(errorData)}`, `project/${sanitizeProjectName(project)}`],
      additional: {
        error_type: errorData.type,
        error_hash: path.basename(filePath, '.md'),
        first_seen: observation.timestamp,
        last_seen: observation.timestamp,
        occurrences: 1,
        resolved: false,
        sessions: [sessionId],
      },
    });

    let summary = '';
    if (this.config.summarization.errorSummary && this.summarizer.isAvailable()) {
      summary = await this.summarizer.summarizeError(observation);
    }

    const content = `# Error: ${errorData.type || 'Unknown'}

## Summary

${summary || '> [!danger] Error Pattern\n> ' + (errorData.message || 'No message')}

## Context

**File**: \`${errorData.file || 'unknown'}\`
**Line**: ${errorData.line || 'unknown'}

## Error Message

\`\`\`
${errorData.message || 'No error message'}
\`\`\`

${errorData.stack ? `## Stack Trace

\`\`\`
${errorData.stack}
\`\`\`` : ''}

## Resolution

> [!success] Solution
> _Not yet resolved_

## Occurrences

| Date | Session | Context |
|------|---------|---------|
| ${observation.timestamp.split('T')[0]} | ${sessionId.substring(0, 8)} | First occurrence |
`;

    fs.writeFileSync(filePath, stringifyFrontmatter(frontmatter, content));
  }

  /**
   * Update an existing error note
   */
  private async updateErrorNote(
    filePath: string,
    observation: Observation,
    sessionId: string
  ): Promise<void> {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { frontmatter, content } = parseFrontmatter(raw);

    // Update frontmatter
    const sessions = (frontmatter.sessions as string[]) || [];
    if (!sessions.includes(sessionId)) {
      sessions.push(sessionId);
    }

    const updatedFrontmatter = mergeFrontmatter(frontmatter, {
      last_seen: observation.timestamp,
      occurrences: ((frontmatter.occurrences as number) || 0) + 1,
      sessions,
    } as Record<string, unknown>);

    // Add new occurrence to table
    const errorData = observation.data as ErrorData;
    const newRow = `| ${observation.timestamp.split('T')[0]} | ${sessionId.substring(0, 8)} | ${errorData.context || 'Recurring'} |`;

    // Find the Occurrences table and append the new row
    let updatedContent = content;
    const occurrencesHeader = '## Occurrences';
    const headerIndex = content.indexOf(occurrencesHeader);

    if (headerIndex !== -1) {
      // Find the table separator line (|---|---|---|)
      const afterHeader = content.substring(headerIndex);
      const separatorMatch = afterHeader.match(/\|[-|\s]+\|\n/);

      if (separatorMatch) {
        const separatorEnd = headerIndex + (separatorMatch.index || 0) + separatorMatch[0].length;
        // Insert the new row right after the separator
        updatedContent = content.substring(0, separatorEnd) + newRow + '\n' + content.substring(separatorEnd);
      }
    }

    fs.writeFileSync(filePath, stringifyFrontmatter(updatedFrontmatter, updatedContent));
  }

  /**
   * Process a file edit observation
   */
  private async processFileEdit(sessionId: string, observation: Observation): Promise<void> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) return;

    const fileData = observation.data as { path: string; language?: string; changeType?: string };
    const fileHash = this.hashFilePath(fileData.path);

    const projectPath = path.join(
      this.vault.getMemPath(),
      'projects',
      sanitizeProjectName(session.project),
      'files'
    );

    // Ensure directory exists
    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true });
    }

    const knowledgeFilePath = path.join(projectPath, `${fileHash}.md`);

    if (fs.existsSync(knowledgeFilePath)) {
      // Update existing file knowledge
      await this.updateFileKnowledge(knowledgeFilePath, observation, sessionId);
    } else {
      // Create new file knowledge note
      await this.createFileKnowledge(knowledgeFilePath, observation, session.project, sessionId);
    }
  }

  /**
   * Create a new file knowledge note
   */
  private async createFileKnowledge(
    filePath: string,
    observation: Observation,
    project: string,
    sessionId: string
  ): Promise<void> {
    const fileData = observation.data as { path: string; language?: string; changeType?: string };

    const frontmatter = generateFrontmatter('file', {
      title: path.basename(fileData.path),
      project,
      tags: ['file', `lang/${fileData.language || 'unknown'}`, `project/${sanitizeProjectName(project)}`],
      additional: {
        file_path: fileData.path,
        file_hash: path.basename(filePath, '.md'),
        language: fileData.language || 'unknown',
        edit_count: 1,
        last_edited: observation.timestamp,
      },
    });

    const content = `# File: ${fileData.path}

## Purpose

_File purpose not yet documented_

## Edit History

| Date | Session | Change Summary |
|------|---------|----------------|
| ${observation.timestamp.split('T')[0]} | ${sessionId.substring(0, 8)} | ${fileData.changeType || 'Modified'} |

## Notes

_No notes yet_
`;

    fs.writeFileSync(filePath, stringifyFrontmatter(frontmatter, content));
  }

  /**
   * Update existing file knowledge
   */
  private async updateFileKnowledge(
    filePath: string,
    observation: Observation,
    sessionId: string
  ): Promise<void> {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { frontmatter, content } = parseFrontmatter(raw);
    const fileData = observation.data as { path: string; changeType?: string };

    const updatedFrontmatter = mergeFrontmatter(frontmatter, {
      edit_count: ((frontmatter.edit_count as number) || 0) + 1,
      last_edited: observation.timestamp,
    } as Record<string, unknown>);

    // Add new row to edit history
    const newRow = `| ${observation.timestamp.split('T')[0]} | ${sessionId.substring(0, 8)} | ${fileData.changeType || 'Modified'} |`;

    let updatedContent = content;
    const tableMatch = content.match(/(\| Date \| Session \| Change Summary \|\n\|[-|\s]+\|)/);
    if (tableMatch) {
      const insertPos = content.indexOf(tableMatch[0]) + tableMatch[0].length;
      updatedContent = content.substring(0, insertPos) + '\n' + newRow + content.substring(insertPos);
    }

    fs.writeFileSync(filePath, stringifyFrontmatter(updatedFrontmatter, updatedContent));
  }

  /**
   * Hash an error for deduplication
   */
  private hashError(error: ErrorData): string {
    const key = `${error.type || ''}:${error.message || ''}:${error.file || ''}`;
    return crypto.createHash('md5').update(key).digest('hex').substring(0, 12);
  }

  /**
   * Hash a file path for note naming
   */
  private hashFilePath(filePath: string): string {
    return crypto.createHash('md5').update(filePath).digest('hex').substring(0, 12);
  }

  /**
   * Categorize an error type
   */
  private categorizeError(error: ErrorData): string {
    const type = (error.type || '').toLowerCase();
    const message = (error.message || '').toLowerCase();

    if (type.includes('syntax') || message.includes('syntax')) return 'syntax';
    if (type.includes('type') || message.includes('type')) return 'type';
    if (type.includes('reference') || message.includes('undefined')) return 'reference';
    if (type.includes('network') || message.includes('fetch') || message.includes('connection')) return 'network';
    if (type.includes('permission') || message.includes('access denied')) return 'permission';
    if (message.includes('not found') || message.includes('enoent')) return 'not-found';

    return 'general';
  }
}
