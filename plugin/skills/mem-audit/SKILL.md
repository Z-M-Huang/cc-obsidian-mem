---
name: mem-audit
description: Scan the knowledge base for structural issues like broken links, orphan notes, missing indexes, and optionally AI-powered content staleness detection.
version: 1.0.1
allowed-tools:
  - mcp__obsidian-mem__mem_audit
  - mcp__obsidian-mem__mem_list_projects
---

# Memory Audit Skill

Audit your Claude Code knowledge base to identify structural issues and content staleness.

## When to Use

- Checking health of your knowledge base
- Finding broken links between notes
- Identifying orphan notes not connected to the hierarchy
- Detecting missing category indexes
- Finding notes with invalid frontmatter
- Optionally: AI-powered detection of stale content

## Usage

The skill can run with or without a project specified:

```
/mem-audit
/mem-audit project:my-project
/mem-audit includeContentValidation:true
```

## Workflow

1. **Detect Project**
   - If no project specified and only one exists, use it automatically
   - If multiple projects exist, list them and ask the user to specify

2. **Run Audit**
   - Call `mem_audit` with appropriate options
   - Structural checks run by default (fast, no AI)
   - Content validation is optional and uses AI (slower)

3. **Present Results**
   - Show summary of issues by severity (errors, warnings, info)
   - Group issues by category
   - Show suggested fixes and whether they're auto-fixable
   - Recommend using `/mem-fix` for auto-fixable issues

## Issue Categories

### Structural (Fast, No AI)
- `broken_link`: Wikilinks pointing to non-existent notes
- `orphan_note`: Notes without parent links (not connected to hierarchy)
- `missing_index`: Category folders missing their index file
- `supersession_inconsistent`: Supersession links not properly set up
- `index_stale`: JSON index out of sync with note files
- `invalid_frontmatter`: Missing required frontmatter fields

### Content (AI-Powered, Slower)
- Stale content detection by comparing notes to current code
- Only runs when `includeContentValidation: true`

## Output Format

```markdown
# Audit Results: project-name

**Scanned**: 42 notes in 156ms

## Summary

- **Errors**: 2
- **Warnings**: 5
- **Info**: 3

## Broken Link (3)

- [!] `research/2024-01-15_api-design.md`: Broken link: [[old-decision]]
  - Fix: Remove broken link [[old-decision]] (auto-fixable)
  - ID: `broken_link-abc123`

...

---
Use `mem_fix` to apply fixes. Use `dryRun: true` to preview changes first.
```

## Follow-up Actions

After presenting results, suggest:
- `/mem-fix` to automatically fix auto-fixable issues
- `/mem-fix dryRun:true` to preview changes first
- Manual review for non-auto-fixable issues
