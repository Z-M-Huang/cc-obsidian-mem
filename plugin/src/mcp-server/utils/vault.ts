import * as fs from 'fs';
import * as path from 'path';
import { parseFrontmatter, stringifyFrontmatter, generateFrontmatter, mergeFrontmatter } from './frontmatter.js';
import type { Note, NoteFrontmatter, WriteNoteInput, NoteType, SearchResult, ProjectContext, TechKBCategory } from '../../shared/types.js';
import {
  loadConfig,
  getMemFolderPath,
  getProjectPath,
  sanitizeProjectName,
  isTechKBEnabled,
  getTechKBBasePath,
  getTechKBCategoryPath,
  getTechKBProjectPath,
  getTechKBCategories,
  resolveTechKBPath,
} from '../../shared/config.js';
import { PROJECTS_FOLDER, GLOBAL_FOLDER, TEMPLATES_FOLDER } from '../../shared/constants.js';

/**
 * Input for writing a TechKB note
 */
export interface WriteTechKBNoteInput {
  /** Category key or path relative to TechKB base */
  category: string;
  /** Note title */
  title: string;
  /** Note content (markdown) */
  content: string;
  /** Optional tags */
  tags?: string[];
  /** Optional custom frontmatter fields */
  metadata?: Record<string, unknown>;
  /** Specific filename (without .md extension) - if not provided, generates from title */
  filename?: string;
  /** If true, append to existing note instead of creating new */
  append?: boolean;
}

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

    const categories = ['sessions', 'errors', 'decisions', 'files', 'knowledge', 'research'];
    const dirs = [
      projectPath,
      ...categories.map(cat => path.join(projectPath, cat)),
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Migrate old _index.md to new naming if it exists
    const sanitizedName = sanitizeProjectName(projectName);
    const oldIndexPath = path.join(projectPath, '_index.md');
    const newIndexPath = path.join(projectPath, `${sanitizedName}.md`);

    if (fs.existsSync(oldIndexPath) && !fs.existsSync(newIndexPath)) {
      fs.renameSync(oldIndexPath, newIndexPath);
    }

    // Create project index if it doesn't exist
    if (!fs.existsSync(newIndexPath)) {
      await this.createProjectIndex(projectName, projectPath);
    }

    // Create category indexes if they don't exist
    for (const category of categories) {
      // Use category name as index file name (e.g., decisions/decisions.md)
      const categoryIndexPath = path.join(projectPath, category, `${category}.md`);
      if (!fs.existsSync(categoryIndexPath)) {
        await this.createCategoryIndex(projectName, category, projectPath);
      }
    }

    return projectPath;
  }

  /**
   * Create a category index file that links to the project base
   */
  private async createCategoryIndex(
    projectName: string,
    category: string,
    projectPath: string
  ): Promise<void> {
    const sanitizedName = sanitizeProjectName(projectName);
    const categoryPath = path.join(projectPath, category);
    // Use category name as index file name (e.g., decisions/decisions.md)
    const indexPath = path.join(categoryPath, `${category}.md`);

    // Parent link to project base
    const projectBaseLink = `[[${this.memFolder}/${PROJECTS_FOLDER}/${sanitizedName}/${sanitizedName}]]`;

    // Category-specific configuration
    const categoryConfig: Record<string, { title: string; type: string; description: string }> = {
      sessions: {
        title: 'Sessions',
        type: 'session',
        description: 'Coding sessions with Claude Code',
      },
      errors: {
        title: 'Errors',
        type: 'error',
        description: 'Errors encountered and their resolutions',
      },
      decisions: {
        title: 'Decisions',
        type: 'decision',
        description: 'Technical and architectural decisions',
      },
      files: {
        title: 'Files',
        type: 'file',
        description: 'File-specific knowledge and edit history',
      },
      knowledge: {
        title: 'Knowledge',
        type: 'learning',
        description: 'Learnings, explanations, and Q&A',
      },
      research: {
        title: 'Research',
        type: 'learning',
        description: 'Web research and documentation lookups',
      },
    };

    const config = categoryConfig[category] || {
      title: category.charAt(0).toUpperCase() + category.slice(1),
      type: 'learning',
      description: `${category} for this project`,
    };

    const frontmatter = `---
type: ${config.type}
title: "${config.title} - ${projectName}"
project: ${projectName}
created: '${new Date().toISOString()}'
updated: '${new Date().toISOString()}'
tags:
  - index
  - ${category}
  - project/${sanitizedName}
parent: "${projectBaseLink}"
---
`;

    const content = `# ${config.title}

> ${config.description}

**Parent**: ${projectBaseLink}

## All ${config.title}

\`\`\`dataview
TABLE WITHOUT ID
  file.link as "Note",
  title as "Title",
  created as "Created"
FROM "${this.memFolder}/${PROJECTS_FOLDER}/${sanitizedName}/${category}"
WHERE file.name != "${category}"
SORT created DESC
\`\`\`
`;

    fs.writeFileSync(indexPath, frontmatter + content);
  }

  /**
   * Create a project index file with Dataview queries
   */
  private async createProjectIndex(projectName: string, projectPath: string): Promise<void> {
    const sanitizedName = sanitizeProjectName(projectName);
    const relativePath = path.relative(this.getMemPath(), projectPath);

    // Category links (e.g., decisions/decisions.md)
    const categories = ['knowledge', 'research', 'decisions', 'sessions', 'errors', 'files'];
    const categoryLinks = categories
      .map(cat => `- [[${this.memFolder}/${relativePath}/${cat}/${cat}|${cat.charAt(0).toUpperCase() + cat.slice(1)}]]`)
      .join('\n');

    const content = `# ${projectName}

## Categories

${categoryLinks}

---

## Recent Sessions

\`\`\`dataview
TABLE start_time as "Started", duration_minutes as "Duration", observations_count as "Actions"
FROM "${this.memFolder}/${relativePath}/sessions"
WHERE type = "session" AND !contains(tags, "index")
SORT start_time DESC
LIMIT 10
\`\`\`

## Active Errors

\`\`\`dataview
TABLE occurrences as "Count", last_seen as "Last Seen"
FROM "${this.memFolder}/${relativePath}/errors"
WHERE type = "error" AND resolved = false AND !contains(tags, "index")
SORT occurrences DESC
\`\`\`

## Recent Decisions

\`\`\`dataview
LIST
FROM "${this.memFolder}/${relativePath}/decisions"
WHERE type = "decision" AND !contains(tags, "index")
SORT created DESC
LIMIT 5
\`\`\`

## Recent Knowledge

\`\`\`dataview
TABLE knowledge_type as "Type", created as "Created"
FROM "${this.memFolder}/${relativePath}/knowledge"
WHERE !contains(tags, "index")
SORT created DESC
LIMIT 10
\`\`\`

## File Knowledge

\`\`\`dataview
TABLE language as "Language", edit_count as "Edits"
FROM "${this.memFolder}/${relativePath}/files"
WHERE type = "file" AND !contains(tags, "index")
SORT edit_count DESC
LIMIT 10
\`\`\`
`;

    const frontmatter = generateFrontmatter('learning', {
      title: projectName,
      project: projectName,
      tags: ['index', 'project-root', `project/${sanitizedName}`],
    });

    fs.writeFileSync(
      path.join(projectPath, `${sanitizedName}.md`),
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
        // Apply status if provided (can update status on existing notes)
        ...(input.status && { status: input.status }),
      } as Partial<NoteFrontmatter>);
      updatedFrontmatter.updated = new Date().toISOString();

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
        // Apply status if provided (can update status on existing notes)
        ...(input.status && { status: input.status }),
        updated: new Date().toISOString(),
      };

      fs.writeFileSync(fullPath, stringifyFrontmatter(mergedFrontmatter, input.content));
    } else {
      // Generate parent link for hierarchical navigation
      const parentLink = this.generateParentLink(notePath, input.project);

      // Create or overwrite
      const frontmatter = generateFrontmatter(input.type, {
        title: input.title,
        project: input.project,
        tags: input.tags,
        additional: {
          ...input.metadata,
          // Add parent link for hierarchical navigation
          ...(parentLink && { parent: parentLink }),
          // Add linking fields if provided
          ...(input.status && { status: input.status }),
          ...(input.superseded_by && { superseded_by: input.superseded_by }),
          ...(input.supersedes && input.supersedes.length > 0 && { supersedes: input.supersedes }),
        },
      });

      fs.writeFileSync(fullPath, stringifyFrontmatter(frontmatter, input.content));
    }

    return { path: notePath, created: !exists };
  }

  /**
   * Supersede an existing note with a new one
   * Creates bidirectional links between old and new notes
   * Infers project and type from old note if not provided
   * @throws Error if old note doesn't exist
   */
  async supersedeNote(
    oldNotePath: string,
    newNote: WriteNoteInput
  ): Promise<{ oldPath: string; newPath: string }> {
    // Validate old note exists
    const fullOldPath = this.resolvePath(oldNotePath);
    if (!fs.existsSync(fullOldPath)) {
      throw new Error(`Cannot supersede: note not found at "${oldNotePath}"`);
    }

    // Read old note to infer defaults
    let inferredProject: string | undefined;
    let inferredType: NoteType | undefined;
    let oldFrontmatter: NoteFrontmatter | undefined;

    {
      const raw = fs.readFileSync(fullOldPath, 'utf-8');
      const parsed = parseFrontmatter(raw);
      oldFrontmatter = parsed.frontmatter;

      // Infer project from old note
      if (!newNote.project && oldFrontmatter.project) {
        inferredProject = oldFrontmatter.project as string;
      }

      // Infer type from old note - preserve knowledge_type for research notes
      if (!newNote.type || newNote.type === 'learning') {
        const oldType = oldFrontmatter.type as NoteType;
        const knowledgeType = oldFrontmatter.knowledge_type as string;

        // If old note was in research folder or has research knowledge_type, keep it in research
        if (oldNotePath.includes('/research/') || knowledgeType === 'research') {
          // Store metadata to route to research folder
          inferredType = 'learning'; // Base type
          // We'll need to preserve the knowledge_type
        } else if (oldType) {
          inferredType = oldType;
        }
      }
    }

    // Build new note with inferred values
    const oldWikiLink = this.pathToWikiLink(oldNotePath);
    const newNoteWithLink: WriteNoteInput = {
      ...newNote,
      project: newNote.project || inferredProject,
      type: newNote.type || inferredType || 'learning',
      supersedes: [...(newNote.supersedes || []), oldWikiLink],
      // Preserve knowledge_type metadata if old note had one
      metadata: {
        ...newNote.metadata,
        ...(oldFrontmatter?.knowledge_type ? { knowledge_type: oldFrontmatter.knowledge_type } : {}),
      },
    };

    // Special handling for research notes - force them to stay in research folder
    let newResult: { path: string; created: boolean };
    if (oldNotePath.includes('/research/') || oldFrontmatter?.knowledge_type === 'research') {
      // Manually construct path to keep in research folder
      const project = newNoteWithLink.project;
      if (project) {
        const date = new Date().toISOString().split('T')[0];
        const slug = this.slugify(newNoteWithLink.title, 'research');
        const researchPath = `${PROJECTS_FOLDER}/${sanitizeProjectName(project)}/research/${date}_${slug}.md`;
        newResult = await this.writeNote({ ...newNoteWithLink, path: researchPath });
      } else {
        newResult = await this.writeNote(newNoteWithLink);
      }
    } else {
      newResult = await this.writeNote(newNoteWithLink);
    }

    const newWikiLink = this.pathToWikiLink(newResult.path);

    // Then, update the old note to mark it as superseded
    // (fullOldPath already resolved above)
    if (fs.existsSync(fullOldPath)) {
      const raw = fs.readFileSync(fullOldPath, 'utf-8');
      const { frontmatter, content } = parseFrontmatter(raw);

      // Update frontmatter
      frontmatter.status = 'superseded';
      frontmatter.superseded_by = newWikiLink;

      // Add superseded notice to content if not already present
      let updatedContent = content;
      if (!content.includes('> [!warning] Superseded')) {
        const notice = `> [!warning] Superseded\n> This note has been superseded by ${newWikiLink}\n\n`;
        updatedContent = notice + content;
      }

      fs.writeFileSync(fullOldPath, stringifyFrontmatter(frontmatter, updatedContent));
    }

    return { oldPath: oldNotePath, newPath: newResult.path };
  }

  /**
   * Convert a note path to an Obsidian wikilink
   */
  private pathToWikiLink(notePath: string): string {
    // Remove .md extension and prepend memFolder for vault-relative path
    const linkPath = notePath.replace(/\.md$/, '');
    // If path doesn't include memFolder, prepend it
    if (!linkPath.startsWith(this.memFolder)) {
      return `[[${this.memFolder}/${linkPath}]]`;
    }
    return `[[${linkPath}]]`;
  }

  /**
   * Generate parent link for a note based on its path
   * Notes link to their category _index.md, which links to project base
   */
  private generateParentLink(notePath: string, project?: string): string | undefined {
    if (!project) return undefined;

    const sanitizedProject = sanitizeProjectName(project);

    // Determine category from path
    const pathParts = notePath.split('/');
    const projectIndex = pathParts.indexOf(PROJECTS_FOLDER);

    if (projectIndex === -1) {
      // Global note - no parent linking for now
      return undefined;
    }

    // Path format: projects/project-name/category/filename.md
    // Category is at index projectIndex + 2
    const category = pathParts[projectIndex + 2];
    if (!category || category.endsWith('.md')) {
      // This is the project base itself
      return undefined;
    }

    // Link to category index (e.g., decisions/decisions.md)
    return `[[${this.memFolder}/${PROJECTS_FOLDER}/${sanitizedProject}/${category}/${category}]]`;
  }

  /**
   * Write a knowledge note to the vault
   */
  async writeKnowledge(
    knowledge: {
      type: 'qa' | 'explanation' | 'decision' | 'research' | 'learning';
      title: string;
      context: string;
      content: string;
      keyPoints: string[];
      topics: string[];
      sourceUrl?: string;
      sourceSession?: string;
    },
    projectName: string
  ): Promise<{ path: string; created: boolean }> {
    await this.ensureProjectStructure(projectName);

    const date = new Date().toISOString().split('T')[0];
    const slug = this.slugify(knowledge.title, `untitled-${knowledge.type}`);

    // Determine folder based on type
    const folder = knowledge.type === 'research'
      ? 'research'
      : 'knowledge';

    const notePath = `${PROJECTS_FOLDER}/${sanitizeProjectName(projectName)}/${folder}/${date}_${slug}.md`;

    // Build content
    const keyPointsSection = knowledge.keyPoints.length > 0
      ? `\n**Key Points**:\n${knowledge.keyPoints.map(p => `- ${p}`).join('\n')}\n`
      : '';

    const sourceSection = knowledge.sourceUrl
      ? `\n**Source**: [${knowledge.sourceUrl}](${knowledge.sourceUrl})`
      : knowledge.sourceSession
        ? `\n**Source**: Session ${knowledge.sourceSession.substring(0, 8)}`
        : '';

    const noteContent = `# ${knowledge.title}

**Context**: ${knowledge.context}

${knowledge.content}
${keyPointsSection}${sourceSection}
`;

    // Build tags
    const tags = [
      'knowledge',
      `knowledge/${knowledge.type}`,
      ...knowledge.topics.map(t => `topic/${t.toLowerCase().replace(/\s+/g, '-')}`),
    ];

    return this.writeNote({
      type: 'learning', // Use learning as the base note type
      title: knowledge.title,
      content: noteContent,
      project: projectName,
      tags,
      path: notePath,
      metadata: {
        knowledge_type: knowledge.type,
        topics: knowledge.topics,
        source_url: knowledge.sourceUrl,
        source_session: knowledge.sourceSession,
      },
    });
  }

  /**
   * Write multiple knowledge items to the vault
   */
  async writeKnowledgeBatch(
    items: Array<{
      type: 'qa' | 'explanation' | 'decision' | 'research' | 'learning';
      title: string;
      context: string;
      content: string;
      keyPoints: string[];
      topics: string[];
      sourceUrl?: string;
      sourceSession?: string;
    }>,
    projectName: string
  ): Promise<string[]> {
    const paths: string[] = [];

    for (const item of items) {
      try {
        const result = await this.writeKnowledge(item, projectName);
        paths.push(result.path);
      } catch (error) {
        console.error(`Failed to write knowledge: ${item.title}`, error);
      }
    }

    return paths;
  }

  /**
   * Update a session note to link to knowledge items
   * Appends to existing "Knowledge Captured" section if present
   */
  async linkSessionToKnowledge(
    sessionPath: string,
    knowledgePaths: string[]
  ): Promise<void> {
    if (knowledgePaths.length === 0) return;

    const fullPath = this.resolvePath(sessionPath);
    if (!fs.existsSync(fullPath)) return;

    try {
      let raw = fs.readFileSync(fullPath, 'utf-8');

      // Build knowledge links using full paths from vault root
      const links = knowledgePaths
        .map(p => {
          const linkPath = p.replace(/\.md$/, '');
          return `- [[${this.memFolder}/${linkPath}]]`;
        })
        .join('\n');

      // Check if Knowledge section already exists
      if (raw.includes('## Knowledge Captured')) {
        // Find the section and append to it (before next ## or end of file)
        const sectionStart = raw.indexOf('## Knowledge Captured');
        const afterSection = raw.substring(sectionStart);
        const nextSectionMatch = afterSection.match(/\n## [^#]/);

        if (nextSectionMatch && nextSectionMatch.index !== undefined) {
          // Insert before next section, ensuring newline separation
          const insertPos = sectionStart + nextSectionMatch.index;
          // Add newline before links to ensure separation from existing content
          raw = raw.substring(0, insertPos) + '\n' + links + raw.substring(insertPos);
        } else {
          // Append to end of file with proper newline
          raw = raw.trimEnd() + '\n' + links + '\n';
        }
        fs.writeFileSync(fullPath, raw);
      } else {
        // Create new section
        const knowledgeSection = `\n## Knowledge Captured\n\n${links}\n`;
        fs.appendFileSync(fullPath, knowledgeSection);
      }

      // Update knowledge_captured count in frontmatter
      this.updateKnowledgeCount(fullPath, knowledgePaths.length);
    } catch (error) {
      console.error(`Failed to link session to knowledge: ${sessionPath}`, error);
    }
  }

  /**
   * Update the knowledge_captured count in session frontmatter
   */
  private updateKnowledgeCount(fullPath: string, addCount: number): void {
    try {
      const raw = fs.readFileSync(fullPath, 'utf-8');
      const { frontmatter, content } = parseFrontmatter(raw);

      const currentCount = (frontmatter.knowledge_captured as number) || 0;
      frontmatter.knowledge_captured = currentCount + addCount;
      frontmatter.updated = new Date().toISOString();

      fs.writeFileSync(fullPath, stringifyFrontmatter(frontmatter, content));
    } catch {
      // Ignore errors - count update is best-effort
    }
  }

  /**
   * Search knowledge notes
   */
  async searchKnowledge(
    query: string,
    options: {
      project?: string;
      knowledgeType?: 'qa' | 'explanation' | 'decision' | 'research' | 'learning';
      topics?: string[];
      limit?: number;
    } = {}
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const limit = options.limit || 10;

    // Build search directories
    const searchDirs: string[] = [];
    if (options.project) {
      const projectPath = path.join(
        this.getMemPath(),
        PROJECTS_FOLDER,
        sanitizeProjectName(options.project)
      );
      searchDirs.push(path.join(projectPath, 'knowledge'));
      searchDirs.push(path.join(projectPath, 'research'));
    } else {
      // Search all projects
      const projectsDir = path.join(this.getMemPath(), PROJECTS_FOLDER);
      if (fs.existsSync(projectsDir)) {
        const projects = fs.readdirSync(projectsDir, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => d.name);
        for (const proj of projects) {
          searchDirs.push(path.join(projectsDir, proj, 'knowledge'));
          searchDirs.push(path.join(projectsDir, proj, 'research'));
        }
      }
    }

    const queryLower = query.toLowerCase();

    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue;

      const files = this.walkDir(dir, '.md');

      for (const file of files) {
        if (results.length >= limit) break;

        try {
          const raw = fs.readFileSync(file, 'utf-8');
          const { frontmatter, content } = parseFrontmatter(raw);

          // Filter by knowledge type
          if (options.knowledgeType && frontmatter.knowledge_type !== options.knowledgeType) {
            continue;
          }

          // Filter by topics
          if (options.topics && options.topics.length > 0) {
            const itemTopics = (frontmatter.topics as string[]) || [];
            const hasMatchingTopic = options.topics.some(t =>
              itemTopics.some(it => it.toLowerCase().includes(t.toLowerCase()))
            );
            if (!hasMatchingTopic) continue;
          }

          // Search in content
          const fullText = (content + ' ' + (frontmatter.title || '')).toLowerCase();
          if (!fullText.includes(queryLower)) {
            continue;
          }

          results.push({
            id: path.basename(file, '.md'),
            title: frontmatter.title || path.basename(file, '.md'),
            type: `knowledge/${frontmatter.knowledge_type || 'unknown'}`,
            path: path.relative(this.vaultPath, file),
            snippet: this.extractSnippet(content, query),
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
    }

    // Sort by score
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
  }

  /**
   * Search notes by content (keyword search)
   * Excludes knowledge/ and research/ folders (use searchKnowledge for those)
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

      // Skip knowledge/ and research/ folders (handled by searchKnowledge)
      // Normalize path separators for cross-platform support (Windows uses \)
      const relativePath = path.relative(searchDir, file).split(path.sep).join('/');
      if (relativePath.includes('/knowledge/') || relativePath.includes('/research/') ||
          relativePath.startsWith('knowledge/') || relativePath.startsWith('research/')) {
        continue;
      }

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

  // ===== TechKB Methods =====

  /**
   * Check if TechKB integration is enabled
   */
  isTechKBEnabled(): boolean {
    return isTechKBEnabled();
  }

  /**
   * Get available TechKB categories
   */
  getTechKBCategories(): TechKBCategory[] {
    return getTechKBCategories();
  }

  /**
   * Write a note to a TechKB category
   * @throws Error if TechKB is not enabled
   */
  async writeTechKBNote(input: WriteTechKBNoteInput): Promise<{ path: string; created: boolean }> {
    if (!isTechKBEnabled()) {
      throw new Error('TechKB integration is not enabled. Enable it in config.json with techkb.enabled: true');
    }

    const config = loadConfig();
    const categoryPath = resolveTechKBPath(input.category);
    if (!categoryPath) {
      throw new Error(`TechKB category not found: ${input.category}`);
    }

    // Ensure category directory exists
    if (!fs.existsSync(categoryPath)) {
      fs.mkdirSync(categoryPath, { recursive: true });
    }

    // Generate filename
    const date = new Date().toISOString().split('T')[0];
    const slug = input.filename || this.slugify(input.title, 'untitled');
    const filename = `${date}_${slug}.md`;
    const fullPath = path.join(categoryPath, filename);

    const exists = fs.existsSync(fullPath);

    if (exists && input.append) {
      // Append to existing note
      const raw = fs.readFileSync(fullPath, 'utf-8');
      const { frontmatter, content } = parseFrontmatter(raw);
      const newContent = content + '\n\n' + input.content;
      frontmatter.updated = new Date().toISOString();
      if (input.tags) {
        frontmatter.tags = [...new Set([...(frontmatter.tags || []), ...input.tags])];
      }
      fs.writeFileSync(fullPath, stringifyFrontmatter(frontmatter, newContent));
    } else {
      // Create new note
      const baseTags = ['techkb', `techkb/${input.category.split('/')[0]}`];
      const allTags = [...baseTags, ...(input.tags || [])];

      // Build frontmatter with TechKB defaults
      const techkbDefaults = config.techkb?.defaultFrontmatter || {};
      const frontmatter: NoteFrontmatter = {
        type: 'learning' as NoteType,
        title: input.title,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        tags: allTags,
        ...techkbDefaults,
        ...input.metadata,
        // TechKB-specific fields
        techkb_category: input.category,
      };

      const noteContent = `# ${input.title}\n\n${input.content}`;
      fs.writeFileSync(fullPath, stringifyFrontmatter(frontmatter, noteContent));
    }

    // Return path relative to vault root
    const relativePath = path.relative(this.vaultPath, fullPath);
    return { path: relativePath, created: !exists };
  }

  /**
   * Search TechKB notes across categories
   */
  async searchTechKB(
    query: string,
    options: {
      category?: string;
      limit?: number;
    } = {}
  ): Promise<SearchResult[]> {
    if (!isTechKBEnabled()) {
      return [];
    }

    const results: SearchResult[] = [];
    const limit = options.limit || 10;
    const basePath = getTechKBBasePath();
    if (!basePath) return [];

    // Determine search directory
    let searchDir = basePath;
    if (options.category) {
      const categoryPath = resolveTechKBPath(options.category);
      if (categoryPath && fs.existsSync(categoryPath)) {
        searchDir = categoryPath;
      }
    }

    if (!fs.existsSync(searchDir)) {
      return [];
    }

    const files = this.walkDir(searchDir, '.md');
    const queryLower = query.toLowerCase();

    for (const file of files) {
      if (results.length >= limit) break;

      try {
        const raw = fs.readFileSync(file, 'utf-8');
        const { frontmatter, content } = parseFrontmatter(raw);

        const fullText = (content + ' ' + (frontmatter.title || '')).toLowerCase();
        if (!fullText.includes(queryLower)) {
          continue;
        }

        results.push({
          id: path.basename(file, '.md'),
          title: frontmatter.title || path.basename(file, '.md'),
          type: `techkb/${frontmatter.techkb_category || 'unknown'}`,
          path: path.relative(this.vaultPath, file),
          snippet: this.extractSnippet(content, query),
          score: this.calculateScore(fullText, queryLower),
          metadata: {
            date: frontmatter.created,
            tags: frontmatter.tags,
          },
        });
      } catch {
        // Skip files that can't be parsed
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Get the TechKB project path for a project
   * When TechKB is enabled, projects use TechKB/10-projects/{project}/_claude-mem/
   */
  getTechKBProjectMemPath(projectName: string): string | null {
    return getTechKBProjectPath(projectName);
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
      case 'learning':
      default:
        // Learnings go to project folder if project is specified
        folder = input.project
          ? `${PROJECTS_FOLDER}/${sanitizeProjectName(input.project)}/knowledge`
          : `${GLOBAL_FOLDER}/learnings`;
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
