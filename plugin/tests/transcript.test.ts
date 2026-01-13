import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseTranscript } from '../src/services/transcript.js';

describe('Transcript parsing with leafUuid', () => {
  let tempDir: string;
  let transcriptPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-test-'));
    transcriptPath = path.join(tempDir, 'test.jsonl');
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('should extract and return leafUuid from summary entry', () => {
    const transcript = [
      { type: 'summary', summary: 'Previous summary', leafUuid: 'uuid-123' },
      { type: 'user', message: { role: 'user', content: 'Hello' }, uuid: 'uuid-456', timestamp: '2026-01-13T10:00:00Z' },
      { type: 'assistant', message: { role: 'assistant', content: 'Hi there' }, uuid: 'uuid-789', timestamp: '2026-01-13T10:00:01Z' },
    ].map(e => JSON.stringify(e)).join('\n');

    fs.writeFileSync(transcriptPath, transcript);

    const result = parseTranscript(transcriptPath);

    expect(result.summary).toBe('Previous summary');
    expect(result.leafUuid).toBe('uuid-123');
    expect(result.turns.length).toBe(2);
  });

  it('should return undefined leafUuid when no summary entry exists', () => {
    const transcript = [
      { type: 'user', message: { role: 'user', content: 'Hello' }, uuid: 'uuid-456', timestamp: '2026-01-13T10:00:00Z' },
      { type: 'assistant', message: { role: 'assistant', content: 'Hi there' }, uuid: 'uuid-789', timestamp: '2026-01-13T10:00:01Z' },
    ].map(e => JSON.stringify(e)).join('\n');

    fs.writeFileSync(transcriptPath, transcript);

    const result = parseTranscript(transcriptPath);

    expect(result.leafUuid).toBeUndefined();
    expect(result.turns.length).toBe(2);
  });

  it('should include uuid in parsed turns', () => {
    const transcript = [
      { type: 'user', message: { role: 'user', content: 'Hello' }, uuid: 'uuid-456', timestamp: '2026-01-13T10:00:00Z' },
      { type: 'assistant', message: { role: 'assistant', content: 'Hi there' }, uuid: 'uuid-789', timestamp: '2026-01-13T10:00:01Z' },
    ].map(e => JSON.stringify(e)).join('\n');

    fs.writeFileSync(transcriptPath, transcript);

    const result = parseTranscript(transcriptPath);

    expect(result.turns[0].uuid).toBe('uuid-456');
    expect(result.turns[1].uuid).toBe('uuid-789');
  });

  it('should handle filtering when leafUuid found in turns array', () => {
    const transcript = [
      { type: 'summary', summary: 'Previous summary', leafUuid: 'uuid-456' },
      { type: 'user', message: { role: 'user', content: 'Old message' }, uuid: 'uuid-456', timestamp: '2026-01-13T10:00:00Z' },
      { type: 'assistant', message: { role: 'assistant', content: 'Old response' }, uuid: 'uuid-457', timestamp: '2026-01-13T10:00:01Z' },
      { type: 'user', message: { role: 'user', content: 'New message' }, uuid: 'uuid-789', timestamp: '2026-01-13T10:00:02Z' },
      { type: 'assistant', message: { role: 'assistant', content: 'New response' }, uuid: 'uuid-790', timestamp: '2026-01-13T10:00:03Z' },
    ].map(e => JSON.stringify(e)).join('\n');

    fs.writeFileSync(transcriptPath, transcript);

    const result = parseTranscript(transcriptPath);

    expect(result.leafUuid).toBe('uuid-456');
    expect(result.turns.length).toBe(4); // All turns are in the result

    // Filtering logic is in background-summarize.ts, not parseTranscript
    // This test verifies we have the data needed to filter
    const leafIndex = result.turns.findIndex(t => t.uuid === result.leafUuid);
    const filteredTurns = result.turns.slice(leafIndex + 1);

    expect(filteredTurns.length).toBe(3); // Should include all turns after uuid-456
    expect(filteredTurns[0].text).toBe('Old response');
    expect(filteredTurns[1].text).toBe('New message');
    expect(filteredTurns[2].text).toBe('New response');
  });

  it('should handle case when leafUuid not found in turns array', () => {
    const transcript = [
      { type: 'summary', summary: 'Previous summary', leafUuid: 'uuid-not-exist' },
      { type: 'user', message: { role: 'user', content: 'Message 1' }, uuid: 'uuid-456', timestamp: '2026-01-13T10:00:00Z' },
      { type: 'assistant', message: { role: 'assistant', content: 'Response 1' }, uuid: 'uuid-789', timestamp: '2026-01-13T10:00:01Z' },
    ].map(e => JSON.stringify(e)).join('\n');

    fs.writeFileSync(transcriptPath, transcript);

    const result = parseTranscript(transcriptPath);

    expect(result.leafUuid).toBe('uuid-not-exist');
    const leafIndex = result.turns.findIndex(t => t.uuid === result.leafUuid);
    expect(leafIndex).toBe(-1); // Not found

    // When leafIndex is -1, should process all turns (backward compatibility)
    const filteredTurns = leafIndex >= 0 ? result.turns.slice(leafIndex + 1) : result.turns;
    expect(filteredTurns.length).toBe(2);
  });

  it('should use exact string comparison for UUID matching', () => {
    const transcript = [
      { type: 'summary', summary: 'Previous summary', leafUuid: 'uuid-456' },
      { type: 'user', message: { role: 'user', content: 'Message 1' }, uuid: 'uuid-456', timestamp: '2026-01-13T10:00:00Z' },
      { type: 'user', message: { role: 'user', content: 'Message 2' }, uuid: 'uuid-4567', timestamp: '2026-01-13T10:00:01Z' },
      { type: 'user', message: { role: 'user', content: 'Message 3' }, uuid: 'UUID-456', timestamp: '2026-01-13T10:00:02Z' },
    ].map(e => JSON.stringify(e)).join('\n');

    fs.writeFileSync(transcriptPath, transcript);

    const result = parseTranscript(transcriptPath);

    const leafIndex = result.turns.findIndex(t => t.uuid === result.leafUuid);
    expect(leafIndex).toBe(0); // Exact match on first turn, not partial match on second

    const filteredTurns = result.turns.slice(leafIndex + 1);
    expect(filteredTurns.length).toBe(2); // uuid-4567 and UUID-456 (case-sensitive)
  });

  it('should use last leafUuid when multiple summary entries exist', () => {
    const transcript = [
      { type: 'summary', summary: 'First summary', leafUuid: 'uuid-100' },
      { type: 'user', message: { role: 'user', content: 'Old message' }, uuid: 'uuid-200', timestamp: '2026-01-13T10:00:00Z' },
      { type: 'summary', summary: 'Second summary', leafUuid: 'uuid-300' },
      { type: 'user', message: { role: 'user', content: 'New message' }, uuid: 'uuid-400', timestamp: '2026-01-13T10:00:01Z' },
    ].map(e => JSON.stringify(e)).join('\n');

    fs.writeFileSync(transcriptPath, transcript);

    const result = parseTranscript(transcriptPath);

    expect(result.summary).toBe('Second summary'); // Last summary wins
    expect(result.leafUuid).toBe('uuid-300'); // Last leafUuid wins
  });
});
