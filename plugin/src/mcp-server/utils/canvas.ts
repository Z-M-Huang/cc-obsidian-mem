import * as fs from 'fs';
import * as path from 'path';
import type { NoteStatus } from '../../shared/types.js';

/**
 * Canvas node types (JSON Canvas spec)
 */
export interface CanvasNode {
  id: string;
  type: 'file' | 'text' | 'group';
  x: number;
  y: number;
  width: number;
  height: number;
  file?: string;
  text?: string;
  color?: string;
  label?: string;  // For group nodes
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: 'top' | 'right' | 'bottom' | 'left';
  toSide?: 'top' | 'right' | 'bottom' | 'left';
  color?: string;
  label?: string;
}

export interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/**
 * Canvas-specific note representation
 */
export interface CanvasNote {
  path: string;           // Vault-relative path
  title: string;          // From frontmatter.title or filename
  folder: CanvasFolder;   // Detected from path
  status: NoteStatus;     // From frontmatter.status || 'active'
  created: string;        // ISO date string from frontmatter.created
}

export type CanvasFolder = 'errors' | 'decisions' | 'patterns' | 'files' | 'knowledge' | 'research';

/**
 * Fixed folder order for deterministic layout
 */
const FOLDER_ORDER: CanvasFolder[] = [
  'errors', 'decisions', 'patterns', 'files', 'knowledge', 'research'
];

/**
 * Folder to group mapping with colors
 */
const FOLDER_TO_GROUP: Record<CanvasFolder, { label: string; color: string }> = {
  errors: { label: 'Errors', color: '1' },       // red
  decisions: { label: 'Decisions', color: '4' }, // green
  patterns: { label: 'Patterns', color: '3' },   // yellow
  files: { label: 'Files', color: '6' },         // purple
  knowledge: { label: 'Knowledge', color: '5' }, // cyan
  research: { label: 'Research', color: '2' },   // orange
};

// Layout constants
const NODE_WIDTH = 400;
const NODE_HEIGHT = 200;
const SPACING = 50;
const GROUP_PADDING = 50;
const COLS = 3;

/**
 * Detect folder type from note path
 */
export function detectFolder(notePath: string): CanvasFolder {
  if (notePath.includes('/errors/')) return 'errors';
  if (notePath.includes('/decisions/')) return 'decisions';
  if (notePath.includes('/patterns/')) return 'patterns';
  if (notePath.includes('/files/')) return 'files';
  if (notePath.includes('/research/')) return 'research';
  if (notePath.includes('/knowledge/')) return 'knowledge';
  return 'knowledge'; // default
}

/**
 * Generate unique ID from file path (collision-free)
 */
export function pathToId(notePath: string): string {
  return `file-${encodeURIComponent(notePath)}`;
}

/**
 * Safe date parsing with fallback
 */
export function parseDate(dateStr: string | undefined): Date {
  if (!dateStr) return new Date(0);
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

/**
 * Grid layout for notes within a group
 */
export function gridLayout(
  notes: CanvasNote[],
  startX: number,
  startY: number
): CanvasNode[] {
  return notes.map((note, i) => ({
    id: pathToId(note.path),
    type: 'file' as const,
    file: note.path,
    x: startX + (i % COLS) * (NODE_WIDTH + SPACING),
    y: startY + Math.floor(i / COLS) * (NODE_HEIGHT + SPACING),
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  }));
}

/**
 * Timeline layout for chronological display
 */
export function timelineLayout(notes: CanvasNote[]): CanvasNode[] {
  const sorted = [...notes].sort(
    (a, b) => parseDate(a.created).getTime() - parseDate(b.created).getTime()
  );

  return sorted.map((note, i) => ({
    id: pathToId(note.path),
    type: 'file' as const,
    file: note.path,
    x: i * (NODE_WIDTH + SPACING * 2),
    y: 0,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    color: note.status === 'superseded' ? '5' : '4', // gray vs green
  }));
}

/**
 * Radial layout with project at center
 */
export function radialLayout(
  projectName: string,
  notes: CanvasNote[]
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const centerNode: CanvasNode = {
    id: 'project-center',
    type: 'text',
    text: `# ${projectName}`,
    x: 0,
    y: 0,
    width: 300,
    height: 150,
  };

  const radius = 500;
  const angleStep = (2 * Math.PI) / Math.max(notes.length, 1);

  const surrounding = notes.map((note, i) => ({
    id: pathToId(note.path),
    type: 'file' as const,
    file: note.path,
    x: Math.round(Math.cos(i * angleStep) * radius),
    y: Math.round(Math.sin(i * angleStep) * radius),
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  }));

  // Create edges from center to each note
  // Use path-based IDs for deterministic, collision-free edges during append operations
  const edges: CanvasEdge[] = surrounding.map((node) => ({
    id: `edge-center-${node.id}`,
    fromNode: 'project-center',
    toNode: node.id,
    fromSide: 'right' as const,
    toSide: 'left' as const,
  }));

  return {
    nodes: [centerNode, ...surrounding],
    edges,
  };
}

/**
 * Generate project dashboard canvas with grouped notes
 */
export function generateProjectDashboard(
  project: string,
  notes: CanvasNote[]
): CanvasData {
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];

  // Group notes by folder
  const groupedByFolder = notes.reduce((acc, note) => {
    const folder = note.folder;
    if (!acc[folder]) acc[folder] = [];
    acc[folder].push(note);
    return acc;
  }, {} as Record<CanvasFolder, CanvasNote[]>);

  // Create groups in fixed order for deterministic layout
  let yOffset = 0;
  for (const folder of FOLDER_ORDER) {
    const folderNotes = groupedByFolder[folder] || [];
    if (folderNotes.length === 0) continue;

    const groupConfig = FOLDER_TO_GROUP[folder];
    const rows = Math.ceil(folderNotes.length / COLS);
    const groupHeight = rows * (NODE_HEIGHT + SPACING) + GROUP_PADDING * 2;
    const groupWidth = COLS * (NODE_WIDTH + SPACING) + GROUP_PADDING * 2;

    // Create group node
    nodes.push({
      id: `group-${folder}`,
      type: 'group',
      label: groupConfig.label,
      x: 0,
      y: yOffset,
      width: groupWidth,
      height: groupHeight,
      color: groupConfig.color,
    });

    // Add file nodes within group bounds
    const fileNodes = gridLayout(
      folderNotes,
      GROUP_PADDING,
      yOffset + GROUP_PADDING
    );
    nodes.push(...fileNodes);

    yOffset += groupHeight + SPACING;
  }

  return { nodes, edges };
}

