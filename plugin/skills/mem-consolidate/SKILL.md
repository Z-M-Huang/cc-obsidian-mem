---
name: mem-consolidate
description: Interactively consolidate duplicate knowledge notes using AI semantic matching
version: 1.0.2
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
  - Bash
  - AskUserQuestion
---

# Memory Consolidate Skill

Interactively consolidate duplicate knowledge notes in your Claude Code knowledge base.

## When to Use

- After migrating to topic-based filenames (no date prefixes)
- When you have multiple files with the same topic (e.g., `2026-01-15_auth-bug.md` and `auth-bug.md`)
- To merge duplicate content into single consolidated notes
- To clean up verbose/specific filenames into generic topic names

## Usage

```
/mem-consolidate
/mem-consolidate project:my-project
/mem-consolidate project:my-project dryRun:true
```

## Workflow

### 0. Get Config (Required First Step)

Before any file operations, you MUST read the config:

1. **Read user config**: `~/.cc-obsidian-mem/config.json`
   - On Windows: `C:\Users\{username}\.cc-obsidian-mem\config.json`
   - On macOS/Linux: `~/.cc-obsidian-mem/config.json`

2. **Extract settings from config**:
   ```json
   {
     "vault": {
       "path": "/path/to/obsidian/vault",
       "memFolder": "_claude-mem"
     },
     "ai": {
       "enabled": true,
       "model": "sonnet",
       "timeout": 30000
     }
   }
   ```

3. **Construct project paths**:
   - Memory folder: `{vault.path}/{vault.memFolder}`
   - Projects folder: `{vault.path}/{vault.memFolder}/projects`
   - Project folder: `{vault.path}/{vault.memFolder}/projects/{project-name}`

4. **Note AI settings** for semantic matching:
   - `ai.enabled`: Whether to use AI (default: true)
   - `ai.model`: "sonnet", "haiku", or "opus" (default: sonnet)

**Important**: Never hardcode or assume vault paths. Always read from config first.

### 1. Detect Project

- If no project specified and only one exists, use it automatically
- If multiple projects exist, list them and ask the user to specify

### 2. Collect All Notes

For each category (decisions, patterns, errors, research, knowledge):

1. **List all files** in `{project}/{category}/` folder
   - **Exclude** category index files (e.g., `decisions/decisions.md`)
   - **Exclude** `.archive/` subfolder
   - **Exclude** sessions folder

2. **Build notes list** with title and category:
   ```
   [
     { "title": "Stop hook non-blocking", "category": "decisions", "path": "..." },
     { "title": "QA: How to prevent stop hook from blocking", "category": "research", "path": "..." },
     ...
   ]
   ```

### 3. Find Duplicate Groups Using AI

Use AI semantic matching to identify groups of notes that discuss the same topic.

#### AI Prompt for Grouping

Send this prompt to Claude CLI using the model from config:

```
Group these notes by semantic similarity (same topic, different wording).

NOTES (0-indexed):
0. [decisions] "Stop hook non-blocking"
1. [research] "QA: How to prevent stop hook from blocking"
2. [research] "QA: Stop hook blocking Claude session"
3. [patterns] "Two-phase locking"
...

Respond with JSON using 0-based indices:
{"groups": [[0,1,2], [3]], "genericTitles": ["Stop hook blocking", "Two-phase locking"]}

Rules:
- Only group notes that are semantically about the SAME topic
- Notes in different categories CAN be grouped if same topic
- Each note appears in at most one group
- Single-note groups can be omitted
- Suggest a short generic title (2-4 words) for each group
```

#### Execute AI Call

```bash
echo '<prompt>' | claude -p - --model {config.ai.model} --no-session-persistence --output-format text
```

#### Parse Response

AI returns groups like:
```json
{
  "groups": [[0,1,2], [5,8,12]],
  "genericTitles": ["Stop hook blocking", "Windows path normalization"]
}
```

### 4. Process Each Duplicate Group

For each group with 2+ notes:

#### Step 4a: Present Group to User

Show the group for confirmation (unless auto-mode):

```
Found duplicate group: "Stop hook blocking"
  1. [decisions] stop-hook-non-blocking.md
  2. [research] qa-how-to-prevent-stop-hook-from-blocking-claude-s.md
  3. [research] qa-stop-hook-blocking-claude-session.md

Merge into: decisions/stop-hook-blocking.md ?
[Yes / Skip / Custom target]
```

#### Step 4b: Execute Merge

1. **Choose target file**:
   - Prefer existing GENERIC filename (short, 1-4 words)
   - Or use AI-suggested generic title
   - Keep in the most appropriate category (decisions > patterns > errors > research)

