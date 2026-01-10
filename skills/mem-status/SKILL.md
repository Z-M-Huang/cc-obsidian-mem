---
name: mem-status
description: Show what has been captured in the current session and overall memory system status. Use to review session activity or check memory system health.
version: 1.0.0
allowed-tools:
  - mcp__obsidian-mem__mem_project_context
  - mcp__obsidian-mem__mem_list_projects
  - Bash
---

# Memory Status Skill

Display current session capture status and memory system information.

## When to Use

- Check what's been captured this session
- See if the memory system is working
- Review recent activity
- List all tracked projects

## Usage

```
/mem-status
/mem-status projects
/mem-status session
```

## Workflow

1. **Check Worker Service**
   ```bash
   curl -s http://localhost:37781/health
   ```

2. **Get Current Session**
   ```bash
   curl -s http://localhost:37781/session/current
   ```

3. **List Projects**
   Use `mem_list_projects` tool

4. **Get Project Context**
   If a project is active, use `mem_project_context`

## Output Format

```markdown
## Memory System Status

### Worker Service
- **Status**: Running
- **Uptime**: 2 hours
- **Port**: 37781

### Current Session
- **Session ID**: abc-123
- **Project**: my-project
- **Started**: 2 hours ago
- **Observations**: 15

#### Captured This Session
| Type | Count |
|------|-------|
| File Edits | 8 |
| Commands | 5 |
| Errors | 2 |

### Projects in Memory
1. project-a (last active: 1 day ago)
2. project-b (last active: 3 days ago)
3. my-project (active now)

### Quick Stats
- Total Notes: 156
- Sessions Logged: 42
- Errors Documented: 23
- Decisions Recorded: 15
```

## Troubleshooting

If the worker isn't running:
1. Check if the process exists: `ps aux | grep worker`
2. Try starting manually: `bun run src/worker/index.ts`
3. Check config: `cat ~/.cc-obsidian-mem/config.json`

If no data is being captured:
1. Verify hooks are installed: check `.claude/hooks.json`
2. Check vault path is correct
3. Ensure vault directory is writable
