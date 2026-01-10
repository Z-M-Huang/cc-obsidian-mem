import * as fs from 'fs';
import * as path from 'path';
import type { Session, Observation, SessionStartRequest, SessionEndRequest } from '../../shared/types.js';
import { VaultManager } from '../../mcp-server/utils/vault.js';
import { stringifyFrontmatter, generateFrontmatter } from '../../mcp-server/utils/frontmatter.js';
import { sanitizeProjectName } from '../../shared/config.js';

export class SessionManager {
  private vault: VaultManager;
  private currentSession: Session | null = null;
  private sessionsInMemory: Map<string, Session> = new Map();

  constructor(vault: VaultManager) {
    this.vault = vault;
  }

  /**
   * Start a new session
   */
  async startSession(request: SessionStartRequest): Promise<Session> {
    // End any existing session
    if (this.currentSession) {
      await this.endSession({
        sessionId: this.currentSession.id,
        endType: 'stop',
        endTime: new Date().toISOString(),
      });
    }

    const session: Session = {
      id: request.sessionId,
      project: request.project,
      projectPath: request.projectPath,
      startTime: request.startTime,
      status: 'active',
      observations: [],
      filesModified: [],
      commandsRun: 0,
      errorsEncountered: 0,
    };

    this.currentSession = session;
    this.sessionsInMemory.set(session.id, session);

    // Ensure project structure exists
    await this.vault.ensureProjectStructure(request.project);

    return session;
  }

  /**
   * End a session
   */
  async endSession(request: SessionEndRequest): Promise<Session | null> {
    const session = this.sessionsInMemory.get(request.sessionId);
    if (!session) {
      return null;
    }

    session.endTime = request.endTime;
    session.status = request.endType === 'stop' ? 'stopped' : 'completed';

    // Calculate duration
    const start = new Date(session.startTime);
    const end = new Date(request.endTime);
    session.durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);

    // Persist session to vault
    await this.persistSession(session);

    // Clear from memory
    if (this.currentSession?.id === session.id) {
      this.currentSession = null;
    }
    this.sessionsInMemory.delete(session.id);

