---
name: mem-repair
description: Repair common issues with the memory system. Cleans up orphan temp files, stale sessions, lock files, and old logs.
version: 1.0.4
allowed-tools:
  - Bash
  - Read
---

# Memory Repair Skill

Clean up and repair common issues with the cc-obsidian-mem memory system.

## When to Use

- Getting errors about temp files or stale sessions
- Sessions not starting properly
- `--continue` picking up wrong sessions
- Sessions stuck in "processing" status
- Want to clean up all temp files and start fresh

## Usage

```
/mem-repair
/mem-repair full
```

## Workflow

1. **Show Current Status**
   First, show what will be cleaned:

   ```bash
   # Windows (cmd)
   dir "%TEMP%\cc-obsidian-mem-*.txt" 2>nul || echo No temp files
   dir "%TEMP%\cc-mem-agent-*.txt" 2>nul || echo No legacy temp files
   dir "%USERPROFILE%\.cc-obsidian-mem\locks\*" 2>nul || echo No lock files

   # macOS/Linux
   ls -la /tmp/cc-obsidian-mem-*.txt 2>/dev/null || echo "No temp files"
   ls -la /tmp/cc-mem-agent-*.txt 2>/dev/null || echo "No legacy temp files"
   ls -la ~/.cc-obsidian-mem/locks/* 2>/dev/null || echo "No lock files"
   ```

2. **Clean Up Temp Files**
   Remove orphan temp files from crashed sessions:

   ```bash
   # Windows (cmd)
   del /q "%TEMP%\cc-obsidian-mem-*.txt" 2>nul
   del /q "%TEMP%\cc-mem-agent-*.txt" 2>nul

   # macOS/Linux
   rm -f /tmp/cc-obsidian-mem-*.txt
   rm -f /tmp/cc-mem-agent-*.txt
   ```

3. **Clean Up Stale Lock Files**

   ```bash
   # Windows (cmd)
   del /q "%USERPROFILE%\.cc-obsidian-mem\locks\*" 2>nul

   # macOS/Linux
   rm -f ~/.cc-obsidian-mem/locks/*
   ```

4. **Clean Up Old Log Files** (optional, if user requests full cleanup)

   ```bash
   # Windows (cmd)
   del /q "%TEMP%\cc-obsidian-mem-*.log" 2>nul

   # macOS/Linux
   rm -f /tmp/cc-obsidian-mem-*.log
   ```

5. **Clean Up Database Sessions** (if sqlite3 is available)

   ```bash
   # Mark stale processing sessions as failed (stuck > 30 min)
   sqlite3 ~/.cc-obsidian-mem/sessions.db "UPDATE sessions SET status = 'failed' WHERE status = 'processing' AND updated_at < datetime('now', '-30 minutes');"

   # Mark orphan active sessions as failed (active > 24 hours)
   sqlite3 ~/.cc-obsidian-mem/sessions.db "UPDATE sessions SET status = 'failed' WHERE status = 'active' AND created_at < datetime('now', '-24 hours');"

   # Show recent sessions
   sqlite3 ~/.cc-obsidian-mem/sessions.db "SELECT substr(session_id, 1, 12) || '...' as session_id, status, project, created_at FROM sessions ORDER BY created_at DESC LIMIT 10;"
   ```

   Windows alternative (if sqlite3 not in PATH):
   ```bash
   # Just show the database file exists
   dir "%USERPROFILE%\.cc-obsidian-mem\sessions.db" 2>nul || echo No database found
   ```

6. **Clean Polluted Claude Session History** (if `--continue` picks wrong sessions)

   ```bash
   # Windows (PowerShell) - find and delete polluted session files
   Get-ChildItem -Path "$env:USERPROFILE\.claude\projects" -Recurse -Filter "*.jsonl" |
     Where-Object { (Get-Content $_.FullName -Raw) -match "cc-mem-agent|cc-obsidian-mem-" } |
     Remove-Item -Force

   # macOS/Linux
   grep -rl "cc-mem-agent\|cc-obsidian-mem-" ~/.claude/projects --include="*.jsonl" | xargs rm -f
   ```

## Output Format

```markdown
## Memory System Repair

### Temp Files Cleaned
- Removed 3 orphan temp files
- Removed 1 legacy temp file

### Lock Files Cleaned
- Removed 2 stale lock files

### Database Sessions
- Marked 1 stale processing session as failed
- Marked 0 orphan sessions as failed

### Log Files
- Kept (use `/mem-repair full` to remove)

### Recent Sessions
| Session ID | Status | Project | Created |
|------------|--------|---------|---------|
| abc123... | completed | my-project | 2024-01-15 10:30 |
| def456... | failed | other-proj | 2024-01-14 15:20 |

Repair complete. Start a new session to continue working.
```

## Common Issues Fixed

| Issue | Symptom | Fix |
|-------|---------|-----|
| Orphan temp files | Errors reading temp files | Remove `cc-obsidian-mem-*.txt` |
| Legacy temp files | `--continue` picks wrong session | Remove `cc-mem-agent-*.txt` |
| Stale locks | Sessions stuck in "processing" | Remove files from `~/.cc-obsidian-mem/locks/` |
| Stale processing | Sessions never complete | Mark as failed in database |
| Orphan sessions | Old active sessions | Mark as failed in database |
| Polluted history | `--continue` reads file paths | Delete polluted JSONL files |
| Old logs | Disk space usage | Remove `cc-obsidian-mem-*.log` |

## After Repair

- Start a fresh session (not `--continue`)
- If issues persist, check config: `cat ~/.cc-obsidian-mem/config.json`
- Run `/mem-status` to verify memory system is working
