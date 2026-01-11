#!/usr/bin/env bun

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";
import { VaultManager } from "./utils/vault.js";
import { loadConfig, getProjectPath } from "../shared/config.js";
import type { SearchResult, ProjectContext, Note } from "../shared/types.js";
import {
  generateProjectCanvases,
  detectFolder,
  type CanvasNote,
} from "./utils/canvas.js";
import * as path from "path";

type TextContent = { type: "text"; text: string };
type ToolResult = { content: TextContent[]; isError?: boolean };

async function main() {
  const config = loadConfig();
  const vault = new VaultManager(config.vault.path, config.vault.memFolder);

  // Ensure vault structure exists
  await vault.ensureStructure();

  const server = new McpServer({
    name: "obsidian-mem",
    version: "0.5.0",
  });

  // Tool: mem_search - Search the knowledge base
  server.registerTool(
    "mem_search",
    {
      title: "Search Memory",
      description:
        "Search the Claude Code knowledge base for errors, decisions, patterns, and learnings. Use semantic search to find relevant information based on natural language queries.",
      inputSchema: {
        query: z
          .string()
          .describe("Search query - natural language or keywords"),
        project: z.string().optional().describe("Filter by project name"),
        type: z
          .enum([
            "error",
            "decision",
            "pattern",
            "file",
            "learning",
            "knowledge",
          ])
          .optional()
          .describe(
            'Filter by note type. Use "knowledge" to search all knowledge notes (qa, explanation, decision, research, learning)'
          ),
        tags: z.array(z.string()).optional().describe("Filter by tags"),
        limit: z.number().default(10).describe("Maximum number of results"),
      },
    },
    async ({ query, project, type, tags, limit }): Promise<ToolResult> => {
      try {
        // Map NoteType to knowledge_type for knowledge search
        // 'knowledge' type searches ALL knowledge types (qa, explanation, decision, research, learning)
        const knowledgeTypeMap: Record<string, string | string[] | undefined> =
          {
            knowledge: undefined, // undefined = search all knowledge types
            learning: "learning",
            decision: "decision",
            // These types only exist in regular notes, so skip knowledge search
            session: undefined,
            error: undefined,
            pattern: undefined,
            file: undefined,
          };

        // Determine what to search
        const isKnowledgeOnlySearch = type === "knowledge";
        const regularNoteType = isKnowledgeOnlySearch ? undefined : type;

        // Search regular notes (skip if searching only knowledge)
        let regularResults: SearchResult[] = [];
        if (!isKnowledgeOnlySearch) {
          regularResults = await vault.searchNotes(query, {
            project,
            type: regularNoteType,
            tags,
            limit,
          });
        }

        // Only search knowledge if type filter allows it
        // - No type filter: search both regular notes and all knowledge
        // - 'knowledge' type: search all knowledge types (skip regular notes)
        // - 'learning' or 'decision': search specific knowledge type
        // - Other types (session, error, etc.): skip knowledge search
        let knowledgeResults: SearchResult[] = [];
        const shouldSearchKnowledge =
          !type ||
          type === "knowledge" ||
          type === "learning" ||
          type === "decision";

        if (shouldSearchKnowledge) {
          const knowledgeType =
            type === "knowledge" || !type
              ? undefined // search all knowledge types
              : (knowledgeTypeMap[type] as
                  | "qa"
                  | "explanation"
                  | "decision"
                  | "research"
                  | "learning"
                  | undefined);

          knowledgeResults = await vault.searchKnowledge(query, {
            project,
            knowledgeType,
            limit: isKnowledgeOnlySearch
              ? limit
              : Math.max(5, limit - regularResults.length),
          });
        }

        // Combine and sort by score
        const allResults = [...regularResults, ...knowledgeResults]
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);

        const output = formatSearchResults(allResults);

        return {
          content: [{ type: "text", text: output }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Search failed: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: mem_read - Read a specific note
  server.registerTool(
    "mem_read",
    {
      title: "Read Memory Note",
      description:
        "Read the full content of a specific note from the knowledge base by path or ID",
      inputSchema: {
        path: z
          .string()
          .describe("Path to the note (relative to vault or absolute)"),
        section: z
          .string()
          .optional()
          .describe(
            'Optional heading or block ID to extract (e.g., "Summary" or "^block-id")'
          ),
      },
    },
    async ({ path, section }): Promise<ToolResult> => {
      try {
        const note = await vault.readNote(path, section);
        const output = formatNote(note);

        return {
          content: [{ type: "text", text: output }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to read note: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: mem_write - Write or update a note
  server.registerTool(
    "mem_write",
    {
      title: "Write Memory Note",
      description:
        "Create or update a note in the knowledge base. Use for saving decisions, patterns, learnings, or custom content.",
      inputSchema: {
        type: z
          .enum(["error", "decision", "pattern", "file", "learning"])
          .describe("Type of note to create"),
        title: z.string().describe("Title for the note"),
        content: z.string().describe("Markdown content for the note"),
        project: z
          .string()
          .optional()
          .describe("Project name to associate with"),
        tags: z.array(z.string()).optional().describe("Additional tags"),
        path: z
          .string()
          .optional()
          .describe("Custom path (auto-generated if not provided)"),
        append: z
          .boolean()
          .optional()
          .describe("Append to existing note instead of replacing"),
        status: z
          .enum(["active", "superseded", "draft"])
          .optional()
          .describe("Note status (default: active)"),
        supersedes: z
          .array(z.string())
          .optional()
          .describe(
            'Wikilinks to notes this supersedes (e.g., ["[[path/to/old-note]]"])'
          ),
      },
    },
    async ({
      type,
      title,
      content,
      project,
      tags,
      path,
      append,
      status,
      supersedes,
    }): Promise<ToolResult> => {
      try {
        // Warn if supersedes is provided - should use mem_supersede instead
        let warning = "";
        if (supersedes && supersedes.length > 0) {
          warning =
            "\n\nNote: `supersedes` was provided but mem_write only creates one-way links. " +
            "Use mem_supersede to create bidirectional supersedes/superseded_by links.";
        }

        const result = await vault.writeNote({
          type,
          title,
          content,
          project,
          tags,
          path,
          append,
          status,
          supersedes,
        });

        const action = result.created ? "Created" : "Updated";
        return {
          content: [
            { type: "text", text: `${action} note: ${result.path}${warning}` },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to write note: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: mem_write_knowledge - Write knowledge extracted from conversations
  server.registerTool(
    "mem_write_knowledge",
    {
      title: "Write Knowledge Note",
      description:
        "Write knowledge extracted from conversations (Q&A, explanations, research, learnings). " +
        "Routes research to /research folder, others to /knowledge. Sets knowledge_type in frontmatter for filtered searches.",
      inputSchema: {
        type: z
          .enum(["qa", "explanation", "decision", "research", "learning"])
          .describe(
            "Type of knowledge: qa (question/answer), explanation (concept explained), decision (choice made), research (web/doc research), learning (insight/tip)"
          ),
        title: z.string().describe("Title for the knowledge note"),
        context: z
          .string()
          .describe("When this knowledge is useful (1 sentence)"),
        content: z
          .string()
          .describe("Main content/summary of the knowledge"),
        keyPoints: z
          .array(z.string())
          .optional()
          .describe("Key actionable points (2-5 items)"),
        topics: z
          .array(z.string())
          .optional()
          .describe("Topic tags for categorization (2-5 items)"),
        project: z.string().describe("Project name to associate with"),
        sourceUrl: z
          .string()
          .optional()
          .describe("Source URL if from web research"),
        sourceSession: z
          .string()
          .optional()
          .describe("Session ID if from conversation"),
      },
    },
    async ({
      type,
      title,
      context,
      content,
      keyPoints,
      topics,
      project,
      sourceUrl,
      sourceSession,
    }): Promise<ToolResult> => {
      try {
        const result = await vault.writeKnowledge(
          {
            type,
            title,
            context,
            content,
            keyPoints: keyPoints || [],
            topics: topics || [],
            sourceUrl,
            sourceSession,
          },
          project
        );

        const folder = type === "research" ? "research" : "knowledge";
        return {
          content: [
            {
              type: "text",
              text: `Created ${type} note in ${folder}/: ${result.path}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            { type: "text", text: `Failed to write knowledge: ${error}` },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool: mem_supersede - Supersede an existing note with a new one
  server.registerTool(
    "mem_supersede",
    {
      title: "Supersede Note",
      description:
        "Create a new note that supersedes an existing one. Automatically creates bidirectional links: the old note is marked as superseded with a link to the new note, and the new note links back to the old one.",
      inputSchema: {
        oldNotePath: z
          .string()
          .describe(
            'Path to the note being superseded (relative to vault, e.g., "projects/my-project/knowledge/old-note.md")'
          ),
        type: z
          .enum(["error", "decision", "pattern", "file", "learning"])
          .describe("Type of new note to create"),
        title: z.string().describe("Title for the new note"),
        content: z.string().describe("Markdown content for the new note"),
        project: z
          .string()
          .optional()
          .describe("Project name to associate with"),
        tags: z.array(z.string()).optional().describe("Additional tags"),
      },
    },
    async ({
      oldNotePath,
      type,
      title,
      content,
      project,
      tags,
    }): Promise<ToolResult> => {
      try {
        const result = await vault.supersedeNote(oldNotePath, {
          type,
          title,
          content,
          project,
          tags,
        });

        return {
          content: [
            {
              type: "text",
              text: `Superseded note:\n- Old (now superseded): ${result.oldPath}\n- New: ${result.newPath}\n\nBidirectional links created.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            { type: "text", text: `Failed to supersede note: ${error}` },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool: mem_project_context - Get context for current project
  server.registerTool(
    "mem_project_context",
    {
      title: "Get Project Context",
      description:
        "Retrieve relevant context for a project including unresolved errors, active decisions, and patterns. Useful at the start of a session to understand project history.",
      inputSchema: {
        project: z.string().describe("Project name"),
        includeErrors: z
          .boolean()
          .default(true)
          .describe("Include unresolved errors"),
        includeDecisions: z
          .boolean()
          .default(true)
          .describe("Include recent decisions"),
        includePatterns: z
          .boolean()
          .default(true)
          .describe("Include relevant patterns"),
        generateCanvas: z
          .boolean()
          .optional()
          .describe(
            "Generate/update project canvases (requires canvas.enabled in config)"
          ),
      },
    },
    async ({
      project,
      includeErrors,
      includeDecisions,
      includePatterns,
      generateCanvas,
    }): Promise<ToolResult> => {
      try {
        const context = await vault.getProjectContext(project, {
          includeErrors,
          includeDecisions,
          includePatterns,
        });

        let output = formatProjectContext(context);

        // Handle canvas generation
        // generateCanvas=true: force generate
        // generateCanvas=false: force skip (per-call opt-out)
        // generateCanvas=undefined: use autoGenerate config
        const shouldGenerateCanvas =
          generateCanvas ?? (config.canvas?.enabled && config.canvas?.autoGenerate);

        if (shouldGenerateCanvas) {
          if (!config.canvas?.enabled) {
            output +=
              "\n\n> Canvas generation requested but disabled in config.";
          } else {
            try {
              const projectPath = getProjectPath(project, config);
              const notes = await vault.getProjectNotes(project);

              if (notes.length > 0) {
                const canvasNotes: CanvasNote[] = notes.map((note) => ({
                  path: note.path,
                  title: note.title,
                  folder: detectFolder(note.path),
                  status: note.frontmatter.status || "active",
                  created: note.frontmatter.created,
                }));

                const canvasDir = path.join(projectPath, "canvases");
                const updateStrategy = config.canvas.updateStrategy || "skip";

                const result = generateProjectCanvases(
                  project,
                  canvasNotes,
                  canvasDir,
                  updateStrategy,
                  false // don't force
                );

                const generated: string[] = [];
                if (result.dashboard)
                  generated.push(`Dashboard: ${result.dashboard}`);
                if (result.timeline)
                  generated.push(`Timeline: ${result.timeline}`);
                if (result.graph) generated.push(`Graph: ${result.graph}`);

                if (generated.length > 0) {
                  output += `\n\n## Generated Canvases\n${generated
                    .map((g) => `- ${g}`)
                    .join("\n")}`;
                }
              }
            } catch (canvasError) {
              output += `\n\n> Canvas generation failed: ${canvasError}`;
            }
          }
        }

        return {
          content: [{ type: "text", text: output }],
        };
      } catch (error) {
        return {
          content: [
            { type: "text", text: `Failed to get project context: ${error}` },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool: mem_list_projects - List all projects
  server.registerTool(
    "mem_list_projects",
    {
      title: "List Projects",
      description:
        "List all projects that have been tracked in the memory system",
      inputSchema: {},
    },
    async (): Promise<ToolResult> => {
      try {
        const projects = await vault.listProjects();

        if (projects.length === 0) {
          return {
            content: [
              { type: "text", text: "No projects found in memory yet." },
            ],
          };
        }

        const output = `## Projects in Memory\n\n${projects
          .map((p) => `- ${p}`)
          .join("\n")}`;

        return {
          content: [{ type: "text", text: output }],
        };
      } catch (error) {
        return {
          content: [
            { type: "text", text: `Failed to list projects: ${error}` },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool: mem_generate_canvas - Generate visualization canvases
  server.registerTool(
    "mem_generate_canvas",
    {
      title: "Generate Project Canvas",
      description:
        "Generate visualization canvases for a project (dashboard, timeline, graph). " +
        "Requires canvas.enabled=true in config.",
      inputSchema: {
        project: z.string().describe("Project name"),
        types: z
          .array(z.enum(["dashboard", "timeline", "graph"]))
          .optional()
          .describe("Canvas types to generate (default: all)"),
        force: z
          .boolean()
          .optional()
          .describe("Overwrite existing canvases regardless of updateStrategy"),
      },
    },
    async ({ project, types, force }): Promise<ToolResult> => {
      try {
        // Check if canvas is enabled
        if (!config.canvas?.enabled) {
          return {
            content: [
              {
                type: "text",
                text: "Canvas generation is disabled. Enable it in config: canvas.enabled = true",
              },
            ],
            isError: true,
          };
        }

        // Get all notes for the project
        const projectPath = getProjectPath(project, config);
        const notes = await vault.getProjectNotes(project);

        if (notes.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No notes found for project "${project}". Create some notes first.`,
              },
            ],
          };
        }

        // Convert to CanvasNote format
        const canvasNotes: CanvasNote[] = notes.map((note) => ({
          path: note.path,
          title: note.title,
          folder: detectFolder(note.path),
          status: note.frontmatter.status || "active",
          created: note.frontmatter.created,
        }));

        // Generate canvases
        const canvasDir = path.join(projectPath, "canvases");
        const updateStrategy = config.canvas.updateStrategy || "skip";

        const result = generateProjectCanvases(
          project,
          canvasNotes,
          canvasDir,
          updateStrategy,
          force || false,
          types
        );

        // Format output
        const generated: string[] = [];
        if (result.dashboard) generated.push(`- Dashboard: ${result.dashboard}`);
        if (result.timeline) generated.push(`- Timeline: ${result.timeline}`);
        if (result.graph) generated.push(`- Graph: ${result.graph}`);

        if (generated.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No canvases generated (existing files skipped due to updateStrategy: "${updateStrategy}"). Use force=true to overwrite.`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Generated ${generated.length} canvas(es) for project "${project}":\n${generated.join("\n")}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            { type: "text", text: `Failed to generate canvases: ${error}` },
          ],
          isError: true,
        };
      }
    }
  );

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Formatting functions

function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No results found.";
  }

  const lines: string[] = [`## Search Results (${results.length})\n`];

  for (const result of results) {
    lines.push(`### ${result.title}`);
    lines.push(`**Type**: ${result.type} | **Path**: \`${result.path}\``);
    if (result.metadata.project) {
      lines.push(`**Project**: ${result.metadata.project}`);
    }
    if (result.metadata.tags && result.metadata.tags.length > 0) {
      lines.push(
        `**Tags**: ${result.metadata.tags.map((t) => `#${t}`).join(" ")}`
      );
    }
    lines.push("");
    lines.push(`> ${result.snippet}`);
    lines.push("");
  }

  return lines.join("\n");
}

function formatNote(note: Note): string {
  const lines: string[] = [];

  lines.push(`# ${note.title}`);
  lines.push("");
  lines.push(`**Path**: \`${note.path}\``);
  lines.push(`**Type**: ${note.frontmatter.type}`);
  if (note.frontmatter.project) {
    lines.push(`**Project**: ${note.frontmatter.project}`);
  }
  if (note.frontmatter.tags.length > 0) {
    lines.push(
      `**Tags**: ${note.frontmatter.tags.map((t) => `#${t}`).join(" ")}`
    );
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(note.content);

  return lines.join("\n");
}

function formatProjectContext(context: ProjectContext): string {
  const lines: string[] = [];

  lines.push(`# Project: ${context.project}`);
  lines.push("");

  if (context.summary) {
    lines.push("## Summary");
    lines.push(context.summary);
    lines.push("");
  }

  if (context.unresolvedErrors.length > 0) {
    lines.push("## Unresolved Errors");
    lines.push("");
    for (const error of context.unresolvedErrors) {
      lines.push(`> [!danger] ${error.type}`);
      lines.push(`> ${error.message}`);
      lines.push(`> Last seen: ${error.lastSeen}`);
      lines.push("");
    }
  }

  if (context.activeDecisions.length > 0) {
    lines.push("## Active Decisions");
    lines.push("");
    for (const decision of context.activeDecisions) {
      lines.push(`### ${decision.title}`);
      lines.push(decision.decision);
      lines.push("");
    }
  }

  if (context.patterns.length > 0) {
    lines.push("## Relevant Patterns");
    lines.push("");
    for (const pattern of context.patterns) {
      lines.push(`- **${pattern.name}**: ${pattern.description}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

main().catch((error) => {
  console.error("MCP server error:", error);
  process.exit(1);
});
