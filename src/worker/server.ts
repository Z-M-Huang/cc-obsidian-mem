import { Hono } from 'hono';
import { serve } from 'bun';
import type { Config } from '../shared/types.js';
import { loadConfig, sanitizeProjectName } from '../shared/config.js';
import { VaultManager } from '../mcp-server/utils/vault.js';
import { SessionManager } from './services/session.js';
import { ObservationProcessor } from './services/observation.js';
import { Summarizer } from './services/summarizer.js';

export function createServer(config: Config) {
  const vault = new VaultManager(config.vault.path, config.vault.memFolder);
  const sessionManager = new SessionManager(vault);
  const summarizer = new Summarizer(config.summarization);
  const observationProcessor = new ObservationProcessor(vault, sessionManager, summarizer, config);

  const app = new Hono();

  // Health check
  app.get('/health', (c) => {
    const currentSession = sessionManager.getCurrentSession();
    return c.json({
      status: 'ok',
      uptime: process.uptime(),
      sessionsActive: currentSession ? 1 : 0,
      currentSession: currentSession?.id,
      summarizationAvailable: summarizer.isAvailable(),
    });
  });

  // Session endpoints
  app.post('/session/start', async (c) => {
    try {
      const body = await c.req.json();
      const session = await sessionManager.startSession(body);
      return c.json({ success: true, sessionId: session.id });
    } catch (error) {
      console.error('Failed to start session:', error);
      return c.json({ success: false, error: String(error) }, 500);
    }
  });

  app.post('/session/end', async (c) => {
    try {
      const body = await c.req.json();
      const session = await sessionManager.endSession(body);
      return c.json({ success: true, sessionId: session?.id });
    } catch (error) {
      console.error('Failed to end session:', error);
      return c.json({ success: false, error: String(error) }, 500);
    }
  });

  app.get('/session/current', (c) => {
    const session = sessionManager.getCurrentSession();
    if (!session) {
      return c.json({ session: null });
    }
    return c.json({
      session: {
        id: session.id,
        project: session.project,
        startTime: session.startTime,
        observationsCount: session.observations.length,
        filesModified: session.filesModified.length,
        commandsRun: session.commandsRun,
        errorsEncountered: session.errorsEncountered,
      },
    });
  });

  app.post('/session/summarize', async (c) => {
    try {
      const body = await c.req.json();
      const { sessionId } = body;

      // Validate sessionId
      if (!sessionId || typeof sessionId !== 'string') {
        return c.json({ success: false, error: 'sessionId is required and must be a string' }, 400);
      }

      const session = sessionManager.getSession(sessionId);

      if (!session) {
        return c.json({ success: false, error: 'Session not found' }, 404);
      }

      const summary = await summarizer.summarizeSession(session);
      sessionManager.updateSessionSummary(sessionId, summary);

      // Extract and persist decisions if enabled
      let decisions: Array<{ title: string; description: string; rationale: string }> = [];
      if (config.capture.decisions) {
        decisions = await summarizer.extractDecisions(session);

        // Persist each decision to the vault
        for (const decision of decisions) {
          const sessionDate = new Date().toISOString().split('T')[0];
          const sessionRef = sessionId.substring(0, 8);

          // Try to read existing decision note
          let slugifiedTitle = decision.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .substring(0, 50);

          // Add timestamp suffix for untitled decisions to avoid collisions
          if (!slugifiedTitle) {
            slugifiedTitle = `untitled-decision-${Date.now()}`;
          }

          const decisionPath = `projects/${sanitizeProjectName(session.project)}/decisions/${slugifiedTitle}.md`;

          try {
            // Check if decision note already exists
            const existingNote = await vault.readNote(decisionPath);

            // Insert new row into existing Session History table
            const newRow = `| ${sessionDate} | ${sessionRef} | Updated |`;
            let updatedContent = existingNote.content;

            const historyHeader = '## Session History';
            const headerIndex = existingNote.content.indexOf(historyHeader);

            if (headerIndex !== -1) {
              // Find the table separator line
              const afterHeader = existingNote.content.substring(headerIndex);
              const separatorMatch = afterHeader.match(/\|[-|\s]+\|\n/);

              if (separatorMatch) {
                const separatorEnd = headerIndex + (separatorMatch.index || 0) + separatorMatch[0].length;
                updatedContent =
                  existingNote.content.substring(0, separatorEnd) +
                  newRow +
                  '\n' +
                  existingNote.content.substring(separatorEnd);
              }
            } else {
              // No Session History section found, append one
              updatedContent =
                existingNote.content.trimEnd() +
                `\n\n## Session History

| Date | Session | Notes |
|------|---------|-------|
| ${sessionDate} | ${sessionRef} | Updated |
`;
            }

            // Write updated note with preserved frontmatter
            await vault.writeNote({
              type: 'decision',
              title: decision.title,
              content: updatedContent,
              project: session.project,
              tags: ['decision', 'auto-extracted'],
              path: decisionPath,
              preserveFrontmatter: true,
            });
          } catch {
            // Decision doesn't exist, create new one
            await vault.writeNote({
              type: 'decision',
              title: decision.title,
              content: `## Context

${decision.rationale || 'Extracted from session activity.'}

## Decision

${decision.description}

## Session History

| Date | Session | Notes |
|------|---------|-------|
| ${sessionDate} | ${sessionRef} | Initial extraction |
`,
              project: session.project,
              tags: ['decision', 'auto-extracted'],
            });
          }
        }
      }

      return c.json({ success: true, summary, decisions, decisionsCount: decisions.length });
    } catch (error) {
      console.error('Failed to summarize session:', error);
      return c.json({ success: false, error: String(error) }, 500);
    }
  });

  // Observation endpoints
  app.post('/observation/capture', async (c) => {
    try {
      const { sessionId, observation } = await c.req.json();
      await observationProcessor.process(sessionId, observation);
      return c.json({ success: true, id: observation.id });
    } catch (error) {
      console.error('Failed to capture observation:', error);
      return c.json({ success: false, error: String(error) }, 500);
    }
  });

  // Context endpoints
  app.get('/context/project', async (c) => {
    try {
      const project = c.req.query('project');
      const maxTokens = parseInt(c.req.query('maxTokens') || '4000');
      const includeRecentSessions = parseInt(c.req.query('includeRecentSessions') || '3');
      const includeRelatedErrors = c.req.query('includeRelatedErrors') !== 'false';

      if (!project) {
        return c.json({ success: false, error: 'Project name required' }, 400);
      }

      const context = await vault.getProjectContext(project, {
        includeRecentSessions,
        includeErrors: includeRelatedErrors,
        includeDecisions: true,
        includePatterns: true,
      });

      // Format for injection
      const formatted = formatContextForInjection(context, maxTokens);

      return c.json({ success: true, context, formatted });
    } catch (error) {
      console.error('Failed to get project context:', error);
      return c.json({ success: false, error: String(error) }, 500);
    }
  });

  // Search endpoints
  app.post('/search', async (c) => {
    try {
      const body = await c.req.json();
      const results = await vault.searchNotes(body.query, {
        project: body.project,
        type: body.type,
        tags: body.tags,
        limit: body.limit || 10,
      });
      return c.json({ success: true, results });
    } catch (error) {
      console.error('Failed to search:', error);
      return c.json({ success: false, error: String(error) }, 500);
    }
  });

  // Projects list
  app.get('/projects', async (c) => {
    try {
      const projects = await vault.listProjects();
      return c.json({ success: true, projects });
    } catch (error) {
      console.error('Failed to list projects:', error);
      return c.json({ success: false, error: String(error) }, 500);
    }
  });

  return app;
}

