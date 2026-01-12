#!/usr/bin/env bun

/**
 * Background Summarization Script
 *
 * This script runs in the background (detached from the hook process) and uses
 * `claude -p` to generate AI summaries of conversation knowledge.
 *
 * Key design:
 * - Spawned by hooks with `detached: true` and `.unref()`
 * - Uses `claude -p` CLI (not Agent SDK) to avoid deadlock
 * - Writes extracted knowledge directly to the Obsidian vault
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { loadConfig } from '../../src/shared/config.js';
import { parseTranscript, extractQAPairs, extractWebResearch } from '../../src/services/transcript.js';
import { markBackgroundJobCompleted } from '../../src/shared/session-store.js';
import { VaultManager } from '../../src/mcp-server/utils/vault.js';
import { createLogger } from '../../src/shared/logger.js';

interface SummarizeInput {
  transcript_path: string;
  session_id: string;
  project_hint?: string; // Detected project (may be wrong, for reference only)
  trigger: 'pre-compact' | 'session-end';
  mem_folder: string;
}

interface KnowledgeResult {
  type: 'qa' | 'explanation' | 'decision' | 'research' | 'learning';
  title: string;
  context: string;
  summary: string;
  keyPoints: string[];
  topics: string[];
}

async function main() {
  // Parse input from command line argument (outside try for catch access)
  const inputArg = process.argv[2];
  if (!inputArg) {
    console.error('[background-summarize] ERROR: No input argument provided');
    process.exit(1);
  }

  let input: SummarizeInput;
  try {
    input = JSON.parse(inputArg);
  } catch (parseError) {
    console.error(`[background-summarize] ERROR: Failed to parse input: ${parseError}`);
    process.exit(1);
  }

  // Create logger with session ID
  const logger = createLogger('background-summarize', input.session_id);

  try {
    logger.info(`Starting background summarization for session ${input.session_id}`);

    const config = loadConfig();

    // Check if transcript exists
    if (!fs.existsSync(input.transcript_path)) {
      logger.error(`Transcript not found: ${input.transcript_path}`);
      if (input.trigger === 'pre-compact') markBackgroundJobCompleted(input.session_id);
      process.exit(1);
    }

    // Parse transcript
    const conversation = parseTranscript(input.transcript_path);
    if (conversation.turns.length === 0) {
      logger.info('No conversation turns found, exiting');
      if (input.trigger === 'pre-compact') markBackgroundJobCompleted(input.session_id);
      process.exit(0);
    }

    logger.info(`Parsed ${conversation.turns.length} conversation turns`);

    // Build context for AI summarization
    const qaPairs = extractQAPairs(conversation);
    const research = extractWebResearch(conversation);

    logger.info(`Found ${qaPairs.length} Q&A pairs, ${research.length} research items`);

    // Build context - will use conversation fallback if no Q&A or research
    const contextText = buildContextForSummarization(qaPairs, research, conversation);

    // Skip if context is too short for meaningful summarization
    if (contextText.length < 500) {
      logger.info('Context too short for meaningful summarization, skipping');
      if (input.trigger === 'pre-compact') markBackgroundJobCompleted(input.session_id);
      process.exit(0);
    }

    const timeout = config.summarization.timeout || 180000; // Default 3 minutes
    logger.info('Calling claude -p for AI summarization...');
    const knowledgeItems = await runClaudeP(contextText, config.summarization.model, timeout, logger);

    if (!knowledgeItems || knowledgeItems.length === 0) {
      logger.info('AI summarization failed or returned empty - no pending items created');
      if (input.trigger === 'pre-compact') markBackgroundJobCompleted(input.session_id);
      process.exit(0);
    }

    logger.info(`AI extracted ${knowledgeItems.length} knowledge items`);

    // Write knowledge directly to vault (skip if no project detected)
    if (!input.project_hint) {
      logger.error('No project detected, skipping knowledge write to vault');
    } else {
      try {
        const VALID_TYPES = ['qa', 'explanation', 'decision', 'research', 'learning'];

        // Filter and map valid items (with type guards for malformed AI output)
        const validItems: Array<{
          type: 'qa' | 'explanation' | 'decision' | 'research' | 'learning';
          title: string;
          context: string;
          content: string;
          keyPoints: string[];
          topics: string[];
          sourceSession: string;
        }> = [];

        for (const item of knowledgeItems) {
          const typeStr = typeof item.type === 'string' ? item.type.trim().toLowerCase() : '';
          const titleStr = typeof item.title === 'string' ? item.title : '';
          const summaryStr = typeof item.summary === 'string' ? item.summary : '';
          const hasRequiredFields = typeStr && titleStr && summaryStr;
          const hasValidType = VALID_TYPES.includes(typeStr);

          if (!hasRequiredFields || !hasValidType) {
            logger.debug(`Skipping invalid AI item: type=${String(item.type).substring(0, 20)}, title=${String(item.title).substring(0, 30)}`);
            continue;
          }

          // Filter arrays to only string items to prevent writeKnowledge failures
          const keyPoints = Array.isArray(item.keyPoints)
            ? item.keyPoints.filter((k: unknown) => typeof k === 'string')
            : [];
          const topics = Array.isArray(item.topics)
            ? item.topics.filter((t: unknown) => typeof t === 'string')
            : [];

          validItems.push({
            type: typeStr as 'qa' | 'explanation' | 'decision' | 'research' | 'learning',
            title: titleStr,
            context: typeof item.context === 'string' ? item.context : '',
            content: summaryStr,
            keyPoints,
            topics,
            sourceSession: input.session_id,
          });
        }

        if (validItems.length === 0) {
          logger.info('No valid knowledge items to write');
        } else {
          const vault = new VaultManager(config.vault.path, config.vault.memFolder);
          const paths = await vault.writeKnowledgeBatch(validItems, input.project_hint);
          logger.info(`Wrote ${paths.length}/${validItems.length} knowledge notes to vault`);
        }
      } catch (error) {
        logger.error(`Failed to write knowledge to vault`, error instanceof Error ? error : undefined);
      }
    }

    // Mark background job as completed (so session-end doesn't wait)
    if (input.trigger === 'pre-compact') {
      markBackgroundJobCompleted(input.session_id);
      logger.debug('Marked background job as completed');
    }

    logger.info('Background summarization complete');

  } catch (error) {
    logger.error(`FATAL ERROR in background summarization`, error instanceof Error ? error : undefined);
    // Still mark as completed on error so session-end doesn't wait forever
    if (input?.trigger === 'pre-compact' && input?.session_id) {
      markBackgroundJobCompleted(input.session_id);
    }
    process.exit(1);
  }
}

/**
 * Build context text for AI summarization
 */
