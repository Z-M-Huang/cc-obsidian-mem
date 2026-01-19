/**
 * Tests for vault-manager.ts hierarchical index structure
 */

import { describe, test, expect, afterEach } from "bun:test";
import { existsSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { ensureProjectStructure, buildParentLink, CATEGORIES, getMemFolderPath, slugifyProjectName, findExistingTopicNote, appendToExistingNote, writeNote, readNote, addAliasToNote, renameNoteWithGenericTitle, findSimilarTopicInCategory } from "../src/vault/vault-manager.js";
import { generateFilename } from "../src/vault/note-builder.js";
import { MAX_ALIASES } from "../src/shared/types.js";

// Test with real config - cleanup test projects after
const TEST_PROJECT = "test-vault-manager";

afterEach(() => {
	// Clean up test project
	const memPath = getMemFolderPath();
	const testProjectPath = join(memPath, "projects", TEST_PROJECT);
	if (existsSync(testProjectPath)) {
		rmSync(testProjectPath, { recursive: true, force: true });
	}
});

describe("slugifyProjectName", () => {
	test("keeps valid names unchanged", () => {
		expect(slugifyProjectName("my-project")).toBe("my-project");
		expect(slugifyProjectName("my_project")).toBe("my_project");
		expect(slugifyProjectName("project123")).toBe("project123");
	});

	test("converts spaces to hyphens", () => {
		expect(slugifyProjectName("My Project")).toBe("my-project");
		expect(slugifyProjectName("hello world test")).toBe("hello-world-test");
	});

	test("converts dots to hyphens", () => {
		expect(slugifyProjectName("v1.2.3")).toBe("v1-2-3");
		expect(slugifyProjectName("my.project")).toBe("my-project");
	});

	test("removes special characters", () => {
		expect(slugifyProjectName("test@project!")).toBe("testproject");
		expect(slugifyProjectName("my#project$name")).toBe("myprojectname");
	});

	test("collapses multiple hyphens", () => {
		expect(slugifyProjectName("my  project")).toBe("my-project");
		expect(slugifyProjectName("a...b")).toBe("a-b");
	});

	test("trims leading/trailing hyphens", () => {
		expect(slugifyProjectName("-project-")).toBe("project");
		expect(slugifyProjectName("  project  ")).toBe("project");
	});

	test("converts to lowercase", () => {
		expect(slugifyProjectName("MyProject")).toBe("myproject");
		expect(slugifyProjectName("UPPERCASE")).toBe("uppercase");
	});
});

describe("buildParentLink", () => {
	test("builds project parent link without category", () => {
		const link = buildParentLink("_claude-mem", "test-project");
		expect(link).toBe("[[_claude-mem/projects/test-project/test-project]]");
	});

	test("builds category parent link with category", () => {
		const link = buildParentLink("_claude-mem", "test-project", "decisions");
		expect(link).toBe("[[_claude-mem/projects/test-project/decisions/decisions]]");
	});

	test("handles custom mem folder name", () => {
		const link = buildParentLink("custom-mem", "my-proj", "errors");
		expect(link).toBe("[[custom-mem/projects/my-proj/errors/errors]]");
	});

	test("generates correct format for all categories", () => {
		for (const category of CATEGORIES) {
			const link = buildParentLink("_claude-mem", "proj", category);
			expect(link).toBe(`[[_claude-mem/projects/proj/${category}/${category}]]`);
		}
	});
});

describe("ensureProjectStructure", () => {
	test("creates project index file", () => {
		ensureProjectStructure(TEST_PROJECT);

		const memPath = getMemFolderPath();
		const projectIndexPath = join(memPath, "projects", TEST_PROJECT, `${TEST_PROJECT}.md`);

		expect(existsSync(projectIndexPath)).toBe(true);

		const content = readFileSync(projectIndexPath, "utf-8");
		expect(content).toContain("type: \"project\"");
		expect(content).toContain(`title: \"${TEST_PROJECT}\"`);
		expect(content).toContain("## Categories");
	});

	test("creates all category index files", () => {
		ensureProjectStructure(TEST_PROJECT);

		const memPath = getMemFolderPath();
		const projectPath = join(memPath, "projects", TEST_PROJECT);

		for (const category of CATEGORIES) {
			const categoryIndexPath = join(projectPath, category, `${category}.md`);
			expect(existsSync(categoryIndexPath)).toBe(true);

			const content = readFileSync(categoryIndexPath, "utf-8");
			expect(content).toContain("type: \"index\"");
			expect(content).toContain(`project: \"${TEST_PROJECT}\"`);
			expect(content).toMatch(/parent: ".*"/);
		}
	});

	test("is idempotent - calling twice doesn't error", () => {
		// First call
		expect(() => ensureProjectStructure(TEST_PROJECT)).not.toThrow();

		// Second call should not throw
		expect(() => ensureProjectStructure(TEST_PROJECT)).not.toThrow();
	});

	test("normalizes project names with spaces", () => {
		// Spaces are normalized to hyphens, not rejected
		expect(() => ensureProjectStructure("My Project")).not.toThrow();

		// Clean up - normalized name is "my-project"
		const memPath = getMemFolderPath();
		const path = join(memPath, "projects", "my-project");
		if (existsSync(path)) {
			rmSync(path, { recursive: true, force: true });
		}
	});

	test("normalizes project names with dots", () => {
		// Dots are normalized to hyphens, not rejected
		expect(() => ensureProjectStructure("v1.2.3")).not.toThrow();

		// Clean up - normalized name is "v1-2-3"
		const memPath = getMemFolderPath();
		const path = join(memPath, "projects", "v1-2-3");
		if (existsSync(path)) {
			rmSync(path, { recursive: true, force: true });
		}
	});

	test("throws error for path traversal attempts", () => {
		expect(() => ensureProjectStructure("invalid/project")).toThrow(/Path separators/);
		expect(() => ensureProjectStructure("invalid\\project")).toThrow(/Path separators/);
		expect(() => ensureProjectStructure("../escape")).toThrow(/Path separators/);
	});

	test("throws error for empty or invalid project names", () => {
		expect(() => ensureProjectStructure("")).toThrow(/cannot be empty/);
		expect(() => ensureProjectStructure("   ")).toThrow(/cannot be empty/);
		expect(() => ensureProjectStructure("!!!")).toThrow(/at least one alphanumeric/);
	});

	test("allows valid project names", () => {
		expect(() => ensureProjectStructure("valid-project-1")).not.toThrow();
		expect(() => ensureProjectStructure("valid_project_2")).not.toThrow();
		expect(() => ensureProjectStructure("ValidProject123")).not.toThrow();

		// Clean up these test projects (note: ValidProject123 becomes validproject123)
		const memPath = getMemFolderPath();
		["valid-project-1", "valid_project_2", "validproject123"].forEach((proj) => {
			const path = join(memPath, "projects", proj);
			if (existsSync(path)) {
				rmSync(path, { recursive: true, force: true });
			}
		});
	});

	test("category index files link to correct parent", () => {
		ensureProjectStructure(TEST_PROJECT);

		const memPath = getMemFolderPath();
		const decisionsIndexPath = join(memPath, "projects", TEST_PROJECT, "decisions", "decisions.md");

		const content = readFileSync(decisionsIndexPath, "utf-8");

		// Just check parent field exists and has valid format
		expect(content).toMatch(/parent: "\[\[.*\/projects\/.*\/.*\]\]"/);
	});

	test("returns normalized slug for consistent path usage", () => {
		// Test that ensureProjectStructure returns the slug
		const slug = ensureProjectStructure("My Test Project");
		expect(slug).toBe("my-test-project");

		// Verify the folder was created with the slug, not original name
		const memPath = getMemFolderPath();
		const slugPath = join(memPath, "projects", "my-test-project");
		const originalPath = join(memPath, "projects", "My Test Project");

		expect(existsSync(slugPath)).toBe(true);
		expect(existsSync(originalPath)).toBe(false);

		// Clean up
		if (existsSync(slugPath)) {
			rmSync(slugPath, { recursive: true, force: true });
		}
	});

	test("slug can be used for consistent buildParentLink paths", () => {
		const slug = ensureProjectStructure("Project.With.Dots");
		expect(slug).toBe("project-with-dots");

		// Parent link should use the slug
		const parentLink = buildParentLink("_claude-mem", slug, "decisions");
		expect(parentLink).toBe("[[_claude-mem/projects/project-with-dots/decisions/decisions]]");

		// Clean up
		const memPath = getMemFolderPath();
		const path = join(memPath, "projects", slug);
		if (existsSync(path)) {
			rmSync(path, { recursive: true, force: true });
		}
	});

	test("creates canvases folder separately", () => {
		ensureProjectStructure(TEST_PROJECT);

		const memPath = getMemFolderPath();
		const canvasesPath = join(memPath, "projects", TEST_PROJECT, "canvases");

		// Canvases folder should exist
		expect(existsSync(canvasesPath)).toBe(true);

		// But canvases should NOT be in CATEGORIES (it's created separately)
		expect(CATEGORIES.includes("canvases" as any)).toBe(false);
	});
});

describe("generateFilename", () => {
	test("generates topic-based filename without date", () => {
		const filename = generateFilename("Authentication Bug");
		expect(filename).toBe("authentication-bug.md");
		expect(filename).not.toMatch(/^\d{4}-\d{2}-\d{2}/); // No date prefix
	});

	test("sanitizes path traversal attempts", () => {
		const filename1 = generateFilename("../escape");
		expect(filename1).not.toContain("..");
		expect(filename1).not.toContain("/");

		const filename2 = generateFilename("test/path");
		expect(filename2).not.toContain("/");

		const filename3 = generateFilename("test\\path");
		expect(filename3).not.toContain("\\");
	});

	test("normalizes special characters like slugifyProjectName", () => {
		expect(generateFilename("My Project Name")).toBe("my-project-name.md");
		expect(generateFilename("v1.2.3")).toBe("v1-2-3.md");
		expect(generateFilename("test@project!")).toBe("testproject.md");
	});

	test("collapses multiple hyphens", () => {
		expect(generateFilename("my  project")).toBe("my-project.md");
		expect(generateFilename("a...b")).toBe("a-b.md");
	});

	test("truncates to 50 characters", () => {
		const longTitle = "a".repeat(100);
		const filename = generateFilename(longTitle);
		expect(filename.length).toBeLessThanOrEqual(53); // 50 chars + .md
	});
});

describe("findExistingTopicNote", () => {
	test("returns null for non-existent category", () => {
		const memPath = getMemFolderPath();
		const projectPath = join(memPath, "projects", TEST_PROJECT);

		const result = findExistingTopicNote(projectPath, "nonexistent", "test");
		expect(result).toBe(null);
	});

	test("finds note with exact slug match", () => {
		ensureProjectStructure(TEST_PROJECT);

		const memPath = getMemFolderPath();
		const projectPath = join(memPath, "projects", TEST_PROJECT);
		const decisionsPath = join(projectPath, "decisions");

		// Create a test note
		const testNotePath = join(decisionsPath, "authentication-bug.md");
		writeFileSync(testNotePath, "---\ntype: decision\n---\nTest content", "utf-8");

		// Should find it
		const result = findExistingTopicNote(projectPath, "decisions", "Authentication Bug");
		expect(result).toBe(testNotePath);
	});

	test("returns null when no match exists", () => {
		ensureProjectStructure(TEST_PROJECT);

		const memPath = getMemFolderPath();
		const projectPath = join(memPath, "projects", TEST_PROJECT);

		const result = findExistingTopicNote(projectPath, "decisions", "NonExistent Topic");
		expect(result).toBe(null);
	});

	test("case-insensitive matching through slug normalization", () => {
		ensureProjectStructure(TEST_PROJECT);

		const memPath = getMemFolderPath();
		const projectPath = join(memPath, "projects", TEST_PROJECT);
		const decisionsPath = join(projectPath, "decisions");

		// Create a test note
		const testNotePath = join(decisionsPath, "my-decision.md");
		writeFileSync(testNotePath, "---\ntype: decision\n---\nTest content", "utf-8");

		// Should match regardless of case
		expect(findExistingTopicNote(projectPath, "decisions", "My Decision")).toBe(testNotePath);
		expect(findExistingTopicNote(projectPath, "decisions", "MY DECISION")).toBe(testNotePath);
		expect(findExistingTopicNote(projectPath, "decisions", "my decision")).toBe(testNotePath);
	});
});

describe("appendToExistingNote", () => {
	test("appends content to existing note", () => {
		ensureProjectStructure(TEST_PROJECT);

		const memPath = getMemFolderPath();
		const projectPath = join(memPath, "projects", TEST_PROJECT);
		const decisionsPath = join(projectPath, "decisions");
		const notePath = join(decisionsPath, "test-append.md");

		// Create initial note with proper frontmatter
		writeFileSync(notePath, `---
type: "decision"
title: "Test Append"
project: "${TEST_PROJECT}"
created: "2026-01-01T00:00:00.000Z"
tags: ["initial"]
status: "active"
entry_count: 1
---

Initial content`, "utf-8");

		// Append new content
		const success = appendToExistingNote(notePath, "New appended content", ["new-tag"]);
		expect(success).toBe(true);

		// Verify content was appended
		const content = readFileSync(notePath, "utf-8");
		expect(content).toContain("Initial content");
		expect(content).toContain("## Entry:");
		expect(content).toContain("New appended content");
	});

	test("merges tags without duplicates", () => {
		ensureProjectStructure(TEST_PROJECT);

		const memPath = getMemFolderPath();
		const projectPath = join(memPath, "projects", TEST_PROJECT);
		const decisionsPath = join(projectPath, "decisions");
		const notePath = join(decisionsPath, "test-tags.md");

		// Create initial note
		writeFileSync(notePath, `---
type: "decision"
title: "Test Tags"
project: "${TEST_PROJECT}"
created: "2026-01-01T00:00:00.000Z"
tags: ["tag1", "tag2"]
status: "active"
entry_count: 1
---

Initial content`, "utf-8");

		// Append with overlapping tags
		appendToExistingNote(notePath, "New content", ["tag2", "tag3"]);

		const content = readFileSync(notePath, "utf-8");
		// Should have all unique tags
		expect(content).toContain('"tag1"');
		expect(content).toContain('"tag2"');
		expect(content).toContain('"tag3"');
	});

	test("increments entry_count", () => {
		ensureProjectStructure(TEST_PROJECT);

		const memPath = getMemFolderPath();
		const projectPath = join(memPath, "projects", TEST_PROJECT);
		const decisionsPath = join(projectPath, "decisions");
		const notePath = join(decisionsPath, "test-count.md");

		// Create initial note with entry_count: 1
		writeFileSync(notePath, `---
type: "decision"
title: "Test Count"
project: "${TEST_PROJECT}"
created: "2026-01-01T00:00:00.000Z"
tags: []
status: "active"
entry_count: 1
---

Initial content`, "utf-8");

		// Append
		appendToExistingNote(notePath, "Second entry", []);

		const content = readFileSync(notePath, "utf-8");
		expect(content).toContain("entry_count: 2");
	});

	test("returns false for non-existent note", () => {
		const result = appendToExistingNote("/nonexistent/path.md", "content", []);
		expect(result).toBe(false);
	});
});

describe("addAliasToNote", () => {
	test("adds alias to note without existing aliases", () => {
		ensureProjectStructure(TEST_PROJECT);

		const memPath = getMemFolderPath();
		const projectPath = join(memPath, "projects", TEST_PROJECT);
		const decisionsPath = join(projectPath, "decisions");
		const notePath = join(decisionsPath, "test-alias.md");

		// Create initial note without aliases
		writeFileSync(notePath, `---
type: "decision"
title: "Test Alias"
project: "${TEST_PROJECT}"
created: "2026-01-01T00:00:00.000Z"
tags: []
status: "active"
---

Test content`, "utf-8");

		// Add alias
		const success = addAliasToNote(notePath, "Original Title");
		expect(success).toBe(true);

		// Verify alias was added
		const content = readFileSync(notePath, "utf-8");
		expect(content).toContain("aliases:");
		expect(content).toContain("Original Title");
	});

	test("adds alias to note with existing aliases", () => {
		ensureProjectStructure(TEST_PROJECT);

		const memPath = getMemFolderPath();
		const projectPath = join(memPath, "projects", TEST_PROJECT);
		const decisionsPath = join(projectPath, "decisions");
		const notePath = join(decisionsPath, "test-alias-existing.md");

		// Create note with existing alias
		writeFileSync(notePath, `---
type: "decision"
title: "Test Alias"
project: "${TEST_PROJECT}"
created: "2026-01-01T00:00:00.000Z"
tags: []
aliases: ["First Alias"]
status: "active"
---

Test content`, "utf-8");

		// Add another alias
		const success = addAliasToNote(notePath, "Second Alias");
		expect(success).toBe(true);

		// Verify both aliases exist
		const content = readFileSync(notePath, "utf-8");
		expect(content).toContain("First Alias");
		expect(content).toContain("Second Alias");
	});

	test("returns true if alias already exists (case-insensitive)", () => {
		ensureProjectStructure(TEST_PROJECT);

		const memPath = getMemFolderPath();
		const projectPath = join(memPath, "projects", TEST_PROJECT);
		const decisionsPath = join(projectPath, "decisions");
		const notePath = join(decisionsPath, "test-alias-duplicate.md");

		// Create note with existing alias
		writeFileSync(notePath, `---
type: "decision"
title: "Test"
project: "${TEST_PROJECT}"
created: "2026-01-01T00:00:00.000Z"
tags: []
aliases: ["Existing Alias"]
status: "active"
---

Test content`, "utf-8");

		// Try to add same alias (different case)
		const success = addAliasToNote(notePath, "existing alias");
		expect(success).toBe(true); // Should succeed (already exists)

		// Verify no duplicate was added
		const content = readFileSync(notePath, "utf-8");
		const aliasMatches = content.match(/Existing Alias/gi);
		expect(aliasMatches?.length).toBe(1);
	});

	test("returns false for empty alias", () => {
		ensureProjectStructure(TEST_PROJECT);

		const memPath = getMemFolderPath();
		const projectPath = join(memPath, "projects", TEST_PROJECT);
		const decisionsPath = join(projectPath, "decisions");
		const notePath = join(decisionsPath, "test-alias-empty.md");

		writeFileSync(notePath, `---
type: "decision"
title: "Test"
project: "${TEST_PROJECT}"
created: "2026-01-01T00:00:00.000Z"
tags: []
---

Test content`, "utf-8");

		expect(addAliasToNote(notePath, "")).toBe(false);
		expect(addAliasToNote(notePath, "   ")).toBe(false);
	});

	test("returns false for non-existent note", () => {
		expect(addAliasToNote("/nonexistent/path.md", "alias")).toBe(false);
	});

	test("respects MAX_ALIASES limit", () => {
		ensureProjectStructure(TEST_PROJECT);

		const memPath = getMemFolderPath();
		const projectPath = join(memPath, "projects", TEST_PROJECT);
		const decisionsPath = join(projectPath, "decisions");
		const notePath = join(decisionsPath, "test-alias-max.md");

		// Create note with MAX_ALIASES aliases already
		const existingAliases = Array.from({ length: MAX_ALIASES }, (_, i) => `Alias ${i + 1}`);
		writeFileSync(notePath, `---
type: "decision"
title: "Test"
project: "${TEST_PROJECT}"
created: "2026-01-01T00:00:00.000Z"
tags: []
aliases: [${existingAliases.map(a => `"${a}"`).join(", ")}]
---

Test content`, "utf-8");

		// Try to add one more - should fail
		const success = addAliasToNote(notePath, "One More Alias");
		expect(success).toBe(false);
	});
});

describe("renameNoteWithGenericTitle", () => {
	test("renames note to new slug", () => {
		ensureProjectStructure(TEST_PROJECT);

		const memPath = getMemFolderPath();
		const projectPath = join(memPath, "projects", TEST_PROJECT);
		const decisionsPath = join(projectPath, "decisions");
		const originalPath = join(decisionsPath, "specific-pid-error.md");

		// Create original note
		writeFileSync(originalPath, `---
type: "decision"
title: "Specific PID Error"
project: "${TEST_PROJECT}"
created: "2026-01-01T00:00:00.000Z"
tags: []
---

Test content`, "utf-8");

		// Rename to generic title
		const newPath = renameNoteWithGenericTitle(originalPath, "PID Issues");

		expect(newPath).not.toBeNull();
		expect(newPath).toContain("pid-issues.md");
		expect(existsSync(newPath!)).toBe(true);
		expect(existsSync(originalPath)).toBe(false);

		// Clean up
		if (newPath && existsSync(newPath)) {
			rmSync(newPath);
		}
	});

	test("returns original path if same slug", () => {
		ensureProjectStructure(TEST_PROJECT);

		const memPath = getMemFolderPath();
		const projectPath = join(memPath, "projects", TEST_PROJECT);
		const decisionsPath = join(projectPath, "decisions");
		const originalPath = join(decisionsPath, "same-slug.md");

		writeFileSync(originalPath, `---
type: "decision"
title: "Same Slug"
project: "${TEST_PROJECT}"
created: "2026-01-01T00:00:00.000Z"
tags: []
---

Test content`, "utf-8");

		// Rename to same slug (different casing)
		const result = renameNoteWithGenericTitle(originalPath, "Same Slug");

		expect(result).toBe(originalPath);
		expect(existsSync(originalPath)).toBe(true);
	});

	test("handles collision with suffix", () => {
		ensureProjectStructure(TEST_PROJECT);

		const memPath = getMemFolderPath();
		const projectPath = join(memPath, "projects", TEST_PROJECT);
		const decisionsPath = join(projectPath, "decisions");
		const originalPath = join(decisionsPath, "original-note.md");
		const existingPath = join(decisionsPath, "target-name.md");

		// Create original note
		writeFileSync(originalPath, `---
type: "decision"
title: "Original"
project: "${TEST_PROJECT}"
created: "2026-01-01T00:00:00.000Z"
tags: []
---

Original content`, "utf-8");

		// Create existing note at target path
		writeFileSync(existingPath, `---
type: "decision"
title: "Target Name"
project: "${TEST_PROJECT}"
created: "2026-01-01T00:00:00.000Z"
tags: []
---

Existing content`, "utf-8");

		// Rename should create target-name-2.md
		const newPath = renameNoteWithGenericTitle(originalPath, "Target Name");

		expect(newPath).not.toBeNull();
		expect(newPath).toContain("target-name-2.md");
		expect(existsSync(newPath!)).toBe(true);
		expect(existsSync(existingPath)).toBe(true); // Original target still exists

		// Clean up
		if (newPath && existsSync(newPath)) {
			rmSync(newPath);
		}
		if (existsSync(existingPath)) {
			rmSync(existingPath);
		}
	});

	test("returns original path for empty title", () => {
		ensureProjectStructure(TEST_PROJECT);

		const memPath = getMemFolderPath();
		const projectPath = join(memPath, "projects", TEST_PROJECT);
		const decisionsPath = join(projectPath, "decisions");
		const originalPath = join(decisionsPath, "test-empty-title.md");

		writeFileSync(originalPath, `---
type: "decision"
title: "Test"
project: "${TEST_PROJECT}"
created: "2026-01-01T00:00:00.000Z"
tags: []
---

Test content`, "utf-8");

		const result = renameNoteWithGenericTitle(originalPath, "");
		expect(result).toBe(originalPath);
	});

	test("returns null for non-existent note", () => {
		const result = renameNoteWithGenericTitle("/nonexistent/path.md", "New Title");
		expect(result).toBeNull();
	});

	test("updates title in frontmatter", () => {
		ensureProjectStructure(TEST_PROJECT);

		const memPath = getMemFolderPath();
		const projectPath = join(memPath, "projects", TEST_PROJECT);
		const decisionsPath = join(projectPath, "decisions");
		const originalPath = join(decisionsPath, "old-title-note.md");

		writeFileSync(originalPath, `---
type: "decision"
title: "Old Title"
project: "${TEST_PROJECT}"
created: "2026-01-01T00:00:00.000Z"
tags: []
---

Test content`, "utf-8");

		const newPath = renameNoteWithGenericTitle(originalPath, "New Generic Title");

		expect(newPath).not.toBeNull();
		const content = readFileSync(newPath!, "utf-8");
		expect(content).toContain('title: "New Generic Title"');

		// Clean up
		if (newPath && existsSync(newPath)) {
			rmSync(newPath);
		}
	});
});

describe("Tiered matching with aliases", () => {
	test("finds match via alias when title doesn't match directly", () => {
		ensureProjectStructure(TEST_PROJECT);

		const memPath = getMemFolderPath();
		const projectPath = join(memPath, "projects", TEST_PROJECT);
		const decisionsPath = join(projectPath, "decisions");
		// Use filename that will have gray-zone score with search title
		// "database-connection-pool" vs "database connection timeout" = ~0.5 Jaccard
		const notePath = join(decisionsPath, "database-connection-pool.md");

		// Create note with generic title but specific alias that will match
		writeFileSync(notePath, `---
type: "decision"
title: "Database Connection Pool"
project: "${TEST_PROJECT}"
created: "2026-01-01T00:00:00.000Z"
tags: []
aliases: ["database connection timeout handling", "db timeout configuration"]
---

Test content about database connections`, "utf-8");

		// Search with title that matches alias
		// Jaccard("database-connection-timeout-handling", "database-connection-pool"):
		// input words: [database, connection, timeout, handling]
		// file words: [database, connection, pool]
		// intersection: 2 (database, connection)
		// union: 5 (database, connection, timeout, handling, pool)
		// score: 2/5 = 0.4 (in gray zone 0.3-0.59)
		// With alias match, should find it
		const result = findSimilarTopicInCategory(
			projectPath,
			"decisions",
			"Database Connection Timeout Handling",
			0.6
		);

		// Should find the note via alias matching (alias has 100% match)
		expect(result).not.toBeNull();
		if (result) {
			expect(result.path).toContain("database-connection-pool.md");
		}
	});

	test("prefers direct slug match over alias match", () => {
		ensureProjectStructure(TEST_PROJECT);

		const memPath = getMemFolderPath();
		const projectPath = join(memPath, "projects", TEST_PROJECT);
		const decisionsPath = join(projectPath, "decisions");

		// Create note with exact slug match
		const exactMatchPath = join(decisionsPath, "authentication-bug.md");
		writeFileSync(exactMatchPath, `---
type: "decision"
title: "Authentication Bug"
project: "${TEST_PROJECT}"
created: "2026-01-01T00:00:00.000Z"
tags: []
---

Exact match content`, "utf-8");

		// Create another note with authentication-bug as alias
		const aliasMatchPath = join(decisionsPath, "security-issues.md");
		writeFileSync(aliasMatchPath, `---
type: "decision"
title: "Security Issues"
project: "${TEST_PROJECT}"
created: "2026-01-01T00:00:00.000Z"
tags: []
aliases: ["authentication bug"]
---

Alias match content`, "utf-8");

		// Search should find exact match
		const result = findSimilarTopicInCategory(
			projectPath,
			"decisions",
			"Authentication Bug",
			0.6
		);

		expect(result).not.toBeNull();
		expect(result?.path).toContain("authentication-bug.md");

		// Clean up
		rmSync(aliasMatchPath);
	});
});
