---
id: "002-app-shell"
title: "The control plane's EnRaHiTu app shell"
status: approved
created: "2026-07-14"
implementation: pending
depends_on:
  - "001-stagecraft-thesis"
establishes:
  - "package.json"
  - "encore.app"
  - "tsconfig.json"
  - "vitest.config.ts"
  - "vitest.setup.ts"
  - { kind: directory, path: "addon/" }
  - { kind: directory, path: "core/" }
  - { kind: directory, path: "auth/" }
  - { kind: directory, path: "idp/" }
  - { kind: directory, path: "lib/" }
  - { kind: directory, path: "hiq/" }
  - { kind: directory, path: "health/" }
  - { kind: directory, path: "web/" }
  - { kind: directory, path: "scripts/" }
  - { kind: directory, path: "vendor/" }
  - { kind: directory, path: "docker/" }
summary: >
  Stagecraft becomes a running EnRaHiTu app: the chassis from
  stagecraft-ing/enrahitu is brought into this repo (vendored Encore
  toolchain, hiqlite addon, CoreLedger, auth baseline, rauthy proxy,
  health, packaging, verify workflow), stamped with app name
  "stagecraft". After this spec the control plane boots, authenticates,
  and tests green; every later service spec (004+) adds Encore services
  onto this shell. This is deliberate dogfooding: the platform is
  stamped from the same template it will stamp for customers.
---

# 002: App shell

## 0. Cross-repo gate (read first)

BLOCKED until enrahitu specs 018 (packaged chassis) and 019
(frontend/backend layout) are implemented (decided 2026-07-14): the
first template consumer must import the slimmed two-directory shape,
never the fat tree. When picking work, if enrahitu's registry does not
show 018 and 019 implemented, take spec 008 instead (it has no chassis
dependency) and report the blockage. After 018/019, the import in §2
brings a tree whose only code directories are `frontend/` and
`backend/`, with the toolchain and the hiqlite addon arriving as
pinned npm packages (@enrahitu/toolchain, @enrahitu/hiqlite-native)
rather than as vendored source; read the template's then-current
CLAUDE.md for the layout truth and adjust the §2 mechanics to it.

## 1. Purpose

Every service the control plane needs (tenants, factory, fleet) is an
Encore.ts service on the EnRaHiTu substrate. The shell must exist first,
and it must arrive the same way a customer app arrives: stamped from the
template, not hand-assembled, so that template drift and platform drift
are the same drift and get caught together.

## 2. How to bring the chassis in

1. Clone `git@github.com:stagecraft-ing/enrahitu.git` at its latest main
   into a temp dir; run its stamp recipe with app_name `stagecraft`,
   org `stagecraft-ing` (if the scaffold verb, enrahitu spec 014, is
   implemented, use it: `node scripts/stamp.mjs --app-name stagecraft
   --org stagecraft-ing`; otherwise apply the manual v0 recipe recorded
   in enrahitu spec 014 §3 steps 2, 3, 5).
2. Copy the stamped tree into this repo EXCEPT: `specs/`, `standards/`,
   `.claude/`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `LICENSE`,
   `spec-spine.toml`, `.github/workflows/spec-spine.yml` (this repo's
   governance identity wins; enrahitu's specs do not migrate). Take
   `.github/workflows/verify.yml`, `.gitignore` (merge with the existing
   one), and everything else.
3. The imported tree's spec-linkage keys (`"spec-spine": { "spec": ... }`
   in package.json files, `[package.metadata.spec-spine]` in
   addon/Cargo.toml) point at enrahitu spec ids that do not exist here.
   Repoint them: root package.json -> "002-app-shell"; addon/, webapp
   dirs -> "002-app-shell" as well (service specs re-claim their
   directories later). `spec-spine lint` failing on a dangling id is the
   check that you caught them all.
4. Record provenance: append to README.md a "Chassis" section naming the
   enrahitu commit imported and the date. There is no born-with cert
   here until the factory exists; note that explicitly.
5. `spec-spine compile && spec-spine index`, commit the shards with the
   import.

## 3. Constraints

- The webapp/ Vue placeholder comes along for now; spec 007 replaces it
  with the React Router v7 governance UI. Do not invest in it.
- License boundary (CLAUDE.md convention): the imported chassis is
  Apache-2.0 code entering an AGPL-3.0 repo; that direction is fine.
  Keep `vendor/encore/LICENSE` (MPL-2.0) intact.
- No Encore SQLDatabase anywhere; CoreLedger is the only durable-data
  API (chassis rule, kept).
- `spec-spine.toml` gains the chassis packages:
  `standalone_rust_workspaces = ["addon"]`,
  `standalone_npm_packages = ["addon", "webapp"]`, and
  `[index] extra_hashed_inputs` should match enrahitu's list so manifest
  edits trip staleness here too.

## 4. Acceptance

- From a clean checkout: `npm --prefix addon ci && npm ci &&
  npm --prefix webapp ci`, `npm run build:addon`, `npm run build:runtime`,
  `npm run build:app`, `npm run typecheck`, `npm test` all green
  (the chassis suite, 32 tests at import time).
- `npm run dev` boots; `GET /health` and `GET /hiq/health` return 200.
- verify.yml runs green on main.
- `spec-spine lint --fail-on-warn` and `spec-spine index check` green.

## 5. Out of scope

- Postgres (spec 003), any new service (004+), UI replacement (007).
- Automating chassis refresh from upstream enrahitu (a later spec;
  manual re-import with a recorded commit is the v0 mode).
