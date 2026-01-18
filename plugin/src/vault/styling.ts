/**
 * Obsidian styling utilities for cc-obsidian-mem
 * Generates CSS snippets and graph color groups
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { ColorMap, ColorInfo, StylingConfig, StylingResult } from "../shared/types.js";
import { createLogger } from "../shared/logger.js";
import { slugifyProjectName } from "./vault-manager.js";

/**
 * Write file only if content has changed (avoids unnecessary I/O)
 * Returns true if file was written, false if skipped (no changes)
 */
function writeIfChanged(filePath: string, content: string): boolean {
	try {
		const existing = readFileSync(filePath, "utf-8");
		if (existing === content) {
			return false; // No changes needed
		}
	} catch {
		// File doesn't exist or can't be read - proceed with write
	}
	writeFileSync(filePath, content, "utf-8");
	return true;
}

export const DEFAULT_COLORS: ColorMap = {
	decisions: { hex: "#4ECDC4", rgb_int: 5164484, canvas_preset: "4" },
	errors: { hex: "#FF6B6B", rgb_int: 16739179, canvas_preset: "1" },
	patterns: { hex: "#FFE66D", rgb_int: 16770669, canvas_preset: "3" },
	research: { hex: "#FFA500", rgb_int: 16753920, canvas_preset: "2" },
	knowledge: { hex: "#66CDFF", rgb_int: 6737407, canvas_preset: "5" },
	sessions: { hex: "#9B59B6", rgb_int: 10181046, canvas_preset: "6" },
};

const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

/**
 * Validate hex color format
 */
function isValidHexColor(hex: string): boolean {
	return HEX_COLOR_REGEX.test(hex);
}

/**
 * Validate canvas preset value
 */
function isValidCanvasPreset(preset: string): boolean {
	return ["1", "2", "3", "4", "5", "6"].includes(preset);
}

/**
 * Compute rgb_int from hex color
 */
function hexToRgbInt(hex: string): number {
	return parseInt(hex.slice(1), 16);
}

/**
 * Validate and normalize color info
 */
function validateColorInfo(
	category: string,
	info: Partial<ColorInfo>
): ColorInfo {
	const defaultInfo = DEFAULT_COLORS[category] || DEFAULT_COLORS.decisions;

	// Validate hex color
	const hex = info.hex && isValidHexColor(info.hex) ? info.hex : defaultInfo.hex;

	// Derive or validate rgb_int
	let rgb_int: number;
	if (info.rgb_int !== undefined) {
		// User provided rgb_int - validate range
		rgb_int =
			typeof info.rgb_int === "number" &&
			info.rgb_int >= 0 &&
			info.rgb_int <= 16777215
				? info.rgb_int
				: hexToRgbInt(hex);
	} else {
		// Compute from validated hex
		rgb_int = hexToRgbInt(hex);
	}

	// Validate canvas preset
	const canvas_preset =
		info.canvas_preset && isValidCanvasPreset(info.canvas_preset)
			? info.canvas_preset
			: defaultInfo.canvas_preset;

	return { hex, rgb_int, canvas_preset };
}

/**
 * Merge user colors with defaults
 */
function mergeColors(userColors?: Partial<ColorMap>): ColorMap {
	if (!userColors) {
		return { ...DEFAULT_COLORS };
	}

	const merged: ColorMap = {};

	for (const category of Object.keys(DEFAULT_COLORS)) {
		merged[category] = validateColorInfo(
			category,
			userColors[category] || {}
		);
	}

	return merged;
}

/**
 * Generate CSS snippet for tag coloring
 */
