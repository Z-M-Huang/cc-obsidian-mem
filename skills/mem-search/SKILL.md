---
name: mem-search
description: Search the Claude Code knowledge base for past sessions, errors, solutions, decisions, and patterns. Use this to find information from previous coding sessions.
version: 1.0.0
allowed-tools:
  - mcp__obsidian-mem__mem_search
  - mcp__obsidian-mem__mem_read
  - mcp__obsidian-mem__mem_project_context
---

# Memory Search Skill

Search your Claude Code knowledge base to find relevant information from past sessions.

## When to Use

- Finding how a previous error was solved
- Recalling decisions made about the codebase
- Looking up patterns used before
- Getting context about a file's history
- Finding what was done in recent sessions

## Usage

The skill accepts a natural language query. Examples:

```
/mem-search authentication error fix
/mem-search database schema decisions
/mem-search how did we handle caching
/mem-search recent sessions for this project
```

## Workflow

1. **Analyze the Query**
   - Determine if they're looking for an error, decision, pattern, or general info
   - Identify any project context

2. **Search Strategy**
   - Use `mem_search` with appropriate filters
   - For errors: filter by `type: error`
   - For decisions: filter by `type: decision`
   - For patterns: filter by `type: pattern`

3. **Present Results**
   - Show a summary of top matches
   - Include relevant snippets
   - Offer to show full details with `mem_read`

## Output Format

Present results clearly:

```markdown
## Found X results for "query"

### [Title] (type, date)
> Relevant excerpt from the note...
**Project**: project-name | **Tags**: #tag1 #tag2

---

Would you like me to show the full details of any of these?
```

## Advanced Usage

If the user wants project-wide context:
```
mem_project_context({ project: "project-name" })
```

This returns recent sessions, unresolved errors, and active decisions for the project.
