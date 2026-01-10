import { describe, test, expect } from 'bun:test';
import { extractCommandInfo } from '../hooks/scripts/utils/helpers.js';

describe('Bash Output Capture Configuration', () => {
  const mockBashResponse = {
    content: [
      {
        type: 'text',
        text: 'Line 1\nLine 2\nLine 3\nSensitive data: API_KEY=secret123\nMore output...',
      },
    ],
    isError: false,
  };

  const mockBashInput = {
    command: 'echo "test"',
  };

  test('captures output when bashOutput.enabled is true', () => {
    const result = extractCommandInfo(mockBashInput, mockBashResponse, {
      enabled: true,
      maxLength: 5000,
    });

    expect(result.output).toBeDefined();
    expect(result.output).toContain('Line 1');
    expect(result.output).toContain('Sensitive data');
  });

  test('does not capture output when bashOutput.enabled is false', () => {
    const result = extractCommandInfo(mockBashInput, mockBashResponse, {
      enabled: false,
      maxLength: 5000,
    });

    expect(result.output).toBeUndefined();
  });

  test('respects maxLength configuration', () => {
    const longOutput = 'A'.repeat(10000);
    const response = {
      content: [{ type: 'text', text: longOutput }],
      isError: false,
    };

    const result = extractCommandInfo(mockBashInput, response, {
      enabled: true,
      maxLength: 100,
    });

    expect(result.output).toBeDefined();
    expect(result.output!.length).toBe(100);
  });

  test('uses default maxLength of 5000 when not specified', () => {
    const longOutput = 'B'.repeat(10000);
    const response = {
      content: [{ type: 'text', text: longOutput }],
      isError: false,
    };

    // No config passed - should use defaults
    const result = extractCommandInfo(mockBashInput, response);

    expect(result.output).toBeDefined();
    expect(result.output!.length).toBe(5000);
  });

  test('defaults to enabled when config not provided', () => {
    const result = extractCommandInfo(mockBashInput, mockBashResponse);

    expect(result.output).toBeDefined();
    expect(result.output).toContain('Line 1');
  });

  test('preserves command and exitCode regardless of output config', () => {
    const result = extractCommandInfo(mockBashInput, mockBashResponse, {
      enabled: false,
      maxLength: 100,
    });

    expect(result.command).toBe('echo "test"');
    expect(result.exitCode).toBe(0);
    expect(result.isError).toBe(false);
  });

  test('correctly identifies errors from exit code in output', () => {
    const errorResponse = {
      content: [{ type: 'text', text: 'Error occurred\nexit code: 1' }],
      isError: false,
    };

    const result = extractCommandInfo(mockBashInput, errorResponse, {
      enabled: true,
      maxLength: 5000,
    });

    expect(result.exitCode).toBe(1);
    expect(result.isError).toBe(true);
  });

  test('treats isError response flag as error', () => {
    const errorResponse = {
      content: [{ type: 'text', text: 'Command failed' }],
      isError: true,
    };

    const result = extractCommandInfo(mockBashInput, errorResponse, {
      enabled: false,
      maxLength: 100,
    });

    expect(result.isError).toBe(true);
    expect(result.exitCode).toBe(1);
    // Output should still be undefined when disabled
    expect(result.output).toBeUndefined();
  });
});

describe('Sensitive Data Protection', () => {
  test('output truncation prevents leaking data beyond maxLength', () => {
    const sensitiveOutput = 'Public info\n'.repeat(10) + 'SECRET_TOKEN=abc123xyz';
    const response = {
      content: [{ type: 'text', text: sensitiveOutput }],
      isError: false,
    };

    const result = extractCommandInfo({ command: 'env' }, response, {
      enabled: true,
      maxLength: 50, // Truncate before the secret
    });

    expect(result.output).toBeDefined();
    expect(result.output!.length).toBe(50);
    expect(result.output).not.toContain('SECRET_TOKEN');
  });

  test('disabling output capture prevents any sensitive data storage', () => {
    const sensitiveOutput = 'API_KEY=super_secret_key_12345\nPASSWORD=hunter2';
    const response = {
      content: [{ type: 'text', text: sensitiveOutput }],
      isError: false,
    };

    const result = extractCommandInfo({ command: 'cat .env' }, response, {
      enabled: false,
      maxLength: 5000,
    });

    expect(result.output).toBeUndefined();
    // Command is still captured for context
    expect(result.command).toBe('cat .env');
  });
});