export function generateCssSnippet(colors: ColorMap): string {
	const css = `/* cc-obsidian-mem tag colors - auto-generated */
/* Enable in: Settings → Appearance → CSS snippets */

/* Category tags */
.tag[href="#decision"], .tag[href="#decisions"] {
  background-color: ${colors.decisions.hex} !important;
  color: #1a1a1a !important;
  padding: 2px 6px;
  border-radius: 4px;
}

.tag[href="#error"], .tag[href="#errors"] {
  background-color: ${colors.errors.hex} !important;
  color: white !important;
  padding: 2px 6px;
  border-radius: 4px;
}

.tag[href="#pattern"], .tag[href="#patterns"] {
  background-color: ${colors.patterns.hex} !important;
  color: #1a1a1a !important;
  padding: 2px 6px;
  border-radius: 4px;
}

.tag[href="#research"] {
  background-color: ${colors.research.hex} !important;
  color: #1a1a1a !important;
  padding: 2px 6px;
  border-radius: 4px;
}

.tag[href="#learning"], .tag[href="#knowledge"] {
  background-color: ${colors.knowledge.hex} !important;
  color: #1a1a1a !important;
  padding: 2px 6px;
  border-radius: 4px;
}

/* Status tags */
.tag[href="#active"] {
  background-color: #2ecc71 !important;
  color: white !important;
  padding: 2px 6px;
  border-radius: 4px;
}

.tag[href="#superseded"] {
  background-color: #95a5a6 !important;
  color: white !important;
  padding: 2px 6px;
  border-radius: 4px;
}

.tag[href="#draft"] {
  background-color: #f39c12 !important;
  color: white !important;
  padding: 2px 6px;
  border-radius: 4px;
}
`;

	return css;
}

interface ColorGroup {
	query: string;
	color: { a: number; rgb: number };
}

/**
 * Generate Obsidian graph color groups for a project
 */
export function generateGraphColorGroups(
	project: string,
	memFolder: string,
	colors: ColorMap
): ColorGroup[] {
	const projectSlug = slugifyProjectName(project);

	// Normalize paths to forward slashes for Obsidian
	const normalizedMemFolder = memFolder.replace(/\\/g, "/");
	const normalizedProject = projectSlug.replace(/\\/g, "/");

	const basePath = `${normalizedMemFolder}/projects/${normalizedProject}`;

	const groups: ColorGroup[] = [];

	for (const [category, colorInfo] of Object.entries(colors)) {
		groups.push({
			query: `path:${basePath}/${category}`,
			color: { a: 1, rgb: colorInfo.rgb_int },
		});
	}

	return groups;
}

const MINIMAL_GRAPH_JSON = {
	colorGroups: [],
	"collapse-filter": true,
	search: "",
	showTags: false,
	showAttachments: false,
	hideUnresolved: false,
	showOrphans: true,
	"collapse-color-groups": true,
	"collapse-display": true,
	showArrow: false,
	textFadeMultiplier: 0,
	nodeSizeMultiplier: 1,
	lineSizeMultiplier: 1,
	"collapse-forces": true,
	centerStrength: 0.5,
	repelStrength: 10,
	linkStrength: 1,
	linkDistance: 250,
	scale: 1,
	close: true,
};

interface ApplyCssResult {
	created: boolean;
	error?: string;
}

/**
 * Apply CSS snippet styling to vault
 */
function applyCssSnippet(
	vaultPath: string,
	colors: ColorMap,
	logger: ReturnType<typeof createLogger>
): ApplyCssResult {
	try {
		const obsidianPath = join(vaultPath, ".obsidian");
		const snippetsPath = join(obsidianPath, "snippets");

		// Create directories if they don't exist
		if (!existsSync(obsidianPath)) {
			mkdirSync(obsidianPath, { recursive: true });
		}
		if (!existsSync(snippetsPath)) {
			mkdirSync(snippetsPath, { recursive: true });
		}

		const cssPath = join(snippetsPath, "cc-obsidian-mem-colors.css");
		const css = generateCssSnippet(colors);

		const wasWritten = writeIfChanged(cssPath, css);
		logger.debug(wasWritten ? "CSS snippet created" : "CSS snippet unchanged", { path: cssPath });
		return { created: true };
	} catch (error) {
		logger.error("Failed to create CSS snippet", { error });
		return { created: false, error: `CSS write failed: ${error}` };
	}
}

interface ApplyGraphResult {
	updated: boolean;
	error?: string;
}

/**
 * Apply graph color groups to vault
 */
