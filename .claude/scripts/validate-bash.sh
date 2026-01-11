#!/bin/bash
# Pre-tool-use validation hook for Bash commands
# Blocks access to sensitive directories and files

# Read JSON input from stdin
INPUT=$(cat)

# Extract the command from JSON
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# If no command found, allow it
if [ -z "$COMMAND" ]; then
  exit 0
fi

# Define forbidden patterns (security-sensitive paths)
FORBIDDEN_PATTERNS=(
  "\.env"
  "node_modules"
  "__pycache__"
  "\.git/"
  "venv/"
  "\.pyc$"
  "\.csv$"
  "\.log$"
  "\.pem$"
  "\.key$"
  "credentials\.json"
  "service-account-key\.json"
)

# Check if command contains any forbidden patterns
for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qE "$pattern"; then
    echo "ERROR: Access to '$pattern' is blocked by security policy" >&2
    exit 2 # Exit code 2 = blocking error
  fi
done

# Command is clean, allow it
exit 0
