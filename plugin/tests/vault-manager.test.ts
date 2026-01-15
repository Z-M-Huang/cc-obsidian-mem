/**
 * Tests for vault-manager.ts hierarchical index structure
 */

import { describe, test, expect, afterEach } from "bun:test";
import { existsSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { ensureProjectStructure, buildParentLink, CATEGORIES, getMemFolderPath, slugifyProjectName } from "../src/vault/vault-manager.js";

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
});
