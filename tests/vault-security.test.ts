import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { VaultManager } from '../src/mcp-server/utils/vault.js';

describe('VaultManager Path Traversal Prevention', () => {
  let tempDir: string;
  let vaultPath: string;
  let vault: VaultManager;

  beforeEach(() => {
    // Create a temporary directory structure for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'));
    vaultPath = path.join(tempDir, 'vault');
    fs.mkdirSync(vaultPath, { recursive: true });
    fs.mkdirSync(path.join(vaultPath, '_claude-mem'), { recursive: true });

    // Create a test file inside the vault
    fs.writeFileSync(
      path.join(vaultPath, '_claude-mem', 'test.md'),
      '---\ntype: learning\n---\n# Test'
    );

    // Create a sensitive file outside the vault (simulating ~/.ssh/id_rsa)
    fs.writeFileSync(path.join(tempDir, 'sensitive.txt'), 'SECRET DATA');

    vault = new VaultManager(vaultPath, '_claude-mem');
  });

  afterEach(() => {
    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('allows reading files inside the vault', async () => {
    const note = await vault.readNote('test.md');
    expect(note.content).toContain('# Test');
  });

  test('allows ../ that stays within vault (mem folder to vault root)', async () => {
    // ../ from _claude-mem goes to vault root, which is still within vault
    // This should not throw path traversal error, just "not found"
    await expect(vault.readNote('../nonexistent.txt')).rejects.toThrow(
      /Note not found/
    );
  });

  test('blocks path traversal with ../../ to escape vault', async () => {
    // Attempt to read a file outside the vault using ../../
    await expect(vault.readNote('../../sensitive.txt')).rejects.toThrow(
      /Path traversal detected/
    );
  });

  test('blocks path traversal with absolute path outside vault', async () => {
    const outsidePath = path.join(tempDir, 'sensitive.txt');
    await expect(vault.readNote(outsidePath)).rejects.toThrow(
      /Path traversal detected/
    );
  });

  test('blocks deeper path traversal with multiple ../../../', async () => {
    // Attempt with multiple levels of ../
    await expect(vault.readNote('../../../sensitive.txt')).rejects.toThrow(
      /Path traversal detected/
    );
  });

  test('blocks path traversal via nested ../ in middle of path', async () => {
    // Attempt to traverse from within the mem folder
    await expect(vault.readNote('projects/../../../sensitive.txt')).rejects.toThrow(
      /Path traversal detected/
    );
  });

  test('blocks writing outside vault', async () => {
    await expect(
      vault.writeNote({
        type: 'learning',
        title: 'Malicious',
        content: 'payload',
        path: '../../malicious.md',
      })
    ).rejects.toThrow(/Path traversal detected/);
  });

  test('blocks writing to absolute path outside vault', async () => {
    const outsidePath = path.join(tempDir, 'malicious.md');
    await expect(
      vault.writeNote({
        type: 'learning',
        title: 'Malicious',
        content: 'payload',
        path: outsidePath,
      })
    ).rejects.toThrow(/Path traversal detected/);
  });

  test('allows valid nested paths within vault', async () => {
    // Create the directory structure
    fs.mkdirSync(path.join(vaultPath, '_claude-mem', 'projects', 'test-project'), {
      recursive: true,
    });

    const result = await vault.writeNote({
      type: 'learning',
      title: 'Valid Note',
      content: 'This is valid content',
      path: 'projects/test-project/note.md',
    });

    expect(result.created).toBe(true);
    expect(result.path).toBe('projects/test-project/note.md');
  });

  test('normalizes paths with redundant segments', async () => {
    // Create test file
    fs.mkdirSync(path.join(vaultPath, '_claude-mem', 'global'), { recursive: true });
    fs.writeFileSync(
      path.join(vaultPath, '_claude-mem', 'global', 'note.md'),
      '---\ntype: learning\n---\n# Note'
    );

    // Path with redundant ./ should still work
    const note = await vault.readNote('./global/note.md');
    expect(note.content).toContain('# Note');
  });
});
