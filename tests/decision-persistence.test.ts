import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Hono } from 'hono';
import { createServer } from '../src/worker/server.js';
import type { Config, Session } from '../src/shared/types.js';

/**
 * Create a valid test config with the given vault path and overrides
 */
function createTestConfig(vaultPath: string, overrides?: Partial<Config>): Config {
  const baseConfig: Config = {
    vault: {
      path: vaultPath,
      memFolder: '_claude-mem',
    },
    worker: {
      port: 0,
      autoStart: false,
    },
    capture: {
      fileEdits: true,
      bashCommands: true,
      errors: true,
      decisions: true,
      bashOutput: {
        enabled: true,
        maxLength: 5000,
      },
    },
    contextInjection: {
      enabled: true,
      maxTokens: 4000,
      includeRecentSessions: 3,
      includeRelatedErrors: true,
      includeProjectPatterns: true,
    },
    summarization: {
      enabled: false,
      model: 'claude-sonnet-4-5-20250514',
      apiKeyEnvVar: 'ANTHROPIC_API_KEY',
      sessionSummary: false,
      errorSummary: false,
    },
  };

  if (overrides) {
    return {
      ...baseConfig,
      ...overrides,
      capture: { ...baseConfig.capture, ...overrides.capture },
      summarization: { ...baseConfig.summarization, ...overrides.summarization },
    };
  }

  return baseConfig;
}

describe('Decision Persistence', () => {
  let tempDir: string;
  let vaultPath: string;
  let app: Hono;
  let config: Config;

  beforeEach(() => {
    // Create a temporary directory structure
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-test-'));
    vaultPath = path.join(tempDir, 'vault');
    fs.mkdirSync(vaultPath, { recursive: true });
    fs.mkdirSync(path.join(vaultPath, '_claude-mem', 'projects', 'test-project', 'decisions'), {
      recursive: true,
    });

    config = createTestConfig(vaultPath);
    app = createServer(config);
  });

  afterEach(() => {
    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('decision persistence endpoint exists and responds', async () => {
    const testSessionId = 'test-session-' + Date.now();

    // Start a session first
    const startRes = await app.request('/session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: testSessionId,
        project: 'test-project',
        projectPath: '/test/path',
        startTime: new Date().toISOString(),
      }),
    });

    expect(startRes.status).toBe(200);
    const startData = await startRes.json();
    expect(startData.success).toBe(true);
    expect(startData.sessionId).toBe(testSessionId);

    // Try to summarize (will not have AI but endpoint should work)
    const summarizeRes = await app.request('/session/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: testSessionId }),
    });

    expect(summarizeRes.status).toBe(200);
  });

  test('decision notes are persisted with correct structure', async () => {
    // This test verifies the note structure when decisions are written
    const { VaultManager } = await import('../src/mcp-server/utils/vault.js');
    const vault = new VaultManager(vaultPath, '_claude-mem');

    // Write a decision note directly to verify structure
    const result = await vault.writeNote({
      type: 'decision',
      title: 'Use TypeScript for the project',
      content: `## Context

The team needs to choose a programming language for the new service.

## Decision

We will use TypeScript for better type safety and developer experience.

## Session

This decision was made during session \`abc12345\` on 2024-01-15.
`,
      project: 'test-project',
      tags: ['decision', 'auto-extracted'],
    });

    expect(result.created).toBe(true);
    expect(result.path).toContain('decisions');

    // Verify the file was created
    const decisionDir = path.join(
      vaultPath,
      '_claude-mem',
      'projects',
      'test-project',
      'decisions'
    );
    const files = fs.readdirSync(decisionDir);
    expect(files.length).toBeGreaterThan(0);

    // Read the file and verify structure
    const noteContent = fs.readFileSync(path.join(decisionDir, files[0]), 'utf-8');
    expect(noteContent).toContain('type: decision');
    expect(noteContent).toContain('Use TypeScript for the project');
    expect(noteContent).toContain('## Context');
    expect(noteContent).toContain('## Decision');
    expect(noteContent).toContain('## Session');
    expect(noteContent).toContain('decision');
    expect(noteContent).toContain('auto-extracted');
  });

  test('decision frontmatter includes required fields', async () => {
    const { VaultManager } = await import('../src/mcp-server/utils/vault.js');
    const vault = new VaultManager(vaultPath, '_claude-mem');

    await vault.writeNote({
      type: 'decision',
      title: 'API Design Choice',
      content: 'Use REST over GraphQL for simplicity.',
      project: 'test-project',
      tags: ['decision', 'api'],
    });

    const decisionDir = path.join(
      vaultPath,
      '_claude-mem',
      'projects',
      'test-project',
      'decisions'
    );
    const files = fs.readdirSync(decisionDir);
    const noteContent = fs.readFileSync(path.join(decisionDir, files[0]), 'utf-8');

    // Check frontmatter fields
    expect(noteContent).toContain('type: decision');
    expect(noteContent).toContain('title:');
    expect(noteContent).toContain('project: test-project');
    expect(noteContent).toContain('created:');
    expect(noteContent).toContain('updated:');
    expect(noteContent).toContain('tags:');
  });

  test('multiple decisions are persisted separately', async () => {
    const { VaultManager } = await import('../src/mcp-server/utils/vault.js');
    const vault = new VaultManager(vaultPath, '_claude-mem');

    // Write multiple decisions
    await vault.writeNote({
      type: 'decision',
      title: 'Decision One',
      content: 'First decision content.',
      project: 'test-project',
    });

    await vault.writeNote({
      type: 'decision',
      title: 'Decision Two',
      content: 'Second decision content.',
      project: 'test-project',
    });

    await vault.writeNote({
      type: 'decision',
      title: 'Decision Three',
      content: 'Third decision content.',
      project: 'test-project',
    });

    const decisionDir = path.join(
      vaultPath,
      '_claude-mem',
      'projects',
      'test-project',
      'decisions'
    );
    const files = fs.readdirSync(decisionDir);

    // Each decision should create a separate file
    expect(files.length).toBe(3);

    // Verify each has unique content
    const contents = files.map((f) => fs.readFileSync(path.join(decisionDir, f), 'utf-8'));
    expect(contents.some((c) => c.includes('Decision One'))).toBe(true);
    expect(contents.some((c) => c.includes('Decision Two'))).toBe(true);
    expect(contents.some((c) => c.includes('Decision Three'))).toBe(true);
  });

  test('decisions are tagged with project', async () => {
    const { VaultManager } = await import('../src/mcp-server/utils/vault.js');
    const vault = new VaultManager(vaultPath, '_claude-mem');

    await vault.writeNote({
      type: 'decision',
      title: 'Project-Specific Decision',
      content: 'This decision is for a specific project.',
      project: 'my-special-project',
    });

    const decisionDir = path.join(
      vaultPath,
      '_claude-mem',
      'projects',
      'my-special-project',
      'decisions'
    );

    expect(fs.existsSync(decisionDir)).toBe(true);
    const files = fs.readdirSync(decisionDir);
    expect(files.length).toBe(1);

    const content = fs.readFileSync(path.join(decisionDir, files[0]), 'utf-8');
    expect(content).toContain('project: my-special-project');
    expect(content).toContain('project/my-special-project');
  });
});