/**
 * Format project context for injection into Claude's context
 */
function formatContextForInjection(
  context: Awaited<ReturnType<VaultManager['getProjectContext']>>,
  maxTokens: number
): string {
  const lines: string[] = [];

  lines.push(`<project-context project="${context.project}">`);

  if (context.recentSessions.length > 0) {
    lines.push('<recent-sessions>');
    for (const session of context.recentSessions) {
      lines.push(`  <session date="${session.date}">`);
      lines.push(`    ${session.summary}`);
      lines.push('  </session>');
    }
    lines.push('</recent-sessions>');
  }

  if (context.unresolvedErrors.length > 0) {
    lines.push('<unresolved-errors>');
    for (const error of context.unresolvedErrors) {
      lines.push(`  <error type="${error.type}" last-seen="${error.lastSeen}">`);
      lines.push(`    ${error.message}`);
      lines.push('  </error>');
    }
    lines.push('</unresolved-errors>');
  }

  if (context.activeDecisions.length > 0) {
    lines.push('<active-decisions>');
    for (const decision of context.activeDecisions) {
      lines.push(`  <decision title="${decision.title}">`);
      lines.push(`    ${decision.decision}`);
      lines.push('  </decision>');
    }
    lines.push('</active-decisions>');
  }

  if (context.patterns.length > 0) {
    lines.push('<patterns>');
    for (const pattern of context.patterns) {
      lines.push(`  <pattern name="${pattern.name}">`);
      lines.push(`    ${pattern.description}`);
      lines.push('  </pattern>');
    }
    lines.push('</patterns>');
  }

  lines.push('</project-context>');

  let result = lines.join('\n');

  // Rough token estimation (4 chars per token)
  const estimatedTokens = result.length / 4;
  if (estimatedTokens > maxTokens) {
    // Truncate if too long
    const targetChars = maxTokens * 4;
    result = result.substring(0, targetChars) + '\n... [truncated]';
  }

  return result;
}

/**
 * Start the worker server
 */
export async function startServer(config?: Config): Promise<void> {
  const cfg = config || loadConfig();
  const app = createServer(cfg);

  console.log(`Starting worker service on port ${cfg.worker.port}...`);

  serve({
    fetch: app.fetch,
    port: cfg.worker.port,
  });

  console.log(`Worker service running at http://localhost:${cfg.worker.port}`);
}
