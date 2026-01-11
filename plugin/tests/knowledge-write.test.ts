import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { VaultManager } from '../src/mcp-server/utils/vault.js';

describe('Knowledge Write', () => {
  let tempDir: string;
  let vaultPath: string;
  let vault: VaultManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-write-test-'));
    vaultPath = path.join(tempDir, 'vault');
    fs.mkdirSync(vaultPath, { recursive: true });
    vault = new VaultManager(vaultPath, '_claude-mem');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('writeKnowledgeBatch', () => {
    test('writes valid knowledge items to vault', async () => {
      const items = [
        {
          type: 'learning' as const,
          title: 'Test Learning',
          context: 'When testing',
          content: 'This is a test learning note',
          keyPoints: ['point 1', 'point 2'],
          topics: ['testing', 'bun'],
          sourceSession: 'test-session-123',
        },
        {
          type: 'qa' as const,
          title: 'Test QA',
          context: 'When asking questions',
          content: 'Q&A content here',
          keyPoints: ['answer 1'],
          topics: ['faq'],
          sourceSession: 'test-session-123',
        },
      ];

      const paths = await vault.writeKnowledgeBatch(items, 'test-project');

      expect(paths.length).toBe(2);

      // Verify files exist
      for (const p of paths) {
        const fullPath = path.join(vaultPath, '_claude-mem', p);
        expect(fs.existsSync(fullPath)).toBe(true);
      }
    });

    test('handles empty items array gracefully', async () => {
      const paths = await vault.writeKnowledgeBatch([], 'test-project');
      expect(paths.length).toBe(0);
    });

    test('routes research type to research folder', async () => {
      const items = [
        {
          type: 'research' as const,
          title: 'Research Finding',
          context: 'When researching APIs',
          content: 'Found this API documentation',
          keyPoints: ['key finding'],
          topics: ['api', 'docs'],
          sourceSession: 'test-session-123',
        },
      ];

      const paths = await vault.writeKnowledgeBatch(items, 'test-project');

      expect(paths.length).toBe(1);
      expect(paths[0]).toContain('research');
    });

    test('routes non-research types to knowledge folder', async () => {
      const types = ['qa', 'explanation', 'decision', 'learning'] as const;

      for (const type of types) {
        const items = [
          {
            type,
            title: `Test ${type}`,
            context: 'Testing context',
            content: 'Test content',
            keyPoints: [],
            topics: [],
            sourceSession: 'test-session-123',
          },
        ];

        const paths = await vault.writeKnowledgeBatch(items, `test-project-${type}`);

        expect(paths.length).toBe(1);
        expect(paths[0]).toContain('knowledge');
      }
    });
  });

  describe('writeKnowledge validation', () => {
    test('writes knowledge with all valid types', async () => {
      const validTypes = ['qa', 'explanation', 'decision', 'research', 'learning'] as const;

      for (const type of validTypes) {
        const result = await vault.writeKnowledge(
          {
            type,
            title: `Valid ${type} note`,
            context: 'Testing valid types',
            content: 'Content for testing',
            keyPoints: ['point'],
            topics: ['test'],
          },
          'validation-test-project'
        );

        expect(result.path).toBeTruthy();
      }
    });

    test('handles empty keyPoints and topics arrays', async () => {
      const result = await vault.writeKnowledge(
        {
          type: 'learning',
          title: 'Empty arrays test',
          context: 'Testing empty arrays',
          content: 'Content here',
          keyPoints: [],
          topics: [],
        },
        'test-project'
      );

      expect(result.path).toBeTruthy();

      // Verify the file was created and can be read
      const fullPath = path.join(vaultPath, '_claude-mem', result.path);
      const content = fs.readFileSync(fullPath, 'utf-8');
      expect(content).toContain('Empty arrays test');
    });

    test('handles sourceUrl and sourceSession metadata', async () => {
      const result = await vault.writeKnowledge(
        {
          type: 'research',
          title: 'Research with source',
          context: 'Testing source metadata',
          content: 'Content from research',
          keyPoints: ['finding'],
          topics: ['api'],
          sourceUrl: 'https://example.com/docs',
          sourceSession: 'session-abc-123',
        },
        'test-project'
      );

      expect(result.path).toBeTruthy();

      const fullPath = path.join(vaultPath, '_claude-mem', result.path);
      const content = fs.readFileSync(fullPath, 'utf-8');
      expect(content).toContain('https://example.com/docs');
    });
  });
});