describe('Decision Extraction Response Format', () => {
  test('summarize endpoint returns decisions array', async () => {
    // Create temp setup
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-resp-test-'));
    const vaultPath = path.join(tempDir, 'vault');
    fs.mkdirSync(path.join(vaultPath, '_claude-mem'), { recursive: true });

    const config = createTestConfig(vaultPath);
    const app = createServer(config);

    const testSessionId = 'test-session-resp-' + Date.now();

    // Start a session
    const startRes = await app.request('/session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: testSessionId,
        project: 'test-project',
        projectPath: '/test',
        startTime: new Date().toISOString(),
      }),
    });

    expect(startRes.status).toBe(200);

    // Summarize the session
    const summarizeRes = await app.request('/session/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: testSessionId }),
    });

    const data = await summarizeRes.json();

    // Response should include decisions array and count
    expect(data).toHaveProperty('decisions');
    expect(data).toHaveProperty('decisionsCount');
    expect(Array.isArray(data.decisions)).toBe(true);
    expect(typeof data.decisionsCount).toBe('number');

    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

describe('Config.capture.decisions Flag', () => {
  test('decisions config flag exists in type', () => {
    // Verify the type includes decisions flag
    const config: Partial<Config> = {
      capture: {
        fileEdits: true,
        bashCommands: true,
        errors: true,
        decisions: false, // This should compile
        bashOutput: { enabled: true, maxLength: 5000 },
      },
    };

    expect(config.capture?.decisions).toBe(false);
  });

  test('decisions are not extracted when disabled', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-disabled-test-'));
    const vaultPath = path.join(tempDir, 'vault');
    fs.mkdirSync(path.join(vaultPath, '_claude-mem'), { recursive: true });

    // Config with decisions disabled
    const config = createTestConfig(vaultPath, {
      capture: { decisions: false } as Config['capture'],
    });

    const app = createServer(config);

    const testSessionId = 'test-session-disabled-' + Date.now();

    // Start and summarize a session
    const startRes = await app.request('/session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: testSessionId,
        project: 'test-project',
        projectPath: '/test',
        startTime: new Date().toISOString(),
      }),
    });

    expect(startRes.status).toBe(200);

    const summarizeRes = await app.request('/session/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: testSessionId }),
    });

    const data = await summarizeRes.json();

    // Decisions should be empty when disabled
    expect(data.decisions).toEqual([]);
    expect(data.decisionsCount).toBe(0);

    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
