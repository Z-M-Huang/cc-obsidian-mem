---
name: mem-save
description: Explicitly save knowledge, patterns, decisions, or learnings to the knowledge base. Use when you want to document something for future reference.
version: 1.0.0
allowed-tools:
  - mcp__obsidian-mem__mem_write
  - mcp__obsidian-mem__mem_read
---

# Memory Save Skill

Explicitly save knowledge to the Claude Code memory system for future reference.

## When to Use

- Recording an important decision
- Documenting a useful pattern
- Saving a solution to a tricky error
- Noting learnings for future sessions
- Creating reusable knowledge

## Usage

The skill accepts content to save. Examples:

```
/mem-save decision: We chose PostgreSQL over MongoDB for this project
/mem-save pattern: This regex pattern works for parsing dates: /\d{4}-\d{2}-\d{2}/
/mem-save learning: The API rate limits at 100 requests per minute
/mem-save error-fix: The CORS issue was fixed by adding the origin header
```

## Note Types

| Type | Use For |
|------|---------|
| `decision` | Architectural or design decisions with rationale |
| `pattern` | Reusable code patterns, regex, algorithms |
| `error` | Error solutions and workarounds |
| `learning` | General insights and knowledge |
| `file` | File-specific notes and documentation |

## Workflow

1. **Identify Content Type**
   - Parse the user's input to determine the note type
   - If unclear, ask for clarification

2. **Structure the Content**
   - Extract the main information
   - Add appropriate context (project, tags)
   - Format with Obsidian-friendly markdown

3. **Save and Confirm**
   - Use `mem_write` to persist
   - Show the saved note path
   - Offer to add more details

## Content Templates

### Decision
```markdown
## Context
[Why this decision was needed]

## Decision
[What was decided]

## Rationale
[Why this approach was chosen]

## Consequences
- Positive: ...
- Negative: ...
```

### Pattern
```markdown
## Description
[What this pattern does]

## When to Use
[Scenarios where this applies]

## Implementation
\`\`\`language
[Code example]
\`\`\`
```

### Error Fix
```markdown
## Problem
[The error encountered]

## Cause
[Root cause]

## Solution
[How it was fixed]

## Prevention
[How to avoid in future]
```

## Guidelines

- Always include context about why something was decided
- Add relevant tags for discoverability
- Link to related notes when possible
- Be specific enough to be useful later