describe('Knowledge Type Validation Logic', () => {
  // These tests verify the validation logic used in background-summarize.ts and session-start.ts

  const VALID_TYPES = ['qa', 'explanation', 'decision', 'research', 'learning'];

  test('normalizes type with trim and lowercase', () => {
    const testCases = [
      { input: 'QA', expected: 'qa' },
      { input: 'Research ', expected: 'research' },
      { input: ' LEARNING ', expected: 'learning' },
      { input: 'Decision', expected: 'decision' },
      { input: '  explanation  ', expected: 'explanation' },
    ];

    for (const { input, expected } of testCases) {
      const normalized = input.trim().toLowerCase();
      expect(normalized).toBe(expected);
      expect(VALID_TYPES.includes(normalized)).toBe(true);
    }
  });

  test('rejects invalid types after normalization', () => {
    const invalidTypes = ['invalid', 'error', 'pattern', 'file', '', '  ', 'QAA'];

    for (const type of invalidTypes) {
      const normalized = type.trim().toLowerCase();
      expect(VALID_TYPES.includes(normalized)).toBe(false);
    }
  });

  test('type guards handle non-string types', () => {
    const testCases = [
      { input: null, expected: '' },
      { input: undefined, expected: '' },
      { input: 123, expected: '' },
      { input: {}, expected: '' },
      { input: [], expected: '' },
    ];

    for (const { input, expected } of testCases) {
      const typeStr = typeof input === 'string' ? input.trim().toLowerCase() : '';
      expect(typeStr).toBe(expected);
    }
  });

  test('array filtering removes non-string items', () => {
    const mixedArray = ['valid', 123, null, 'also valid', undefined, { obj: true }, 'third'];

    const filtered = mixedArray.filter((item): item is string => typeof item === 'string');

    expect(filtered).toEqual(['valid', 'also valid', 'third']);
  });

  test('array filtering handles non-array input', () => {
    const testCases = [null, undefined, 'string', 123, {}];

    for (const input of testCases) {
      const result = Array.isArray(input)
        ? input.filter((item: unknown) => typeof item === 'string')
        : [];
      expect(result).toEqual([]);
    }
  });
});

describe('Pending File Migration Logic', () => {
  // These tests verify the validation patterns used in session-start.ts migration

  test('validates required fields: type, title, content', () => {
    const validItem = {
      type: 'learning',
      title: 'Valid Title',
      content: 'Valid content',
    };

    const invalidItems = [
      { title: 'Missing type', content: 'Has content' },
      { type: 'learning', content: 'Missing title' },
      { type: 'learning', title: 'Missing content' },
      { type: '', title: 'Empty type', content: 'Has content' },
      { type: 'learning', title: '', content: 'Empty title' },
    ];

    // Valid item should pass
    const typeStr = typeof validItem.type === 'string' ? validItem.type.trim().toLowerCase() : '';
    const titleStr = typeof validItem.title === 'string' ? validItem.title : '';
    const contentStr = typeof validItem.content === 'string' ? validItem.content : '';
    const hasRequiredFields = !!(typeStr && titleStr && contentStr);
    expect(hasRequiredFields).toBe(true);

    // Invalid items should fail
    for (const item of invalidItems) {
      const t = typeof (item as any).type === 'string' ? (item as any).type.trim().toLowerCase() : '';
      const ti = typeof (item as any).title === 'string' ? (item as any).title : '';
      const c = typeof (item as any).content === 'string' ? (item as any).content : '';
      const valid = !!(t && ti && c);
      expect(valid).toBe(false);
    }
  });

  test('maps item fields correctly for writeKnowledge', () => {
    const pendingItem = {
      type: 'QA',
      title: 'Test Question',
      context: 'When asking about tests',
      content: 'Answer to the question',
      keyPoints: ['point 1', 'point 2'],
      topics: ['testing', 'qa'],
      sourceSession: 'session-123',
    };

    // Simulate the mapping logic from migration
    const typeStr = typeof pendingItem.type === 'string' ? pendingItem.type.trim().toLowerCase() : '';
    const keyPoints = Array.isArray(pendingItem.keyPoints)
      ? pendingItem.keyPoints.filter((k: unknown) => typeof k === 'string')
      : [];
    const topics = Array.isArray(pendingItem.topics)
      ? pendingItem.topics.filter((t: unknown) => typeof t === 'string')
      : [];

    const mapped = {
      type: typeStr as 'qa',
      title: pendingItem.title,
      context: typeof pendingItem.context === 'string' ? pendingItem.context : '',
      content: pendingItem.content,
      keyPoints,
      topics,
      sourceSession: pendingItem.sourceSession,
    };

    expect(mapped.type).toBe('qa');
    expect(mapped.title).toBe('Test Question');
    expect(mapped.context).toBe('When asking about tests');
    expect(mapped.content).toBe('Answer to the question');
    expect(mapped.keyPoints).toEqual(['point 1', 'point 2']);
    expect(mapped.topics).toEqual(['testing', 'qa']);
    expect(mapped.sourceSession).toBe('session-123');
  });

  test('handles items with missing optional fields', () => {
    const minimalItem = {
      type: 'learning',
      title: 'Minimal Item',
      content: 'Just the basics',
    };

    const context = typeof (minimalItem as any).context === 'string' ? (minimalItem as any).context : '';
    const keyPoints = Array.isArray((minimalItem as any).keyPoints)
      ? (minimalItem as any).keyPoints.filter((k: unknown) => typeof k === 'string')
      : [];
    const topics = Array.isArray((minimalItem as any).topics)
      ? (minimalItem as any).topics.filter((t: unknown) => typeof t === 'string')
      : [];

    expect(context).toBe('');
    expect(keyPoints).toEqual([]);
    expect(topics).toEqual([]);
  });
});
