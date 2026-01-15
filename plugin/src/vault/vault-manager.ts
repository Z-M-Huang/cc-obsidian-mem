/**
 * Obsidian vault manager
 * Handles reading, writing, and searching markdown files
 */

import {
	existsSync,
	readFileSync,
	writeFileSync,
	readdirSync,
	statSync,
	mkdirSync,
} from "fs";
import { join, relative, dirname, basename } from "path";
import { loadConfig } from "../shared/config.js";
import { validatePath } from "../shared/security.js";
import { createLogger } from "../shared/logger.js";
import type { NoteFrontmatter } from "../shared/types.js";

/**
 * List of valid category names for project structure
 */
export const CATEGORIES = ["research", "decisions", "errors", "patterns", "knowledge", "sessions"] as const;

export interface SearchResult {
	path: string;
	title: string;
	type: string;
	snippet: string;
	score: number;
}

export interface NoteContent {
	frontmatter: NoteFrontmatter;
	content: string;
	rawContent: string;
}

/**
 * Get the vault memory folder path
 */
export function getMemFolderPath(): string {
	const config = loadConfig();
	return join(config.vault.path, config.vault.memFolder || "_claude-mem");
}

/**
 * Get a project's folder path
 */
export function getProjectPath(project: string): string {
	return join(getMemFolderPath(), "projects", project);
}

/**
 * Search notes in the vault
 */
export function searchNotes(
	query: string,
	options?: {
		type?: string;
		project?: string;
		limit?: number;
		tags?: string[];
	}
): SearchResult[] {
	const config = loadConfig();
	const memFolder = getMemFolderPath();

	if (!existsSync(memFolder)) {
		return [];
	}

	const results: SearchResult[] = [];
	const limit = options?.limit ?? 10;
	const queryLower = query.toLowerCase();

	// Get search path
	let searchPath = memFolder;
	if (options?.project) {
		searchPath = getProjectPath(options.project);
	}

	if (!existsSync(searchPath)) {
		return [];
	}

	// Recursively search markdown files
	searchDirectory(searchPath, queryLower, results, options);

	// Sort by score and limit
	results.sort((a, b) => b.score - a.score);
	return results.slice(0, limit);
}

/**
 * Recursively search a directory
 */
function searchDirectory(
	dir: string,
	query: string,
	results: SearchResult[],
	options?: { type?: string; tags?: string[] }
): void {
	try {
		const entries = readdirSync(dir);

		for (const entry of entries) {
			const fullPath = join(dir, entry);
			const stat = statSync(fullPath);

			if (stat.isDirectory()) {
				// Skip hidden directories
				if (!entry.startsWith(".")) {
					searchDirectory(fullPath, query, results, options);
				}
			} else if (entry.endsWith(".md")) {
				const match = matchNote(fullPath, query, options);
				if (match) {
					results.push(match);
				}
			}
		}
	} catch {
		// Skip directories we can't read
	}
}

/**
 * Check if a note matches the search query
 */
function matchNote(
	filePath: string,
	query: string,
	options?: { type?: string; tags?: string[] }
): SearchResult | null {
	try {
		const content = readFileSync(filePath, "utf-8");
		const parsed = parseNote(content);

		if (!parsed) {
			return null;
		}

		// Filter by type
		if (options?.type && options.type !== "knowledge") {
			if (parsed.frontmatter.type !== options.type) {
				return null;
			}
		}

		// Filter by tags
		if (options?.tags && options.tags.length > 0) {
			const noteTags = parsed.frontmatter.tags || [];
			const hasMatchingTag = options.tags.some((t) =>
				noteTags.includes(t)
			);
			if (!hasMatchingTag) {
				return null;
			}
		}

		// Calculate match score
		let score = 0;
		const contentLower = content.toLowerCase();
		const titleLower = (parsed.frontmatter.title || "").toLowerCase();

		// Title match is worth more
		if (titleLower.includes(query)) {
			score += 10;
		}

		// Content match
		const contentMatches = (contentLower.match(new RegExp(query, "g")) || [])
			.length;
		score += contentMatches;

		if (score === 0) {
			return null;
		}

		// Extract snippet around first match
		const matchIndex = contentLower.indexOf(query);
		const snippetStart = Math.max(0, matchIndex - 50);
		const snippetEnd = Math.min(content.length, matchIndex + query.length + 50);
		const snippet = content.substring(snippetStart, snippetEnd).replace(/\n/g, " ");

		return {
			path: filePath,
			title: parsed.frontmatter.title || basename(filePath, ".md"),
			type: parsed.frontmatter.type || "unknown",
			snippet: snippet.trim(),
			score,
		};
	} catch {
		return null;
	}
}

