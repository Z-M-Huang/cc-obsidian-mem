# cc-obsidian-mem

## For Users: Add to Your Project's CLAUDE.md

Copy the following section to your project's `CLAUDE.md` file to enable Claude to proactively use the memory system:

```markdown
## Memory System (cc-obsidian-mem)

You have access to a persistent memory system via MCP tools. Use it proactively.

### Available Tools

| Tool                  | Use When                                                 |
| --------------------- | -------------------------------------------------------- |
| `mem_search`          | Looking for past decisions, errors, patterns, or context |
| `mem_read`            | Need full content of a specific note                     |
| `mem_write`           | Saving important decisions, patterns, or learnings       |
| `mem_supersede`       | Updating/replacing outdated information                  |
| `mem_project_context` | Starting work on a project (get recent context)          |
| `mem_list_projects`   | Need to see all tracked projects                         |
| `mem_generate_canvas` | Generate Obsidian canvas visualizations for a project    |

### When to Search Memory

**Proactively search memory (`mem_search`) when:**

- Starting work on a codebase - check for project context and recent decisions
- Encountering an error - search for similar errors and their solutions
- Making architectural decisions - look for related past decisions
- User asks "how did we..." or "why did we..." or "what was..."
- Implementing a feature similar to past work

**Example searches:**

- `mem_search query="authentication" type="decision"` - Find auth-related decisions
- `mem_search query="TypeError" type="error"` - Find past TypeScript errors
- `mem_search query="database schema"` - Find DB-related knowledge
- `mem_project_context project="my-project"` - Get full project context

### When to Save to Memory

**Save to memory (`mem_write`) when:**

- Making significant architectural or technical decisions
- Discovering important patterns or gotchas
- Solving tricky bugs (save the solution)
- Learning something project-specific that will be useful later

**Use `mem_supersede` when:**

- A previous decision is being replaced
- Updating outdated documentation or patterns
```

---

## For Contributors: Development Guide

### Version Bump Checklist

When releasing a new version, update the version number in **all four files**:

| File                                | Field                | Example              |
| ----------------------------------- | -------------------- | -------------------- |
| `plugin/package.json`               | `version`            | `"version": "0.5.0"` |
| `plugin/.claude-plugin/plugin.json` | `version`            | `"version": "0.5.0"` |
| `.claude-plugin/marketplace.json`   | `plugins[0].version` | `"version": "0.5.0"` |
| `plugin/src/mcp-server/index.ts`    | `version`            | `version: "0.5.0"`   |

### Project Structure

```
cc-obsidian-mem/
├── .claude-plugin/
│   └── marketplace.json      # Marketplace metadata (version here!)
├── plugin/                   # The actual plugin
│   ├── .claude-plugin/
│   │   └── plugin.json       # Plugin metadata (version here!)
│   ├── package.json          # NPM package (version here!)
│   ├── hooks/
│   │   ├── hooks.json        # Hook definitions
│   │   └── scripts/          # Hook implementations
│   ├── scripts/              # Utility scripts (backfill, migrations)
│   ├── src/
│   │   ├── cli/              # Setup CLI
│   │   ├── mcp-server/       # MCP server for mem_* tools
│   │   ├── services/         # Summarization & knowledge extraction
│   │   └── shared/           # Shared types, config, session store
│   └── tests/
└── CLAUDE.md                 # This file
```

### Key Files by Feature

#### Hook Scripts

- `plugin/hooks/scripts/session-start.ts` - Initialize session tracking, inject project context, migrate legacy pending files
- `plugin/hooks/scripts/user-prompt-submit.ts` - Track user prompts
- `plugin/hooks/scripts/post-tool-use.ts` - Capture tool observations, extract knowledge from WebFetch/WebSearch/Context7
- `plugin/hooks/scripts/pre-compact.ts` - Trigger background summarization before compaction
- `plugin/hooks/scripts/background-summarize.ts` - AI-powered knowledge extraction, writes directly to vault
- `plugin/hooks/scripts/session-end.ts` - Generate canvas visualizations, cleanup session files

#### Configuration

- `plugin/src/shared/config.ts` - Config loading and defaults
- `plugin/src/shared/types.ts` - TypeScript type definitions
- User config: `~/.cc-obsidian-mem/config.json`

#### MCP Server

- `plugin/src/mcp-server/index.ts` - MCP server entry point, registers all `mem_*` tools
- `plugin/src/mcp-server/utils/vault.ts` - Vault read/write operations, note linking, superseding
- `plugin/src/mcp-server/utils/canvas.ts` - Canvas generation (dashboard, timeline, graph layouts)

#### Utility Scripts

- `plugin/scripts/backfill-parent-links.ts` - Backfill parent links and create category indexes for existing notes

### Testing

```bash
cd plugin
bun test              # Run all tests
bunx tsc --noEmit     # Type check only
```

### Local Development

```bash
# Install from local path
claude /plugin install /path/to/cc-obsidian-mem/plugin

# Uninstall
claude /plugin uninstall cc-obsidian-mem

# Check installed plugins
claude /plugin list
```

### Important Notes

- Background summarization uses `claude -p` CLI (not Agent SDK) to avoid hook deadlock
- Background summarization writes knowledge directly to vault (not pending files)
- Knowledge notes use `frontmatter.knowledge_type` for the actual type (qa/explanation/decision/research/learning)
- Project detection searches up the directory tree for `.git` to find the repo root
- Canvas auto-generation requires `canvas.enabled: true` in config
- Canvases are regenerated at session-end when enabled (respects `updateStrategy`)

### Canvas Configuration

To enable canvas visualizations, add to `~/.cc-obsidian-mem/config.json`:

```json
"canvas": {
  "enabled": true,
  "autoGenerate": true,
  "updateStrategy": "always"
}
```

| Option | Values | Description |
|--------|--------|-------------|
| `enabled` | `true`/`false` | Enable canvas generation |
| `autoGenerate` | `true`/`false` | Auto-generate when `mem_project_context` is called |
| `updateStrategy` | `"always"`/`"skip"` | `always` = overwrite existing, `skip` = preserve manual edits |

Canvas files are created in `_claude-mem/projects/{project}/canvases/`:
- `dashboard.canvas` - Grid layout grouped by folder type (errors, decisions, patterns, etc.)
- `timeline.canvas` - Decisions sorted chronologically
- `graph.canvas` - Radial knowledge graph centered on project

### Note Linking Structure

Notes follow a hierarchical linking pattern for proper Obsidian graph navigation:

```
Project Base (project-name.md)
    ↑ parent
Category Index (decisions/decisions.md, knowledge/knowledge.md, etc.)
    ↑ parent
Individual Notes (decisions/2026-01-10_some-decision.md)
```

- **Category indexes** use the folder name as filename: `decisions/decisions.md`, NOT `_index.md`
- **Parent links** in frontmatter: `parent: "[[_claude-mem/projects/project-name/category/category]]"`
- **Superseding notes** creates bidirectional links: old note gets `superseded_by`, new note gets `supersedes`
