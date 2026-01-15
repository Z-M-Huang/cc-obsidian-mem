---
name: mem-consolidate
description: Interactively consolidate duplicate knowledge notes
version: 1.0.0
allowed-tools:
  - mcp__obsidian-mem__mem_search
  - mcp__obsidian-mem__mem_read
  - mcp__obsidian-mem__mem_write
  - mcp__obsidian-mem__mem_list_projects
  - mcp__obsidian-mem__mem_file_ops
  - Glob
  - Read
  - Edit
  - Write
  - AskUserQuestion
---

# Memory Consolidate Skill

Interactively consolidate duplicate knowledge notes in your Claude Code knowledge base.

## When to Use

- After migrating to topic-based filenames (no date prefixes)
- When you have multiple files with the same topic (e.g., `2026-01-15_auth-bug.md` and `auth-bug.md`)
- To merge duplicate content into single consolidated notes
- To clean up old date-prefixed filenames

## Usage

```
/mem-consolidate
/mem-consolidate project:my-project
/mem-consolidate project:my-project dryRun:true
```

## Workflow

### 1. Detect Project

- If no project specified and only one exists, use it automatically
- If multiple projects exist, list them and ask the user to specify

### 2. Scan for Duplicates

- For each category (decisions, patterns, errors, research, knowledge):
  - List all `*.md` files in `{project}/{category}/` folder
  - **Exclude** category index files (e.g., `decisions/decisions.md`)
  - **Exclude** sessions folder (auto-generated content)
  - Extract topic slug from each filename using:
    1. Remove date prefix if present: `^(\d{4}-\d{2}-\d{2}[_-])?(.+)\.md$`
    2. Normalize using `slugifyProjectName() + substring(0, 50)`
  - Group files with identical slugs as potential duplicates

### 3. Present Duplicate Groups

For each duplicate group found:

**Show file previews:**
- Filename and relative path
- Frontmatter: type, created date, tag count
- Content preview: First 100 characters (after frontmatter)
  - Truncate with `...` if longer
  - For files > 10KB, show `[Large file - X KB]`
- Show extracted slug for confirmation

**Limit display:**
- If group has > 5 files, show first 5 and indicate total count
- Example: "Showing 5 of 12 duplicates..."

### 4. Ask User Decision

Use `AskUserQuestion` with these options:

| Option | Description | Action |
|--------|-------------|--------|
| **Merge all** | Combine into single topic-based file | Execute merge workflow |
| **Keep separate** | These are different topics, no changes | Skip to next group |
| **Rename one** | One file should have different name | Execute rename workflow |
| **Skip** | Decide later, move to next group | Track for summary report |

**Handling unexpected responses:**
- If user selects "Other" and provides custom text, treat as **Skip** and log the response for manual review

### 5. Merge Workflow (if "Merge all" selected)

1. **Sort files** by created date (oldest first)
   - Read frontmatter `created` field (ISO8601 format)
   - **Fallback**: If `created` missing, use file mtime
   - **Warn user**: "Using file mtime for {filename} (no created date in frontmatter)"

2. **Prepare merged content:**
   - Use oldest file's `created` date for merged file
   - Merge all tags (unique union)
   - Combine content with timestamped entry headers:
     ```markdown
     ## Entry: YYYY-MM-DD HH:MM
     {content from this file}
     ```
   - **entry_count**: Count existing `## Entry` headers across all source files being merged
   - Generate canonical topic-based filename (no date prefix)

3. **Write merged file:**
   - Generate canonical topic-based filename (e.g., `auth-bug.md`)
   - **If canonical file already exists** (rare edge case):
     1. Use `Read` tool to get existing file content
     2. Parse existing frontmatter (tags, entry_count, created)
     3. Merge tags: union of existing + new tags
     4. Keep oldest `created` date between existing and new
     5. Append new entries to existing content
     6. Update `entry_count` = existing count + new entries
     7. Use `Write` tool with complete merged content
   - **If canonical file does not exist**:
     - Use `Write` tool to create merged note at canonical path

