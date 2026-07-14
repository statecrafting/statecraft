---
id: "008-governance-attestation"
title: "Governance spine: attestation ledger + action gate + trust window"
status: approved
created: "2026-07-14"
implementation: pending
depends_on:
  - "001-stagecraft-thesis"
establishes:
  - { kind: directory, path: "governance/" }
  - { kind: directory, path: "addon/governance-native/" }
summary: >
  The platform's tamper-evident memory and its decision spine, built on
  the four crates extracted from OAP's policy-kernel: attest-ledger
  (tamper-evident record chain + signed anchors), canonical-keysort-json
  (byte-identical canonical JSON), action-gate (pure deterministic
  Gate over an ordered Check registry), and trust-window
  (rolling-window trust scorer mapping to graduated privilege). A
  napi-rs addon wraps the Rust crates; a governance/ Encore service
  exposes record/verify/gate/trust APIs that factory (005) and fleet
  (006) call at their privileged moments. This is the platform's
  differentiator: not that it deploys apps, but that every privileged
  act is gated, recorded, and independently verifiable.
---

# 008: Governance: attestation, gating, trust

## 1. Crate dependencies (read first)

Four external crates, extracted from the OAP policy-kernel
(stagecraft-ing lineage). DECIDED 2026-07-14: all are published on
crates.io under the stagecraft-ing org (verified: canonical-keysort-json
0.1.0, attest-ledger-types/core/cli 0.1.0, action-gate-types/core
0.1.0, trust-window 0.1.0; repository fields point at
github.com/stagecraft-ing/*). Consume from crates.io with exact version
pins (`=0.1.x` while pre-1.0); do NOT use git dependencies. Local
working copies exist at ~/DevWork/<name> for reference reading if the
session has access.

- `canonical-keysort-json`: deterministic canonical JSON: recursive
  lexicographic key sort at the serialization boundary; values
  serialize byte-identically regardless of serde preserve_order.
- `attest-ledger-types` + `attest-ledger-core` (repo attest-ledger):
  the tamper-evident LedgerRecord envelope, signed ChainAnchor,
  hashing, Ed25519 anchor signing, independent verification of the
  record chain and audit-segment chain. (`attest-ledger-cli` exists as
  an independent verifier; not a dependency, but its existence is the
  design point: third parties can verify our ledger without our code.)
- `action-gate-types` + `action-gate-core` (repo action-gate): a pure,
  deterministic Gate over a pluggable ordered Check registry, stable
  config hash, ActionContext -> Decision/Outcome.
- `trust-window`: rolling-window trust scorer: weighted samples map to
  a graduated privilege level, degrade-only or bidirectional,
  deterministic, snapshot-persistable.

## 2. Territory

- `addon/governance-native/`: napi-rs cdylib `governance-native`
  (spec-spine manifest key -> this spec; add to spec-spine.toml
  standalone lists). Exposed surface (plain JSON in/out):
  - `canonicalize(json) -> {canonical, sha256}`
  - `ledgerAppend(stateDir, record) -> {seq, recordHash, chainHash}`
    and `ledgerVerify(stateDir) -> {ok, seq, error?}` over an
    append-only file store; `ledgerAnchor(stateDir, keyRef) -> anchor`
    (Ed25519; key from an Encore secret, never on disk unencrypted).
  - `gateEvaluate(configJson, actionContextJson) -> decision` with the
    gate's stable config hash included in the result.
  - `trustSample(snapshotJson|null, sampleJson) -> snapshotJson` and
    `trustLevel(snapshotJson) -> {level, score}`.
- `governance/`: Encore.ts service:
  - `POST /governance/records` (internal + API): append an attestation
    {kind: stamp|deploy|update|backup|remove|approval, subject ids,
    payloadHash (keysorted sha256 of the full payload), actor}: the
    full payload itself goes into the record; CoreLedger keeps an
    index row (recordSeq, kind, subject, hash) for queries while the
    chain file is the authority.
  - `GET /governance/records?subject=...` list from the index;
    `GET /governance/verify` runs ledgerVerify and returns the chain
    head.
  - `POST /governance/gate` (internal): evaluate an ActionContext for
    factory/fleet privileged verbs; deny is final, allow returns the
    decision + config hash which the caller must attach to its
    attestation record.
  - Trust: per-actor (user or agent identity) snapshots persisted via
    CoreLedger; samples appended on gate outcomes and operation
    results; level is advisory v1 (exposed, not yet enforced).
- Gate config v1 (checks, ordered): posture-required (stamps must
  carry an explicit agentic posture), confirm-name-required (fleet
  remove), tenant-active, actor-authenticated. Config lives in a
  committed JSON with its stable hash asserted in a test, so config
  drift is visible in review.

## 3. Integration contract (for specs 005/006)

Callers wrap privileged transitions: evaluate gate -> on allow, act ->
append attestation with the gate's config hash and the action's
payload hash. Factory stamps additionally record the born-with
certHash (enrahitu spec 012 §4), which makes the repo-local cert and
the platform ledger mutually checkable. Callers must treat a missing
governance service as deny for remove-class actions and
warn-and-proceed for read-class; never silently skip a gate.

## 4. Acceptance

- Rust addon tests: canonicalize matches canonical-keysort-json's own
  test vectors; append/verify detects a tampered byte; gate decision
  deterministic across runs with stable config hash; trust level
  transitions on a scripted sample stream.
- Service tests: record round-trip (index row + chain growth +
  verify ok), gate deny surfaces to callers, payloadHash equals an
  independently computed keysorted sha256.
- One integration test proving the spec 005 pattern: a fake stamp
  flow calls gate -> append -> verify.
- Spine gates + verify verb green.

## 5. Out of scope

- Enforcing trust levels on real actions (advisory in v1).
- External anchor publication (e.g. a public transparency log) and
  key rotation ceremonies.
- The approvals human-workflow UI (data shape lands here; UI is a
  follow-up to spec 007).
