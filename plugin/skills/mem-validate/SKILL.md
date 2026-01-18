---
name: mem-validate
description: AI-powered validation of knowledge notes against current codebase. Detects stale content by comparing documented knowledge with actual files.
version: 1.0.1
allowed-tools:
  - mcp__obsidian-mem__mem_validate
  - mcp__obsidian-mem__mem_read
  - mcp__obsidian-mem__mem_supersede
  - Bash
---

# Memory Validate Skill

Validate your knowledge notes against the current state of the codebase to detect stale content.

## When to Use

- Periodic knowledge base maintenance
- After major refactoring
- Before relying on old documentation
- To identify notes that need updating

## Usage

```
/mem-validate project:my-project
/mem-validate project:my-project noteType:decision
/mem-validate project:my-project limit:10
```

## How It Works

1. **Extract File References**
   - Scans note content for file path mentions
   - Patterns like `src/utils/helper.ts`, code block paths, etc.

2. **Check File Existence**
   - If referenced files are deleted: note is definitely stale
   - If some files missing: note is likely stale

3. **AI Comparison** (for existing files)
   - Reads current file content (first 2000 chars)
   - Uses AI to compare documented knowledge vs actual code
   - Returns staleness verdict with confidence score

## Workflow

1. **Run Validation**
   - Call `mem_validate` for the project
   - Default limit: 20 notes (AI validation is slow)

2. **Present Results**
   - Group by status: stale, current, unable to validate
   - Show confidence scores for stale notes
   - List files that have changed

3. **Offer Actions**
   - For stale notes: offer to update via `mem_supersede`
   - For notes without file references: note that manual review may be needed

## Output Format

```markdown
# Content Validation Results

**Checked**: 15 notes
**Stale**: 3
**Current**: 10
**Unable to validate**: 2

## Stale Notes

These notes may need to be updated or superseded:

### `research/2024-01-15_api-design.md`
- **Confidence**: 85%
- **Reason**: The API endpoint handlers have been refactored to use a different pattern
- **Referenced files**: src/api/handlers.ts, src/middleware/auth.ts

### `decisions/authentication-strategy.md`
- **Confidence**: 92%
- **Reason**: All referenced files have been deleted

## Unable to Validate

- `research/general-tips.md`: No file references found in note content

---
Use `mem_supersede` to update stale notes with current information.
```

## Follow-up Actions

For each stale note, offer:
1. **Update**: Read current files and create superseding note with `mem_supersede`
2. **Skip**: Leave as-is (user decides later)
3. **Delete**: If content is no longer relevant

## Notes

- Validation is AI-powered and may take 30-60 seconds per note
- Uses `claude -p` with haiku model for fast validation
- Notes without file references cannot be automatically validated
- High confidence (>80%) suggests the note should definitely be reviewed
