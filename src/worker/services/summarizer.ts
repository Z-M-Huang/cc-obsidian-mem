import Anthropic from '@anthropic-ai/sdk';
import type { Session, Observation, Config } from '../../shared/types.js';

export class Summarizer {
  private client: Anthropic | null = null;
  private model: string;
  private enabled: boolean;

  constructor(config: Config['summarization']) {
    this.enabled = config.enabled;
    this.model = config.model;

    if (config.enabled) {
      const apiKey = process.env[config.apiKeyEnvVar];
      if (apiKey) {
        this.client = new Anthropic({ apiKey });
      } else {
        console.warn(`AI summarization enabled but ${config.apiKeyEnvVar} not found`);
        this.enabled = false;
      }
    }
  }

  /**
   * Check if summarizer is available
   */
  isAvailable(): boolean {
    return this.enabled && this.client !== null;
  }

  /**
   * Summarize a session
   */
  async summarizeSession(session: Session): Promise<string> {
    if (!this.isAvailable()) {
      return this.generateFallbackSummary(session);
    }

    const observationSummary = session.observations
      .slice(0, 50)
      .map(obs => `- [${obs.timestamp.split('T')[1].substring(0, 8)}] ${obs.type}: ${this.briefDescription(obs)}`)
      .join('\n');

    try {
      const response = await this.client!.messages.create({
        model: this.model,
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `Summarize this Claude Code session concisely. Focus on:
1. Main accomplishments
2. Key decisions made
3. Problems solved
4. Any unresolved issues

Session duration: ${session.durationMinutes || 'unknown'} minutes
Project: ${session.project}
Files modified: ${session.filesModified.length}
Commands run: ${session.commandsRun}
Errors encountered: ${session.errorsEncountered}

Observations:
${observationSummary}

Provide a 2-3 paragraph summary suitable for future reference. Be specific about what was done.`
        }]
      });

      if (response.content[0].type === 'text') {
        return response.content[0].text;
      }
    } catch (error) {
      console.error('Failed to summarize session:', error);
    }

    return this.generateFallbackSummary(session);
  }

  /**
   * Summarize an error for the error note
   */
  async summarizeError(error: Observation): Promise<string> {
    if (!this.isAvailable()) {
      return this.generateFallbackErrorSummary(error);
    }

    const data = error.data as Record<string, unknown>;

    try {
      const response = await this.client!.messages.create({
        model: this.model,
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: `Summarize this error for future reference:

Error Type: ${data.type || 'unknown'}
Error Message: ${data.message || 'No message'}
File: ${data.file || 'unknown'}
Context: ${data.context || 'No additional context'}
Stack Trace (first lines): ${data.stack ? (data.stack as string).split('\n').slice(0, 3).join('\n') : 'Not available'}

Provide a brief, actionable summary that would help identify and fix this error in the future.`
        }]
      });

      if (response.content[0].type === 'text') {
        return response.content[0].text;
      }
    } catch (error) {
      console.error('Failed to summarize error:', error);
    }

    return this.generateFallbackErrorSummary(error);
  }

  /**
   * Extract key decisions from a session
   */
  async extractDecisions(session: Session): Promise<Array<{
    title: string;
    description: string;
    rationale: string;
  }>> {
    if (!this.isAvailable() || session.observations.length === 0) {
      return [];
    }

    const observationSummary = session.observations
      .slice(0, 30)
      .map(obs => `- ${obs.type}: ${this.briefDescription(obs)}`)
      .join('\n');

    try {
      const response = await this.client!.messages.create({
        model: this.model,
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `Analyze this coding session and identify any significant architectural or design decisions that were made.

Project: ${session.project}
Session observations:
${observationSummary}

For each decision found, provide:
1. A brief title
2. What was decided
3. Why (if apparent from context)

Format as JSON array: [{"title": "...", "description": "...", "rationale": "..."}]

If no significant decisions were made, return an empty array: []`
        }]
      });

      if (response.content[0].type === 'text') {
        const text = response.content[0].text;
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
      }
    } catch (error) {
      console.error('Failed to extract decisions:', error);
    }

    return [];
  }

  /**
   * Generate brief description of an observation
   */
  private briefDescription(obs: Observation): string {
    const data = obs.data as Record<string, unknown>;
    switch (obs.type) {
      case 'file_edit':
        return `Edited ${data.path}`;
      case 'command':
        const cmd = (data.command as string || '').substring(0, 80);
        return cmd + ((data.command as string || '').length > 80 ? '...' : '');
      case 'error':
        return `Error: ${(data.message as string || '').substring(0, 60)}`;
      default:
        return obs.tool;
    }
  }

  /**
   * Generate fallback summary without AI
   */
  private generateFallbackSummary(session: Session): string {
    const lines: string[] = [];

    lines.push(`This session lasted ${session.durationMinutes || 'unknown'} minutes.`);
    lines.push('');

    if (session.filesModified.length > 0) {
      lines.push(`**Files modified** (${session.filesModified.length}):`);
      for (const file of session.filesModified.slice(0, 5)) {
        lines.push(`- ${file}`);
      }
      if (session.filesModified.length > 5) {
        lines.push(`- ...and ${session.filesModified.length - 5} more`);
      }
      lines.push('');
    }

    if (session.commandsRun > 0) {
      lines.push(`**Commands run**: ${session.commandsRun}`);
    }

    if (session.errorsEncountered > 0) {
      lines.push(`**Errors encountered**: ${session.errorsEncountered}`);
    }

    return lines.join('\n');
  }

  /**
   * Generate fallback error summary without AI
   */
  private generateFallbackErrorSummary(error: Observation): string {
    const data = error.data as Record<string, unknown>;
    return `**${data.type || 'Error'}**: ${data.message || 'Unknown error'}\n\nFile: ${data.file || 'unknown'}`;
  }
}
