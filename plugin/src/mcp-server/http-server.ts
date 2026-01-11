#!/usr/bin/env bun

/**
 * HTTP/SSE MCP Server for cc-obsidian-mem
 *
 * Supports both:
 * 1. Streamable HTTP transport (recommended, protocol version 2025-03-26+)
 * 2. Legacy HTTP+SSE transport (deprecated, for backwards compatibility)
 *
 * Endpoints:
 * - /mcp: Streamable HTTP (GET, POST, DELETE)
 * - /sse: Legacy SSE endpoint (GET)
 * - /messages: Legacy message endpoint (POST)
 * - /health: Health check endpoint
 */

import { randomUUID } from 'node:crypto';
import express, { Request, Response, NextFunction } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod';
import { VaultManager } from './utils/vault.js';
import { loadConfig } from '../shared/config.js';
import type { SearchResult, ProjectContext, Note } from '../shared/types.js';

type TextContent = { type: 'text'; text: string };
type ToolResult = { content: TextContent[]; isError?: boolean };

// Configuration
const PORT = parseInt(process.env.MCP_PORT || '8080', 10);
const HOST = process.env.MCP_HOST || '0.0.0.0';
const BEARER_TOKEN = process.env.BEARER_TOKEN || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://claude.ai').split(',').map(s => s.trim());

// Store active transports by session ID
const transports: Record<string, StreamableHTTPServerTransport | SSEServerTransport> = {};

// Initialize vault
const config = loadConfig();
const vault = new VaultManager(config.vault.path, config.vault.memFolder);

