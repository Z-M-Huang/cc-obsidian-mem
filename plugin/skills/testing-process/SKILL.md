---
name: testing-process
description: Guidelines for testing TypeScript/Bun code. Use when writing new features, fixing bugs, or reviewing test coverage.
---

# Testing & Quality Assurance Process

## Guidelines

1. Always add tests for new functionality, covering all branches and edge cases.
2. Add tests for bug fixes if not already covered. Fix existing tests if the bug was previously covered.
3. Run all tests after completing implementation or fixes: `bun test`

## Testing Best Practices for TypeScript/Bun

### Test Structure
- Use descriptive test names that explain the expected behavior
- Group related tests using `describe()` blocks
- Use `beforeEach`/`afterEach` for setup and teardown
- Keep tests focused on a single behavior

### Coverage
- Aim for comprehensive coverage of public APIs
- Test edge cases: empty inputs, nulls, boundaries
- Test error paths and exception handling
- Use table-driven tests for multiple similar cases

### Mocking
- Mock external dependencies (filesystem, network, time)
- Use dependency injection to make code testable
- Prefer spies over mocks when possible
- Reset mocks between tests

### Running Tests
```bash
cd plugin
bun test              # Run all tests
bun test --watch      # Watch mode
bunx tsc --noEmit     # Type check only
```

### Test File Organization
- Tests live in `plugin/tests/`
- Name test files with `.test.ts` suffix
- Mirror source structure in test files

## Pre-Commit Checklist
- [ ] All existing tests pass
- [ ] New tests added for new functionality
- [ ] Type checking passes (`bunx tsc --noEmit`)
- [ ] No console.log statements in production code
