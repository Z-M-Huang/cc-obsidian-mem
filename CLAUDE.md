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
| `mem_write_knowledge` | Saving Q&A, explanations, research from conversations    |
| `mem_supersede`       | Updating/replacing outdated information                  |
| `mem_project_context` | Starting work on a project (get recent context)          |
| `mem_list_projects`   | Need to see all tracked projects                         |
| `mem_generate_canvas` | Generate Obsidian canvas visualizations for a project    |
| `mem_file_ops`        | Delete, move, or create directories in the vault         |

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
| `plugin/package.json`               | `version`            | `"version": "1.0.0"` |
| `plugin/.claude-plugin/plugin.json` | `version`            | `"version": "1.0.0"` |
| `.claude-plugin/marketplace.json`   | `plugins[0].version` | `"version": "1.0.0"` |
| `plugin/src/mcp-server/index.ts`    | `version`            | `version: "1.0.0"`   |

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
│   │   ├── vault/            # Vault management, canvas generation
│   │   ├── summarizer/       # AI-powered knowledge extraction
│   │   ├── mcp-server/       # MCP server for mem_* tools
│   │   ├── session-end/      # Background session processing
│   │   ├── sqlite/           # SQLite database operations
│   │   ├── context/          # Context injection for prompts
│   │   ├── sdk/              # SDK agent integration
│   │   ├── shared/           # Shared types, config, validation, logging
│   │   ├── cli/              # Setup CLI
│   │   ├── fallback/         # JSON fallback storage
│   │   └── worker/           # Background worker service
│   └── tests/
└── CLAUDE.md                 # This file
```

### Key Files by Feature

#### Vault & Knowledge Management

- `plugin/src/vault/vault-manager.ts` - Vault CRUD, search, project structure, topic deduplication
- `plugin/src/vault/note-builder.ts` - Frontmatter building, filename generation, wikilinks
- `plugin/src/vault/canvas.ts` - Canvas generation (dashboard, timeline, graph layouts)
- `plugin/src/summarizer/summarizer.ts` - AI-powered knowledge extraction using Claude CLI
- `plugin/src/summarizer/prompts.ts` - System prompts for knowledge extraction

#### Hook Scripts

- `plugin/hooks/scripts/session-start.ts` - Initialize session tracking, inject project context
- `plugin/hooks/scripts/user-prompt-submit.ts` - Track user prompts
- `plugin/hooks/scripts/post-tool-use.ts` - Capture tool observations, exploration tracking
- `plugin/hooks/scripts/pre-compact.ts` - Trigger background summarization before compaction
- `plugin/hooks/scripts/stop.ts` - Spawn background session-end processor

#### Session Processing

- `plugin/src/session-end/run-session-end.ts` - Background processor (summarization, canvas generation)
- `plugin/src/session-end/process-lock.ts` - Two-phase locking for session processing

#### MCP Server

- `plugin/src/mcp-server/index.ts` - MCP server entry point, registers all `mem_*` tools

#### Database & Storage

- `plugin/src/sqlite/database.ts` - SQLite initialization
- `plugin/src/sqlite/session-store.ts` - Session CRUD operations
- `plugin/src/sqlite/pending-store.ts` - Message queue for SDK agent
- `plugin/src/fallback/fallback-store.ts` - JSON fallback when SQLite unavailable

#### Configuration & Shared

- `plugin/src/shared/config.ts` - Config loading and defaults
- `plugin/src/shared/types.ts` - TypeScript type definitions
- `plugin/src/shared/validation.ts` - Zod schemas for AI output validation
- `plugin/src/shared/logger.ts` - Logging infrastructure
- User config: `~/.cc-obsidian-mem/config.json`

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
- File-based JSON indexes (`_index.json`) are auto-generated for faster search
- Exploration tracking captures Read/Grep/Glob tool usage for session context
- Session summary notes are created in `projects/{project}/sessions/` at session end

### Logging Configuration

To enable verbose debug logging, add to `~/.cc-obsidian-mem/config.json`:

```json
"logging": {
  "verbose": true,
  "logDir": "/custom/path"  // Optional, defaults to os.tmpdir()
}
```

| Option    | Values         | Description                                     |
| --------- | -------------- | ----------------------------------------------- |
| `verbose` | `true`/`false` | Enable debug-level logging (default: `false`)   |
| `logDir`  | path string    | Custom log directory (default: system temp dir) |

Log files:

- **Hook logs**: `{logDir}/cc-obsidian-mem-{session_id}.log` (one per session, auto-cleaned after 24h)
- **MCP server logs**: `{logDir}/cc-obsidian-mem-mcp.log` (shared, rotated at 10MB)

View logs during a session:

```bash
tail -f /tmp/cc-obsidian-mem-*.log
```

### Canvas Configuration

To enable canvas visualizations, add to `~/.cc-obsidian-mem/config.json`:

```json
"canvas": {
  "enabled": true,
  "autoGenerate": true,
  "updateStrategy": "always"
}
```

| Option           | Values              | Description                                                   |
| ---------------- | ------------------- | ------------------------------------------------------------- |
| `enabled`        | `true`/`false`      | Enable canvas generation                                      |
| `autoGenerate`   | `true`/`false`      | Auto-generate when `mem_project_context` is called            |
| `updateStrategy` | `"always"`/`"skip"` | `always` = overwrite existing, `skip` = preserve manual edits |

Canvas files are created in `_claude-mem/projects/{project}/canvases/`:

- `dashboard.canvas` - Grid layout grouped by folder type (errors, decisions, patterns, etc.)
- `timeline.canvas` - Decisions sorted chronologically
- `graph.canvas` - Radial knowledge graph centered on project

### Processing Configuration

To configure knowledge extraction frequency, add to `~/.cc-obsidian-mem/config.json`:

```json
"processing": {
  "frequency": "compact-only",
  "periodicInterval": 10
}
```

| Option             | Values                        | Description                                         |
| ------------------ | ----------------------------- | --------------------------------------------------- |
| `frequency`        | `"compact-only"`/`"periodic"` | When to extract knowledge (default: `compact-only`) |
| `periodicInterval` | number (minutes)              | Interval for periodic extraction (default: `10`)    |

- `compact-only` - Only extract knowledge when `/compact` is run (recommended)
- `periodic` - Extract knowledge every N minutes during active sessions

### Note Linking Structure

Notes follow a hierarchical linking pattern for proper Obsidian graph navigation:

```
Project Base (project-name.md)
    ↑ parent
Category Index (decisions/decisions.md, knowledge/knowledge.md, etc.)
    ↑ parent
Individual Notes (decisions/authentication-bug.md)
```

- **Category indexes** use the folder name as filename: `decisions/decisions.md`, NOT `_index.md`
- **Parent links** in frontmatter: `parent: "[[_claude-mem/projects/project-name/category/category]]"`
- **Superseding notes** creates bidirectional links: old note gets `superseded_by`, new note gets `supersedes`

### Topic-Based Filenames (Deduplication)

Notes use **topic-based filenames** (not date-prefixed) to enable automatic deduplication:

- Filename: `authentication-bug.md` (not `2026-01-10_authentication-bug.md`)
- When new knowledge matches an existing topic's slug, content is **appended** to the existing note
- Each entry has a timestamp header: `## Entry: YYYY-MM-DD HH:MM`
- Frontmatter tracks: `created` (first entry), `updated` (last entry), `entry_count`
- Matching: exact slug comparison within the same category (case-insensitive)

**Migration**: Existing date-prefixed notes continue to work. New knowledge will use topic-based filenames.
