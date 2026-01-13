/**
 * Transcript parser service
 *
 * Parses Claude Code JSONL transcript files to extract conversation content
 */

import * as fs from 'fs';

/**
 * Message content block types
 */
interface TextContent {
  type: 'text';
  text: string;
}

interface ToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  content: string | Array<{ type: string; text?: string }>;
  is_error?: boolean;
}

interface ThinkingContent {
  type: 'thinking';
  thinking: string;
}

type MessageContent = TextContent | ToolUseContent | ToolResultContent | ThinkingContent;

/**
 * Transcript entry types
 */
interface TranscriptMessage {
  type: 'user' | 'assistant';
  message: {
    role: string;
    content: MessageContent[] | string;
  };
  timestamp?: string;
  uuid?: string;
  sessionId?: string;
}

interface TranscriptSummary {
  type: 'summary';
  summary: string;
  leafUuid: string;
}

type TranscriptEntry = TranscriptMessage | TranscriptSummary | Record<string, unknown>;

/**
 * Parsed conversation turn
 */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  timestamp?: string;
  uuid?: string;
  text: string;
  toolCalls?: Array<{
    name: string;
    input: Record<string, unknown>;
    output?: string;
    isError?: boolean;
  }>;
}

/**
 * Extracted conversation for knowledge extraction
 */
export interface ParsedConversation {
  turns: ConversationTurn[];
  summary?: string;
  leafUuid?: string;
}

/**
 * Read and parse a transcript file
 */