/**
 * Generate decision timeline canvas
 */
export function generateDecisionTimeline(
  project: string,
  notes: CanvasNote[]
): CanvasData {
  // Filter to only decision notes
  const decisions = notes.filter(n => n.folder === 'decisions');

  if (decisions.length === 0) {
    return { nodes: [], edges: [] };
  }

  const nodes = timelineLayout(decisions);
  const edges: CanvasEdge[] = [];

  // Create edges for superseded relationships
  // (In a full implementation, we'd parse frontmatter.superseded_by)

  return { nodes, edges };
}

/**
 * Generate knowledge graph canvas
 */
export function generateKnowledgeGraph(
  project: string,
  notes: CanvasNote[]
): CanvasData {
  return radialLayout(project, notes);
}

/**
 * Write canvas file to disk
 */
export function writeCanvas(
  canvasPath: string,
  data: CanvasData,
  updateStrategy: 'overwrite' | 'append' | 'skip',
  force: boolean = false
): { written: boolean; path: string } {
  const exists = fs.existsSync(canvasPath);

  // Handle skip strategy
  if (exists && updateStrategy === 'skip' && !force) {
    return { written: false, path: canvasPath };
  }

  // Ensure directory exists
  const dir = path.dirname(canvasPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Handle append strategy (only if not forced - force=true always overwrites)
  if (exists && updateStrategy === 'append' && !force) {
    try {
      const existingData = JSON.parse(fs.readFileSync(canvasPath, 'utf-8')) as CanvasData;

      // Merge nodes (avoid duplicates by ID)
      const existingIds = new Set(existingData.nodes.map(n => n.id));
      const newNodes = data.nodes.filter(n => !existingIds.has(n.id));

      const existingEdgeIds = new Set(existingData.edges.map(e => e.id));
      const newEdges = data.edges.filter(e => !existingEdgeIds.has(e.id));

      data = {
        nodes: [...existingData.nodes, ...newNodes],
        edges: [...existingData.edges, ...newEdges],
      };
    } catch {
      // If existing file is corrupted, overwrite
    }
  }

  fs.writeFileSync(canvasPath, JSON.stringify(data, null, 2));
  return { written: true, path: canvasPath };
}

/**
 * Generate all canvases for a project
 */
export function generateProjectCanvases(
  project: string,
  notes: CanvasNote[],
  canvasDir: string,
  updateStrategy: 'overwrite' | 'append' | 'skip',
  force: boolean = false,
  types?: ('dashboard' | 'timeline' | 'graph')[]
): { dashboard?: string; timeline?: string; graph?: string } {
  const result: { dashboard?: string; timeline?: string; graph?: string } = {};
  const canvasTypes = types || ['dashboard', 'timeline', 'graph'];

  if (canvasTypes.includes('dashboard')) {
    const dashboardData = generateProjectDashboard(project, notes);
    const dashboardPath = path.join(canvasDir, 'dashboard.canvas');
    const { written } = writeCanvas(dashboardPath, dashboardData, updateStrategy, force);
    if (written) result.dashboard = dashboardPath;
  }

  if (canvasTypes.includes('timeline')) {
    const timelineData = generateDecisionTimeline(project, notes);
    const timelinePath = path.join(canvasDir, 'timeline.canvas');
    const { written } = writeCanvas(timelinePath, timelineData, updateStrategy, force);
    if (written) result.timeline = timelinePath;
  }

  if (canvasTypes.includes('graph')) {
    const graphData = generateKnowledgeGraph(project, notes);
    const graphPath = path.join(canvasDir, 'graph.canvas');
    const { written } = writeCanvas(graphPath, graphData, updateStrategy, force);
    if (written) result.graph = graphPath;
  }

  return result;
}