/**
 * Read a note from the vault
 */
export function readNote(notePath: string): NoteContent | null {
	const config = loadConfig();

	// Validate path is within vault
	try {
		validatePath(notePath, config.vault.path);
	} catch {
		return null;
	}

	if (!existsSync(notePath)) {
		return null;
	}

	try {
		const rawContent = readFileSync(notePath, "utf-8");
		const parsed = parseNote(rawContent);

		if (!parsed) {
			return null;
		}

		return {
			frontmatter: parsed.frontmatter,
			content: parsed.content,
			rawContent,
		};
	} catch {
		return null;
	}
}

/**
 * Write a note to the vault
 */
export function writeNote(
	notePath: string,
	frontmatter: NoteFrontmatter,
	content: string
): boolean {
	const config = loadConfig();

	// Validate path is within vault
	try {
		validatePath(notePath, config.vault.path);
	} catch {
		return false;
	}

	try {
		// Ensure directory exists
		const dir = dirname(notePath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		// Build note content
		const fullContent = buildNoteContent(frontmatter, content);

		writeFileSync(notePath, fullContent, "utf-8");
		return true;
	} catch {
		return false;
	}
}

/**
 * Parse a note's frontmatter and content
 */
function parseNote(
	rawContent: string
): { frontmatter: NoteFrontmatter; content: string } | null {
	const frontmatterMatch = rawContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

	if (!frontmatterMatch) {
		return null;
	}

	try {
		// Parse YAML frontmatter (simple parser)
		const frontmatterYaml = frontmatterMatch[1];
		const frontmatter = parseSimpleYaml(frontmatterYaml);
		const content = frontmatterMatch[2];

		return {
			frontmatter: frontmatter as NoteFrontmatter,
			content,
		};
	} catch {
		return null;
	}
}

/**
 * Simple YAML parser for frontmatter
 */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const lines = yaml.split("\n");

	for (const line of lines) {
		const match = line.match(/^(\w+):\s*(.*)$/);
		if (match) {
			const [, key, value] = match;

			// Handle arrays
			if (value.startsWith("[") && value.endsWith("]")) {
				const arrayContent = value.slice(1, -1);
				result[key] = arrayContent
					.split(",")
					.map((s) => s.trim().replace(/^["']|["']$/g, ""));
			}
			// Handle quoted strings
			else if (value.startsWith('"') && value.endsWith('"')) {
				result[key] = value.slice(1, -1);
			}
			// Handle numbers
			else if (!isNaN(Number(value))) {
				result[key] = Number(value);
			}
			// Handle booleans
			else if (value === "true" || value === "false") {
				result[key] = value === "true";
			}
			// Plain string
			else {
				result[key] = value;
			}
		}
	}

	return result;
}

/**
 * Build note content from frontmatter and body
 */
function buildNoteContent(
	frontmatter: NoteFrontmatter,
	content: string
): string {
	const frontmatterLines: string[] = ["---"];

	for (const [key, value] of Object.entries(frontmatter)) {
		if (value === undefined || value === null) {
			continue;
		}

		if (Array.isArray(value)) {
			frontmatterLines.push(`${key}: [${value.map((v) => `"${v}"`).join(", ")}]`);
		} else if (typeof value === "string") {
			frontmatterLines.push(`${key}: "${value.replace(/"/g, '\\"')}"`);
		} else {
			frontmatterLines.push(`${key}: ${value}`);
		}
	}

	frontmatterLines.push("---");
	frontmatterLines.push("");

	return frontmatterLines.join("\n") + content;
}

/**
 * List all projects in the vault
 */
export function listProjects(): string[] {
	const projectsPath = join(getMemFolderPath(), "projects");

	if (!existsSync(projectsPath)) {
		return [];
	}

	try {
		const entries = readdirSync(projectsPath);
		return entries.filter((entry) => {
			const stat = statSync(join(projectsPath, entry));
			return stat.isDirectory() && !entry.startsWith(".");
		});
	} catch {
		return [];
	}
}

/**
 * Get project context (recent decisions, patterns, errors)
 */
export function getProjectContext(
	project: string,
	options?: {
		includeDecisions?: boolean;
		includePatterns?: boolean;
		includeErrors?: boolean;
	}
): {
	decisions: SearchResult[];
	patterns: SearchResult[];
	errors: SearchResult[];
} {
	const projectPath = getProjectPath(project);
	const result = {
		decisions: [] as SearchResult[],
		patterns: [] as SearchResult[],
		errors: [] as SearchResult[],
	};

	if (!existsSync(projectPath)) {
		return result;
	}

	// Get recent decisions
	if (options?.includeDecisions !== false) {
		const decisionsPath = join(projectPath, "decisions");
		if (existsSync(decisionsPath)) {
			result.decisions = getRecentNotes(decisionsPath, 5);
		}
	}

	// Get patterns
	if (options?.includePatterns !== false) {
		const patternsPath = join(projectPath, "patterns");
		if (existsSync(patternsPath)) {
			result.patterns = getRecentNotes(patternsPath, 5);
		}
	}

	// Get errors
	if (options?.includeErrors !== false) {
		const errorsPath = join(projectPath, "errors");
		if (existsSync(errorsPath)) {
			result.errors = getRecentNotes(errorsPath, 5);
		}
	}

	return result;
}

/**
 * Build a parent link in Obsidian wikilink format
 * @param memFolder - The memory folder name (e.g., "_claude-mem")
 * @param project - The project name
 * @param category - Optional category name (if omitted, returns project link)
 * @returns Formatted parent link string
 */
export function buildParentLink(memFolder: string, project: string, category?: string): string {
	if (category) {
		return `[[${memFolder}/projects/${project}/${category}/${category}]]`;
	}
	return `[[${memFolder}/projects/${project}/${project}]]`;
}

/**
 * Normalize a project name to a filesystem-safe slug
 * @param name - The original project name (may contain spaces, dots, etc.)
 * @returns Normalized slug (lowercase alphanumeric, hyphens, underscores only)
 */
export function slugifyProjectName(name: string): string {
	return name
		.toLowerCase()
		.replace(/\s+/g, "-") // Replace spaces with hyphens
		.replace(/\.+/g, "-") // Replace dots with hyphens
		.replace(/[^a-z0-9_-]/g, "") // Remove other special chars
		.replace(/-+/g, "-") // Collapse multiple hyphens
		.replace(/^-|-$/g, ""); // Trim leading/trailing hyphens
}

/**
 * Validate project name for security threats only
 * @throws Error if project name contains path traversal attempts
 */
function validateProjectName(name: string): void {
	if (!name || name.trim().length === 0) {
		throw new Error("Project name cannot be empty");
	}
	// Check for path traversal attempts
	if (name.includes("..") || name.includes("/") || name.includes("\\")) {
		throw new Error(
			`Invalid project name: "${name}". Path separators and ".." are not allowed.`
		);
	}
	// Ensure slugified name has content
	const slug = slugifyProjectName(name);
	if (slug.length === 0) {
		throw new Error(
			`Invalid project name: "${name}". Name must contain at least one alphanumeric character.`
		);
	}
}

/**
 * Create project index file
 */
function createProjectIndex(
	projectPath: string,
	slug: string,
	memFolder: string
): void {
	const projectIndexPath = join(projectPath, `${slug}.md`);
	if (existsSync(projectIndexPath)) {
		return;
	}
	const categoryLinks = CATEGORIES.map(
		(cat) =>
			`- [[${memFolder}/projects/${slug}/${cat}/${cat}|${cat.charAt(0).toUpperCase() + cat.slice(1)}]]`
	).join("\n");

	const content = `---
type: "project"
title: "${slug}"
created: "${new Date().toISOString()}"
status: "active"
---

# ${slug}

## Categories

${categoryLinks}
`;
	writeFileSync(projectIndexPath, content, "utf-8");
}

/**
 * Create category index file
 */
function createCategoryIndex(
	categoryPath: string,
	category: string,
	slug: string,
	memFolder: string
): void {
	const categoryIndexPath = join(categoryPath, `${category}.md`);
	if (existsSync(categoryIndexPath)) {
		return;
	}
	const parentLink = buildParentLink(memFolder, slug);
	const content = `---
type: "index"
title: "${category.charAt(0).toUpperCase() + category.slice(1)}"
project: "${slug}"
created: "${new Date().toISOString()}"
parent: "${parentLink}"
---

# ${category.charAt(0).toUpperCase() + category.slice(1)}

Notes in this category will be listed below.
`;
	writeFileSync(categoryIndexPath, content, "utf-8");
}

/**
 * Find existing note with matching topic slug in a category folder
 * @param projectPath - Path to project folder
 * @param category - Category folder name (decisions, patterns, errors, etc.)
 * @param title - Note title to match against
 * @returns Path to existing note if found, null otherwise
 */
export function findExistingTopicNote(
	projectPath: string,
	category: string,
	title: string
): string | null {
	const logger = createLogger({ verbose: false });

	try {
		const categoryPath = join(projectPath, category);

		if (!existsSync(categoryPath)) {
			return null;
		}

		// Normalize input title to slug with same rules as generateFilename:
		// - slugify (lowercase, spaces/dots→hyphens, remove special chars)
		// - truncate to 50 chars for consistent matching
		const inputSlug = slugifyProjectName(title).substring(0, 50);

		// Empty slug after normalization - cannot match any file
		if (inputSlug.length === 0) {
			return null;
		}

		// Get all markdown files in category folder, excluding category index
		const categoryIndexFile = `${category}.md`;
		const files = readdirSync(categoryPath).filter(
			(f) => f.endsWith(".md") && f !== categoryIndexFile
		);

		// Search for exact slug match
		for (const file of files) {
			const fileSlug = file.replace(/\.md$/, "");

			// Compare slugs (already normalized)
			if (fileSlug === inputSlug) {
				return join(categoryPath, file);
			}
		}

		return null;
	} catch (error) {
		logger.warn("Error finding existing topic note", {
			error,
			projectPath,
			category,
			title,
		});
		return null;
	}
}

/**
 * Append new knowledge entry to an existing note
 * Updates frontmatter (keeps created, updates updated, merges tags, increments entry_count)
 * Preserves all unknown/custom frontmatter fields
 * @param notePath - Path to existing note
 * @param newContent - New content to append
 * @param newTags - New tags to merge
 * @returns true if successful, false on failure
 */
export function appendToExistingNote(
	notePath: string,
	newContent: string,
	newTags: string[]
): boolean {
	const logger = createLogger({ verbose: false });

	try {
		// Read existing note
		const note = readNote(notePath);
		if (!note) {
			logger.error("Failed to read note for appending", { notePath });
			return false;
		}

		// Update frontmatter
		const updated = new Date().toISOString();
		const entryCount = (note.frontmatter.entry_count || 0) + 1;

		// Merge tags (unique union)
		const existingTags = note.frontmatter.tags || [];
		const mergedTags = Array.from(new Set([...existingTags, ...newTags]));

		// Build updated frontmatter (preserve all fields)
		const updatedFrontmatter: NoteFrontmatter = {
			...note.frontmatter,
			updated,
			tags: mergedTags,
			entry_count: entryCount,
		};

		// Build new entry with timestamp
		const now = new Date();
		const timestamp = `${now.toISOString().split("T")[0]} ${now.toTimeString().substring(0, 5)}`;
		const newEntry = `\n\n---\n\n## Entry: ${timestamp}\n\n${newContent}`;

		// Append to content
		const updatedContent = note.content + newEntry;

		// Write updated note
		const success = writeNote(notePath, updatedFrontmatter, updatedContent);

		if (!success) {
			logger.error("Failed to write appended note", { notePath });
		}

		return success;
	} catch (error) {
		logger.error("Error appending to existing note", {
			error,
			notePath,
		});
		return false;
	}
}

/**
 * Ensure project structure exists with all index files
 * @param project - The project name (will be normalized to filesystem-safe slug)
 * @returns The normalized slug used for the project folder
 */
export function ensureProjectStructure(project: string): string {
	validateProjectName(project);
	const slug = slugifyProjectName(project);

	const config = loadConfig();
	const memFolder = config.vault.memFolder || "_claude-mem";
	const projectPath = getProjectPath(slug);

	try {
		// Ensure project directory exists
		if (!existsSync(projectPath)) {
			mkdirSync(projectPath, { recursive: true });
		}

		// Create project index file
		createProjectIndex(projectPath, slug, memFolder);

		// Create category directories and index files
		for (const category of CATEGORIES) {
			const categoryPath = join(projectPath, category);
			if (!existsSync(categoryPath)) {
				mkdirSync(categoryPath, { recursive: true });
			}
			createCategoryIndex(categoryPath, category, slug, memFolder);
		}

		// Create canvases folder separately (not a knowledge category)
		const canvasesPath = join(projectPath, "canvases");
		if (!existsSync(canvasesPath)) {
			mkdirSync(canvasesPath, { recursive: true });
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to create project structure for "${project}": ${message}`);
	}

	return slug;
}

/**
 * Get most recent notes from a directory
 */
function getRecentNotes(dir: string, limit: number): SearchResult[] {
	try {
		const files = readdirSync(dir)
			.filter((f) => f.endsWith(".md"))
			.map((f) => {
				const fullPath = join(dir, f);
				const stat = statSync(fullPath);
				return { path: fullPath, mtime: stat.mtimeMs };
			})
			.sort((a, b) => b.mtime - a.mtime)
			.slice(0, limit);

		return files.map((f) => {
			const content = readFileSync(f.path, "utf-8");
			const parsed = parseNote(content);
			return {
				path: f.path,
				title: parsed?.frontmatter.title || basename(f.path, ".md"),
				type: parsed?.frontmatter.type || "unknown",
				snippet: content.substring(0, 200).replace(/\n/g, " "),
				score: 1,
			};
		});
	} catch {
		return [];
	}
}
