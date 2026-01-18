/**
 * Obsidian canvas generation for project visualization
 * Generates dashboard, timeline, and graph canvases
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join, basename } from "path";
import { getProjectPath } from "./vault-manager.js";
import { loadConfig } from "../shared/config.js";
import { createLogger } from "../shared/logger.js";
import { DEFAULT_COLORS } from "./styling.js";

interface CanvasNode {
	id: string;
	type: "file";
	file: string;
	x: number;
	y: number;
	width: number;
	height: number;
	color?: string;
}

interface CanvasEdge {
	id: string;
	fromNode: string;
	toNode: string;
	fromSide: string;
	toSide: string;
}

interface Canvas {
	nodes: CanvasNode[];
	edges: CanvasEdge[];
}

/**
 * Get canvas color preset for a category from shared DEFAULT_COLORS
 * Returns undefined if category not found or if coloring is disabled
 */
function getCategoryCanvasColor(category: string, enabled: boolean): string | undefined {
	if (!enabled) return undefined;
	return DEFAULT_COLORS[category]?.canvas_preset;
}

/**
 * Generate dashboard canvas (grid layout grouped by category)
 */
export function generateDashboardCanvas(projectSlug: string): string[] {
	const logger = createLogger({ verbose: false });

	try {
		const config = loadConfig();
		const memFolder = config.vault.memFolder || "_claude-mem";
		const projectPath = getProjectPath(projectSlug);
		const canvasPath = join(projectPath, "canvases", "dashboard.canvas");

		// Check update strategy
		if (config.canvas?.updateStrategy === "skip" && existsSync(canvasPath)) {
			return [];
		}

		const categories = ["decisions", "patterns", "errors", "research", "knowledge"];
		const nodes: CanvasNode[] = [];
		let x = 0;
		const y = 0;
		const canvasColorsEnabled = config.styling?.canvasColors !== false;

		for (const category of categories) {
			const categoryPath = join(projectPath, category);
			if (!existsSync(categoryPath)) {
				continue;
			}

			const files = readdirSync(categoryPath).filter((f) => f.endsWith(".md") && f !== `${category}.md`);

			files.forEach((file, index) => {
				nodes.push({
					id: `${category}-${index}`,
					type: "file",
					file: `${memFolder}/projects/${projectSlug}/${category}/${file}`,
					x: x,
					y: y + index * 200,
					width: 400,
					height: 150,
					color: getCategoryCanvasColor(category, canvasColorsEnabled),
				});
			});

			x += 500;
		}

		const canvas: Canvas = { nodes, edges: [] };
		writeFileSync(canvasPath, JSON.stringify(canvas, null, 2), "utf-8");

		return [canvasPath];
	} catch (error) {
		logger.error("Failed to generate dashboard canvas", { error, projectSlug });
		return [];
	}
}

/**
 * Generate timeline canvas (decisions sorted chronologically)
 */
export function generateTimelineCanvas(projectSlug: string): string[] {
	const logger = createLogger({ verbose: false });

	try {
		const config = loadConfig();
		const memFolder = config.vault.memFolder || "_claude-mem";
		const projectPath = getProjectPath(projectSlug);
		const canvasPath = join(projectPath, "canvases", "timeline.canvas");

		// Check update strategy
		if (config.canvas?.updateStrategy === "skip" && existsSync(canvasPath)) {
			return [];
		}

		const decisionsPath = join(projectPath, "decisions");
		if (!existsSync(decisionsPath)) {
			return [];
		}

		const files = readdirSync(decisionsPath)
			.filter((f) => f.endsWith(".md") && f !== "decisions.md")
			.sort();

		const nodes: CanvasNode[] = files.map((file, index) => ({
			id: `decision-${index}`,
			type: "file",
			file: `${memFolder}/projects/${projectSlug}/decisions/${file}`,
			x: 0,
			y: index * 250,
			width: 500,
			height: 200,
		}));

		const canvas: Canvas = { nodes, edges: [] };
		writeFileSync(canvasPath, JSON.stringify(canvas, null, 2), "utf-8");

		return [canvasPath];
	} catch (error) {
		logger.error("Failed to generate timeline canvas", { error, projectSlug });
		return [];
	}
}

/**
 * Generate knowledge graph canvas (radial layout)
 */
export function generateGraphCanvas(projectSlug: string): string[] {
	const logger = createLogger({ verbose: false });

	try {
		const config = loadConfig();
		const memFolder = config.vault.memFolder || "_claude-mem";
		const projectPath = getProjectPath(projectSlug);
		const canvasPath = join(projectPath, "canvases", "graph.canvas");

		// Check update strategy
		if (config.canvas?.updateStrategy === "skip" && existsSync(canvasPath)) {
			return [];
		}

		// Center node: project
		const nodes: CanvasNode[] = [
			{
				id: "project",
				type: "file",
				file: `${memFolder}/projects/${projectSlug}/${projectSlug}.md`,
				x: 0,
				y: 0,
				width: 400,
				height: 150,
			},
		];

		const categories = ["decisions", "patterns", "errors"];
		const radius = 600;
		const canvasColorsEnabled = config.styling?.canvasColors !== false;

		categories.forEach((category, catIndex) => {
			const categoryPath = join(projectPath, category);
			if (!existsSync(categoryPath)) {
				return;
			}

			const files = readdirSync(categoryPath)
				.filter((f) => f.endsWith(".md") && f !== `${category}.md`)
				.slice(0, 5); // Limit to 5 per category

			const angle = (2 * Math.PI * catIndex) / categories.length;
			const cx = Math.cos(angle) * radius;
			const cy = Math.sin(angle) * radius;

			files.forEach((file, fileIndex) => {
				const subAngle = angle + (fileIndex - 2) * 0.3;
				const x = Math.cos(subAngle) * radius;
				const y = Math.sin(subAngle) * radius;

				nodes.push({
					id: `${category}-${fileIndex}`,
					type: "file",
					file: `${memFolder}/projects/${projectSlug}/${category}/${file}`,
					x: x,
					y: y,
					width: 300,
					height: 120,
					color: getCategoryCanvasColor(category, canvasColorsEnabled),
				});
			});
		});

		const canvas: Canvas = { nodes, edges: [] };
		writeFileSync(canvasPath, JSON.stringify(canvas, null, 2), "utf-8");

		return [canvasPath];
	} catch (error) {
		logger.error("Failed to generate graph canvas", { error, projectSlug });
		return [];
	}
}

/**
 * Generate all canvases for a project
 */
export function generateAllCanvases(projectSlug: string): string[] {
	const paths: string[] = [];

	paths.push(...generateDashboardCanvas(projectSlug));
	paths.push(...generateTimelineCanvas(projectSlug));
	paths.push(...generateGraphCanvas(projectSlug));

	return paths;
}