4. **Archive old files** (for each source file, except if same name as merged):
   - Create `.archive/` folder: `mem_file_ops(action:'mkdir', path:'{category}/.archive')`
   - Check for conflict: if file exists in `.archive/`, append timestamp to filename
     - Example: `auth-bug.md` → `auth-bug_20260115-103000.md`
   - Move atomically: `mem_file_ops(action:'move', path:'{original}', destination:'{archive}')`

5. **In dry-run mode:**
   - Report "Would merge: {files}" without executing write/archive steps
   - Show preview of merged content structure

### 6. Rename Workflow (if "Rename one" selected)

1. **Ask which file to rename:**
   - Use `AskUserQuestion` with file paths as options

2. **Ask for new topic name:**
   - Use `AskUserQuestion` to get new topic name from user

3. **Validate new name:**
   - Apply `slugifyProjectName() + substring(0, 50)` to ensure valid slug
   - Check slug doesn't match existing files in category
   - If conflict detected, ask user to provide different name

4. **Rename file:**
   - Read old file content
   - Write to new path with validated slug
   - Delete old file: `mem_file_ops(action:'delete', path:oldPath)`

5. **In dry-run mode:**
   - Report "Would rename: {oldPath} → {newPath}" without executing

### 7. Report Summary

After processing all groups:

```markdown
# Consolidation Summary

**Scanned**: {N} files across {M} categories

## Merged
- {category}/{topic}: Merged {N} files into 1 (archived {N-1})

## Renamed
- {category}/{old-name} → {new-name}

## Skipped
- {category}/{topic}: {N} files (user decision: skip)

---
Run again with `dryRun: false` to apply changes.
```

## Edge Cases

### Category Index Exclusion

**Problem**: Category index files like `decisions/decisions.md` have the same slug as their folder name.

**Solution**: Explicitly exclude files matching `${category}.md` pattern to avoid grouping topic notes with their category index.

### Sessions Folder

**Problem**: `sessions/` folder contains auto-generated session notes that are unlikely to have duplicates.

**Solution**: Intentionally exclude `sessions` category from consolidation. Only scan: `decisions`, `patterns`, `errors`, `research`, `knowledge`.

### Files Without Created Date

**Problem**: Some files may not have `created` field in frontmatter.

**Solution**: Fall back to filesystem mtime and warn user: "Using file mtime for {filename} (no created date in frontmatter)"

### Very Large Duplicate Groups

**Problem**: Some topics may have 10+ duplicate files, overwhelming the user.

**Solution**: Show first 5 files, indicate total count, allow batch decisions. Example: "Showing 5 of 12 duplicates for 'authentication'..."

### Existing Files with Multiple Entries

**Problem**: Merged file may already exist with multiple `## Entry` headers from previous appends.

**Solution**: Count all existing `## Entry` headers across source files to calculate accurate `entry_count`.

### Archive Conflicts

**Problem**: File already exists in `.archive/` from previous consolidation.

**Solution**: Append timestamp to filename: `auth-bug_20260115-103000.md`

### Cross-Filesystem Moves (renameSync limitation)

**Note**: `mem_file_ops` uses `renameSync` which requires source and destination on same filesystem. Since `.archive/` folders are always within the same category folder, this is guaranteed to work.

## Safety Features

- **Dry run by default**: Preview changes before applying
- **Archive before delete**: Old files moved to `.archive/` for easy recovery
- **Conflict handling**: Timestamp suffixes prevent overwrites
- **Path validation**: All paths validated to prevent traversal attacks
- **Audit logging**: All file operations logged for auditability

## Follow-up Actions

After consolidation, suggest:
- Review archived files in `.archive/` folders
- Run `/mem-audit` to verify vault structure is clean
- Clean up old archives when confident changes are correct
