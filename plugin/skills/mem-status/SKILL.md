---
name: mem-status
description: Show memory system status and tracked projects. Use to check memory system health and list projects.
version: 1.0.1
allowed-tools:
  - mcp__obsidian-mem__mem_project_context
  - mcp__obsidian-mem__mem_list_projects
  - Bash
---

# Memory Status Skill

Display memory system information and tracked projects.

## When to Use

- See if the memory system is working
- List all tracked projects
- Get context for a specific project

## Usage

```
/mem-status
/mem-status projects
```

## Workflow

1. **List Projects**
   Use `mem_list_projects` tool

2. **Get Project Context**
   If a project is specified, use `mem_project_context`

3. **Check Config**
   ```bash
   cat ~/.cc-obsidian-mem/config.json
   ```

## Output Format

```markdown
## Memory System Status

### Projects in Memory
1. project-a (last active: 1 day ago)
2. project-b (last active: 3 days ago)
3. my-project (current)

### Quick Stats
- Total Notes: 156
- Errors Documented: 23
- Decisions Recorded: 15
- Knowledge Items: 45
```

## Troubleshooting

If no data is being captured:
1. Verify hooks are installed: check `/plugin list`
2. Check config: `cat ~/.cc-obsidian-mem/config.json`
3. Ensure vault path is correct and writable
4. Check background log: `cat /tmp/cc-obsidian-mem-background.log`