export function parseTranscript(transcriptPath: string): ParsedConversation {
  if (!fs.existsSync(transcriptPath)) {
    return { turns: [] };
  }

  const content = fs.readFileSync(transcriptPath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  const turns: ConversationTurn[] = [];
  let summary: string | undefined;
  let leafUuid: string | undefined;

  // Map to store tool results by tool_use_id
  const toolResults = new Map<string, { content: string; isError: boolean }>();

  // First pass: collect all tool results
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as TranscriptEntry;

      if (entry.type === 'user') {
        const msg = entry as TranscriptMessage;
        const contentArray = Array.isArray(msg.message.content)
          ? msg.message.content
          : [];

        for (const block of contentArray) {
          if (block.type === 'tool_result') {
            const toolResult = block as ToolResultContent;
            let resultText = '';

            if (typeof toolResult.content === 'string') {
              resultText = toolResult.content;
            } else if (Array.isArray(toolResult.content)) {
              resultText = toolResult.content
                .filter(c => c.type === 'text' && c.text)
                .map(c => c.text)
                .join('\n');
            }

            toolResults.set(toolResult.tool_use_id, {
              content: resultText.substring(0, 2000), // Truncate
              isError: toolResult.is_error || false,
            });
          }
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  // Second pass: build conversation turns
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as TranscriptEntry;

      if (entry.type === 'summary') {
        const summaryEntry = entry as TranscriptSummary;
        summary = summaryEntry.summary;
        // Support both camelCase and snake_case for schema compatibility
        leafUuid = summaryEntry.leafUuid ?? (summaryEntry as Record<string, unknown>).leaf_uuid as string | undefined;
        continue;
      }

      if (entry.type !== 'user' && entry.type !== 'assistant') {
        continue;
      }

      const msg = entry as TranscriptMessage;
      const contentArray = Array.isArray(msg.message.content)
        ? msg.message.content
        : typeof msg.message.content === 'string'
          ? [{ type: 'text', text: msg.message.content } as TextContent]
          : [];

      // Extract text content (skip thinking, tool_result blocks)
      const textBlocks: string[] = [];
      const toolCalls: ConversationTurn['toolCalls'] = [];

      for (const block of contentArray) {
        if (block.type === 'text') {
          const text = (block as TextContent).text;
          // Skip tool_result placeholder text
          if (!text.startsWith('[Request interrupted') && text.trim()) {
            textBlocks.push(text);
          }
        } else if (block.type === 'tool_use') {
          const toolUse = block as ToolUseContent;
          const result = toolResults.get(toolUse.id);
          toolCalls.push({
            name: toolUse.name,
            input: toolUse.input,
            output: result?.content,
            isError: result?.isError,
          });
        }
        // Skip 'thinking' and 'tool_result' blocks
      }

      // Only add turns that have meaningful content
      const text = textBlocks.join('\n').trim();
      if (text || (msg.type === 'assistant' && toolCalls.length > 0)) {
        turns.push({
          role: msg.type,
          timestamp: msg.timestamp,
          uuid: msg.uuid,
          text,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        });
      }
    } catch {
      // Skip malformed lines
    }
  }

  return { turns, summary, leafUuid };
}

/**
 * Extract user questions from conversation
 */
export function extractUserQuestions(conversation: ParsedConversation): string[] {
  const questions: string[] = [];

  for (const turn of conversation.turns) {
    if (turn.role === 'user' && turn.text) {
      // Skip tool results (they're captured separately)
      const text = turn.text.trim();
      if (text && !text.startsWith('<') && text.length > 10) {
        questions.push(text);
      }
    }
  }

  return questions;
}

/**
 * Extract assistant explanations from conversation
 */
export function extractAssistantResponses(conversation: ParsedConversation): string[] {
  const responses: string[] = [];

  for (const turn of conversation.turns) {
    if (turn.role === 'assistant' && turn.text) {
      // Skip very short responses (likely just acknowledgments)
      if (turn.text.length > 50) {
        responses.push(turn.text);
      }
    }
  }

  return responses;
}

/**
 * Extract Q&A pairs from conversation
 */
export function extractQAPairs(
  conversation: ParsedConversation
): Array<{ question: string; answer: string }> {
  const pairs: Array<{ question: string; answer: string }> = [];

  for (let i = 0; i < conversation.turns.length - 1; i++) {
    const current = conversation.turns[i];
    const next = conversation.turns[i + 1];

    // Look for user question followed by assistant response
    if (
      current.role === 'user' &&
      current.text &&
      current.text.length > 10 &&
      next.role === 'assistant' &&
      next.text &&
      next.text.length > 50
    ) {
      pairs.push({
        question: current.text,
        answer: next.text,
      });
    }
  }

  return pairs;
}

/**
 * Extract web research from tool calls
 */
export function extractWebResearch(
  conversation: ParsedConversation
): Array<{ tool: string; query?: string; url?: string; content: string }> {
  const research: Array<{ tool: string; query?: string; url?: string; content: string }> = [];

  for (const turn of conversation.turns) {
    if (turn.role === 'assistant' && turn.toolCalls) {
      for (const tool of turn.toolCalls) {
        // WebFetch
        if (tool.name === 'WebFetch' && tool.output) {
          research.push({
            tool: 'WebFetch',
            url: tool.input.url as string,
            query: tool.input.prompt as string,
            content: tool.output,
          });
        }

        // WebSearch
        if (tool.name === 'WebSearch' && tool.output) {
          research.push({
            tool: 'WebSearch',
            query: tool.input.query as string,
            content: tool.output,
          });
        }

        // Context7 docs
        if (tool.name.startsWith('mcp__') && tool.name.includes('context7') && tool.output) {
          research.push({
            tool: 'Context7',
            query: tool.input.query as string || tool.input.libraryName as string,
            content: tool.output,
          });
        }
      }
    }
  }

  return research;
}

/**
 * Get conversation text for AI analysis (filtered and truncated)
 */
export function getConversationForAnalysis(
  conversation: ParsedConversation,
  maxLength: number = 30000
): string {
  const lines: string[] = [];
  let totalLength = 0;

  for (const turn of conversation.turns) {
    if (totalLength >= maxLength) break;

    const prefix = turn.role === 'user' ? 'User: ' : 'Assistant: ';
    const text = turn.text.substring(0, 2000); // Truncate long messages

    if (text) {
      const line = `${prefix}${text}`;
      if (totalLength + line.length <= maxLength) {
        lines.push(line);
        totalLength += line.length;
      }
    }

    // Include significant tool calls (web research)
    if (turn.toolCalls) {
      for (const tool of turn.toolCalls) {
        if (['WebFetch', 'WebSearch'].includes(tool.name) || tool.name.includes('context7')) {
          const toolLine = `[Tool: ${tool.name}] ${JSON.stringify(tool.input).substring(0, 200)}`;
          if (totalLength + toolLine.length <= maxLength) {
            lines.push(toolLine);
            totalLength += toolLine.length;
          }
        }
      }
    }
  }

  return lines.join('\n\n');
}
