/**
 * Tests for AI configuration and validation
 */

import { describe, it, expect } from "bun:test";
import { validateModel, VALID_MODELS } from "../src/shared/config.js";

describe("AI Configuration", () => {
	describe("validateModel", () => {
		it("accepts valid model names", () => {
			expect(validateModel("sonnet")).toBe("sonnet");
			expect(validateModel("haiku")).toBe("haiku");
			expect(validateModel("opus")).toBe("opus");
		});

		it("returns sonnet for undefined/null", () => {
			expect(validateModel(undefined)).toBe("sonnet");
			expect(validateModel(null)).toBe("sonnet");
		});

		it("returns sonnet for invalid model names", () => {
			expect(validateModel("invalid")).toBe("sonnet");
			expect(validateModel("claude-3")).toBe("sonnet");
			expect(validateModel("gpt-4")).toBe("sonnet");
			expect(validateModel("")).toBe("sonnet");
		});

		it("returns sonnet for non-string values", () => {
			expect(validateModel(123)).toBe("sonnet");
			expect(validateModel({})).toBe("sonnet");
			expect(validateModel([])).toBe("sonnet");
			expect(validateModel(true)).toBe("sonnet");
		});

		it("is case-sensitive", () => {
			// These should fail and return sonnet
			expect(validateModel("SONNET")).toBe("sonnet");
			expect(validateModel("Haiku")).toBe("sonnet");
			expect(validateModel("OPUS")).toBe("sonnet");
		});
	});

	describe("VALID_MODELS constant", () => {
		it("contains exactly three models", () => {
			expect(VALID_MODELS.length).toBe(3);
		});

		it("contains sonnet, haiku, opus", () => {
			expect(VALID_MODELS).toContain("sonnet");
			expect(VALID_MODELS).toContain("haiku");
			expect(VALID_MODELS).toContain("opus");
		});
	});
});
