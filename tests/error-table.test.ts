import { describe, test, expect } from 'bun:test';

/**
 * Extracted table insertion logic for testing
 * This mirrors the logic in ObservationProcessor.updateErrorNote
 */
function insertErrorOccurrenceRow(content: string, newRow: string): string {
  const occurrencesHeader = '## Occurrences';
  const headerIndex = content.indexOf(occurrencesHeader);

  if (headerIndex === -1) {
    return content; // No header found
  }

  // Find the table separator line (|---|---|---|)
  const afterHeader = content.substring(headerIndex);
  const separatorMatch = afterHeader.match(/\|[-|\s]+\|\n/);

  if (separatorMatch) {
    const separatorEnd = headerIndex + (separatorMatch.index || 0) + separatorMatch[0].length;
    // Insert the new row right after the separator
    return content.substring(0, separatorEnd) + newRow + '\n' + content.substring(separatorEnd);
  }

  return content; // No separator found
}

describe('Error Table Row Insertion', () => {
  const sampleContent = `# Error: TypeError

## Summary

> [!danger] Error Pattern
> Cannot read property 'foo' of undefined

## Context

**File**: \`src/index.ts\`
**Line**: 42

## Error Message

\`\`\`
TypeError: Cannot read property 'foo' of undefined
\`\`\`

## Resolution

> [!success] Solution
> _Not yet resolved_

## Occurrences

| Date | Session | Context |
|------|---------|---------|
| 2024-01-15 | abc12345 | First occurrence |
`;

  test('inserts new row after table separator', () => {
    const newRow = '| 2024-01-16 | def67890 | Recurring |';
    const result = insertErrorOccurrenceRow(sampleContent, newRow);

    // New row should appear after the separator
    expect(result).toContain('|------|---------|---------|');
    expect(result).toContain('| 2024-01-16 | def67890 | Recurring |');

    // The new row should come before the first occurrence
    const newRowIndex = result.indexOf('| 2024-01-16 | def67890 | Recurring |');
    const firstOccurrenceIndex = result.indexOf('| 2024-01-15 | abc12345 | First occurrence |');

    expect(newRowIndex).toBeLessThan(firstOccurrenceIndex);
  });

  test('preserves existing rows when inserting', () => {
    const newRow = '| 2024-01-16 | def67890 | Recurring |';
    const result = insertErrorOccurrenceRow(sampleContent, newRow);

    // Original row should still exist
    expect(result).toContain('| 2024-01-15 | abc12345 | First occurrence |');
  });

  test('handles multiple existing rows', () => {
    const contentWithMultipleRows = `## Occurrences

| Date | Session | Context |
|------|---------|---------|
| 2024-01-15 | abc12345 | First occurrence |
| 2024-01-14 | xyz98765 | Earlier occurrence |
`;

    const newRow = '| 2024-01-16 | def67890 | Latest |';
    const result = insertErrorOccurrenceRow(contentWithMultipleRows, newRow);

    // All rows should exist
    expect(result).toContain('| 2024-01-16 | def67890 | Latest |');
    expect(result).toContain('| 2024-01-15 | abc12345 | First occurrence |');
    expect(result).toContain('| 2024-01-14 | xyz98765 | Earlier occurrence |');

    // New row should come first (after separator)
    const newRowIndex = result.indexOf('| 2024-01-16 | def67890 | Latest |');
    const firstRowIndex = result.indexOf('| 2024-01-15 | abc12345 | First occurrence |');

    expect(newRowIndex).toBeLessThan(firstRowIndex);
  });

  test('handles content without Occurrences header', () => {
    const contentWithoutHeader = `# Error: TypeError

## Summary

Just some content without an occurrences table.
`;

    const newRow = '| 2024-01-16 | def67890 | Should not be inserted |';
    const result = insertErrorOccurrenceRow(contentWithoutHeader, newRow);

    // Content should be unchanged
    expect(result).toBe(contentWithoutHeader);
    expect(result).not.toContain('2024-01-16');
  });

  test('handles table header without separator', () => {
    const contentWithoutSeparator = `## Occurrences

| Date | Session | Context |
Some malformed content here
`;

    const newRow = '| 2024-01-16 | def67890 | Should not be inserted |';
    const result = insertErrorOccurrenceRow(contentWithoutSeparator, newRow);

    // Content should be unchanged since no valid separator
    expect(result).toBe(contentWithoutSeparator);
  });

  test('handles different separator formats', () => {
    // Test with extra dashes
    const contentWithLongSeparator = `## Occurrences

| Date | Session | Context |
|---------|---------------|---------------|
| 2024-01-15 | abc12345 | First occurrence |
`;

    const newRow = '| 2024-01-16 | def67890 | New row |';
    const result = insertErrorOccurrenceRow(contentWithLongSeparator, newRow);

    expect(result).toContain('| 2024-01-16 | def67890 | New row |');

    const newRowIndex = result.indexOf('| 2024-01-16 | def67890 | New row |');
    const firstRowIndex = result.indexOf('| 2024-01-15 | abc12345 | First occurrence |');

    expect(newRowIndex).toBeLessThan(firstRowIndex);
  });

  test('handles separator with spaces', () => {
    const contentWithSpacedSeparator = `## Occurrences

| Date | Session | Context |
| --- | --- | --- |
| 2024-01-15 | abc12345 | First occurrence |
`;

    const newRow = '| 2024-01-16 | def67890 | With spaces |';
    const result = insertErrorOccurrenceRow(contentWithSpacedSeparator, newRow);

    expect(result).toContain('| 2024-01-16 | def67890 | With spaces |');
  });

  test('does not affect content before Occurrences section', () => {
    const newRow = '| 2024-01-16 | def67890 | New |';
    const result = insertErrorOccurrenceRow(sampleContent, newRow);

    // Check that content before Occurrences is preserved
    expect(result).toContain('# Error: TypeError');
    expect(result).toContain('## Summary');
    expect(result).toContain('Cannot read property');
    expect(result).toContain('**File**: `src/index.ts`');
  });

  test('row order is correct for chronological display', () => {
    // Start with a base content
    let content = `## Occurrences

| Date | Session | Context |
|------|---------|---------|
| 2024-01-15 | abc12345 | First occurrence |
`;

    // Insert first new row
    content = insertErrorOccurrenceRow(content, '| 2024-01-16 | def67890 | Second |');
    // Insert second new row
    content = insertErrorOccurrenceRow(content, '| 2024-01-17 | ghi11111 | Third |');

    // Find positions of each row
    const thirdIndex = content.indexOf('| 2024-01-17 | ghi11111 | Third |');
    const secondIndex = content.indexOf('| 2024-01-16 | def67890 | Second |');
    const firstIndex = content.indexOf('| 2024-01-15 | abc12345 | First occurrence |');

    // Newest should be first (closest to separator)
    expect(thirdIndex).toBeLessThan(secondIndex);
    expect(secondIndex).toBeLessThan(firstIndex);
  });
});

