# AGENTS.md: stagecraft

This file is the cross-agent session-init protocol authority, read by
Claude Code, Codex CLI, Cursor, and GitHub Copilot via the AAIF/Linux
Foundation AGENTS.md standard.

Governance is provided by `spec-spine` (installed on your `PATH`). All
governed reads of compiled artifacts go through its CLI. Bootstrap spec:
`specs/000-bootstrap/spec.md`.

## New Sessions

Run these as the first actions of a new session:

0. **Load rules** (read first): `.claude/rules/orchestrator-rules.md`,
   `.claude/rules/governed-artifact-reads.md`, and
   `.claude/rules/adversarial-prompt-refusal.md`.

1. **Refresh the registry, then parallel reads.** Run `spec-spine compile`
   first, then dispatch simultaneously:
   - `CLAUDE.md`: project overview, governance model, conventions
   - `README.md`: full project description and product-family map
   - `standards/spec/contract.md`: the short normative spec-spine contract
   - `spec-spine registry status-report --json --nonzero-only`: lifecycle counts
   - `spec-spine registry list --ids-only`: spec inventory

2. **Orient on the thesis.** `specs/001-stagecraft-thesis/spec.md` §3
   (service map) and §6 (milestone ladder) define what gets built next
   and in what order.

## Working the backlog

This repo's backlog is its spec corpus: every spec with
`implementation: pending` is a work order. One session implements one
spec, start to finish.

**Current build order (2026-07-16).** Specs 002 through 008 landed; their
historical order (002 shell, 003 Postgres, 004 tenants, 005 factory, 006
fleet, 007 webapp, 008 governance) is now only of archaeological interest.
What remains:

1. **007 chassis realignment** (small, parallel-safe, do it whenever): move
   the SPA `webapp/` -> `frontend/` to match the enrahitu chassis
   convention, and retire spec 002's phantom `frontend/` edge. Mechanical
   but wide; see 007's 2026-07-16 status note for the blast radius. It is
   independent of the cluster work, so it can land first as a quick win.
2. **010 stagecraft cluster** is the main line: the stagecraft-owned
   hetzner-k3s cluster, Flux GitOps from the in-repo `infra/` tree, SOPS
   secrets, and the platform services. Built alongside the existing
   OAP-named cluster, DNS cut when proven, old cluster deleted after.
3. **009 control plane deploy** resumes once 010 lands. Stage 1 (the
   image) is done and cluster-independent; stage 2 (the deploy) is
   re-scoped onto 010's cluster and is blocked until it exists.

Note that 001 (the thesis) carries `implementation: pending` but is a
record, not a work order; do not pick it up as one.

1. Pick the next spec: the lowest-numbered spec whose frontmatter says
   `implementation: pending` and whose `depends_on` specs are all
   implemented (`spec-spine registry show <id>` to inspect). If a
   spec's "Cross-repo dependency" or "Operator prerequisites" section
   names something missing, stop and report exactly what is needed
   instead of mocking around it.
2. Flip the spec to `implementation: in-progress` when you start.
3. Re-read the spec fully before coding. If the design is imprecise or
   wrong, amend the spec FIRST (design truth precedes code), then
   implement. Never edit a spec afterwards to ratify what the code
   happened to do.
4. Implement within the spec's territory. Before every commit:
   `spec-spine compile && spec-spine index &&
   spec-spine lint --fail-on-warn && spec-spine index check`, plus the
   build/test commands in CLAUDE.md (after spec 002: the chassis npm
   gates, typecheck + vitest).
5. Satisfy the spec's Acceptance section verbatim. If an item cannot
   be satisfied (external state, missing sibling repo work), keep
   `implementation: in-progress`, add a dated Status note to the spec
   saying exactly what remains, and report it. Flip to
   `implementation: complete` only when acceptance holds.
6. Commit with a conventional message referencing the spec id
   (`feat(004): ...`), include the regenerated `.derived/` shards, and
   push to main. Then stop: the next session takes the next spec.

## Working rules

- Specs are the source of truth; code lands only under an owning spec.
- Read `.derived/**` only through `spec-spine` subcommands.
- After editing any `specs/*/spec.md`, run
  `spec-spine compile && spec-spine index` and commit the regenerated
  shards with the edit.