/**
 * Create and configure the MCP server with all tools
 */
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'obsidian-mem',
    version: '0.3.0',
  });

  // Tool: mem_search - Search the knowledge base
  server.registerTool(
    'mem_search',
    {
      title: 'Search Memory',
      description: 'Search the Claude Code knowledge base for past sessions, errors, decisions, and patterns.',
      inputSchema: {
        query: z.string().describe('Search query - natural language or keywords'),
        project: z.string().optional().describe('Filter by project name'),
        type: z.enum(['session', 'error', 'decision', 'pattern', 'file', 'learning', 'knowledge']).optional().describe('Filter by note type'),
        tags: z.array(z.string()).optional().describe('Filter by tags'),
        limit: z.number().default(10).describe('Maximum number of results'),
      },
    },
    async ({ query, project, type, tags, limit }): Promise<ToolResult> => {
      try {
        const knowledgeTypeMap: Record<string, string | string[] | undefined> = {
          'knowledge': undefined,
          'learning': 'learning',
          'decision': 'decision',
          'session': undefined,
          'error': undefined,
          'pattern': undefined,
          'file': undefined,
        };

        const isKnowledgeOnlySearch = type === 'knowledge';
        const regularNoteType = isKnowledgeOnlySearch ? undefined : type;

        let regularResults: SearchResult[] = [];
        if (!isKnowledgeOnlySearch) {
          regularResults = await vault.searchNotes(query, {
            project,
            type: regularNoteType,
            tags,
            limit,
          });
        }

        let knowledgeResults: SearchResult[] = [];
        const shouldSearchKnowledge = !type || type === 'knowledge' || type === 'learning' || type === 'decision';

        if (shouldSearchKnowledge) {
          const knowledgeType = type === 'knowledge' || !type
            ? undefined
            : knowledgeTypeMap[type] as 'qa' | 'explanation' | 'decision' | 'research' | 'learning' | undefined;

          knowledgeResults = await vault.searchKnowledge(query, {
            project,
            knowledgeType,
            limit: isKnowledgeOnlySearch ? limit : Math.max(5, limit - regularResults.length),
          });
        }

        const allResults = [...regularResults, ...knowledgeResults]
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);

        return {
          content: [{ type: 'text', text: formatSearchResults(allResults) }],
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
        section: z.string().optional().describe('Optional heading or block ID to extract'),
      },
    },
    async ({ path, section }): Promise<ToolResult> => {
      try {
        const note = await vault.readNote(path, section);
        return {
          content: [{ type: 'text', text: formatNote(note) }],
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
      description: 'Create or update a note in the knowledge base.',
      inputSchema: {
        type: z.enum(['session', 'error', 'decision', 'pattern', 'file', 'learning']).describe('Type of note to create'),
        title: z.string().describe('Title for the note'),
        content: z.string().describe('Markdown content for the note'),
        project: z.string().optional().describe('Project name to associate with'),
        tags: z.array(z.string()).optional().describe('Additional tags'),
        path: z.string().optional().describe('Custom path (auto-generated if not provided)'),
        append: z.boolean().optional().describe('Append to existing note instead of replacing'),
        status: z.enum(['active', 'superseded', 'draft']).optional().describe('Note status'),
        supersedes: z.array(z.string()).optional().describe('Wikilinks to notes this supersedes'),
      },
    },
    async ({ type, title, content, project, tags, path, append, status, supersedes }): Promise<ToolResult> => {
      try {
        let warning = '';
        if (supersedes && supersedes.length > 0) {
          warning = '\n\nNote: Use mem_supersede for bidirectional supersedes/superseded_by links.';
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

        const action = result.created ? 'Created' : 'Updated';
        return {
          content: [{ type: 'text', text: `${action} note: ${result.path}${warning}` }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Failed to write note: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: mem_supersede - Supersede an existing note
  server.registerTool(
    'mem_supersede',
    {
      title: 'Supersede Note',
      description: 'Create a new note that supersedes an existing one with bidirectional links.',
      inputSchema: {
        oldNotePath: z.string().describe('Path to the note being superseded'),
        type: z.enum(['session', 'error', 'decision', 'pattern', 'file', 'learning']).describe('Type of new note'),
        title: z.string().describe('Title for the new note'),
        content: z.string().describe('Markdown content for the new note'),
        project: z.string().optional().describe('Project name to associate with'),
        tags: z.array(z.string()).optional().describe('Additional tags'),
      },
    },
    async ({ oldNotePath, type, title, content, project, tags }): Promise<ToolResult> => {
      try {
        const result = await vault.supersedeNote(oldNotePath, {
          type,
          title,
          content,
          project,
          tags,
        });

        return {
          content: [{
            type: 'text',
            text: `Superseded note:\n- Old: ${result.oldPath}\n- New: ${result.newPath}\n\nBidirectional links created.`
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Failed to supersede note: ${error}` }],
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
      description: 'Retrieve relevant context for a project including recent sessions, errors, and decisions.',
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

        return {
          content: [{ type: 'text', text: formatProjectContext(context) }],
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

        return {
          content: [{ type: 'text', text: `## Projects in Memory\n\n${projects.map(p => `- ${p}`).join('\n')}` }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Failed to list projects: ${error}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}

// Formatting functions
function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return 'No results found.';

  const lines: string[] = [`## Search Results (${results.length})\n`];
  for (const result of results) {
    lines.push(`### ${result.title}`);
    lines.push(`**Type**: ${result.type} | **Path**: \`${result.path}\``);
    if (result.metadata.project) lines.push(`**Project**: ${result.metadata.project}`);
    if (result.metadata.tags?.length) lines.push(`**Tags**: ${result.metadata.tags.map(t => `#${t}`).join(' ')}`);
    lines.push('', `> ${result.snippet}`, '');
  }
  return lines.join('\n');
}

function formatNote(note: Note): string {
  const lines: string[] = [
    `# ${note.title}`, '',
    `**Path**: \`${note.path}\``,
    `**Type**: ${note.frontmatter.type}`,
  ];
  if (note.frontmatter.project) lines.push(`**Project**: ${note.frontmatter.project}`);
  if (note.frontmatter.tags.length) lines.push(`**Tags**: ${note.frontmatter.tags.map(t => `#${t}`).join(' ')}`);
  lines.push('', '---', '', note.content);
  return lines.join('\n');
}

function formatProjectContext(context: ProjectContext): string {
  const lines: string[] = [`# Project: ${context.project}`, ''];
  if (context.summary) lines.push('## Summary', context.summary, '');
  if (context.recentSessions.length) {
    lines.push('## Recent Sessions', '');
    for (const s of context.recentSessions) lines.push(`### ${s.date}`, s.summary || '_No summary_', '');
  }
  if (context.unresolvedErrors.length) {
    lines.push('## Unresolved Errors', '');
    for (const e of context.unresolvedErrors) lines.push(`> [!danger] ${e.type}`, `> ${e.message}`, `> Last seen: ${e.lastSeen}`, '');
  }
  if (context.activeDecisions.length) {
    lines.push('## Active Decisions', '');
    for (const d of context.activeDecisions) lines.push(`### ${d.title}`, d.decision, '');
  }
  if (context.patterns.length) {
    lines.push('## Relevant Patterns', '');
    for (const p of context.patterns) lines.push(`- **${p.name}**: ${p.description}`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Bearer token authentication middleware
 */
function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip auth for health check
  if (req.path === '/health') {
    next();
    return;
  }

  // Skip auth if no token configured
  if (!BEARER_TOKEN) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized: Missing Authorization header' },
      id: null
    });
    return;
  }

  const [scheme, token] = authHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || token !== BEARER_TOKEN) {
    res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized: Invalid token' },
      id: null
    });
    return;
  }

  next();
}

/**
 * CORS middleware
 */
function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;

  // Check if origin is allowed
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (ALLOWED_ORIGINS.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
}

/**
 * Main function to start the server
 */
async function main(): Promise<void> {
  // Ensure vault structure exists
  await vault.ensureStructure();

  const app = express();

  // Middleware
  app.use(corsMiddleware);
  app.use(express.json());
  app.use(authMiddleware);

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      name: 'obsidian-mem',
      version: '0.3.0',
      timestamp: new Date().toISOString()
    });
  });

  // =============================================
  // STREAMABLE HTTP TRANSPORT (recommended)
  // =============================================
  app.all('/mcp', async (req: Request, res: Response) => {
    console.log(`[Streamable HTTP] ${req.method} /mcp`);

    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        const existing = transports[sessionId];
        if (existing instanceof StreamableHTTPServerTransport) {
          transport = existing;
        } else {
          res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Session uses different transport protocol' },
            id: null
          });
          return;
        }
      } else if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
        // New session initialization
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid: string) => {
            console.log(`[Streamable HTTP] Session initialized: ${sid}`);
            transports[sid] = transport;
          }
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports[sid]) {
            console.log(`[Streamable HTTP] Session closed: ${sid}`);
            delete transports[sid];
          }
        };

        const mcpServer = createMcpServer();
        await mcpServer.connect(transport);
      } else if (!sessionId) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'No session ID. Send initialize request first.' },
          id: null
        });
        return;
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Invalid session ID' },
          id: null
        });
        return;
      }

      // Handle the request
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('[Streamable HTTP] Error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null
        });
      }
    }
  });

  // =============================================
  // LEGACY HTTP+SSE TRANSPORT (deprecated)
  // =============================================
  app.get('/sse', async (req: Request, res: Response) => {
    console.log('[Legacy SSE] GET /sse (deprecated)');

    const transport = new SSEServerTransport('/messages', res);
    transports[transport.sessionId] = transport;

    res.on('close', () => {
      console.log(`[Legacy SSE] Connection closed: ${transport.sessionId}`);
      delete transports[transport.sessionId];
    });

    const mcpServer = createMcpServer();
    await mcpServer.connect(transport);
  });

  app.post('/messages', async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    console.log(`[Legacy SSE] POST /messages for session: ${sessionId}`);

    if (!sessionId) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'sessionId query parameter required' },
        id: null
      });
      return;
    }

    const transport = transports[sessionId];
    if (!transport || !(transport instanceof SSEServerTransport)) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Invalid or expired session' },
        id: null
      });
      return;
    }

    await transport.handlePostMessage(req, res, req.body);
  });

  // Start server
  const server = app.listen(PORT, HOST, () => {
    console.log(`
==============================================
Obsidian Memory MCP Server
==============================================
Listening on: http://${HOST}:${PORT}

Endpoints:
  GET  /health    - Health check
  ALL  /mcp       - Streamable HTTP (recommended)
  GET  /sse       - Legacy SSE (deprecated)
  POST /messages  - Legacy POST (deprecated)

Auth: ${BEARER_TOKEN ? 'Bearer token required' : 'No authentication'}
CORS: ${ALLOWED_ORIGINS.join(', ')}
Vault: ${config.vault.path}
==============================================
`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down...');

    for (const sessionId in transports) {
      try {
        await transports[sessionId].close();
        delete transports[sessionId];
      } catch (error) {
        console.error(`Error closing session ${sessionId}:`, error);
      }
    }

    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
