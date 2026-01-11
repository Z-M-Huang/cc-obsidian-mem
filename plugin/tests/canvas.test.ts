import { describe, test, expect } from 'bun:test';
import {
  detectFolder,
  pathToId,
  parseDate,
  gridLayout,
  timelineLayout,
  radialLayout,
  generateProjectDashboard,
  generateDecisionTimeline,
  generateKnowledgeGraph,
  type CanvasNote,
  type CanvasFolder,
} from '../src/mcp-server/utils/canvas.js';

/**
 * Helper to create mock CanvasNote for testing
 */
function mockNote(name: string, overrides: Partial<CanvasNote> = {}): CanvasNote {
  return {
    path: `_claude-mem/projects/test/decisions/${name}.md`,
    title: name,
    folder: 'decisions',
    status: 'active',
    created: '2026-01-10T00:00:00Z',
    ...overrides,
  };
}

describe('Canvas Utilities', () => {
  describe('detectFolder', () => {
    test('detects errors folder', () => {
      expect(detectFolder('projects/test/errors/error.md')).toBe('errors');
    });

    test('detects decisions folder', () => {
      expect(detectFolder('projects/test/decisions/decision.md')).toBe('decisions');
    });

    test('detects patterns folder', () => {
      expect(detectFolder('projects/test/patterns/pattern.md')).toBe('patterns');
    });

    test('detects files folder', () => {
      expect(detectFolder('projects/test/files/file.md')).toBe('files');
    });

    test('detects knowledge folder', () => {
      expect(detectFolder('projects/test/knowledge/note.md')).toBe('knowledge');
    });

    test('detects research folder', () => {
      expect(detectFolder('projects/test/research/note.md')).toBe('research');
    });

    test('defaults to knowledge for unknown paths', () => {
      expect(detectFolder('some/unknown/path.md')).toBe('knowledge');
    });
  });

  describe('pathToId', () => {
    test('generates collision-free IDs from paths', () => {
      const id1 = pathToId('projects/a/note.md');
      const id2 = pathToId('projects/b/note.md');

      expect(id1).not.toBe(id2);
    });

    test('prefixes IDs with file-', () => {
      const id = pathToId('projects/test/note.md');
      expect(id).toMatch(/^file-/);
    });

    test('URL-encodes special characters', () => {
      const id = pathToId('projects/test/some file with spaces.md');
      expect(id).toContain('file-');
      expect(id).toContain('%20'); // URL-encoded space
    });

    test('same path produces same ID', () => {
      const path = 'projects/test/decisions/auth.md';
      expect(pathToId(path)).toBe(pathToId(path));
    });
  });

  describe('parseDate', () => {
    test('parses valid ISO date strings', () => {
      const date = parseDate('2026-01-10T00:00:00Z');
      expect(date.getTime()).toBeGreaterThan(0);
    });

    test('returns epoch for undefined', () => {
      const date = parseDate(undefined);
      expect(date.getTime()).toBe(0);
    });

    test('returns epoch for invalid date string', () => {
      const date = parseDate('not-a-date');
      expect(date.getTime()).toBe(0);
    });

    test('returns epoch for empty string', () => {
      const date = parseDate('');
      expect(date.getTime()).toBe(0);
    });
  });
});

