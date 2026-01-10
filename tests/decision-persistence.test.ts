import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Config } from '../src/shared/types.js';
import {
  startSession,
  endSession,
  readSession,
  clearSessionFile,
  getSessionFilePath,
  addObservation,
  listActiveSessions,
  getSessionsDir,
} from '../src/shared/session-store.js';

/**
 * Create a valid test config with the given vault path and overrides
 */
function createTestConfig(vaultPath: string, overrides?: Partial<Config>): Config {
  const baseConfig: Config = {
    vault: {
      path: vaultPath,
      memFolder: '_claude-mem',
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

    // Clean up sessions directory
    const sessionsDir = getSessionsDir();
    if (fs.existsSync(sessionsDir)) {
      fs.rmSync(sessionsDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // Clean up sessions directory
    const sessionsDir = getSessionsDir();
    if (fs.existsSync(sessionsDir)) {
      fs.rmSync(sessionsDir, { recursive: true, force: true });
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('session can be started and ended with file-based store', () => {
    const testSessionId = 'test-session-' + Date.now();

    // Start a session
    const session = startSession(testSessionId, 'test-project', '/test/path');

    expect(session).not.toBeNull();
    expect(session.id).toBe(testSessionId);
    expect(session.project).toBe('test-project');
    expect(session.status).toBe('active');

    // Verify session can be read by ID
    const currentSession = readSession(testSessionId);
    expect(currentSession).not.toBeNull();
    expect(currentSession?.id).toBe(testSessionId);

    // End the session by ID
    const endedSession = endSession(testSessionId, 'end');
    expect(endedSession).not.toBeNull();
    expect(endedSession?.status).toBe('completed');
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
});

describe('Session Store File-Based Operations', () => {
  beforeEach(() => {
    const sessionsDir = getSessionsDir();
    if (fs.existsSync(sessionsDir)) {
      fs.rmSync(sessionsDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    const sessionsDir = getSessionsDir();
    if (fs.existsSync(sessionsDir)) {
      fs.rmSync(sessionsDir, { recursive: true, force: true });
    }
  });

  test('session file is created when session starts', () => {
    const testSessionId = 'file-test-' + Date.now();
    startSession(testSessionId, 'test-project', '/test/path');

    const sessionPath = getSessionFilePath(testSessionId);
    expect(fs.existsSync(sessionPath)).toBe(true);
  });

  test('session file is removed when cleared', () => {
    const testSessionId = 'clear-test-' + Date.now();
    startSession(testSessionId, 'test-project', '/test/path');

    const sessionPath = getSessionFilePath(testSessionId);
    expect(fs.existsSync(sessionPath)).toBe(true);

    clearSessionFile(testSessionId);
    expect(fs.existsSync(sessionPath)).toBe(false);
  });

  test('reading non-existent session returns null', () => {
    const session = readSession('nonexistent-session-id');
    expect(session).toBeNull();
  });

  test('multiple concurrent sessions are supported', () => {
    const firstSessionId = 'first-' + Date.now();
    const secondSessionId = 'second-' + Date.now();

    // Start first session
    startSession(firstSessionId, 'project-1', '/path/1');

    // Start second session - should NOT end the first
    startSession(secondSessionId, 'project-2', '/path/2');

    // Both sessions should be active
    const first = readSession(firstSessionId);
    const second = readSession(secondSessionId);

    expect(first?.id).toBe(firstSessionId);
    expect(first?.status).toBe('active');
    expect(second?.id).toBe(secondSessionId);
    expect(second?.status).toBe('active');

    // List should show both
    const activeSessions = listActiveSessions();
    expect(activeSessions.length).toBe(2);
  });

  test('addObservation targets correct session', () => {
    const sessionId1 = 'obs-test-1-' + Date.now();
    const sessionId2 = 'obs-test-2-' + Date.now();

    startSession(sessionId1, 'project-1', '/path/1');
    startSession(sessionId2, 'project-2', '/path/2');

    // Add observation to session 1
    addObservation(sessionId1, {
      id: 'obs-1',
      timestamp: new Date().toISOString(),
      type: 'command',
      tool: 'Bash',
      isError: false,
      data: { command: 'echo test', exitCode: 0 },
    });

    // Session 1 should have the observation
    const session1 = readSession(sessionId1);
    expect(session1?.observations.length).toBe(1);
    expect(session1?.commandsRun).toBe(1);

    // Session 2 should not have any observations
    const session2 = readSession(sessionId2);
    expect(session2?.observations.length).toBe(0);
    expect(session2?.commandsRun).toBe(0);
  });

  test('endSession targets correct session', () => {
    const sessionId1 = 'end-test-1-' + Date.now();
    const sessionId2 = 'end-test-2-' + Date.now();

    startSession(sessionId1, 'project-1', '/path/1');
    startSession(sessionId2, 'project-2', '/path/2');

    // End only session 1
    endSession(sessionId1, 'end');

    // Session 1 should be completed
    const session1 = readSession(sessionId1);
    expect(session1?.status).toBe('completed');

    // Session 2 should still be active
    const session2 = readSession(sessionId2);
    expect(session2?.status).toBe('active');
  });

  test('session ID uses hash to prevent collisions', () => {
    // These would collide with simple sanitization
    const id1 = 'a/b';
    const id2 = 'a_b';

    const path1 = getSessionFilePath(id1);
    const path2 = getSessionFilePath(id2);

    // Different IDs should get different file paths
    expect(path1).not.toBe(path2);

    // Neither should contain path traversal
    expect(path1).not.toContain('..');
    expect(path2).not.toContain('..');
  });

  test('session ID sanitization prevents path traversal', () => {
    const maliciousId = '../../../etc/passwd';
    const sessionPath = getSessionFilePath(maliciousId);

    // Should not contain path traversal
    expect(sessionPath).not.toContain('..');
  });

  test('concurrent observations are not lost (append-only)', async () => {
    const sessionId = 'concurrent-test-' + Date.now();
    startSession(sessionId, 'test-project', '/test/path');

    // Simulate concurrent writes
    const promises: Promise<void>[] = [];
    const observationCount = 20;

    for (let i = 0; i < observationCount; i++) {
      promises.push(
        new Promise((resolve) => {
          // Small random delay to interleave writes
          setTimeout(() => {
            addObservation(sessionId, {
              id: `obs-${i}`,
              timestamp: new Date().toISOString(),
              type: 'command',
              tool: 'Bash',
              isError: false,
              data: { command: `echo ${i}`, exitCode: 0 },
            });
            resolve();
          }, Math.random() * 10);
        })
      );
    }

    await Promise.all(promises);

    // All observations should be present
    const session = readSession(sessionId);
    expect(session?.observations.length).toBe(observationCount);
    expect(session?.commandsRun).toBe(observationCount);
  });

  test('observations are stored in separate JSONL file', () => {
    const sessionId = 'jsonl-test-' + Date.now();
    startSession(sessionId, 'test-project', '/test/path');

    addObservation(sessionId, {
      id: 'obs-1',
      timestamp: new Date().toISOString(),
      type: 'file_edit',
      tool: 'Edit',
      isError: false,
      data: { path: '/test/file.ts', changeType: 'modify' },
    });

    // Session file should exist
    const sessionPath = getSessionFilePath(sessionId);
    expect(fs.existsSync(sessionPath)).toBe(true);

    // Observations file should also exist (ends with .observations.jsonl)
    const obsPath = sessionPath.replace('.json', '.observations.jsonl');
    expect(fs.existsSync(obsPath)).toBe(true);

    // Observations file should contain the observation as JSONL
    const content = fs.readFileSync(obsPath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines.length).toBe(1);

    const obs = JSON.parse(lines[0]);
    expect(obs.id).toBe('obs-1');
    expect(obs.type).toBe('file_edit');
  });

  test('malformed JSONL lines are skipped without losing other observations', () => {
    const sessionId = 'malformed-test-' + Date.now();
    startSession(sessionId, 'test-project', '/test/path');

    // Add a valid observation
    addObservation(sessionId, {
      id: 'obs-1',
      timestamp: new Date().toISOString(),
      type: 'command',
      tool: 'Bash',
      isError: false,
      data: { command: 'echo 1', exitCode: 0 },
    });

    // Manually corrupt the JSONL file by adding a malformed line
    const sessionPath = getSessionFilePath(sessionId);
    const obsPath = sessionPath.replace('.json', '.observations.jsonl');
    fs.appendFileSync(obsPath, 'this is not valid JSON\n');
    fs.appendFileSync(obsPath, '{"partial": true\n'); // Incomplete JSON

    // Add another valid observation
    addObservation(sessionId, {
      id: 'obs-2',
      timestamp: new Date().toISOString(),
      type: 'command',
      tool: 'Bash',
      isError: false,
      data: { command: 'echo 2', exitCode: 0 },
    });

    // Read session - should have both valid observations, skip malformed
    const session = readSession(sessionId);
    expect(session?.observations.length).toBe(2);
    expect(session?.observations[0].id).toBe('obs-1');
    expect(session?.observations[1].id).toBe('obs-2');
  });

  test('stale session cleanup considers observations file mtime', async () => {
    const sessionId = 'stale-obs-test-' + Date.now();
    startSession(sessionId, 'test-project', '/test/path');

    // Add an observation (this updates the observations file mtime)
    addObservation(sessionId, {
      id: 'obs-1',
      timestamp: new Date().toISOString(),
      type: 'command',
      tool: 'Bash',
      isError: false,
      data: { command: 'echo test', exitCode: 0 },
    });

    // Manually backdate the metadata file to look stale
    const sessionPath = getSessionFilePath(sessionId);
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
    fs.utimesSync(sessionPath, oldTime, oldTime);

    // Session should NOT be cleaned up because observations file is recent
    const { cleanupStaleSessions } = await import('../src/shared/session-store.js');
    const stale = cleanupStaleSessions(24);

    // Session should still exist (not cleaned up)
    const session = readSession(sessionId);
    expect(session).not.toBeNull();
    expect(stale.length).toBe(0);
  });

  test('lock file is cleaned up after observation write', () => {
    const sessionId = 'lock-test-' + Date.now();
    startSession(sessionId, 'test-project', '/test/path');

    addObservation(sessionId, {
      id: 'obs-1',
      timestamp: new Date().toISOString(),
      type: 'command',
      tool: 'Bash',
      isError: false,
      data: { command: 'echo test', exitCode: 0 },
    });

    // Lock file should not exist after write completes
    const sessionPath = getSessionFilePath(sessionId);
    const lockPath = sessionPath.replace('.json', '.lock');
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});
