# AI Agent Guidelines

This repository is maintained and developed by human contributors and AI coding assistants. All AI agents (Antigravity, Cursor, Claude Code, GitHub Copilot, etc.) must strictly adhere to the following rules when modifying code and interacting with git.

---

## Git Commit Rules

### 1. Subject Line Length Limit (Strict 50/72 Rule)
- **Subject lines MUST be 50 characters or fewer** (absolute hard limit: 72 characters).
- Never write verbose, rambling, or multi-clause commit titles.
- Follow **Conventional Commits**: `<type>(<scope>): <imperative summary>`
  - Allowed types: `feat`, `fix`, `refactor`, `perf`, `test`, `style`, `docs`, `chore`
  - Good ($44$ chars): `feat(toolbar): scope defaults to active tool`
  - Bad ($79$ chars): `feat(toolbar): scope drawing defaults popover to active tool and show in header`
- **Body for extra context**: If more explanation is needed, leave one blank line after the subject and write the details in the commit body, wrapping lines at 72 characters:
  ```text
  feat(toolbar): scope defaults to active tool

  - Display current selected tool with icon and badge in header
  - Show settings relevant only to active tool
  - Provide fallback state with quick tool switches
  ```

### 2. Session-Scoped Staging (Never `git add .`)
- **Only commit files that directly belong to the current task/session.**
- The workspace may contain unrelated uncommitted modifications, scratch files, or work-in-progress from other parallel tasks or sessions.
- **FORBIDDEN COMMANDS**:
  - `git add .`
  - `git add -A`
  - `git commit -a`
  - `git commit -am "..."`
- **Mandatory Workflow**:
  1. Inspect status: `git status`
  2. Explicitly stage only your session's files:
     ```bash
     git add path/to/file1.ts path/to/file2.ts
     ```
  3. Verify staged changes before committing: `git diff --staged --stat`
  4. Ensure no unrelated files or temporary artifacts are staged.

### 3. Pre-Commit Quality Verification
- Before creating a commit, always ensure the project passes compilation, linting, and tests:
  ```bash
  pnpm check
  ```

---

## Code Quality Standards
- **Production-grade TypeScript**: No `any` escapes unless strictly interacting with untyped 3rd-party browser APIs.
- **Zero Test Regressions**: All unit tests (`pnpm test`) and E2E browser tests (`pnpm test:e2e`) must pass.
- **Accessibility**: All interactive elements must follow WCAG 2.2 keyboard navigation and ARIA guidelines.