2. **Merge content**:
   - Sort by `created` date (oldest first)
   - Combine as timestamped entries: `## Entry: YYYY-MM-DD HH:MM`
   - Merge tags (unique union)
   - **Add all source titles as aliases** (for future Jaccard matching)
   - Update `entry_count`

3. **Write merged file** to target path

4. **Archive source files** (except target) to `.archive/`

### 5. Merge Workflow

When merging multiple files into one:

1. **Sort files** by created date (oldest first)
   - Read frontmatter `created` field (ISO8601 format)
   - Fallback: use file mtime if `created` missing

2. **Prepare merged content**:
   - Use oldest file's `created` date
   - Merge all tags (unique union)
   - Combine all aliases (unique, cap at 10)
   - Combine content with timestamped entry headers:
     ```markdown
     ## Entry: YYYY-MM-DD HH:MM
     {content from this file}
     ```
   - Calculate `entry_count` from all `## Entry` headers

3. **Write merged file**:
   - Use generic filename (shortest/most canonical)
   - Include aliases from all source files
   - If target file exists, append and merge frontmatter

4. **Archive source files** (except the target file):
   - Move to `.archive/` subfolder
   - Handle conflicts with timestamp suffix

### 6. Auto-Merge Mode

When user requests automatic merging (no prompts):

1. **Trust AI groupings**: Auto-merge all groups identified by AI
   - AI has already determined semantic similarity
   - Use AI-suggested generic titles

2. **Category priority for target**: When group spans categories:
   - decisions > patterns > errors > research > knowledge
   - Or keep in category with most files

3. **Still prompt for**:
   - Groups with notes in very different categories (e.g., errors + decisions)
   - When AI confidence indicators suggest uncertainty

### 7. Report Summary

After processing all files:

```markdown
# Consolidation Summary

**Scanned**: {N} files across {M} categories
**AI Model**: {config.ai.model}
**Groups Found**: {X} duplicate groups

## Merged Groups
| Group | Files | Target | Aliases Added |
|-------|-------|--------|---------------|
| Stop hook blocking | 3 | decisions/stop-hook-blocking.md | 2 |
| Windows path normalization | 4 | research/windows-path-normalization.md | 3 |

## Skipped
- `{filename}`: {reason}

## Stats
- Files before: {N}
- Files after: {M}
- Reduced by: {N-M} ({percentage}%)

---
Archived files are in `.archive/` folders.
Aliases added will improve future Jaccard matching.
```

## AI Semantic Matching Details

### Why AI Instead of Filename Patterns?

Filename-based matching (Jaccard word similarity) misses semantic duplicates:
- "stop-hook-non-blocking" vs "prevent-stop-hook-blocking" → different words, same topic
- "windows-config-location" vs "cc-obsidian-mem-config-path" → same topic
- "jaccard-similarity-limitations" vs "word-based-matching-insufficient" → same topic

AI understands that these are the same topic even with different wording.

### Self-Improving System

When AI identifies duplicates and they're merged:
1. **All source titles added as aliases** to merged note
2. **Next time**, Jaccard matching will catch similar titles (aliases are checked)
3. **Reduces future AI calls** - the system learns from consolidation

### Handling Large Note Collections

If project has many notes (50+), batch the AI call:
1. Send first 50 notes to AI
2. Process identified groups
3. Repeat with remaining notes
4. This avoids prompt size limits

## Edge Cases

### Category Index Exclusion

**Problem**: Category index files like `decisions/decisions.md` have the same slug as their folder name.

**Solution**: Explicitly exclude files matching `${category}.md` pattern.

### Sessions Folder

**Problem**: `sessions/` folder contains auto-generated session notes.

**Solution**: Exclude `sessions` category from consolidation.

### Files Without Created Date

**Problem**: Some files may not have `created` field in frontmatter.

**Solution**: Fall back to filesystem mtime and warn user.

### Already-Consolidated Files

**Problem**: Some generic files may already have multiple entries from previous consolidations.

**Solution**: Append new entries, merge aliases, update entry_count.

### Archive Conflicts

**Problem**: File already exists in `.archive/` from previous consolidation.

**Solution**: Append timestamp to filename: `auth-bug_20260115-103000.md`

## Safety Features

- **Dry run available**: Preview changes before applying
- **Archive before delete**: Old files moved to `.archive/` for easy recovery
- **Conflict handling**: Timestamp suffixes prevent overwrites
- **Alias preservation**: Original titles saved for future matching
- **Incremental**: Can run multiple times safely

## Follow-up Actions

After consolidation, suggest:
- Review archived files in `.archive/` folders
- Run `/mem-audit` to verify vault structure is clean
- Clean up old archives when confident changes are correct
