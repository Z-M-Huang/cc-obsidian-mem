#!/usr/bin/env bun

/**
 * MCP Server for cc-obsidian-mem
 * Provides mem_* tools for interacting with the knowledge base
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";
import { loadConfig } from "../shared/config.js";
import { createLogger } from "../shared/logger.js";
import { validatePath } from "../shared/security.js";
import {
	searchNotes,
	readNote,
	writeNote,
	listProjects,
	getProjectContext,
	getProjectPath,
	getMemFolderPath,
	findExistingTopicNote,
	appendToExistingNote,
	ensureProjectStructure,
	slugifyProjectName,
} from "../vault/vault-manager.js";
import {
	generateAllCanvases,
	generateDashboardCanvas,
	generateTimelineCanvas,
	generateGraphCanvas,
} from "../vault/canvas.js";
import {
	buildFrontmatter,
	generateFilename,
	getParentLink,
	noteTypeToFolder,
} from "../vault/note-builder.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync } from "fs";
import { join, dirname, basename } from "path";
import type { NoteType } from "../shared/types.js";

type TextContent = { type: "text"; text: string };
type ToolResult = { content: TextContent[]; isError?: boolean };

async function main() {
	const config = loadConfig();
	const logger = createLogger({
		logDir: config.logging?.logDir,
		verbose: config.logging?.verbose,
	});

	logger.info("MCP server starting");

	const server = new McpServer({
		name: "obsidian-mem",
		version: "1.0.0",
	});

	// ========================================================================
	// mem_search - Search the knowledge base
	// ========================================================================
	server.registerTool(
		"mem_search",
		{
			title: "Search Memory",
			description:
				'Step 1: Search the knowledge base. Returns lightweight index with titles, types, and paths. ALWAYS search first before reading full notes. Use mem_read only for relevant results after filtering. Tip: Use type="knowledge" to search all knowledge notes (qa, explanation, decision, research, learning).',
			inputSchema: {
				query: z.string().describe("Search query - natural language or keywords"),
				project: z.string().optional().describe("Filter by project name"),
				type: z
					.enum(["error", "decision", "pattern", "file", "learning", "knowledge"])
					.optional()
					.describe("Filter by note type"),
				tags: z.array(z.string()).optional().describe("Filter by tags"),
				limit: z.number().default(10).describe("Maximum number of results"),
			},
		},
		async ({ query, project, type, tags, limit }): Promise<ToolResult> => {
			logger.debug("mem_search called", { query, project, type });

			try {
				const results = searchNotes(query, { type, project, limit, tags });

				if (results.length === 0) {
					return {
						content: [{ type: "text", text: "No results found." }],
					};
				}

				const formatted = results
					.map(
						(r, i) =>
							`${i + 1}. **${r.title}** (${r.type})\n   Path: ${r.path}\n   ${r.snippet}`
					)
					.join("\n\n");

				return {
					content: [{ type: "text", text: `Found ${results.length} results:\n\n${formatted}` }],
				};
			} catch (error) {
				logger.error("mem_search error", { error });
				return {
					content: [{ type: "text", text: `Search error: ${error}` }],
					isError: true,
				};
			}
		}
	);

	// ========================================================================
	// mem_read - Read full note content
	// ========================================================================
	server.registerTool(
		"mem_read",
		{
			title: "Read Note",
			description:
				'Step 2: Read full note content. Only call AFTER filtering with mem_search. Returns complete markdown with frontmatter. Use "section" param to extract specific headings or blocks.',
			inputSchema: {
				path: z.string().describe("Path to the note (relative to vault or absolute)"),
				section: z
					.string()
					.optional()
					.describe('Optional heading or block ID to extract (e.g., "Summary" or "^block-id")'),
			},
		},
		async ({ path: notePath, section }): Promise<ToolResult> => {
			logger.debug("mem_read called", { path: notePath, section });

			try {
				// Validate path is within vault
				validatePath(notePath, config.vault.path);

				const note = readNote(notePath);
				if (!note) {
					return {
						content: [{ type: "text", text: `Note not found: ${notePath}` }],
						isError: true,
					};
				}

				let content = note.rawContent;

				// Extract section if specified
				if (section) {
					const sectionMatch = content.match(
						new RegExp(`## ${section}[\\s\\S]*?(?=\\n## |$)`, "i")
					);
					if (sectionMatch) {
						content = sectionMatch[0];
					}
				}

				return {
					content: [{ type: "text", text: content }],
				};
			} catch (error) {
				logger.error("mem_read error", { error });
				return {
					content: [{ type: "text", text: `Read error: ${error}` }],
					isError: true,
				};
			}
		}
	);

	// ========================================================================
	// mem_write - Create a knowledge note (with topic deduplication)
	// ========================================================================
	server.registerTool(
		"mem_write",
		{
			title: "Write Note",
			description:
				"Create or update a note in the knowledge base. Use for saving decisions, patterns, learnings, or custom content. Automatically appends to existing notes with the same topic.",
			inputSchema: {
				type: z
					.enum(["error", "decision", "pattern", "file", "learning"])
					.describe("Type of note to create"),
				title: z.string().min(1).describe("Title for the note"),
				content: z.string().describe("Markdown content for the note"),
				project: z.string().optional().describe("Project name to associate with"),
				tags: z.array(z.string()).optional().describe("Additional tags"),
				status: z
					.enum(["active", "superseded", "draft"])
					.optional()
					.describe("Note status (default: active)"),
			},
		},
		async ({ type, title, content, project, tags, status }): Promise<ToolResult> => {
			logger.debug("mem_write called", { type, title, project });

			// Input validation
			if (!title || title.trim().length === 0) {
				return {
					content: [{ type: "text", text: "Error: title cannot be empty" }],
					isError: true,
				};
			}

			try {
				const projectName = project || config.defaultProject || "default";
				const folder = noteTypeToFolder(type as NoteType);

				// Ensure project structure exists
				const projectSlug = ensureProjectStructure(projectName);
				const projectPath = getProjectPath(projectSlug);

				// Check for existing note with same topic (deduplication)
				const existingNotePath = findExistingTopicNote(projectPath, folder, title);

				if (existingNotePath) {
					// Append to existing note
					const success = appendToExistingNote(existingNotePath, content, tags || []);
					if (success) {
						return {
							content: [{ type: "text", text: `Appended to existing note: ${existingNotePath}` }],
						};
					} else {
						return {
							content: [{ type: "text", text: "Failed to append to existing note" }],
							isError: true,
						};
					}
				}

				// Create new note
				const filename = generateFilename(title);
				const notePath = join(projectPath, folder, filename);

				// Ensure directory exists
				const dir = dirname(notePath);
				if (!existsSync(dir)) {
					mkdirSync(dir, { recursive: true });
				}

				const frontmatter = buildFrontmatter({
					type: type as NoteType,
					title,
					project: projectSlug,
					tags,
					status: status as any,
					parent: getParentLink(projectSlug, folder),
				});

				// Add entry_count for new notes
				(frontmatter as any).entry_count = 1;

				const success = writeNote(notePath, frontmatter, content);

				if (success) {
					return {
						content: [{ type: "text", text: `Note created: ${notePath}` }],
					};
				} else {
					return {
						content: [{ type: "text", text: "Failed to write note" }],
						isError: true,
					};
				}
			} catch (error) {
				logger.error("mem_write error", { error });
				return {
					content: [{ type: "text", text: `Write error: ${error}` }],
					isError: true,
				};
			}
		}
	);

	// ========================================================================
	// mem_write_knowledge - Write knowledge extracted from conversations (with deduplication)
	// ========================================================================
	server.registerTool(
		"mem_write_knowledge",
		{
			title: "Write Knowledge",
			description:
				"Write knowledge extracted from conversations (Q&A, explanations, research, learnings). Routes to /research folder. Sets knowledge_type in frontmatter for filtered searches. Automatically appends to existing notes with the same topic.",
			inputSchema: {
				type: z
					.enum(["qa", "explanation", "decision", "research", "learning"])
					.describe("Type of knowledge"),
				title: z.string().min(1).describe("Title for the knowledge note"),
				context: z.string().describe("When this knowledge is useful (1 sentence)"),
				content: z.string().min(1).describe("Main content/summary of the knowledge"),
				project: z.string().min(1).describe("Project name to associate with"),
				topics: z.array(z.string()).optional().describe("Topic tags for categorization (2-5 items)"),
				keyPoints: z.array(z.string()).optional().describe("Key actionable points (2-5 items)"),
			},
		},
		async ({ type, title, context, content, project, topics, keyPoints }): Promise<ToolResult> => {
			logger.debug("mem_write_knowledge called", { type, title, project });

			// Input validation
			if (!title || title.trim().length === 0) {
				return {
					content: [{ type: "text", text: "Error: title cannot be empty" }],
					isError: true,
				};
			}
			if (!content || content.trim().length === 0) {
				return {
					content: [{ type: "text", text: "Error: content cannot be empty" }],
					isError: true,
				};
			}
			if (!project || project.trim().length === 0) {
				return {
					content: [{ type: "text", text: "Error: project cannot be empty" }],
					isError: true,
				};
			}

			try {
				const folder = "research";

				// Ensure project structure exists
				const projectSlug = ensureProjectStructure(project);
				const projectPath = getProjectPath(projectSlug);

				// Build content with key points if provided
				let fullContent = `## Context\n${context}\n\n## Content\n${content}`;

				if (keyPoints && keyPoints.length > 0) {
					fullContent += "\n\n## Key Points\n";
					fullContent += keyPoints.map((p) => `- ${p}`).join("\n");
				}

				// Check for existing note with same topic (deduplication)
				const existingNotePath = findExistingTopicNote(projectPath, folder, title);

				if (existingNotePath) {
					// Append to existing note
					const success = appendToExistingNote(existingNotePath, fullContent, topics || []);
					if (success) {
						return {
							content: [{ type: "text", text: `Appended to existing knowledge note: ${existingNotePath}` }],
						};
					} else {
						return {
							content: [{ type: "text", text: "Failed to append to existing knowledge note" }],
							isError: true,
						};
					}
				}

				// Create new note
				const filename = generateFilename(title);
				const notePath = join(projectPath, folder, filename);

				// Ensure directory exists
				const dir = dirname(notePath);
				if (!existsSync(dir)) {
					mkdirSync(dir, { recursive: true });
				}

				const frontmatter = buildFrontmatter({
					type: "learning",
					title,
					project: projectSlug,
					tags: topics,
					knowledge_type: type,
					parent: getParentLink(projectSlug, folder),
				});

				// Add entry_count for new notes
				(frontmatter as any).entry_count = 1;

				const success = writeNote(notePath, frontmatter, fullContent);

				if (success) {
					return {
						content: [{ type: "text", text: `Knowledge note created: ${notePath}` }],
					};
				} else {
					return {
						content: [{ type: "text", text: "Failed to write knowledge note" }],
						isError: true,
					};
				}
			} catch (error) {
				logger.error("mem_write_knowledge error", { error });
				return {
					content: [{ type: "text", text: `Write error: ${error}` }],
					isError: true,
				};
			}
		}
	);

	// ========================================================================
	// mem_supersede - Create note that supersedes an existing one
	// ========================================================================
	server.registerTool(
		"mem_supersede",
		{
			title: "Supersede Note",
			description:
				"Create a new note that supersedes an existing one. Automatically creates bidirectional links: the old note is marked as superseded with a link to the new note, and the new note links back to the old one.",
			inputSchema: {
				oldNotePath: z.string().describe("Path to the note being superseded"),
				type: z
					.enum(["error", "decision", "pattern", "file", "learning"])
					.describe("Type of new note to create"),
				title: z.string().describe("Title for the new note"),
				content: z.string().describe("Markdown content for the new note"),
				project: z.string().optional().describe("Project name to associate with"),
				tags: z.array(z.string()).optional().describe("Additional tags"),
			},
		},
		async ({ oldNotePath, type, title, content, project, tags }): Promise<ToolResult> => {
			logger.debug("mem_supersede called", { oldNotePath, type, title });

			try {
				// Validate old note path
				validatePath(oldNotePath, config.vault.path);

				// Read old note
				const oldNote = readNote(oldNotePath);
				if (!oldNote) {
					return {
						content: [{ type: "text", text: `Old note not found: ${oldNotePath}` }],
						isError: true,
					};
				}

				const projectName = project || oldNote.frontmatter.project || config.defaultProject || "default";
				const folder = noteTypeToFolder(type as NoteType);
				const filename = generateFilename(title);
				const projectPath = getProjectPath(projectName);
				const newNotePath = join(projectPath, folder, filename);

				// Create new note with supersedes link
				const newFrontmatter = buildFrontmatter({
					type: type as NoteType,
					title,
					project: projectName,
					tags,
					supersedes: [`[[${oldNotePath.replace(/\.md$/, "")}]]`],
					parent: getParentLink(projectName, folder),
				});

				const successNew = writeNote(newNotePath, newFrontmatter, content);

				// Update old note with superseded_by
				if (successNew) {
					oldNote.frontmatter.status = "superseded";
					oldNote.frontmatter.superseded_by = `[[${newNotePath.replace(/\.md$/, "")}]]`;
					writeNote(oldNotePath, oldNote.frontmatter, oldNote.content);
				}

				if (successNew) {
					return {
						content: [
							{
								type: "text",
								text: `Created new note: ${newNotePath}\nMarked as superseded: ${oldNotePath}`,
							},
						],
					};
				} else {
					return {
						content: [{ type: "text", text: "Failed to create superseding note" }],
						isError: true,
					};
				}
			} catch (error) {
				logger.error("mem_supersede error", { error });
				return {
					content: [{ type: "text", text: `Supersede error: ${error}` }],
					isError: true,
				};
			}
		}
	);

	// ========================================================================
	// mem_project_context - Get project summary
	// ========================================================================
	server.registerTool(
		"mem_project_context",
		{
			title: "Project Context",
			description:
				"Retrieve summary context for a project including unresolved errors, active decisions, and patterns. Useful at the start of a session to understand project history.",
			inputSchema: {
				project: z.string().describe("Project name"),
				includeErrors: z.boolean().default(true).describe("Include unresolved errors"),
				includeDecisions: z.boolean().default(true).describe("Include recent decisions"),
				includePatterns: z.boolean().default(true).describe("Include relevant patterns"),
			},
		},
		async ({ project, includeErrors, includeDecisions, includePatterns }): Promise<ToolResult> => {
			logger.debug("mem_project_context called", { project });

			try {
				const context = getProjectContext(project, {
					includeErrors,
					includeDecisions,
					includePatterns,
				});

				let output = `# Project Context: ${project}\n\n`;

				if (includeDecisions && context.decisions.length > 0) {
					output += "## Recent Decisions\n";
					for (const d of context.decisions) {
						output += `- **${d.title}**: ${d.snippet.substring(0, 100)}...\n`;
					}
					output += "\n";
				}

				if (includePatterns && context.patterns.length > 0) {
					output += "## Patterns\n";
					for (const p of context.patterns) {
						output += `- **${p.title}**: ${p.snippet.substring(0, 100)}...\n`;
					}
					output += "\n";
				}

				if (includeErrors && context.errors.length > 0) {
					output += "## Known Errors\n";
					for (const e of context.errors) {
						output += `- **${e.title}**: ${e.snippet.substring(0, 100)}...\n`;
					}
					output += "\n";
				}

				if (
					context.decisions.length === 0 &&
					context.patterns.length === 0 &&
					context.errors.length === 0
				) {
					output += "No knowledge found for this project yet.\n";
				}

				return {
					content: [{ type: "text", text: output }],
				};
			} catch (error) {
				logger.error("mem_project_context error", { error });
				return {
					content: [{ type: "text", text: `Context error: ${error}` }],
					isError: true,
				};
			}
		}
	);

	// ========================================================================
	// mem_list_projects - List all tracked projects
	// ========================================================================
	server.registerTool(
		"mem_list_projects",
		{
			title: "List Projects",
			description: "List all projects that have been tracked in the memory system",
			inputSchema: {},
		},
		async (): Promise<ToolResult> => {
			logger.debug("mem_list_projects called");

			try {
				const projects = listProjects();

				if (projects.length === 0) {
					return {
						content: [{ type: "text", text: "No projects found in memory system." }],
					};
				}

				const output = `Found ${projects.length} projects:\n\n${projects.map((p) => `- ${p}`).join("\n")}`;

				return {
					content: [{ type: "text", text: output }],
				};
			} catch (error) {
				logger.error("mem_list_projects error", { error });
				return {
					content: [{ type: "text", text: `List error: ${error}` }],
					isError: true,
				};
			}
		}
	);

	// ========================================================================
	// mem_generate_canvas - Generate Obsidian canvas visualizations
	// ========================================================================
	server.registerTool(
		"mem_generate_canvas",
		{
			title: "Generate Canvas",
			description:
				"Generate Obsidian canvas visualizations for a project. Creates dashboard (grid layout), timeline (chronological decisions), and graph (radial knowledge graph) canvases.",
			inputSchema: {
				project: z.string().min(1).describe("Project name"),
				canvas_type: z
					.enum(["dashboard", "timeline", "graph", "all"])
					.default("all")
					.describe("Type of canvas to generate (default: all)"),
			},
		},
		async ({ project, canvas_type }): Promise<ToolResult> => {
			logger.debug("mem_generate_canvas called", { project, canvas_type });

			// Input validation
			if (!project || project.trim().length === 0) {
				return {
					content: [{ type: "text", text: "Error: project cannot be empty" }],
					isError: true,
				};
			}

			try {
				// Check if project exists - validate slug is non-empty after normalization
				const projectSlug = slugifyProjectName(project);

				if (projectSlug.length === 0) {
					return {
						content: [{ type: "text", text: `Error: invalid project name '${project}'. Name must contain at least one alphanumeric character.` }],
						isError: true,
					};
				}

				const projectPath = getProjectPath(projectSlug);

				if (!existsSync(projectPath)) {
					return {
						content: [{ type: "text", text: `Error: project '${project}' not found` }],
						isError: true,
					};
				}

				let generatedPaths: string[] = [];

				switch (canvas_type) {
					case "dashboard":
						generatedPaths = generateDashboardCanvas(projectSlug);
						break;
					case "timeline":
						generatedPaths = generateTimelineCanvas(projectSlug);
						break;
					case "graph":
						generatedPaths = generateGraphCanvas(projectSlug);
						break;
					case "all":
					default:
						generatedPaths = generateAllCanvases(projectSlug);
						break;
				}

				if (generatedPaths.length === 0) {
					return {
						content: [{ type: "text", text: "No canvases generated (possibly skipped due to updateStrategy)" }],
					};
				}

				return {
					content: [
						{
							type: "text",
							text: `Generated ${generatedPaths.length} canvas(es):\n${generatedPaths.map((p) => `- ${p}`).join("\n")}`,
						},
					],
				};
			} catch (error) {
				logger.error("mem_generate_canvas error", { error });
				return {
					content: [{ type: "text", text: `Canvas generation error: ${error}` }],
					isError: true,
				};
			}
		}
	);

	// ========================================================================
	// mem_file_ops - Cross-platform file operations
	// ========================================================================
	server.registerTool(
		"mem_file_ops",
		{
			title: "File Operations",
			description:
				"Cross-platform file operations for vault management (delete, move, mkdir). Validates paths and prevents operations on category index files.",
			inputSchema: {
				action: z.enum(["delete", "move", "mkdir"]).describe("Operation to perform"),
				path: z.string().describe("Target file/folder path (relative to vault)"),
				destination: z.string().optional().describe("Destination path for move action"),
			},
		},
		async ({ action, path: targetPath, destination }): Promise<ToolResult> => {
			logger.debug("mem_file_ops called", { action, path: targetPath, destination });

			try {
				const vaultPath = config.vault.path;

				// Validate target path is within vault
				const validatedPath = validatePath(targetPath, vaultPath);

				// Security: Prevent operations on category index files
				const filename = basename(validatedPath);
				const filenameWithoutExt = filename.replace(/\.md$/, "");
				const isIndexFile = ["decisions", "patterns", "errors", "research", "knowledge", "sessions"].includes(filenameWithoutExt);

				if (isIndexFile && filename.endsWith(".md")) {
					logger.warn("mem_file_ops: blocked operation on category index file", { path: targetPath });
					return {
						content: [{ type: "text", text: `Error: Cannot perform operations on category index files (${filename})` }],
						isError: true,
					};
				}

				switch (action) {
					case "delete": {
						if (!existsSync(validatedPath)) {
							return {
								content: [{ type: "text", text: `Error: File not found: ${targetPath}` }],
								isError: true,
							};
						}

						unlinkSync(validatedPath);
						logger.info("mem_file_ops: deleted file", { path: targetPath });

						return {
							content: [{ type: "text", text: `Deleted: ${targetPath}` }],
						};
					}

					case "move": {
						if (!destination) {
							return {
								content: [{ type: "text", text: "Error: destination parameter required for move action" }],
								isError: true,
							};
						}

						if (!existsSync(validatedPath)) {
							return {
								content: [{ type: "text", text: `Error: Source file not found: ${targetPath}` }],
								isError: true,
							};
						}

						// Validate destination path
						const validatedDest = validatePath(destination, vaultPath);

						// Security: Prevent moving TO a category index file path
						const destFilename = basename(validatedDest);
						const destFilenameWithoutExt = destFilename.replace(/\.md$/, "");
						const isDestIndexFile = ["decisions", "patterns", "errors", "research", "knowledge", "sessions"].includes(destFilenameWithoutExt);

						if (isDestIndexFile && destFilename.endsWith(".md")) {
							logger.warn("mem_file_ops: blocked move to category index file path", { destination });
							return {
								content: [{ type: "text", text: `Error: Cannot move to category index file path (${destFilename})` }],
								isError: true,
							};
						}

						// Check if destination already exists
						if (existsSync(validatedDest)) {
							return {
								content: [{ type: "text", text: `Error: Destination already exists: ${destination}` }],
								isError: true,
							};
						}

						// Ensure destination directory exists
						const destDir = dirname(validatedDest);
						if (!existsSync(destDir)) {
							mkdirSync(destDir, { recursive: true });
						}

						renameSync(validatedPath, validatedDest);
						logger.info("mem_file_ops: moved file", { from: targetPath, to: destination });

						return {
							content: [{ type: "text", text: `Moved: ${targetPath} → ${destination}` }],
						};
					}

					case "mkdir": {
						// Create directory with recursive option
						mkdirSync(validatedPath, { recursive: true });
						logger.info("mem_file_ops: created directory", { path: targetPath });

						return {
							content: [{ type: "text", text: `Created directory: ${targetPath}` }],
						};
					}

					default: {
						return {
							content: [{ type: "text", text: `Error: Unknown action: ${action}` }],
							isError: true,
						};
					}
				}
			} catch (error) {
				logger.error("mem_file_ops error", { error, action, path: targetPath });
				return {
					content: [{ type: "text", text: `File operation error: ${error}` }],
					isError: true,
				};
			}
		}
	);

	// Start server
	const transport = new StdioServerTransport();
	await server.connect(transport);

	logger.info("MCP server connected");
}

main().catch((error) => {
	console.error("MCP server error:", error);
	process.exit(1);
});
