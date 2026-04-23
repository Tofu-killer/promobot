# Browser Artifact Ops Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strengthen PromoBot's browser-lane and browser-handoff operations with deploy-time health visibility and a reversible artifact archive CLI.

**Architecture:** Keep the two workstreams isolated. The health workstream adds a read-only browser artifact summary that can be reused by `/api/system/health` and the deployment smoke CLI. The archive workstream adds an explicit CLI that archives old resolved/obsolete artifacts into an on-disk archive tree with a dry-run mode, so operators can reduce clutter without deleting evidence.

**Tech Stack:** TypeScript, Express 5, better-sqlite3-backed runtime paths, Vitest, tsx CLI entrypoints

---

## File Structure

- Create: `src/server/services/browser/artifactHealth.ts`
- Create: `src/server/services/browser/artifactArchiver.ts`
- Create: `src/server/cli/archiveBrowserArtifacts.ts`
- Modify: `src/server/routes/system.ts`
- Modify: `src/server/cli/deploymentSmoke.ts`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `tests/server/system.test.ts`
- Modify: `tests/server/deploymentSmoke.test.ts`
- Create: `tests/server/archiveBrowserArtifacts.test.ts`

### Task 1: Browser Artifact Health Summary

**Files:**
- Create: `src/server/services/browser/artifactHealth.ts`
- Modify: `src/server/routes/system.ts`
- Modify: `src/server/cli/deploymentSmoke.ts`
- Modify: `tests/server/system.test.ts`
- Modify: `tests/server/deploymentSmoke.test.ts`

- [ ] **Step 1: Write failing health and smoke assertions**

Add tests that prove:
- `/api/system/health` returns browser-lane request counts and browser-handoff counts
- the health payload surfaces pending/resolved/obsolete splits
- `deploymentSmoke.ts` probes both browser artifact endpoints and returns the richer health payload

- [ ] **Step 2: Run targeted tests to verify failure**

Run: `pnpm test -- tests/server/system.test.ts tests/server/deploymentSmoke.test.ts`
Expected: FAIL because the new health fields and smoke probe order do not exist yet.

- [ ] **Step 3: Implement a read-only browser artifact summary helper**

Create a small service that reads existing artifact lists and returns a normalized summary:
- lane requests: `total`, `pending`, `resolved`
- browser handoffs: `total`, `pending`, `resolved`, `obsolete`, `unmatched`

- [ ] **Step 4: Wire the summary into `/api/system/health` and the smoke CLI**

Update the health payload to include the browser artifact summary and update the smoke CLI so it also probes `/api/system/browser-handoffs?limit=1`.

- [ ] **Step 5: Run targeted tests to verify pass**

Run: `pnpm test -- tests/server/system.test.ts tests/server/deploymentSmoke.test.ts`
Expected: PASS with all targeted tests green.

### Task 2: Reversible Browser Artifact Archive CLI

**Files:**
- Create: `src/server/services/browser/artifactArchiver.ts`
- Create: `src/server/cli/archiveBrowserArtifacts.ts`
- Modify: `package.json`
- Create: `tests/server/archiveBrowserArtifacts.test.ts`

- [ ] **Step 1: Write failing archive CLI/service tests**

Add tests that prove:
- dry-run mode reports candidate artifacts without moving files
- apply mode archives resolved browser-lane result/request artifacts older than a retention cutoff
- apply mode archives resolved/obsolete browser-handoff artifacts older than a retention cutoff
- pending artifacts are never archived

- [ ] **Step 2: Run targeted tests to verify failure**

Run: `pnpm test -- tests/server/archiveBrowserArtifacts.test.ts`
Expected: FAIL because the archive service and CLI do not exist yet.

- [ ] **Step 3: Implement the archive service**

Move eligible artifacts from:
- `artifacts/browser-lane-requests/**`
- `artifacts/browser-handoffs/**`

into:
- `artifacts/archive/browser-lane-requests/**`
- `artifacts/archive/browser-handoffs/**`

Preserve relative paths, return a machine-readable summary, and keep dry-run as the default.

- [ ] **Step 4: Add the CLI and package script**

Support:
- `--apply`
- `--older-than-hours <n>`
- `--include-results`
- `--help`

Default behavior must be non-destructive dry-run output.

- [ ] **Step 5: Run targeted tests to verify pass**

Run: `pnpm test -- tests/server/archiveBrowserArtifacts.test.ts`
Expected: PASS with archive behavior verified.

### Task 3: Operator Docs

**Files:**
- Modify: `README.md`
- Modify: `docs/DEPLOYMENT.md`

- [ ] **Step 1: Document the new health contract and archive CLI**

Describe:
- the new `/api/system/health` browser artifact summary
- the extra smoke check against browser handoffs
- the archive CLI, its dry-run default, and the archive directory layout

- [ ] **Step 2: Run build and full tests**

Run: `pnpm test && pnpm build`
Expected: PASS with no regressions.
