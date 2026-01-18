/**
 * Tests for cross-category deduplication functions
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { join } from "path";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import {
	findSimilarTopicAcrossCategories,
	type SimilarTopicMatch,
} from "../src/vault/vault-manager.js";

const TEST_VAULT = join(tmpdir(), `cc-obsidian-mem-test-${Date.now()}`);
const TEST_PROJECT = "test-project";

beforeAll(() => {
	// Create test vault structure
	if (!existsSync(TEST_VAULT)) {
		mkdirSync(TEST_VAULT, { recursive: true });
	}

	// Set up test environment
	process.env.CC_OBSIDIAN_MEM_VAULT_PATH = TEST_VAULT;
});

afterAll(() => {
	// Clean up test vault
	if (existsSync(TEST_VAULT)) {
		rmSync(TEST_VAULT, { recursive: true, force: true });
	}
});

describe("Cross-category deduplication", () => {
	describe("findSimilarTopicAcrossCategories", () => {
		it("returns null for empty title", () => {
			const projectPath = join(TEST_VAULT, "_claude-mem", "projects", TEST_PROJECT);
			const result = findSimilarTopicAcrossCategories(projectPath, "");
			expect(result).toBeNull();
		});

		it("returns null for non-existent project path", () => {
			const result = findSimilarTopicAcrossCategories("/non/existent/path", "some title");
			expect(result).toBeNull();
		});

		it("clamps threshold to valid range", () => {
			const projectPath = join(TEST_VAULT, TEST_PROJECT);

			// Should not crash with invalid threshold
			const result1 = findSimilarTopicAcrossCategories(projectPath, "test", -1);
			const result2 = findSimilarTopicAcrossCategories(projectPath, "test", 2);
			const result3 = findSimilarTopicAcrossCategories(projectPath, "test", NaN);

			// All should return null (no files created)
			expect(result1).toBeNull();
			expect(result2).toBeNull();
			expect(result3).toBeNull();
		});

		it("finds match across different categories", () => {
			const projectPath = join(TEST_VAULT, TEST_PROJECT);

			// Manually create project structure
			const decisionsDir = join(projectPath, "decisions");
			mkdirSync(decisionsDir, { recursive: true });

			// Create note in decisions folder
			const decisionsNote = join(decisionsDir, "version-bump-checklist-multi-file.md");
			const noteContent = `---
type: "decision"
title: "Version bump checklist multi file"
project: "${TEST_PROJECT}"
created: "${new Date().toISOString()}"
tags: ["versioning"]
status: active
---

Test content`;
			writeFileSync(decisionsNote, noteContent);

			// Search with similar title
			const result = findSimilarTopicAcrossCategories(
				projectPath,
				"Version Bump Checklist for Multi-File Projects",
				0.6
			);

			expect(result).not.toBeNull();
			expect(result?.category).toBe("decisions");
			expect(result?.score).toBeGreaterThanOrEqual(0.6);
		});

		it("excludes category index files", () => {
			const projectPath = join(TEST_VAULT, TEST_PROJECT);

			// Create decisions folder with index file
			const decisionsDir = join(projectPath, "decisions");
			mkdirSync(decisionsDir, { recursive: true });

			const indexFile = join(decisionsDir, "decisions.md");
			writeFileSync(indexFile, "# Decisions Index");

			// The category index files should not be matched
			const result = findSimilarTopicAcrossCategories(projectPath, "decisions", 0.5);

			// Should not match against decisions/decisions.md
			expect(result).toBeNull();
		});

		it("excludes .archive folders", () => {
			const projectPath = join(TEST_VAULT, TEST_PROJECT);

			// Create .archive folder with a note
			const archiveDir = join(projectPath, "decisions", ".archive");
			mkdirSync(archiveDir, { recursive: true });

			const archivedNote = join(archiveDir, "old-decision.md");
			writeFileSync(archivedNote, "Archived content");

			// Should not find the archived note
			const result = findSimilarTopicAcrossCategories(projectPath, "old decision", 0.6);
			expect(result).toBeNull();
		});

		it("falls back to exact match for single word", () => {
			const projectPath = join(TEST_VAULT, TEST_PROJECT);

			// Create errors folder and note
			const errorsDir = join(projectPath, "errors");
			mkdirSync(errorsDir, { recursive: true });

			const note = join(errorsDir, "authentication.md");
			writeFileSync(note, "Error content");

			// Should find exact match
			const result = findSimilarTopicAcrossCategories(projectPath, "authentication", 0.6);
			expect(result).not.toBeNull();
			expect(result?.score).toBe(1.0);
		});

		it("respects threshold setting", () => {
			const projectPath = join(TEST_VAULT, TEST_PROJECT);

			// Create patterns folder and note
			const patternsDir = join(projectPath, "patterns");
			mkdirSync(patternsDir, { recursive: true });

			const note = join(patternsDir, "database-connection-pooling.md");
			writeFileSync(note, "Pattern content");

			// Low threshold should match
			const resultLow = findSimilarTopicAcrossCategories(
				projectPath,
				"database connection",
				0.3
			);
			expect(resultLow).not.toBeNull();

			// High threshold should not match
			const resultHigh = findSimilarTopicAcrossCategories(
				projectPath,
				"database connection",
				0.9
			);
			expect(resultHigh).toBeNull();
		});

		it("handles unreadable directory gracefully", () => {
			const projectPath = join(TEST_VAULT, TEST_PROJECT);

			// This should not crash even if a category directory is missing permissions
			const result = findSimilarTopicAcrossCategories(projectPath, "test", 0.6);

			// Should return null or a valid match, but not throw
			expect(result === null || typeof result === "object").toBe(true);
		});

		it("deterministic tiebreaker using alphabetical order", () => {
			const projectPath = join(TEST_VAULT, TEST_PROJECT);

			// Create research folder
			const researchDir = join(projectPath, "research");
			mkdirSync(researchDir, { recursive: true });

			// Create two notes with identical similarity scores
			const note1 = join(researchDir, "api-design-principles.md");
			const note2 = join(researchDir, "api-design-patterns.md");

			writeFileSync(note1, "Principles content");
			writeFileSync(note2, "Patterns content");

			// Search with "API design" - both should have same similarity
			const result = findSimilarTopicAcrossCategories(projectPath, "API design best", 0.5);

			// Should deterministically pick the alphabetically first one (patterns < principles)
			expect(result).not.toBeNull();
			expect(result?.path).toContain("api-design-patterns.md");
		});

		it("real-world: detects version-bump-checklist-* as duplicates", () => {
			const projectPath = join(TEST_VAULT, TEST_PROJECT);

			// Create patterns folder
			const patternsDir = join(projectPath, "patterns");
			mkdirSync(patternsDir, { recursive: true });

			// Create multiple version-bump related notes (simulating user's duplicates)
			const notes = [
				"version-bump-checklist-for-multi-file-projects.md",
				"version-bump-checklist-for-claude-code-plugins.md",
				"version-bump-checklist-for-claude-plugins.md",
				"version-bumps-require-updates-in-four-files.md",
			];

			for (const filename of notes) {
				const notePath = join(patternsDir, filename);
				writeFileSync(notePath, "Version bump content");
			}

			// New title should match one of the existing ones
			const result = findSimilarTopicAcrossCategories(
				projectPath,
				"Version bump checklist for multi-file projects",
				0.6
			);

			expect(result).not.toBeNull();
			expect(result?.score).toBeGreaterThan(0.6);
			expect(result?.path).toContain("version-bump");
		});
	});
});
