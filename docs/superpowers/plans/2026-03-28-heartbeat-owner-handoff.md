# Heartbeat Owner Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure one machine has exactly one active heartbeat owner, and let the most recent explicit start from Claude/Codex take over safely.

**Architecture:** Persist a machine-level heartbeat-owner record under `~/.memorytree/`, use it during `daemon install`, `daemon quick-start`, `daemon uninstall`, and `daemon status`, and treat owner mismatch as a scheduler handoff that reinstalls the scheduler to the current runtime. Keep the existing lock as the last-line runtime guard.

**Tech Stack:** TypeScript, Vitest, Commander CLI, OS scheduler adapters, JSON state under `~/.memorytree/`

---

### Task 1: Add failing owner-state tests

**Files:**
- Create: `tests/heartbeat/owner.test.ts`
- Test: `tests/heartbeat/owner.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'

describe('heartbeat owner state', () => {
  it('infers Claude and Codex owners from skill paths and round-trips owner state', () => {
    expect(true).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/heartbeat/owner.test.ts`
Expected: FAIL because the owner helpers do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export function detectHeartbeatOwner() { /* minimal implementation */ }
export function readHeartbeatOwner() { /* minimal implementation */ }
export function writeHeartbeatOwner() { /* minimal implementation */ }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/heartbeat/owner.test.ts`
Expected: PASS

### Task 2: Add failing daemon handoff tests

**Files:**
- Modify: `tests/cli/daemon.test.ts`
- Test: `tests/cli/daemon.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('reinstalls the scheduler when quick-start takes ownership from another client', async () => {
  expect(true).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/cli/daemon.test.ts`
Expected: FAIL because quick-start currently keeps same-interval installs even when the owner changed.

- [ ] **Step 3: Write minimal implementation**

```ts
if (registeredOwner !== null && registeredOwner.owner_id !== currentOwner.owner_id) {
  uninstall + reinstall
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/cli/daemon.test.ts`
Expected: PASS

### Task 3: Document the owner file and takeover semantics

**Files:**
- Modify: `references/global-configuration.md`
- Modify: `references/heartbeat-scheduling.md`

- [ ] **Step 1: Update the docs**

```md
- heartbeat-owner.json stores the current machine-level heartbeat owner metadata.
- The latest explicit install/quick-start takes ownership and replaces the previous scheduler binding.
```

- [ ] **Step 2: Run focused verification**

Run: `npm test -- tests/heartbeat/owner.test.ts tests/cli/daemon.test.ts`
Expected: PASS

### Task 4: Final regression sweep

**Files:**
- Modify: `src/cli/cmd-daemon.ts`
- Modify: `src/heartbeat/owner.ts`
- Modify: `tests/cli/daemon.test.ts`
- Modify: `tests/heartbeat/owner.test.ts`
- Modify: `references/global-configuration.md`
- Modify: `references/heartbeat-scheduling.md`

- [ ] **Step 1: Run lint, typecheck, tests, and build**

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

- [ ] **Step 2: Confirm the tree stays green**

Expected: all commands exit successfully with no new failures.
