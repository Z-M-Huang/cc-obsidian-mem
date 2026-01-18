/**
 * Tests for styling.ts - Obsidian styling utilities
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
	DEFAULT_COLORS,
	generateCssSnippet,
	generateGraphColorGroups,
	applyStyling,
} from "../src/vault/styling.js";

// Use temp directory for test vault
const TEST_VAULT = join(tmpdir(), "cc-obsidian-mem-styling-test");

beforeEach(() => {
	// Create fresh test vault
	if (existsSync(TEST_VAULT)) {
		rmSync(TEST_VAULT, { recursive: true, force: true });
	}
	mkdirSync(TEST_VAULT, { recursive: true });
});

afterEach(() => {
	// Clean up test vault
	if (existsSync(TEST_VAULT)) {
		rmSync(TEST_VAULT, { recursive: true, force: true });
	}
});

describe("DEFAULT_COLORS", () => {
	test("has all required categories", () => {
		expect(DEFAULT_COLORS.decisions).toBeDefined();
		expect(DEFAULT_COLORS.errors).toBeDefined();
		expect(DEFAULT_COLORS.patterns).toBeDefined();
		expect(DEFAULT_COLORS.research).toBeDefined();
		expect(DEFAULT_COLORS.knowledge).toBeDefined();
		expect(DEFAULT_COLORS.sessions).toBeDefined();
	});

	test("has valid hex colors", () => {
		const hexRegex = /^#[0-9A-Fa-f]{6}$/;
		for (const [category, info] of Object.entries(DEFAULT_COLORS)) {
			expect(hexRegex.test(info.hex)).toBe(true);
		}
	});

	test("has valid canvas presets (1-6)", () => {
		const validPresets = ["1", "2", "3", "4", "5", "6"];
		for (const [category, info] of Object.entries(DEFAULT_COLORS)) {
			expect(validPresets.includes(info.canvas_preset)).toBe(true);
		}
	});

	test("rgb_int matches hex value", () => {
		for (const [category, info] of Object.entries(DEFAULT_COLORS)) {
			const computedRgb = parseInt(info.hex.slice(1), 16);
			expect(info.rgb_int).toBe(computedRgb);
		}
	});
});

describe("generateCssSnippet", () => {
	test("generates valid CSS", () => {
		const css = generateCssSnippet(DEFAULT_COLORS);

		// Check for CSS structure
		expect(css).toContain("/* cc-obsidian-mem tag colors");
		expect(css).toContain(".tag[href=");
		expect(css).toContain("background-color:");
	});

	test("includes all category tags", () => {
		const css = generateCssSnippet(DEFAULT_COLORS);

		expect(css).toContain('#decision"]');
		expect(css).toContain('#error"]');
		expect(css).toContain('#pattern"]');
		expect(css).toContain('#research"]');
		expect(css).toContain('#learning"]');
	});

	test("includes status tags", () => {
		const css = generateCssSnippet(DEFAULT_COLORS);

		expect(css).toContain('#active"]');
		expect(css).toContain('#superseded"]');
		expect(css).toContain('#draft"]');
	});

	test("uses colors from input", () => {
		const customColors = {
			...DEFAULT_COLORS,
			decisions: { hex: "#123456", rgb_int: 1193046, canvas_preset: "4" },
		};
		const css = generateCssSnippet(customColors);

		expect(css).toContain("#123456");
	});
});

describe("generateGraphColorGroups", () => {
	test("generates correct structure", () => {
		const groups = generateGraphColorGroups("test-project", "_claude-mem", DEFAULT_COLORS);

		expect(Array.isArray(groups)).toBe(true);
		expect(groups.length).toBe(Object.keys(DEFAULT_COLORS).length);
	});

	test("has correct query format", () => {
		const groups = generateGraphColorGroups("test-project", "_claude-mem", DEFAULT_COLORS);

		for (const group of groups) {
			expect(group.query).toMatch(/^path:_claude-mem\/projects\/test-project\//);
		}
	});

	test("has correct color format", () => {
		const groups = generateGraphColorGroups("test-project", "_claude-mem", DEFAULT_COLORS);

		for (const group of groups) {
			expect(group.color).toHaveProperty("a");
			expect(group.color).toHaveProperty("rgb");
			expect(group.color.a).toBe(1);
			expect(typeof group.color.rgb).toBe("number");
		}
	});

	test("normalizes Windows paths to forward slashes", () => {
		const groups = generateGraphColorGroups("test-project", "custom\\mem\\folder", DEFAULT_COLORS);

		for (const group of groups) {
			expect(group.query).not.toContain("\\");
			expect(group.query).toContain("custom/mem/folder");
		}
	});

	test("slugifies project name", () => {
		const groups = generateGraphColorGroups("My Project Name", "_claude-mem", DEFAULT_COLORS);

		for (const group of groups) {
			expect(group.query).toContain("my-project-name");
		}
	});
});

describe("applyStyling", () => {
	test("returns disabled result when disabled", () => {
		const result = applyStyling(TEST_VAULT, "test-project", "_claude-mem", {
			enabled: false,
		});

		expect(result.success).toBe(false);
		expect(result.reason).toBe("disabled");
	});

	test("returns invalid_project for empty project name", () => {
		const result = applyStyling(TEST_VAULT, "", "_claude-mem", {});

		expect(result.success).toBe(false);
		expect(result.reason).toBe("invalid_project");
	});

	test("returns invalid_project for whitespace-only project name", () => {
		const result = applyStyling(TEST_VAULT, "   ", "_claude-mem", {});

		expect(result.success).toBe(false);
		expect(result.reason).toBe("invalid_project");
	});

	test("creates CSS snippet when cssSnippet enabled", () => {
		const result = applyStyling(TEST_VAULT, "test-project", "_claude-mem", {
			cssSnippet: true,
			graphColors: false,
		});

		expect(result.success).toBe(true);
		expect(result.cssCreated).toBe(true);

		const cssPath = join(TEST_VAULT, ".obsidian", "snippets", "cc-obsidian-mem-colors.css");
		expect(existsSync(cssPath)).toBe(true);

		const css = readFileSync(cssPath, "utf-8");
		expect(css).toContain("cc-obsidian-mem tag colors");
	});

	test("creates graph.json when graphColors enabled", () => {
		const result = applyStyling(TEST_VAULT, "test-project", "_claude-mem", {
			cssSnippet: false,
			graphColors: true,
		});

		expect(result.success).toBe(true);
		expect(result.graphUpdated).toBe(true);

		const graphPath = join(TEST_VAULT, ".obsidian", "graph.json");
		expect(existsSync(graphPath)).toBe(true);

		const graph = JSON.parse(readFileSync(graphPath, "utf-8"));
		expect(graph.colorGroups).toBeDefined();
		expect(Array.isArray(graph.colorGroups)).toBe(true);
	});

	test("preserves existing graph.json settings", () => {
		// Create existing graph.json with custom settings
		const obsidianPath = join(TEST_VAULT, ".obsidian");
		mkdirSync(obsidianPath, { recursive: true });
		writeFileSync(
			join(obsidianPath, "graph.json"),
			JSON.stringify({
				colorGroups: [{ query: "path:custom", color: { a: 1, rgb: 123456 } }],
				showTags: true,
				customSetting: "preserved",
			}),
			"utf-8"
		);

		const result = applyStyling(TEST_VAULT, "test-project", "_claude-mem", {
			graphColors: true,
			cssSnippet: false,
		});

		expect(result.success).toBe(true);

		const graph = JSON.parse(readFileSync(join(obsidianPath, "graph.json"), "utf-8"));
		expect(graph.customSetting).toBe("preserved");
		expect(graph.showTags).toBe(true);
		// Should have custom group + new groups
		expect(graph.colorGroups.length).toBeGreaterThan(Object.keys(DEFAULT_COLORS).length);
	});

	test("replaces existing color groups for same project", () => {
		// Create existing graph.json with old project groups
		const obsidianPath = join(TEST_VAULT, ".obsidian");
		mkdirSync(obsidianPath, { recursive: true });
		writeFileSync(
			join(obsidianPath, "graph.json"),
			JSON.stringify({
				colorGroups: [
					{ query: "path:_claude-mem/projects/test-project/decisions", color: { a: 1, rgb: 111111 } },
					{ query: "path:other-folder", color: { a: 1, rgb: 222222 } },
				],
			}),
			"utf-8"
		);

		applyStyling(TEST_VAULT, "test-project", "_claude-mem", {
			graphColors: true,
			cssSnippet: false,
		});

		const graph = JSON.parse(readFileSync(join(obsidianPath, "graph.json"), "utf-8"));

		// Other folder should be preserved
		const otherGroup = graph.colorGroups.find((g: any) => g.query === "path:other-folder");
		expect(otherGroup).toBeDefined();

		// Old project group should be replaced with new ones
		const decisionsGroup = graph.colorGroups.find((g: any) =>
			g.query.includes("test-project/decisions")
		);
		expect(decisionsGroup).toBeDefined();
		expect(decisionsGroup.color.rgb).toBe(DEFAULT_COLORS.decisions.rgb_int);
	});

	test("skips rewrite when content unchanged (caching)", () => {
		// First call
		applyStyling(TEST_VAULT, "test-project", "_claude-mem", {
			cssSnippet: true,
			graphColors: false,
		});

		const cssPath = join(TEST_VAULT, ".obsidian", "snippets", "cc-obsidian-mem-colors.css");
		const originalMtime = Bun.file(cssPath).lastModified;

		// Wait a bit
		Bun.sleepSync(50);

		// Second call with same config
		const result = applyStyling(TEST_VAULT, "test-project", "_claude-mem", {
			cssSnippet: true,
			graphColors: false,
		});

		expect(result.success).toBe(true);
		expect(result.cssCreated).toBe(true);

		// File should not have been rewritten
		const newMtime = Bun.file(cssPath).lastModified;
		expect(newMtime).toBe(originalMtime);
	});

	test("handles corrupted graph.json gracefully", () => {
		// Create corrupted graph.json
		const obsidianPath = join(TEST_VAULT, ".obsidian");
		mkdirSync(obsidianPath, { recursive: true });
		writeFileSync(join(obsidianPath, "graph.json"), "not valid json{{{", "utf-8");

		const result = applyStyling(TEST_VAULT, "test-project", "_claude-mem", {
			graphColors: true,
			cssSnippet: false,
		});

		expect(result.success).toBe(true);
		expect(result.graphUpdated).toBe(true);

		// Should have created a valid graph.json
		const graph = JSON.parse(readFileSync(join(obsidianPath, "graph.json"), "utf-8"));
		expect(graph.colorGroups).toBeDefined();
	});

	test("applies custom colors", () => {
		const result = applyStyling(TEST_VAULT, "test-project", "_claude-mem", {
			cssSnippet: true,
			graphColors: true,
			colors: {
				decisions: { hex: "#AABBCC", rgb_int: 11189196, canvas_preset: "1" },
			},
		});

		expect(result.success).toBe(true);

		const cssPath = join(TEST_VAULT, ".obsidian", "snippets", "cc-obsidian-mem-colors.css");
		const css = readFileSync(cssPath, "utf-8");
		expect(css).toContain("#AABBCC");

		const graphPath = join(TEST_VAULT, ".obsidian", "graph.json");
		const graph = JSON.parse(readFileSync(graphPath, "utf-8"));
		const decisionsGroup = graph.colorGroups.find((g: any) =>
			g.query.includes("decisions")
		);
		expect(decisionsGroup.color.rgb).toBe(11189196);
	});

	test("partial success when CSS fails but graph succeeds", () => {
		// Create snippets as a file (not directory) to cause CSS write failure
		const obsidianPath = join(TEST_VAULT, ".obsidian");
		mkdirSync(obsidianPath, { recursive: true });
		writeFileSync(join(obsidianPath, "snippets"), "file not dir", "utf-8");

		const result = applyStyling(TEST_VAULT, "test-project", "_claude-mem", {
			cssSnippet: true,
			graphColors: true,
		});

		// Overall should fail because CSS failed
		expect(result.success).toBe(false);
		expect(result.cssCreated).toBe(false);
		expect(result.graphUpdated).toBe(true);
		expect(result.error).toContain("CSS");
	});
});
