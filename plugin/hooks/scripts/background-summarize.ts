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

// Log file for debugging background script issues (cross-platform)
const LOG_FILE = path.join(os.tmpdir(), 'cc-obsidian-mem-background.log');

function log(message: string) {
  try {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    // Silently fail if logging fails (e.g., permission issues)
  }
}

async function main() {
  // Parse input from command line argument (outside try for catch access)
  const inputArg = process.argv[2];
  if (!inputArg) {
    log('ERROR: No input argument provided');
    process.exit(1);
  }

  let input: SummarizeInput;
  try {
    input = JSON.parse(inputArg);
  } catch (parseError) {
    log(`ERROR: Failed to parse input: ${parseError}`);
    process.exit(1);
  }

  try {
    log(`Starting background summarization for session ${input.session_id}`);

    const config = loadConfig();

    // Check if transcript exists
    if (!fs.existsSync(input.transcript_path)) {
      log(`ERROR: Transcript not found: ${input.transcript_path}`);
      if (input.trigger === 'pre-compact') markBackgroundJobCompleted(input.session_id);
      process.exit(1);
    }

    // Parse transcript
    const conversation = parseTranscript(input.transcript_path);
    if (conversation.turns.length === 0) {
      log('No conversation turns found, exiting');
      if (input.trigger === 'pre-compact') markBackgroundJobCompleted(input.session_id);
      process.exit(0);
    }

    log(`Parsed ${conversation.turns.length} conversation turns`);

    // Build context for AI summarization
    const qaPairs = extractQAPairs(conversation);
    const research = extractWebResearch(conversation);

    log(`Found ${qaPairs.length} Q&A pairs, ${research.length} research items`);

    // Build context - will use conversation fallback if no Q&A or research
    const contextText = buildContextForSummarization(qaPairs, research, conversation);

    // Skip if context is too short for meaningful summarization
    if (contextText.length < 500) {
      log('Context too short for meaningful summarization, skipping');
      if (input.trigger === 'pre-compact') markBackgroundJobCompleted(input.session_id);
      process.exit(0);
    }

    log('Calling claude -p for AI summarization...');
    const knowledgeItems = await runClaudeP(contextText, config.summarization.model);

    if (!knowledgeItems || knowledgeItems.length === 0) {
      log('AI summarization failed or returned empty - no pending items created');
      if (input.trigger === 'pre-compact') markBackgroundJobCompleted(input.session_id);
      process.exit(0);
    }

    log(`AI extracted ${knowledgeItems.length} knowledge items`);

    // Write knowledge directly to vault (skip if no project detected)
    if (!input.project_hint) {
      log('WARNING: No project detected, skipping knowledge write to vault');
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
            log(`Skipping invalid AI item: type=${String(item.type).substring(0, 20)}, title=${String(item.title).substring(0, 30)}`);
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
          log('No valid knowledge items to write');
        } else {
          const vault = new VaultManager(config.vault.path, config.vault.memFolder);
          const paths = await vault.writeKnowledgeBatch(validItems, input.project_hint);
          log(`Wrote ${paths.length}/${validItems.length} knowledge notes to vault`);
        }
      } catch (error) {
        log(`ERROR: Failed to write knowledge to vault: ${error}`);
      }
    }

    // Mark background job as completed (so session-end doesn't wait)
    if (input.trigger === 'pre-compact') {
      markBackgroundJobCompleted(input.session_id);
      log('Marked background job as completed');
    }

    log('Background summarization complete');

  } catch (error) {
    log(`FATAL ERROR: ${error}`);
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
  model: string
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
    // Write prompt to temp file to avoid shell escaping issues (cross-platform)
    const promptFile = path.join(os.tmpdir(), `claude-prompt-${Date.now()}.txt`);
    fs.writeFileSync(promptFile, prompt);

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

    proc.on('close', (code) => {
      // Clean up temp file
      try { fs.unlinkSync(promptFile); } catch {}

      if (code !== 0) {
        log(`claude -p exited with code ${code}`);
        log(`stderr: ${stderr || '(empty)'}`);
        log(`stdout (first 500): ${stdout.substring(0, 500) || '(empty)'}`);
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
          log(`Unexpected response format: ${typeof parsed}`);
          resolve(null);
        }
      } catch (error) {
        log(`Failed to parse claude -p output: ${error}\nOutput: ${stdout.substring(0, 500)}`);
        resolve(null);
      }
    });

    proc.on('error', (error) => {
      log(`Failed to spawn claude -p: ${error}`);
      resolve(null);
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      proc.kill();
      log('claude -p timed out after 2 minutes');
      resolve(null);
    }, 120000);
  });
}

main();