describe('Layout Functions', () => {
  describe('gridLayout', () => {
    test('positions nodes in a grid', () => {
      const notes = [mockNote('a'), mockNote('b'), mockNote('c'), mockNote('d')];
      const nodes = gridLayout(notes, 0, 0);

      expect(nodes).toHaveLength(4);
    });

    test('first node is at start position', () => {
      const notes = [mockNote('a')];
      const nodes = gridLayout(notes, 100, 200);

      expect(nodes[0].x).toBe(100);
      expect(nodes[0].y).toBe(200);
    });

    test('nodes wrap to new row after 3 columns', () => {
      const notes = [mockNote('a'), mockNote('b'), mockNote('c'), mockNote('d')];
      const nodes = gridLayout(notes, 0, 0);

      // First row: nodes 0, 1, 2
      // Second row: node 3
      expect(nodes[0].y).toBe(nodes[1].y); // Same row
      expect(nodes[0].y).toBe(nodes[2].y); // Same row
      expect(nodes[3].y).toBeGreaterThan(nodes[0].y); // New row
    });

    test('nodes have correct dimensions', () => {
      const notes = [mockNote('a')];
      const nodes = gridLayout(notes, 0, 0);

      expect(nodes[0].width).toBe(400);
      expect(nodes[0].height).toBe(200);
    });

    test('node type is file', () => {
      const notes = [mockNote('a')];
      const nodes = gridLayout(notes, 0, 0);

      expect(nodes[0].type).toBe('file');
    });

    test('node file property matches note path', () => {
      const note = mockNote('test-note', { path: 'custom/path.md' });
      const nodes = gridLayout([note], 0, 0);

      expect(nodes[0].file).toBe('custom/path.md');
    });
  });

  describe('timelineLayout', () => {
    test('sorts notes by created date', () => {
      const notes = [
        mockNote('later', { created: '2026-01-11T00:00:00Z' }),
        mockNote('earlier', { created: '2026-01-10T00:00:00Z' }),
      ];
      const nodes = timelineLayout(notes);

      // Earlier date should be first (leftmost)
      expect(nodes[0].file).toContain('earlier');
      expect(nodes[1].file).toContain('later');
    });

    test('positions nodes horizontally', () => {
      const notes = [
        mockNote('a', { created: '2026-01-10T00:00:00Z' }),
        mockNote('b', { created: '2026-01-11T00:00:00Z' }),
      ];
      const nodes = timelineLayout(notes);

      // All nodes should be at y=0
      expect(nodes[0].y).toBe(0);
      expect(nodes[1].y).toBe(0);

      // Second node should be to the right of first
      expect(nodes[1].x).toBeGreaterThan(nodes[0].x);
    });

    test('applies color based on status', () => {
      const notes = [
        mockNote('active', { status: 'active', created: '2026-01-10T00:00:00Z' }),
        mockNote('superseded', { status: 'superseded', created: '2026-01-11T00:00:00Z' }),
      ];
      const nodes = timelineLayout(notes);

      expect(nodes[0].color).toBe('4'); // green for active
      expect(nodes[1].color).toBe('5'); // gray/cyan for superseded
    });
  });

  describe('radialLayout', () => {
    test('creates center node with project name', () => {
      const notes = [mockNote('a')];
      const { nodes } = radialLayout('test-project', notes);

      const centerNode = nodes.find(n => n.id === 'project-center');
      expect(centerNode).toBeDefined();
      expect(centerNode?.text).toBe('# test-project');
    });

    test('center node is a text node', () => {
      const notes = [mockNote('a')];
      const { nodes } = radialLayout('test-project', notes);

      const centerNode = nodes.find(n => n.id === 'project-center');
      expect(centerNode?.type).toBe('text');
    });

    test('creates edges from center to each note', () => {
      const notes = [mockNote('a'), mockNote('b')];
      const { edges } = radialLayout('test-project', notes);

      expect(edges).toHaveLength(2);
      edges.forEach(edge => {
        expect(edge.fromNode).toBe('project-center');
      });
    });

    test('surrounding nodes are file nodes', () => {
      const notes = [mockNote('a')];
      const { nodes } = radialLayout('test-project', notes);

      const fileNodes = nodes.filter(n => n.type === 'file');
      expect(fileNodes).toHaveLength(1);
    });
  });
});

describe('Canvas Generation', () => {
  describe('generateProjectDashboard', () => {
    test('returns valid canvas data structure', () => {
      const canvas = generateProjectDashboard('test', []);

      expect(canvas).toHaveProperty('nodes');
      expect(canvas).toHaveProperty('edges');
      expect(Array.isArray(canvas.nodes)).toBe(true);
      expect(Array.isArray(canvas.edges)).toBe(true);
    });

    test('canvas JSON is valid', () => {
      const canvas = generateProjectDashboard('test', [mockNote('a')]);

      expect(() => JSON.parse(JSON.stringify(canvas))).not.toThrow();
    });

    test('creates groups for each folder type', () => {
      const notes = [
        mockNote('error', { folder: 'errors' as CanvasFolder, path: 'projects/test/errors/e.md' }),
        mockNote('decision', { folder: 'decisions' as CanvasFolder, path: 'projects/test/decisions/d.md' }),
      ];
      const canvas = generateProjectDashboard('test', notes);

      const groupNodes = canvas.nodes.filter(n => n.type === 'group');
      expect(groupNodes).toHaveLength(2);
    });

    test('groups have correct labels', () => {
      const notes = [
        mockNote('error', { folder: 'errors' as CanvasFolder, path: 'projects/test/errors/e.md' }),
      ];
      const canvas = generateProjectDashboard('test', notes);

      const groupNode = canvas.nodes.find(n => n.type === 'group');
      expect(groupNode?.label).toBe('Errors');
    });

    test('file nodes are positioned within group bounds', () => {
      const notes = [
        mockNote('decision', { folder: 'decisions' as CanvasFolder, path: 'projects/test/decisions/d.md' }),
      ];
      const canvas = generateProjectDashboard('test', notes);

      const groupNode = canvas.nodes.find(n => n.type === 'group');
      const fileNode = canvas.nodes.find(n => n.type === 'file');

      // File should be within group bounds
      expect(fileNode!.x).toBeGreaterThanOrEqual(groupNode!.x);
      expect(fileNode!.y).toBeGreaterThanOrEqual(groupNode!.y);
    });

    test('empty notes produces empty canvas', () => {
      const canvas = generateProjectDashboard('test', []);

      expect(canvas.nodes).toHaveLength(0);
      expect(canvas.edges).toHaveLength(0);
    });
  });

  describe('generateDecisionTimeline', () => {
    test('only includes decision notes', () => {
      const notes = [
        mockNote('error', { folder: 'errors' as CanvasFolder, path: 'projects/test/errors/e.md' }),
        mockNote('decision', { folder: 'decisions' as CanvasFolder, path: 'projects/test/decisions/d.md' }),
      ];
      const canvas = generateDecisionTimeline('test', notes);

      // Should only have 1 node (the decision)
      expect(canvas.nodes).toHaveLength(1);
    });

    test('returns empty canvas when no decisions', () => {
      const notes = [
        mockNote('error', { folder: 'errors' as CanvasFolder, path: 'projects/test/errors/e.md' }),
      ];
      const canvas = generateDecisionTimeline('test', notes);

      expect(canvas.nodes).toHaveLength(0);
      expect(canvas.edges).toHaveLength(0);
    });
  });

  describe('generateKnowledgeGraph', () => {
    test('creates radial layout', () => {
      const notes = [mockNote('a'), mockNote('b')];
      const canvas = generateKnowledgeGraph('test', notes);

      // Should have center node + 2 file nodes
      expect(canvas.nodes).toHaveLength(3);

      // Should have 2 edges (center to each note)
      expect(canvas.edges).toHaveLength(2);
    });

    test('center node has project name', () => {
      const notes = [mockNote('a')];
      const canvas = generateKnowledgeGraph('my-project', notes);

      const centerNode = canvas.nodes.find(n => n.id === 'project-center');
      expect(centerNode?.text).toBe('# my-project');
    });
  });
});

