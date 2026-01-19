/**
 * Tests for Claude CLI version checking utilities
 */

import { describe, test, expect } from "bun:test";
import { compareVersions, MIN_CLAUDE_VERSION, parseClaudeVersionOutput } from "../src/shared/config.js";

describe("compareVersions", () => {
	test("equal versions return 0", () => {
		expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
		expect(compareVersions("2.1.9", "2.1.9")).toBe(0);
		expect(compareVersions("1.0.29", "1.0.29")).toBe(0);
	});

	test("greater version returns positive", () => {
		expect(compareVersions("2.0.0", "1.0.0")).toBeGreaterThan(0);
		expect(compareVersions("1.1.0", "1.0.0")).toBeGreaterThan(0);
		expect(compareVersions("1.0.1", "1.0.0")).toBeGreaterThan(0);
		expect(compareVersions("2.1.9", "1.0.29")).toBeGreaterThan(0);
		expect(compareVersions("1.0.30", "1.0.29")).toBeGreaterThan(0);
	});

	test("lesser version returns negative", () => {
		expect(compareVersions("1.0.0", "2.0.0")).toBeLessThan(0);
		expect(compareVersions("1.0.0", "1.1.0")).toBeLessThan(0);
		expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
		expect(compareVersions("1.0.28", "1.0.29")).toBeLessThan(0);
	});

	test("handles versions with different lengths", () => {
		expect(compareVersions("1.0", "1.0.0")).toBe(0);
		expect(compareVersions("1.0.0", "1.0")).toBe(0);
		expect(compareVersions("1.0.1", "1.0")).toBeGreaterThan(0);
		expect(compareVersions("1.0", "1.0.1")).toBeLessThan(0);
	});

	test("handles major version differences", () => {
		expect(compareVersions("10.0.0", "9.9.9")).toBeGreaterThan(0);
		expect(compareVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
	});
});

describe("parseClaudeVersionOutput", () => {
	// Uses actual exported function from config.ts

	test("matches standard format: version (Claude Code)", () => {
		expect(parseClaudeVersionOutput("2.1.9 (Claude Code)")).toBe("2.1.9");
		expect(parseClaudeVersionOutput("1.0.29 (Claude Code)")).toBe("1.0.29");
	});

	test("matches case-insensitive: version (CLAUDE Code)", () => {
		expect(parseClaudeVersionOutput("2.1.9 (CLAUDE Code)")).toBe("2.1.9");
		expect(parseClaudeVersionOutput("1.0.29 (claude code)")).toBe("1.0.29");
	});

	test("matches version after Claude prefix", () => {
		expect(parseClaudeVersionOutput("Claude Code v2.1.9")).toBe("2.1.9");
		expect(parseClaudeVersionOutput("Claude v1.0.29")).toBe("1.0.29");
	});

	test("prefers Claude version over other versions in output", () => {
		// Node version appears before Claude version - should pick Claude's
		expect(parseClaudeVersionOutput("Node 18.0.0\n2.1.9 (Claude Code)")).toBe("2.1.9");
		expect(parseClaudeVersionOutput("Running on Bun 1.0.0\nClaude Code v2.1.9")).toBe("2.1.9");
	});

	test("falls back to any semver when Claude not mentioned", () => {
		expect(parseClaudeVersionOutput("Version: 1.0.29")).toBe("1.0.29");
	});

	test("returns null for no version", () => {
		expect(parseClaudeVersionOutput("Claude Code")).toBeNull();
		expect(parseClaudeVersionOutput("")).toBeNull();
	});
});

describe("MIN_CLAUDE_VERSION requirement", () => {
	// Uses actual MIN_CLAUDE_VERSION from config to detect drift

	test("current common versions are supported", () => {
		// These are versions likely to be in the wild
		expect(compareVersions("1.0.29", MIN_CLAUDE_VERSION)).toBeGreaterThanOrEqual(0);
		expect(compareVersions("1.0.30", MIN_CLAUDE_VERSION)).toBeGreaterThanOrEqual(0);
		expect(compareVersions("2.0.0", MIN_CLAUDE_VERSION)).toBeGreaterThanOrEqual(0);
		expect(compareVersions("2.1.9", MIN_CLAUDE_VERSION)).toBeGreaterThanOrEqual(0);
	});

	test("older versions are not supported", () => {
		expect(compareVersions("1.0.28", MIN_CLAUDE_VERSION)).toBeLessThan(0);
		expect(compareVersions("1.0.0", MIN_CLAUDE_VERSION)).toBeLessThan(0);
		expect(compareVersions("0.9.9", MIN_CLAUDE_VERSION)).toBeLessThan(0);
	});
});
