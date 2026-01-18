---
name: mem-fix
description: Fix issues detected by mem-audit. Supports dry-run mode to preview changes before applying them.
version: 1.0.1
allowed-tools:
  - mcp__obsidian-mem__mem_audit
  - mcp__obsidian-mem__mem_fix
  - mcp__obsidian-mem__mem_read
---

# Memory Fix Skill

Apply fixes for issues detected in your Claude Code knowledge base.

## When to Use

- After running `/mem-audit` and finding issues
- To clean up broken links
- To add missing parent links to orphan notes
- To create missing category indexes
- To rebuild stale indexes

## Usage

```
/mem-fix project:my-project
/mem-fix project:my-project dryRun:true
/mem-fix project:my-project fixCategories:broken_link,orphan_note
```

## Workflow

1. **Run Audit First**
   - Call `mem_audit` to get current issues
   - Present summary: X errors, Y warnings, Z info

2. **Collect Confirmation**
   - Group issues by category
   - For each category with issues, ask: "Fix all N [category] issues?"
   - Show examples (first 3-5) before asking for confirmation

3. **Apply Fixes**
   - Use `dryRun: true` first to preview changes
   - Then apply confirmed fixes with `dryRun: false`

4. **Report Results**
   - Show what was fixed successfully
   - Show what failed and why
   - Suggest re-running audit to verify

## Fix Types

| Category | Fix Type | Auto-Fixable |
|----------|----------|--------------|
| `broken_link` | Remove the broken wikilink | Yes |
| `orphan_note` | Add parent link to frontmatter | Yes |
| `missing_index` | Create category index file | Yes |
| `supersession_inconsistent` | Update frontmatter (may need manual input) | Partial |
| `index_stale` | Rebuild project index | Yes |
| `invalid_frontmatter` | Add missing fields (except title) | Partial |

## Output Format

### Dry Run

```markdown
# Dry Run Results

**Would fix**: 8/10

## Successful

- `broken_link-abc123`: Would remove link [[old-note]]
  - link_removed: Removed broken link [[old-note]]

## Failed

- `supersession_inconsistent-def456`: No suggested fix available

---
Run again with `dryRun: false` to apply these changes.
```

### After Applying

```markdown
# Fix Results

**Fixed**: 8/10

## Successful

- `broken_link-abc123`: Removed link [[old-note]]
  - link_removed: Removed broken link [[old-note]]

## Failed

- `supersession_inconsistent-def456`: No suggested fix available
```

## Safety Features

- **Dry run by default**: Always preview changes first
- **Atomic writes**: Files are written atomically to prevent corruption
- **TOCTOU protection**: Checks if files changed since audit before applying fixes
- **Individual results**: Each fix reports success/failure independently

## Follow-up Actions

After fixing, suggest:
- `/mem-audit` to verify all issues are resolved
- Review any failed fixes manually