    return session;
  }

  /**
   * Get the current active session
   */
  getCurrentSession(): Session | null {
    return this.currentSession;
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): Session | undefined {
    return this.sessionsInMemory.get(sessionId);
  }

  /**
   * Add an observation to the current session
   */
  addObservation(sessionId: string, observation: Observation): void {
    const session = this.sessionsInMemory.get(sessionId);
    if (!session) {
      console.warn(`Session ${sessionId} not found for observation`);
      return;
    }

    session.observations.push(observation);

    // Update counters
    if (observation.type === 'file_edit') {
      const filePath = (observation.data as { path: string }).path;
      if (!session.filesModified.includes(filePath)) {
        session.filesModified.push(filePath);
      }
    } else if (observation.type === 'command') {
      session.commandsRun++;
    } else if (observation.type === 'error' || observation.isError) {
      session.errorsEncountered++;
    }
  }

  /**
   * Update session summary (after AI summarization)
   */
  updateSessionSummary(sessionId: string, summary: string): void {
    const session = this.sessionsInMemory.get(sessionId);
    if (session) {
      session.summary = summary;
    }
  }

  /**
   * Persist session to vault as a markdown note
   */
  private async persistSession(session: Session): Promise<void> {
    const content = this.generateSessionContent(session);

    const frontmatter = generateFrontmatter('session', {
      title: `Session ${session.startTime.split('T')[0]}`,
      project: session.project,
      tags: ['session', `project/${sanitizeProjectName(session.project)}`],
      additional: {
        session_id: session.id,
        start_time: session.startTime,
        end_time: session.endTime,
        duration_minutes: session.durationMinutes,
        status: session.status,
        observations_count: session.observations.length,
        files_modified: session.filesModified.length,
        commands_run: session.commandsRun,
        errors_encountered: session.errorsEncountered,
      },
    });

    const projectPath = path.join(
      this.vault.getMemPath(),
      'projects',
      sanitizeProjectName(session.project),
      'sessions'
    );

    // Ensure directory exists
    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true });
    }

    const fileName = `${session.startTime.split('T')[0]}_${session.id.substring(0, 8)}.md`;
    const filePath = path.join(projectPath, fileName);

    fs.writeFileSync(filePath, stringifyFrontmatter(frontmatter, content));
  }

  /**
   * Generate session note content
   */
  private generateSessionContent(session: Session): string {
    const lines: string[] = [];

    lines.push(`# Session: ${session.startTime.split('T')[0]}`);
    lines.push('');

    // Summary section
    lines.push('## Summary');
    lines.push('');
    if (session.summary) {
      lines.push(session.summary);
    } else {
      lines.push('> [!note] Session completed');
      lines.push(`> Duration: ${session.durationMinutes} minutes`);
      lines.push(`> Files modified: ${session.filesModified.length}`);
      lines.push(`> Commands run: ${session.commandsRun}`);
      lines.push(`> Errors: ${session.errorsEncountered}`);
    }
    lines.push('');

    // Key actions
    if (session.observations.length > 0) {
      lines.push('## Key Actions');
      lines.push('');

      const significantObs = session.observations.slice(0, 20);
      for (const obs of significantObs) {
        const brief = this.briefObservation(obs);
        lines.push(`- **${obs.type}** (${obs.timestamp.split('T')[1].substring(0, 5)}): ${brief}`);
      }

      if (session.observations.length > 20) {
        lines.push(`- ... and ${session.observations.length - 20} more actions`);
      }
      lines.push('');
    }

    // Files modified
    if (session.filesModified.length > 0) {
      lines.push('## Files Modified');
      lines.push('');
      for (const file of session.filesModified.slice(0, 20)) {
        lines.push(`- \`${file}\``);
      }
      if (session.filesModified.length > 20) {
        lines.push(`- ... and ${session.filesModified.length - 20} more files`);
      }
      lines.push('');
    }

    // Observations detail
    if (session.observations.length > 0) {
      lines.push('## Observations');
      lines.push('');

      for (const obs of session.observations.slice(0, 50)) {
        lines.push(`### ${obs.type} ^obs-${obs.id.substring(0, 8)}`);
        lines.push('');
        lines.push(this.formatObservation(obs));
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate brief description of an observation
   */
  private briefObservation(obs: Observation): string {
    const data = obs.data as Record<string, unknown>;
    switch (obs.type) {
      case 'file_edit':
        return `Edited \`${data.path}\``;
      case 'command':
        const cmd = (data.command as string || '').substring(0, 50);
        return `Ran: ${cmd}${(data.command as string || '').length > 50 ? '...' : ''}`;
      case 'error':
        return `Error: ${(data.message as string || '').substring(0, 50)}...`;
      default:
        return obs.tool;
    }
  }

  /**
   * Format observation for note content
   */
  private formatObservation(obs: Observation): string {
    const data = obs.data as Record<string, unknown>;
    const lines: string[] = [];

    const calloutType = obs.isError ? 'danger' : 'info';
    lines.push(`> [!${calloutType}] ${obs.tool} at ${obs.timestamp}`);

    switch (obs.type) {
      case 'file_edit':
        lines.push(`> **File**: \`${data.path}\``);
        lines.push(`> **Type**: ${data.changeType}`);
        if (data.linesAdded) lines.push(`> **Lines added**: ${data.linesAdded}`);
        if (data.linesRemoved) lines.push(`> **Lines removed**: ${data.linesRemoved}`);
        break;

      case 'command':
        lines.push(`> **Command**: \`${data.command}\``);
        lines.push(`> **Exit code**: ${data.exitCode}`);
        if (data.output) {
          lines.push('>');
          lines.push('> ```');
          const output = (data.output as string).substring(0, 500);
          lines.push(`> ${output.split('\n').join('\n> ')}`);
          lines.push('> ```');
        }
        break;

      case 'error':
        lines.push(`> **Type**: ${data.type}`);
        lines.push(`> **Message**: ${data.message}`);
        if (data.file) lines.push(`> **File**: \`${data.file}\``);
        if (data.stack) {
          lines.push('>');
          lines.push('> ```');
          lines.push(`> ${(data.stack as string).split('\n').slice(0, 5).join('\n> ')}`);
          lines.push('> ```');
        }
        break;

      default:
        lines.push(`> ${JSON.stringify(data).substring(0, 200)}`);
    }

    return lines.join('\n');
  }
}
