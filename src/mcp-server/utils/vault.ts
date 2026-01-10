import * as fs from 'fs';
import * as path from 'path';
import { parseFrontmatter, stringifyFrontmatter, generateFrontmatter, mergeFrontmatter } from './frontmatter.js';
import type { Note, NoteFrontmatter, WriteNoteInput, NoteType, SearchResult, ProjectContext } from '../../shared/types.js';
import { loadConfig, getMemFolderPath, getProjectPath, sanitizeProjectName } from '../../shared/config.js';
import { PROJECTS_FOLDER, GLOBAL_FOLDER, TEMPLATES_FOLDER } from '../../shared/constants.js';

export class VaultManager {
  private vaultPath: string;
  private memFolder: string;

  constructor(vaultPath?: string, memFolder?: string) {
    const config = loadConfig();
    this.vaultPath = vaultPath || config.vault.path;
    this.memFolder = memFolder || config.vault.memFolder;
  }

  /**
   * Get the full path to the memory folder
   */
  getMemPath(): string {
    return path.join(this.vaultPath, this.memFolder);
  }

  /**
   * Ensure the vault structure exists
   */
  async ensureStructure(): Promise<void> {
    const memPath = this.getMemPath();
    const dirs = [
      memPath,
      path.join(memPath, PROJECTS_FOLDER),
      path.join(memPath, GLOBAL_FOLDER),
      path.join(memPath, GLOBAL_FOLDER, 'patterns'),
      path.join(memPath, GLOBAL_FOLDER, 'tools'),
      path.join(memPath, GLOBAL_FOLDER, 'learnings'),
      path.join(memPath, GLOBAL_FOLDER, 'errors'),
      path.join(memPath, TEMPLATES_FOLDER),
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Ensure a project folder structure exists
   */
  async ensureProjectStructure(projectName: string): Promise<string> {
    const projectPath = path.join(
      this.getMemPath(),
      PROJECTS_FOLDER,
      sanitizeProjectName(projectName)
    );

    const dirs = [
      projectPath,
      path.join(projectPath, 'sessions'),
      path.join(projectPath, 'errors'),
      path.join(projectPath, 'decisions'),
      path.join(projectPath, 'files'),
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Create project index if it doesn't exist
    const indexPath = path.join(projectPath, '_index.md');
    if (!fs.existsSync(indexPath)) {
      await this.createProjectIndex(projectName, projectPath);
    }

    return projectPath;
  }

  /**
   * Create a project index file with Dataview queries
   */
  private async createProjectIndex(projectName: string, projectPath: string): Promise<void> {
    const relativePath = path.relative(this.getMemPath(), projectPath);
    const content = `# ${projectName}

## Recent Sessions

\`\`\`dataview
TABLE start_time as "Started", duration_minutes as "Duration", observations_count as "Actions"
FROM "${this.memFolder}/${relativePath}/sessions"
WHERE type = "session"
SORT start_time DESC
LIMIT 10
\`\`\`

## Active Errors

\`\`\`dataview
TABLE occurrences as "Count", last_seen as "Last Seen"
FROM "${this.memFolder}/${relativePath}/errors"
WHERE type = "error" AND resolved = false
SORT occurrences DESC
\`\`\`

## Recent Decisions

\`\`\`dataview
LIST
FROM "${this.memFolder}/${relativePath}/decisions"
WHERE type = "decision"
SORT date DESC
LIMIT 5
\`\`\`

## File Knowledge

\`\`\`dataview
TABLE language as "Language", edit_count as "Edits"
FROM "${this.memFolder}/${relativePath}/files"
WHERE type = "file"
SORT edit_count DESC
LIMIT 10
\`\`\`
`;

    const frontmatter = generateFrontmatter('learning', {
      title: projectName,
      project: projectName,
      tags: ['index', `project/${sanitizeProjectName(projectName)}`],
    });

    fs.writeFileSync(
      path.join(projectPath, '_index.md'),
      stringifyFrontmatter(frontmatter, content)
    );
  }

  /**
   * Read a note by path
   */
  async readNote(notePath: string, section?: string): Promise<Note> {
    const fullPath = this.resolvePath(notePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Note not found: ${notePath}`);
    }

    const raw = fs.readFileSync(fullPath, 'utf-8');
    const { frontmatter, content } = parseFrontmatter(raw);

    let finalContent = content;
    if (section) {
      finalContent = this.extractSection(content, section);
    }

    return {
      path: notePath,
      frontmatter,
      content: finalContent,
      title: frontmatter.title || this.extractTitleFromContent(content) || path.basename(notePath, '.md'),
    };
  }

  /**
   * Write a note
   */
  async writeNote(input: WriteNoteInput): Promise<{ path: string; created: boolean }> {
    await this.ensureStructure();

    const notePath = input.path || this.generateNotePath(input);
    const fullPath = this.resolvePath(notePath);

    // Ensure parent directory exists
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const exists = fs.existsSync(fullPath);

    if (exists && input.append) {
      // Append to existing note
      const existing = await this.readNote(notePath);
      const newContent = existing.content + '\n\n' + input.content;
      const updatedFrontmatter = mergeFrontmatter(existing.frontmatter, {
        tags: input.tags,
        ...input.metadata,
      } as Partial<NoteFrontmatter>);

      fs.writeFileSync(fullPath, stringifyFrontmatter(updatedFrontmatter, newContent));
    } else if (exists && input.preserveFrontmatter) {
      // Overwrite content but preserve existing frontmatter fields
      const existing = await this.readNote(notePath);

      // Generate new frontmatter, then merge with existing (existing takes precedence for created, user tags)
      const newFrontmatter = generateFrontmatter(input.type, {
        title: input.title,
        project: input.project,
        tags: input.tags,
        additional: input.metadata,
      });

      // Merge: keep existing created, combine tags, preserve custom fields
      const mergedFrontmatter = {
        ...newFrontmatter,
        ...existing.frontmatter,
        // Combine tags from both, removing duplicates
        tags: [...new Set([...(existing.frontmatter.tags || []), ...(input.tags || [])])],
        // Keep original created timestamp
        created: existing.frontmatter.created,
        // Update title and project if provided
        title: input.title || existing.frontmatter.title,
        project: input.project || existing.frontmatter.project,
      };

      fs.writeFileSync(fullPath, stringifyFrontmatter(mergedFrontmatter, input.content));
    } else {
      // Create or overwrite
      const frontmatter = generateFrontmatter(input.type, {
        title: input.title,
        project: input.project,
        tags: input.tags,
        additional: input.metadata,
      });

      fs.writeFileSync(fullPath, stringifyFrontmatter(frontmatter, input.content));
    }

    return { path: notePath, created: !exists };
  }

  /**
   * Search notes by content (keyword search)
   */
  async searchNotes(query: string, options: {
    project?: string;
    type?: NoteType;
    tags?: string[];
    limit?: number;
  } = {}): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const limit = options.limit || 10;

    const searchDir = options.project
      ? path.join(this.getMemPath(), PROJECTS_FOLDER, sanitizeProjectName(options.project))
      : this.getMemPath();

    if (!fs.existsSync(searchDir)) {
      return results;
    }

    const files = this.walkDir(searchDir, '.md');
    const queryLower = query.toLowerCase();

    for (const file of files) {
      if (results.length >= limit) break;

      try {
        const raw = fs.readFileSync(file, 'utf-8');
        const { frontmatter, content } = parseFrontmatter(raw);

        // Filter by type
        if (options.type && frontmatter.type !== options.type) {
          continue;
        }

        // Filter by tags
        if (options.tags && options.tags.length > 0) {
          const hasAllTags = options.tags.every(tag =>
            frontmatter.tags.includes(tag)
          );
          if (!hasAllTags) continue;
        }

        // Search in content
        const fullText = (content + ' ' + (frontmatter.title || '')).toLowerCase();
        if (!fullText.includes(queryLower)) {
          continue;
        }

        // Extract snippet
        const snippet = this.extractSnippet(content, query);

        results.push({
          id: path.basename(file, '.md'),
          title: frontmatter.title || path.basename(file, '.md'),
          type: frontmatter.type,
          path: path.relative(this.vaultPath, file),
          snippet,
          score: this.calculateScore(fullText, queryLower),
          metadata: {
            project: frontmatter.project,
            date: frontmatter.created,
            tags: frontmatter.tags,
          },
        });
      } catch {
        // Skip files that can't be parsed
      }
    }

    // Sort by score
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
  }

  /**
   * Get project context for injection
   */
  async getProjectContext(projectName: string, options: {
    includeRecentSessions?: number;
    includeErrors?: boolean;
    includeDecisions?: boolean;
    includePatterns?: boolean;
  } = {}): Promise<ProjectContext> {
    const projectPath = path.join(
      this.getMemPath(),
      PROJECTS_FOLDER,
      sanitizeProjectName(projectName)
    );

    const context: ProjectContext = {
      project: projectName,
      summary: '',
      recentSessions: [],
      unresolvedErrors: [],
      activeDecisions: [],
      patterns: [],
    };

    if (!fs.existsSync(projectPath)) {
      return context;
    }

    // Get recent sessions
    if (options.includeRecentSessions !== 0) {
      const sessionsDir = path.join(projectPath, 'sessions');
      if (fs.existsSync(sessionsDir)) {
        const sessionFiles = this.walkDir(sessionsDir, '.md')
          .sort((a, b) => fs.statSync(b).mtime.getTime() - fs.statSync(a).mtime.getTime())
          .slice(0, options.includeRecentSessions || 3);

        for (const file of sessionFiles) {
          try {
            const { frontmatter, content } = parseFrontmatter(
              fs.readFileSync(file, 'utf-8')
            );
            context.recentSessions.push({
              id: frontmatter.session_id as string || path.basename(file, '.md'),
              date: frontmatter.created,
              summary: frontmatter.summary as string || this.extractFirstParagraph(content),
              keyActions: [],
            });
          } catch {
            // Skip
          }
        }
      }
    }

    // Get unresolved errors
    if (options.includeErrors !== false) {
      const errorsDir = path.join(projectPath, 'errors');
      if (fs.existsSync(errorsDir)) {
        const errorFiles = this.walkDir(errorsDir, '.md');
        for (const file of errorFiles) {
          try {
            const { frontmatter } = parseFrontmatter(
              fs.readFileSync(file, 'utf-8')
            );
            if (frontmatter.resolved !== true) {
              context.unresolvedErrors.push({
                type: frontmatter.error_type as string || 'unknown',
                message: frontmatter.title || path.basename(file, '.md'),
                lastSeen: frontmatter.last_seen as string || frontmatter.updated,
              });
            }
          } catch {
            // Skip
          }
        }
      }
    }

    // Get active decisions
    if (options.includeDecisions !== false) {
      const decisionsDir = path.join(projectPath, 'decisions');
      if (fs.existsSync(decisionsDir)) {
        const decisionFiles = this.walkDir(decisionsDir, '.md')
          .sort((a, b) => fs.statSync(b).mtime.getTime() - fs.statSync(a).mtime.getTime())
          .slice(0, 5);

        for (const file of decisionFiles) {
          try {
            const { frontmatter, content } = parseFrontmatter(
              fs.readFileSync(file, 'utf-8')
            );
            context.activeDecisions.push({
              title: frontmatter.title || path.basename(file, '.md'),
              decision: this.extractFirstParagraph(content),
            });
          } catch {
            // Skip
          }
        }
      }
    }

    // Get patterns from global
    if (options.includePatterns !== false) {
      const patternsDir = path.join(this.getMemPath(), GLOBAL_FOLDER, 'patterns');
      if (fs.existsSync(patternsDir)) {
        const patternFiles = this.walkDir(patternsDir, '.md').slice(0, 5);
        for (const file of patternFiles) {
          try {
            const { frontmatter, content } = parseFrontmatter(
              fs.readFileSync(file, 'utf-8')
            );
            context.patterns.push({
              name: frontmatter.title || path.basename(file, '.md'),
              description: this.extractFirstParagraph(content),
            });
          } catch {
            // Skip
          }
        }
      }
    }

    return context;
  }

  /**
   * List all projects
   */
  async listProjects(): Promise<string[]> {
    const projectsDir = path.join(this.getMemPath(), PROJECTS_FOLDER);
    if (!fs.existsSync(projectsDir)) {
      return [];
    }

    return fs.readdirSync(projectsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  }

  // Helper methods

  private resolvePath(notePath: string): string {
    let resolvedPath: string;

    if (path.isAbsolute(notePath)) {
      resolvedPath = path.normalize(notePath);
    } else if (notePath.startsWith(this.memFolder)) {
      resolvedPath = path.normalize(path.join(this.vaultPath, notePath));
    } else {
      resolvedPath = path.normalize(path.join(this.getMemPath(), notePath));
    }

    // Security: Ensure the resolved path is within the vault
    const vaultRoot = path.normalize(this.vaultPath);
    if (!resolvedPath.startsWith(vaultRoot + path.sep) && resolvedPath !== vaultRoot) {
      throw new Error(`Path traversal detected: ${notePath} resolves outside vault`);
    }

    return resolvedPath;
  }

  private generateNotePath(input: WriteNoteInput): string {
    const date = new Date().toISOString().split('T')[0];

    let folder: string;
    let useDate = true;
    let fallbackSlug = 'untitled';

    switch (input.type) {
      case 'session':
        folder = input.project
          ? `${PROJECTS_FOLDER}/${sanitizeProjectName(input.project)}/sessions`
          : `${GLOBAL_FOLDER}/sessions`;
        fallbackSlug = 'untitled-session';
        break;
      case 'error':
        folder = input.project
          ? `${PROJECTS_FOLDER}/${sanitizeProjectName(input.project)}/errors`
          : `${GLOBAL_FOLDER}/errors`;
        fallbackSlug = 'untitled-error';
        break;
      case 'decision':
        folder = input.project
          ? `${PROJECTS_FOLDER}/${sanitizeProjectName(input.project)}/decisions`
          : `${GLOBAL_FOLDER}/decisions`;
        // Decisions use slug-only paths so same title appends to same file
        useDate = false;
        fallbackSlug = 'untitled-decision';
        break;
      case 'pattern':
        folder = `${GLOBAL_FOLDER}/patterns`;
        // Patterns also use slug-only paths
        useDate = false;
        fallbackSlug = 'untitled-pattern';
        break;
      case 'file':
        folder = input.project
          ? `${PROJECTS_FOLDER}/${sanitizeProjectName(input.project)}/files`
          : `${GLOBAL_FOLDER}/files`;
        fallbackSlug = 'untitled-file';
        break;
      default:
        folder = `${GLOBAL_FOLDER}/learnings`;
        fallbackSlug = 'untitled-learning';
    }

    const slug = this.slugify(input.title, fallbackSlug);
    return useDate ? `${folder}/${date}_${slug}.md` : `${folder}/${slug}.md`;
  }

  private slugify(text: string, fallback: string = 'untitled'): string {
    const slug = text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50);

    // Return fallback with timestamp if slug is empty (e.g., title was only punctuation)
    // This prevents collisions when multiple untitled notes are created
    return slug || `${fallback}-${Date.now()}`;
  }

  private walkDir(dir: string, ext: string): string[] {
    const files: string[] = [];

    if (!fs.existsSync(dir)) {
      return files;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...this.walkDir(fullPath, ext));
      } else if (entry.name.endsWith(ext)) {
        files.push(fullPath);
      }
    }

    return files;
  }

  private extractSection(content: string, section: string): string {
    // Handle block ID
    if (section.startsWith('^')) {
      const blockId = section.substring(1);
      const regex = new RegExp(`^(.+?)\\s+\\^${blockId}$`, 'm');
      const match = content.match(regex);
      return match ? match[1] : content;
    }

    // Handle heading
    const lines = content.split('\n');
    let capturing = false;
    let result: string[] = [];
    let headingLevel = 0;

    for (const line of lines) {
      const headingMatch = line.match(/^(#+)\s+(.+)$/);
      if (headingMatch) {
        if (capturing && headingMatch[1].length <= headingLevel) {
          break;
        }
        if (headingMatch[2].toLowerCase() === section.toLowerCase()) {
          capturing = true;
          headingLevel = headingMatch[1].length;
        }
      }
      if (capturing) {
        result.push(line);
      }
    }

    return result.join('\n') || content;
  }

  private extractTitleFromContent(content: string): string | undefined {
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : undefined;
  }

  private extractSnippet(content: string, query: string, maxLength = 200): string {
    const queryLower = query.toLowerCase();
    const contentLower = content.toLowerCase();
    const index = contentLower.indexOf(queryLower);

    if (index === -1) {
      return content.substring(0, maxLength) + '...';
    }

    const start = Math.max(0, index - 50);
    const end = Math.min(content.length, index + query.length + 150);

    let snippet = content.substring(start, end);
    if (start > 0) snippet = '...' + snippet;
    if (end < content.length) snippet = snippet + '...';

    return snippet;
  }

  private calculateScore(text: string, query: string): number {
    let score = 0;
    let index = 0;

    while ((index = text.indexOf(query, index)) !== -1) {
      score += 1;
      index += query.length;
    }

    return score;
  }

  private extractFirstParagraph(content: string): string {
    const lines = content.split('\n');
    const result: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) continue;
      if (trimmed === '') {
        if (result.length > 0) break;
        continue;
      }
      result.push(trimmed);
    }

    return result.join(' ').substring(0, 300);
  }
}
