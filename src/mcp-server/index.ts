#!/usr/bin/env bun

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod';
import { VaultManager } from './utils/vault.js';
import { loadConfig } from '../shared/config.js';
import type { SearchResult, ProjectContext, Note } from '../shared/types.js';

type TextContent = { type: 'text'; text: string };
type ToolResult = { content: TextContent[]; isError?: boolean };

async function main() {
  const config = loadConfig();
  const vault = new VaultManager(config.vault.path, config.vault.memFolder);

  // Ensure vault structure exists
  await vault.ensureStructure();

  const server = new McpServer({
    name: 'obsidian-mem',
    version: '0.1.0',
  });

  // Tool: mem_search - Search the knowledge base
  server.registerTool(
    'mem_search',
    {
      title: 'Search Memory',
      description: 'Search the Claude Code knowledge base for past sessions, errors, decisions, and patterns. Use semantic search to find relevant information based on natural language queries.',
      inputSchema: {
        query: z.string().describe('Search query - natural language or keywords'),
        project: z.string().optional().describe('Filter by project name'),
        type: z.enum(['session', 'error', 'decision', 'pattern', 'file', 'learning']).optional().describe('Filter by note type'),
        tags: z.array(z.string()).optional().describe('Filter by tags'),
        limit: z.number().default(10).describe('Maximum number of results'),
      },
    },
    async ({ query, project, type, tags, limit }): Promise<ToolResult> => {
      try {
        const results = await vault.searchNotes(query, {
          project,
          type,
          tags,
          limit,
        });

        const output = formatSearchResults(results);

        return {
          content: [{ type: 'text', text: output }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Search failed: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: mem_read - Read a specific note
  server.registerTool(
    'mem_read',
    {
      title: 'Read Memory Note',
      description: 'Read the full content of a specific note from the knowledge base by path or ID',
      inputSchema: {
        path: z.string().describe('Path to the note (relative to vault or absolute)'),
        section: z.string().optional().describe('Optional heading or block ID to extract (e.g., "Summary" or "^block-id")'),
      },
    },
    async ({ path, section }): Promise<ToolResult> => {
      try {
        const note = await vault.readNote(path, section);
        const output = formatNote(note);

        return {
          content: [{ type: 'text', text: output }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Failed to read note: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: mem_write - Write or update a note
  server.registerTool(
    'mem_write',
    {
      title: 'Write Memory Note',
      description: 'Create or update a note in the knowledge base. Use for saving decisions, patterns, learnings, or custom content.',
      inputSchema: {
        type: z.enum(['session', 'error', 'decision', 'pattern', 'file', 'learning']).describe('Type of note to create'),
        title: z.string().describe('Title for the note'),
        content: z.string().describe('Markdown content for the note'),
        project: z.string().optional().describe('Project name to associate with'),
        tags: z.array(z.string()).optional().describe('Additional tags'),
        path: z.string().optional().describe('Custom path (auto-generated if not provided)'),
        append: z.boolean().optional().describe('Append to existing note instead of replacing'),
      },
    },
    async ({ type, title, content, project, tags, path, append }): Promise<ToolResult> => {
      try {
        const result = await vault.writeNote({
          type,
          title,
          content,
          project,
          tags,
          path,
          append,
        });

        const action = result.created ? 'Created' : 'Updated';
        return {
          content: [{ type: 'text', text: `${action} note: ${result.path}` }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Failed to write note: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: mem_project_context - Get context for current project
  server.registerTool(
    'mem_project_context',
    {
      title: 'Get Project Context',
      description: 'Retrieve relevant context for a project including recent sessions, unresolved errors, and active decisions. Useful at the start of a session to understand project history.',
      inputSchema: {
        project: z.string().describe('Project name'),
        includeRecentSessions: z.number().default(3).describe('Number of recent sessions to include'),
        includeErrors: z.boolean().default(true).describe('Include unresolved errors'),
        includeDecisions: z.boolean().default(true).describe('Include recent decisions'),
        includePatterns: z.boolean().default(true).describe('Include relevant patterns'),
      },
    },
    async ({ project, includeRecentSessions, includeErrors, includeDecisions, includePatterns }): Promise<ToolResult> => {
      try {
        const context = await vault.getProjectContext(project, {
          includeRecentSessions,
          includeErrors,
          includeDecisions,
          includePatterns,
        });

        const output = formatProjectContext(context);

        return {
          content: [{ type: 'text', text: output }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Failed to get project context: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: mem_list_projects - List all projects
  server.registerTool(
    'mem_list_projects',
    {
      title: 'List Projects',
      description: 'List all projects that have been tracked in the memory system',
      inputSchema: {},
    },
    async (): Promise<ToolResult> => {
      try {
        const projects = await vault.listProjects();

        if (projects.length === 0) {
          return {
            content: [{ type: 'text', text: 'No projects found in memory yet.' }],
          };
        }

        const output = `## Projects in Memory\n\n${projects.map(p => `- ${p}`).join('\n')}`;

        return {
          content: [{ type: 'text', text: output }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Failed to list projects: ${error}` }],
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
    return 'No results found.';
  }

  const lines: string[] = [`## Search Results (${results.length})\n`];

  for (const result of results) {
    lines.push(`### ${result.title}`);
    lines.push(`**Type**: ${result.type} | **Path**: \`${result.path}\``);
    if (result.metadata.project) {
      lines.push(`**Project**: ${result.metadata.project}`);
    }
    if (result.metadata.tags && result.metadata.tags.length > 0) {
      lines.push(`**Tags**: ${result.metadata.tags.map(t => `#${t}`).join(' ')}`);
    }
    lines.push('');
    lines.push(`> ${result.snippet}`);
    lines.push('');
  }

  return lines.join('\n');
}

function formatNote(note: Note): string {
  const lines: string[] = [];

  lines.push(`# ${note.title}`);
  lines.push('');
  lines.push(`**Path**: \`${note.path}\``);
  lines.push(`**Type**: ${note.frontmatter.type}`);
  if (note.frontmatter.project) {
    lines.push(`**Project**: ${note.frontmatter.project}`);
  }
  if (note.frontmatter.tags.length > 0) {
    lines.push(`**Tags**: ${note.frontmatter.tags.map(t => `#${t}`).join(' ')}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(note.content);

  return lines.join('\n');
}

function formatProjectContext(context: ProjectContext): string {
  const lines: string[] = [];

  lines.push(`# Project: ${context.project}`);
  lines.push('');

  if (context.summary) {
    lines.push('## Summary');
    lines.push(context.summary);
    lines.push('');
  }

  if (context.recentSessions.length > 0) {
    lines.push('## Recent Sessions');
    lines.push('');
    for (const session of context.recentSessions) {
      lines.push(`### ${session.date}`);
      lines.push(session.summary || '_No summary available_');
      lines.push('');
    }
  }

  if (context.unresolvedErrors.length > 0) {
    lines.push('## Unresolved Errors');
    lines.push('');
    for (const error of context.unresolvedErrors) {
      lines.push(`> [!danger] ${error.type}`);
      lines.push(`> ${error.message}`);
      lines.push(`> Last seen: ${error.lastSeen}`);
      lines.push('');
    }
  }

  if (context.activeDecisions.length > 0) {
    lines.push('## Active Decisions');
    lines.push('');
    for (const decision of context.activeDecisions) {
      lines.push(`### ${decision.title}`);
      lines.push(decision.decision);
      lines.push('');
    }
  }

  if (context.patterns.length > 0) {
    lines.push('## Relevant Patterns');
    lines.push('');
    for (const pattern of context.patterns) {
      lines.push(`- **${pattern.name}**: ${pattern.description}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

main().catch((error) => {
  console.error('MCP server error:', error);
  process.exit(1);
});