function applyGraphColors(
	vaultPath: string,
	project: string,
	memFolder: string,
	colors: ColorMap,
	logger: ReturnType<typeof createLogger>
): ApplyGraphResult {
	try {
		const obsidianPath = join(vaultPath, ".obsidian");
		const graphPath = join(obsidianPath, "graph.json");

		// Create .obsidian if it doesn't exist
		if (!existsSync(obsidianPath)) {
			mkdirSync(obsidianPath, { recursive: true });
		}

		let graphConfig: unknown = { ...MINIMAL_GRAPH_JSON };

		// Read existing graph.json directly (avoids TOCTOU race condition)
		try {
			const existing = JSON.parse(readFileSync(graphPath, "utf-8"));
			graphConfig = existing;
		} catch (readError: unknown) {
			// File doesn't exist or is unreadable - use minimal schema
			const isNotFound = readError instanceof Error && (readError as NodeJS.ErrnoException).code === "ENOENT";
			if (!isNotFound) {
				logger.warn("Failed to read/parse graph.json, using minimal schema", {
					error: readError,
				});
			}
			graphConfig = { ...MINIMAL_GRAPH_JSON };
		}

		// Ensure graphConfig is a valid object with colorGroups array
		if (
			!graphConfig ||
			typeof graphConfig !== "object" ||
			Array.isArray(graphConfig)
		) {
			// Not a valid object - replace entirely
			graphConfig = { ...MINIMAL_GRAPH_JSON };
		}
		const typedConfig = graphConfig as Record<string, unknown>;
		if (!Array.isArray(typedConfig.colorGroups)) {
			typedConfig.colorGroups = [];
		}

		// Generate new color groups
		const newGroups = generateGraphColorGroups(project, memFolder, colors);

		// Normalize paths in merge pattern
		const normalizedMemFolder = memFolder.replace(/\\/g, "/");
		const normalizedProject = slugifyProjectName(project).replace(/\\/g, "/");
		const pathPattern = `${normalizedMemFolder}/projects/${normalizedProject}/`;

		// Filter out existing groups for this project (with type guard for query)
		const colorGroups = typedConfig.colorGroups as unknown[];
		const existingGroups = colorGroups.filter(
			(g): g is ColorGroup =>
				typeof g === "object" &&
				g !== null &&
				typeof (g as ColorGroup).query === "string" &&
				!(g as ColorGroup).query.includes(pathPattern)
		);

		// Merge: preserve user's custom groups + append our new groups
		typedConfig.colorGroups = [...existingGroups, ...newGroups];

		const graphContent = JSON.stringify(graphConfig, null, 2);
		const wasWritten = writeIfChanged(graphPath, graphContent);
		logger.debug(wasWritten ? "Graph color groups updated" : "Graph color groups unchanged", { path: graphPath });
		return { updated: true };
	} catch (error) {
		logger.error("Failed to update graph.json", { error });
		return { updated: false, error: `Graph update failed: ${error}` };
	}
}

/**
 * Apply styling to Obsidian vault
 */
export function applyStyling(
	vaultPath: string,
	project: string,
	memFolder: string,
	config: StylingConfig
): StylingResult {
	const logger = createLogger({ verbose: false });

	// Check if disabled
	if (config.enabled === false) {
		return { success: false, reason: "disabled" };
	}

	// Validate project name
	if (!project?.trim()) {
		return { success: false, reason: "invalid_project" };
	}

	const result: StylingResult = { success: true };
	const colors = mergeColors(config.colors);

	// Apply CSS snippet if enabled
	if (config.cssSnippet !== false) {
		const cssResult = applyCssSnippet(vaultPath, colors, logger);
		result.cssCreated = cssResult.created;
		if (cssResult.error) {
			result.error = cssResult.error;
		}
	}

	// Apply graph colors if enabled
	if (config.graphColors !== false) {
		const graphResult = applyGraphColors(vaultPath, project, memFolder, colors, logger);
		result.graphUpdated = graphResult.updated;
		if (graphResult.error && !result.error) {
			result.error = graphResult.error;
		}
	}

	// Determine overall success
	const cssSuccess = config.cssSnippet === false || result.cssCreated === true;
	const graphSuccess = config.graphColors === false || result.graphUpdated === true;
	result.success = cssSuccess && graphSuccess;

	return result;
}
