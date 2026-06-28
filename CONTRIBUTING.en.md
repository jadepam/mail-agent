# Contributing Guide

Thanks for your interest in Mail Agent! This guide helps you get started with development and the release process.

## Development Setup

**Prerequisites**: Node.js ≥ 20, pnpm ≥ 9

## Project Structure

```
mail-agent/
├── packages/
│   ├── core/              # @mail-agent/core — Unified data model & adapter interfaces
│   ├── cli/               # @mail-agent/cli — CLI tool (bin: ma)
│   ├── provider-smtp/     # @mail-agent/provider-smtp — SMTP/IMAP adapter
│   ├── provider-agently/  # @mail-agent/provider-agently — Agently Mail adapter
│   └── provider-gmail-api/# @mail-agent/provider-gmail-api — Gmail API adapter
├── site/                  # Docs site (Astro + Starlight)
├── scripts/               # Tool scripts
│   ├── sync-version.mjs   # Version sync
│   └── bump.mjs           # Local version bump (fallback)
└── SKILL.md               # Claude Code Skill definition
```

## Development Workflow

### 1. Fork the Repository

Click the **Fork** button in the top-right corner of the GitHub page to fork the repository to your account.

### 2. Clone and Configure Upstream

```bash
# Clone your fork
git clone https://github.com/<your-username>/mail-agent.git
cd mail-agent

# Add upstream repository (to sync latest changes)
git remote add upstream https://github.com/jadepam/mail-agent.git

# Fetch all upstream branches
git fetch upstream
```

### 3. Create a Feature Branch from dev

```bash
# Create a feature branch based on the latest dev
git checkout -b feat/your-feature upstream/dev
```

> The project uses a two-branch model: `dev` is the development integration branch, `main` is the stable release branch. All PRs target `dev`.

### 4. Develop & Test

```bash
# Watch mode
pnpm dev

# Run tests for affected packages
pnpm --filter @mail-agent/core run test
```

**Testing requirements**:

- Unit tests must not depend on external networks — use mocks
- Integration tests auto-skip when no account is configured
- After code changes, consider impact on related tests and add coverage

### 5. Sync with Upstream

Before submitting a PR, sync with the upstream repository to avoid conflicts:

```bash
git fetch upstream
git rebase upstream/dev
```

### 6. Commit & PR

```bash
git add .
git commit -m "feat: add XXX feature"
git push origin feat/your-feature
```

Then create a Pull Request on GitHub with the target branch set to `jadepam/mail-agent` → `dev`.

### 7. Code Review & Merge

After the PR is submitted, CI will automatically run build and tests. Wait for the maintainer's review before merging to `dev`.

### 8. Release (Maintainers Only)

After the maintainer merges `dev` into `main`, CI performs the automated release process — see below for details.

## Branch Strategy

| Branch | Purpose                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------ |
| `dev`  | Development integration branch. Target for all feature PRs, contains the latest in-progress code |
| `main` | Stable release branch. Only merged by maintainers from `dev`; merging triggers automated release |

## Release Process (Maintainers Only)

When code is merged into `main`, CI performs these steps automatically:

```
PR merged to main
  ↓
CI: Auto bump patch version (0.0.1 → 0.0.2)
  ↓
CI: sync-version to all locations
  ↓
CI: Build + test
  ↓
CI: Commit version change + tag (v0.0.2) + push
  ↓
CI: pnpm publish to npm
```

**No manual version changes or publishing needed** — this section is for maintainers only. External contributors should refer to the Development Workflow above.

### Version sync locations

After bump, version is synced to these locations automatically:

| Location                    | Description             |
| --------------------------- | ----------------------- |
| `package.json` (root)       | Source of truth         |
| `packages/*/package.json`   | All sub-packages        |
| `packages/cli/src/index.ts` | CLI `--version` output  |
| `SKILL.md`                  | Skill frontmatter       |
| `cli-setup.md`              | Setup guide frontmatter |

### Manual trigger (optional)

You can manually trigger the Release workflow from GitHub Actions with:

- **Bump type**: `patch` (default) / `minor` / `major`
- **Dry run**: Run the full flow without publishing

### Local bump (fallback)

If you need to bump locally (e.g., to test the release flow):

```bash
pnpm bump patch    # 0.0.1 → 0.0.2
pnpm bump minor    # 0.0.1 → 0.1.0
pnpm bump major    # 0.0.1 → 1.0.0
pnpm bump 1.2.3    # Exact version
```

> ⚠️ If you bump locally and push to main, CI will detect the tag already exists and skip the release. Local bump is usually unnecessary.

## Code Conventions

- **License**: Code MIT / Docs CC BY 4.0; copyright notice only in root LICENSE
- **package.json**: New packages add `"license": "MIT"` + `"author": "jadepam"`
- **Versions**: SemVer, unified release, no hardcoding
- **Consistency**: Changes must be globally consistent — no contradictions
- **Decisions**: Accepted decisions go to `LESSONS.md`, not `CLAUDE.md`

## Repository Setup

No GitHub Secret needed — CI uses npm trusted publishing (OIDC) for automatic authentication:

```bash
# First-time setup: run locally once
npm login
npm trusted-publish add github
```

This registers the GitHub repo with npm. After that, CI automatically authenticates via OIDC on every release — no long-lived tokens to store.