describe('File Edit Table Row Insertion', () => {
  /**
   * Extracted table insertion logic for file edits
   * This mirrors the logic in ObservationProcessor.updateFileKnowledge
   */
  function insertFileEditRow(content: string, newRow: string): string {
    const tableMatch = content.match(/(\| Date \| Session \| Change Summary \|\n\|[-|\s]+\|)/);
    if (tableMatch) {
      const insertPos = content.indexOf(tableMatch[0]) + tableMatch[0].length;
      return content.substring(0, insertPos) + '\n' + newRow + content.substring(insertPos);
    }
    return content;
  }

  const sampleFileContent = `# File: src/components/Button.tsx

## Purpose

A reusable button component.

## Edit History

| Date | Session | Change Summary |
|------|---------|----------------|
| 2024-01-15 | abc12345 | Created |

## Notes

_No notes yet_
`;

  test('inserts new edit row after table header', () => {
    const newRow = '| 2024-01-16 | def67890 | Added hover state |';
    const result = insertFileEditRow(sampleFileContent, newRow);

    expect(result).toContain('| 2024-01-16 | def67890 | Added hover state |');

    // New row should come before the first row
    const newRowIndex = result.indexOf('| 2024-01-16 | def67890 | Added hover state |');
    const createdRowIndex = result.indexOf('| 2024-01-15 | abc12345 | Created |');

    expect(newRowIndex).toBeLessThan(createdRowIndex);
  });

  test('handles content without Edit History table', () => {
    const contentWithoutTable = `# File: src/index.ts

## Purpose

Entry point for the application.
`;

    const newRow = '| 2024-01-16 | def67890 | Should not appear |';
    const result = insertFileEditRow(contentWithoutTable, newRow);

    expect(result).toBe(contentWithoutTable);
    expect(result).not.toContain('2024-01-16');
  });
});
