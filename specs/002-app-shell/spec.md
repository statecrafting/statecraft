---
id: "002-app-shell"
title: "The control plane's EnRaHiTu app shell"
status: approved
created: "2026-07-14"
implementation: complete
depends_on:
  - "001-stagecraft-thesis"
establishes:
  - "package.json"
  - "package-lock.json"
  - "encore.app"
  - "tsconfig.json"
  - "vitest.config.ts"
  - "vitest.setup.ts"
  - "infra.config.dev.json"
  - "infra.config.json"
  - ".github/workflows/verify.yml"
  - { kind: directory, path: "backend/" }
  - { kind: directory, path: "backend/auth/" }
  - { kind: directory, path: "backend/core/" }
  - { kind: directory, path: "backend/health/" }
  - { kind: directory, path: "backend/hiq/" }
  - { kind: directory, path: "backend/idp/" }
  - { kind: directory, path: "backend/lib/" }
  - { kind: directory, path: "backend/web/" }
  - { kind: directory, path: "scripts/" }
  - { kind: directory, path: "docker/" }
  - { kind: directory, path: ".stagecraft/" }
summary: >
  Stagecraft becomes a running EnRaHiTu app: the slimmed chassis from
  stagecraft-ing/enrahitu is brought into this repo (the two-directory
  backend/ + frontend/ layout, CoreLedger, auth baseline, rauthy proxy,
  health, packaging, verify workflow; the Encore toolchain and the
  hiqlite addon arrive as pinned @enrahitu/* npm packages, not vendored
  source), stamped with app name "stagecraft". After this spec the
  control plane boots, authenticates, and tests green; every later
  service spec (004+) adds Encore services onto this shell. This is
  deliberate dogfooding: the platform is stamped from the same template
  it will stamp for customers.
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

RESOLVED 2026-07-15: enrahitu 018 and 019 are `implementation: complete`
(enrahitu commit 83a4551), which explicitly delegated the slimmed
clean-clone / boot-smoke acceptance to this, its first stamped consumer.
The slimmed import in §2 was performed against that commit and is that
delegated acceptance; §2 records the mechanics actually used.

## 1. Purpose

Every service the control plane needs (tenants, factory, fleet) is an
Encore.ts service on the EnRaHiTu substrate. The shell must exist first,
and it must arrive the same way a customer app arrives: stamped from the
template, not hand-assembled, so that template drift and platform drift
are the same drift and get caught together.

## 2. How the chassis was brought in

Performed 2026-07-15 against enrahitu commit 83a4551 (018/019 complete).
No scaffold verb exists yet (enrahitu spec 014 is pending), so this was
a manual slimmed import; it doubles as the consumer-side acceptance that
enrahitu 018 §4 delegated to the first stamped consumer.

1. Import the slimmed subset from enrahitu's latest main, preserving
   paths: `backend/` (the whole Encore app: auth, core, health, hiq,
   idp, lib, web), `frontend/` (the Vue SPA, without its node_modules),
   `docker/`, and the app-owned `scripts/` files (docker-build.sh,
   generate-keys.ts, sync-dev-rauthy-secret.mjs, verify-born-with.mjs
   and its test, fixtures/). Root files: `encore.app`, `tsconfig.json`,
   `vitest.config.ts`, `vitest.setup.ts`, `infra.config.dev.json`,
   `infra.config.json`, `.stagecraft/born-with.schema.json`, and a
   rewritten `.github/workflows/verify.yml`. NOT imported (the slimming,
   spec 019 §1): `vendor/`, `addon/` (enrahitu's hiqlite source),
   `packages/`, `template.toml`, and enrahitu's governance identity
   (`specs/`, `standards/`, `.claude/`, `AGENTS.md`, `CLAUDE.md`,
   `README.md`, `LICENSE`, `spec-spine.toml`, the spec-spine workflow):
   this repo's identity wins. Never import enrahitu's `.env` (a live
   secret). `.gitignore` is merged into this repo's existing one.
2. The root `package.json` is written fresh, not copied: app name
   `stagecraft`, `@enrahitu/toolchain` and `@enrahitu/hiqlite-native`
   pinned to `0.1.0` from the registry (binaries resolve from
   node_modules; no cargo runtime build), plus this repo's own
   `@stagecraft/governance-native` addon (spec 008) as a `file:` dep and
   a `build:addon` script. `npm install` generates the lockfile and
   `npm ci` is reproducible from it (all six @enrahitu platform optionals
   pinned, so linux CI resolves too). `infra.config.*` app_id and the SPA
   title are stamped to `stagecraft`; substrate names (`@enrahitu/*`,
   `ENRAHITU_*` env prefixes) are deliberately left as the chassis.
3. One enrahitu bug was patched in the imported `vitest.config.ts`: its
   `encoreRuntimeLib()` resolved the Encore runtime only from the
   now-absent `vendor/`, breaking `npm test` for every slimmed consumer.
   Fixed to delegate to the toolchain's exported resolver
   (`@enrahitu/toolchain/resolve`), which finds the binary in
   node_modules. Reported upstream to enrahitu.
4. Repoint spec-linkage keys to this repo's ids: root `package.json` and
   `frontend/package.json` -> `002-app-shell`. The governance addon and
   service keep `008-governance-attestation`. `spec-spine lint` failing on
   a dangling id is the check that they were all caught.
5. The governance service (spec 008), authored at repo-root `governance/`
   against the old flat layout, is relocated under `backend/governance/`
   so its `../core/ledger` import resolves and Encore discovers it as a
   service, and wired to the built addon. See spec 008 for that half.
6. Record provenance: the README "Chassis" section names the enrahitu
   commit and date. There is no born-with cert here until the factory
   (spec 005) exists; that is noted there explicitly.
7. `spec-spine compile && spec-spine index`; commit the shards with the
   import.

## 3. Constraints

- The frontend/ Vue placeholder comes along for now; spec 007 replaces
  it with the React Router v7 governance UI. Do not invest in it.
- License boundary (CLAUDE.md convention): the imported chassis is
  Apache-2.0 code entering an AGPL-3.0 repo; that direction is fine. The
  Encore toolchain (with its MPL-2.0 runtime) is no longer vendored: it
  arrives as the @enrahitu/toolchain npm package, which carries its own
  license, so there is no `vendor/` license file to keep here.
- No Encore SQLDatabase anywhere; CoreLedger is the only durable-data
  API (chassis rule, kept).
- `spec-spine.toml` reflects the slimmed shape: the root `package.json`
  and `frontend/` are npm packages linked to this spec; the governance
  addon and service stay on 008. `standalone_npm_packages` gains
  `frontend` (the governance addon is already listed); `[index]
  extra_hashed_inputs` gains the chassis manifests (the root and
  frontend package.json, the infra configs) so edits trip staleness here
  too.
- Later service specs extend the 002-owned root config in place (amended
  here as they land): spec 003 adds the `dev:db` script (package.json) and
  a Postgres service arm in `verify.yml`, wiring CoreLedger onto Postgres
  via `ENRAHITU_LEDGER_URL` while stamped apps stay on libSQL. Spec 004
  adds the three GitHub App secrets (`GITHUB_APP_ID`,
  `GITHUB_APP_PRIVATE_KEY_B64`, `GITHUB_WEBHOOK_SECRET`) to
  `infra.config.json`'s `secrets` block so the deployed control plane
  binds them from env; dev leaves them unset (the tenants service reads
  `process.env` as a local fallback).

## 4. Acceptance

- From a clean checkout: `npm ci && npm --prefix frontend ci`,
  `npm run build:addon`, `npm run build:web`, `npm run build:app`,
  `npm run typecheck`, `npm test` all green (the chassis suite plus the
  governance service: 55 passed / 11 skipped at import time; the 11 are
  the CoreLedger Postgres arm, which auto-skips without a live database
  and gets CI coverage in spec 003). `cargo test --no-default-features`
  in addon/governance-native/ stays green (22).
- `npm run dev` boots; `GET /health` and `GET /hiq/health` return 200,
  and the governance service answers (`GET /governance/verify` -> ok).
- verify.yml runs green on main.
- `spec-spine lint --fail-on-warn` and `spec-spine index check` green.

## Status (2026-07-15)

`implementation: complete`; acceptance holds in full.

- The §0 cross-repo gate is resolved: enrahitu 018 (packaged chassis) and
  019 (frontend/backend layout) are `implementation: complete` at
  enrahitu commit `83a4551`, and the slimmed two-directory import in §2
  was performed against that commit (the delegated clean-clone acceptance).
- §4 build/test acceptance (item 1) and green-on-main (item 3) hold via
  the `verify` workflow on the latest main commit: `npm ci`, `build:addon`,
  `build:web`, `build:app`, `typecheck`, `npm test` (both CoreLedger
  drivers), and the webapp typecheck + component tests all pass.
- §4 dev-boot acceptance (item 2) live-verified against a local
  `npm run dev` (Encore on :4000, CoreLedger on the dev Postgres):
  `GET /health` -> 200 `{"status":"ok","ledger":"ok","app":"enrahitu"}`;
  `GET /hiq/health` -> 200 `{"status":"ok"}`; `GET /governance/verify`
  -> 200 `{"ok":true,"seq":0}`.
- §4 spine gates (item 4): `spec-spine lint --fail-on-warn` reports
  0 errors / 0 warnings and `spec-spine index check` is fresh.

### Update 2026-07-16 (the `frontend/` edge was a phantom; dropped)

This spec `establishes`-ed `frontend/`, the chassis's placeholder SPA directory.
It never held authored code here: verified 2026-07-16, `frontend/` has **zero
git-tracked files**, and what sits on disk is 860 gitignored `node_modules`
files left by the chassis import. Spec 007 replaced the placeholder with a real
SPA but landed it at `webapp/`, so the corpus ended up owning an empty
`frontend/` while the actual UI lived under a name the chassis does not use.

The edge is dropped here and `frontend/` becomes spec 007's territory when its
2026-07-16 realignment moves `webapp/` -> `frontend/`. This is a bookkeeping
correction, not a behavior change: no tracked file moves under this spec, and
002's acceptance is untouched. The chassis import shape (§2) is unaffected; the
two-directory `backend/` + `frontend/` convention it describes is in fact what
007's move restores.

## 5. Out of scope

- Postgres (spec 003), any new service (004+), UI replacement (007).
- Automating chassis refresh from upstream enrahitu (a later spec;
  manual re-import with a recorded commit is the v0 mode).