function buildContextForSummarization(
  qaPairs: Array<{ question: string; answer: string }>,
  research: Array<{ tool: string; query?: string; url?: string; content: string }>,
  conversation: { turns: Array<{ role: string; text: string }> }
): string {
  const sections: string[] = [];

  // Add Q&A pairs
  if (qaPairs.length > 0) {
    sections.push('## Q&A Exchanges\n');
    for (const qa of qaPairs.slice(0, 10)) {
      sections.push(`Q: ${qa.question.substring(0, 500)}`);
      sections.push(`A: ${qa.answer.substring(0, 1000)}\n`);
    }
  }

  // Add research
  if (research.length > 0) {
    sections.push('## Web Research\n');
    for (const r of research.slice(0, 5)) {
      sections.push(`Source: ${r.url || r.tool}`);
      sections.push(`Query: ${r.query || 'N/A'}`);
      sections.push(`Content: ${r.content.substring(0, 500)}\n`);
    }
  }

  // Add conversation summary if no structured content
  if (sections.length === 0) {
    sections.push('## Conversation\n');
    for (const turn of conversation.turns.slice(0, 20)) {
      const prefix = turn.role === 'user' ? 'User' : 'Assistant';
      sections.push(`${prefix}: ${turn.text.substring(0, 500)}\n`);
    }
  }

  return sections.join('\n').substring(0, 25000);
}

/**
 * Run claude -p to extract knowledge
 */
async function runClaudeP(
  contextText: string,
  model: string,
  timeout: number,
  logger: ReturnType<typeof createLogger>
): Promise<KnowledgeResult[] | null> {
  const prompt = `You are analyzing a coding session conversation to extract valuable knowledge for future reference.

${contextText}

Extract knowledge items from this conversation. Focus on:
1. **qa** - Questions asked and answers provided
2. **explanation** - Concepts or approaches explained
3. **decision** - Technical choices made with rationale
4. **research** - Information gathered from web/docs
5. **learning** - Tips, patterns, gotchas discovered

For each item, provide:
- type: one of qa, explanation, decision, research, learning
- title: concise title (5-10 words)
- context: when this knowledge is useful (1 sentence)
- summary: key information (max 100 words)
- keyPoints: array of actionable points (2-5 items)
- topics: array of relevant topic tags (2-5 items)

Return a JSON array. Only include genuinely useful items worth remembering.
If nothing significant to extract, return an empty array [].

Respond with ONLY valid JSON, no markdown code blocks, no explanation.`;

  return new Promise((resolve) => {
    const proc = spawn('claude', [
      '-p',
      '--model', model || 'haiku',
      '--output-format', 'text',
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Send prompt via stdin
    proc.stdin.write(prompt);
    proc.stdin.end();

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    // Timeout (cleared on completion)
    const timeoutId = setTimeout(() => {
      proc.kill();
      logger.error(`claude -p timed out after ${timeout / 1000} seconds`);
      resolve(null);
    }, timeout);

    proc.on('close', (code) => {
      // Clear timeout since process completed
      clearTimeout(timeoutId);

      if (code !== 0) {
        logger.error(`claude -p exited with code ${code}`);
        // Pass raw output through context for proper sanitization
        logger.debug('stderr', { stderr: stderr || '(empty)' });
        logger.debug('stdout (first 500)', { stdout: stdout.substring(0, 500) || '(empty)' });
        resolve(null);
        return;
      }

      try {
        // Try to parse JSON from output
        const trimmed = stdout.trim();

        // Handle potential markdown code blocks
        let jsonStr = trimmed;
        const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          jsonStr = jsonMatch[1].trim();
        }

        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed)) {
          resolve(parsed as KnowledgeResult[]);
        } else {
          logger.error(`Unexpected response format: ${typeof parsed}`);
          resolve(null);
        }
      } catch (error) {
        // Pass raw output through context for proper sanitization
        logger.error(`Failed to parse claude -p output`, error instanceof Error ? error : undefined);
        logger.debug('Raw output (first 500)', { stdout: stdout.substring(0, 500) });
        resolve(null);
      }
    });

    proc.on('error', (error) => {
      clearTimeout(timeoutId);
      logger.error(`Failed to spawn claude -p: ${error}`);
      resolve(null);
    });
  });
}

main();