describe('ID Uniqueness', () => {
  test('different paths produce different IDs', () => {
    const paths = [
      'projects/test/decisions/a.md',
      'projects/test/decisions/b.md',
      'projects/other/decisions/a.md',
    ];

    const ids = paths.map(p => pathToId(p));
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(ids.length);
  });

  test('generated node IDs are unique within canvas', () => {
    const notes = [
      mockNote('a', { path: 'p1.md' }),
      mockNote('b', { path: 'p2.md' }),
      mockNote('c', { path: 'p3.md' }),
    ];

    const canvas = generateProjectDashboard('test', notes);
    const nodeIds = canvas.nodes.map(n => n.id);
    const uniqueIds = new Set(nodeIds);

    expect(uniqueIds.size).toBe(nodeIds.length);
  });
});

describe('Cross-Platform Compatibility', () => {
  test('detectFolder works with forward slashes (normalized paths)', () => {
    // All paths should use forward slashes after normalization
    expect(detectFolder('_claude-mem/projects/test/errors/error.md')).toBe('errors');
    expect(detectFolder('_claude-mem/projects/test/decisions/d.md')).toBe('decisions');
    expect(detectFolder('_claude-mem/projects/test/patterns/p.md')).toBe('patterns');
    expect(detectFolder('_claude-mem/projects/test/files/f.md')).toBe('files');
    expect(detectFolder('_claude-mem/projects/test/knowledge/k.md')).toBe('knowledge');
    expect(detectFolder('_claude-mem/projects/test/research/r.md')).toBe('research');
  });

  test('detectFolder handles various path formats', () => {
    // With leading path segments
    expect(detectFolder('some/path/errors/note.md')).toBe('errors');
    // With trailing path segments
    expect(detectFolder('projects/test/decisions/2026-01-10_decision.md')).toBe('decisions');
    // Deep nesting
    expect(detectFolder('a/b/c/knowledge/d/e.md')).toBe('knowledge');
  });
});

describe('Edge ID Stability', () => {
  test('radialLayout edge IDs are path-based not index-based', () => {
    const notes = [
      mockNote('a', { path: 'projects/test/knowledge/a.md' }),
      mockNote('b', { path: 'projects/test/knowledge/b.md' }),
    ];
    const { edges } = radialLayout('test', notes);

    // Edge IDs should contain the path-based node ID, not index
    expect(edges[0].id).toContain('file-');
    expect(edges[0].id).not.toBe('edge-center-0');
    expect(edges[1].id).not.toBe('edge-center-1');

    // Edge toNode should match the corresponding node ID
    expect(edges[0].toNode).toBe(pathToId('projects/test/knowledge/a.md'));
    expect(edges[1].toNode).toBe(pathToId('projects/test/knowledge/b.md'));
  });

  test('radialLayout edges are stable across note reordering', () => {
    const notes1 = [
      mockNote('a', { path: 'path/a.md' }),
      mockNote('b', { path: 'path/b.md' }),
    ];
    const notes2 = [
      mockNote('b', { path: 'path/b.md' }),
      mockNote('a', { path: 'path/a.md' }),
    ];

    const { edges: edges1 } = radialLayout('test', notes1);
    const { edges: edges2 } = radialLayout('test', notes2);

    // Edge IDs should be the same regardless of input order
    const ids1 = new Set(edges1.map(e => e.id));
    const ids2 = new Set(edges2.map(e => e.id));

    expect(ids1).toEqual(ids2);
  });

  test('radialLayout edge IDs include full encoded path', () => {
    const notes = [
      mockNote('test', { path: 'projects/my project/knowledge/note.md' }),
    ];
    const { edges } = radialLayout('test', notes);

    // Edge ID should contain URL-encoded path (spaces become %20)
    expect(edges[0].id).toContain('%20');
    expect(edges[0].id).toContain('edge-center-');
  });
});
