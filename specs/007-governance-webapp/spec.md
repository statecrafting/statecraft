---
id: "007-governance-webapp"
title: "Governance UI: Vite + React Router v7 webapp"
status: approved
created: "2026-07-14"
implementation: in-progress
depends_on:
  - "004-tenants-github-app"
establishes:
  - { kind: directory, path: "webapp/" }
# The edge moves to `frontend/` WITH the code, in the same PR as the rename
# (owned paths and this spec move together). It is not flipped early: this spec
# is `in-progress`, so spec-spine enforces that a declared directory unit is a
# real directory (I-007), and `frontend/` holds no tracked file until the move.
summary: >
  Replaces the chassis's placeholder Vue SPA with the control plane's
  real face: a Vite + React Router v7 single-page app served by the
  chassis web service from web/dist, same-origin with the API and the
  embedded rauthy IdP. v1 surface: login, tenant list/create, GitHub
  App install flow, stamp launcher + job progress, fleet table with
  operation buttons. The platform UI is deliberately NOT a template
  flavor: it owes nothing to template stack choices (thesis §3).
---

# 007: Governance webapp

## 1. Territory

`webapp/` is re-established by this spec (the Vue placeholder from the
chassis import, spec 002, is deleted). New package name
`@stagecraft/webapp`, spec-spine manifest key -> this spec. Keep the
build contract identical: `npm --prefix webapp run build` emits into
`backend/web/dist` (the path the chassis web static service serves);
that static service is untouched.

The `frontend/` -> `webapp/` rename also disturbs governance-owned build
and CI surfaces (spec 002, plus `spec-spine.toml`, which spec 000 owns),
carried in this PR under a `Spec-Drift-Waiver:` (007 supersedes the 002
placeholder; those owning specs are not amended to ratify a rename they
did not author):

- the root configs repoint their SPA-directory reference from
  `frontend` to `webapp`: `package.json` (`dev:web` / `build:web`
  scripts), `tsconfig.json` (the `exclude` entry that keeps the SPA out
  of the backend `tsc`), and `vitest.config.ts` (the test `exclude`
  glob).
- `.github/workflows/verify.yml`: the frontend cache path and the
  `npm --prefix frontend ci` step repoint to `webapp`, and a `webapp`
  component-test step is added (§3).
- `spec-spine.toml`: `standalone_npm_packages` swaps `frontend` for
  `webapp`.

## 2. Behavior

- Stack: React 19, React Router v7 in SPA/data-router mode
  (createBrowserRouter; no SSR), Vite, TypeScript strict. Styling:
  keep it minimal and dependency-light (CSS modules or vanilla-extract;
  no component framework in v1).
- Auth: session cookie from the chassis auth service; login page offers
  rauthy (same-origin /auth/v1 flow) and, in dev, the mock driver.
  CSRF header on mutating fetches, matching the chassis lib contract.
  A root loader hits `GET /api/v1/auth/me`; unauthenticated users land
  on /login.
- Routes:
  - `/` dashboard: tenants overview.
  - `/tenants/new`, `/tenants/:id` (installations, repos via spec 004
    endpoints, install-App call-to-action when none).
  - `/tenants/:id/stamps/new` (appName, org picker from installations,
    frontend flavor select, REQUIRED explicit agentic posture select
    with no preselected value), `/stamps/:jobId` live progress
    (poll GET /stamps/:jobId; states from spec 005's machine).
  - `/tenants/:id/fleet` table (spec 006 endpoints; deploy form,
    update/backup/remove actions with the confirm-name guard surfaced
    honestly in the UI).
  - Degrade gracefully when factory/fleet services are not yet
    deployed (404s from missing services render as "not enabled yet",
    not crashes), so this spec is implementable right after 004.
- API access: plain fetch wrappers with typed response shapes copied
  from the service specs; no codegen dependency in v1.

## 3. Acceptance

- `npm --prefix webapp run build` emits web/dist; `npm run dev` serves
  the SPA; login (mock driver) -> create tenant -> tenant detail works
  against a locally running control plane.
- With spec 005 present: launching a stamp shows live job progression.
- vitest component tests for the auth loader redirect and one route
  module; the chassis suite stays green.
- Spine gates green (webapp package repointed in spec-spine.toml if
  the standalone list names change).

## 4. Out of scope

- Approvals inbox rendering (spec 008 adds the data; a follow-up spec
  adds the UI once the shape exists).
- Design-system investment, theming, mobile polish.
- Admin/ops views beyond the fleet table.

## 5. Status (2026-07-15)

Implementation landed, built, unit-tested, and gated; kept `in-progress`
pending two acceptance items that need state this session could not
produce.

Verified against a live local control plane (`encore run` on :4000, the
webapp dev server on :5173, CoreLedger on Postgres, mock auth driver):

- The full §3 login-to-detail request/response contract, end to end:
  unauthenticated `GET /api/v1/auth/me` 401 (the root loader's redirect
  trigger); mock login 302 + session cookies; authenticated `me`;
  `GET /api/v1/auth/csrf-token`; `POST /api/v1/tenants` (CSRF
  double-submit); `GET /api/v1/tenants`; `GET /api/v1/tenants/:id`;
  `GET .../github/install-url`. Every response shape matches the
  webapp's typed client exactly.
- `npm --prefix webapp run build` emits `backend/web/dist`; both the dev
  server (:5173) and the served bundle (:4000) render the SPA.
- vitest component tests (auth-loader redirect + login route) pass; the
  spine gates (compile, index check, lint, couple with the waiver) and
  the CI govern gate are green.

### Update 2026-07-15 (live verification -> `implementation: complete`)

Both remaining items were exercised in-browser against a live local
control plane (Chrome via the automation extension; `encore run` on :4000
with the real GitHub App secrets sourced, the webapp dev server on :5173,
CoreLedger on the dev Postgres, mock auth driver). Acceptance holds in
full:

- **§3.1 in-browser click-through** (real data): unauthenticated load
  redirects to `/login`; mock sign-in lands on the tenants dashboard;
  `New tenant` -> create -> tenant detail. The detail page then bound the
  real org-wide `stagecraft-ing` installation (`125344051`, the spec 004
  e2e installation) through the real `/github/setup` App-JWT path and
  rendered the active installation plus the live repository list read
  through the installation token.
- **§3.2 launching a stamp shows live job progression** (real factory):
  from the stamp launcher (`/tenants/:id/stamps/new`) a create-mode stamp
  (`july-15-stampcheck`, org `stagecraft-ing`, posture `none`) launched
  and the progress view (`/stamps/:jobId`) polled every 2s, advancing the
  stepper live queued -> stamping -> pushing -> verifying -> (terminal).
  The factory really cloned the pinned template, stamped, created the
  private repo `stagecraft-ing/july-15-stampcheck`, minted a born-with
  cert, triggered the repo's born-green CI, and the UI rendered the honest
  terminal state. The stamp finished `failed` because the stamped repo's
  born-green CI did not pass (`npm --prefix frontend-react ci` -> EUSAGE:
  the pinned template ref lacks a `frontend-react` lockfile). That is a
  factory/template concern (the pin, spec 005 / enrahitu), not a webapp
  defect: §3.2 asks that the UI *show live job progression*, which it did
  through to the terminal state, including the failure surface. Tracked
  for the factory separately; it does not gate this webapp spec.

Everything else (build, served bundle, vitest, spine + govern gates) was
already green (above) and stays green.

### Update 2026-07-16 (chassis realignment: `webapp/` -> `frontend/`, back to `in-progress`)

The SPA lives at `webapp/`, and it should not. Stagecraft is stamped from the
enrahitu chassis and is supposed to look like it: enrahitu's slimmed chassis is
two directories, `backend/` + `frontend/` (with a `frontend-react/` variant),
and this repo imported it as `backend/` + `webapp/`. The divergence bought
nothing. This spec's territory therefore moves to `frontend/` and the
implementation flips back to `in-progress` until the move lands.

The repo currently holds the divergence in a confusing shape (verified
2026-07-16):

- `frontend/` **exists but is empty of authored code**: zero git-tracked files.
  What is on disk is 860 gitignored `node_modules` files, a husk left by the
  chassis import. Spec 002 nonetheless `establishes` it, so the corpus owns a
  directory with no content while the real SPA sits in a directory named
  something else.
- `webapp/` holds the 23 tracked files that are actually the SPA.

So the move also retires the phantom: spec 002 drops its `frontend/` edge (see
its 2026-07-16 note) and this spec picks the path up. Ownership stays with the
governance UI either way; only the name changes.

**Blast radius for the implementing session.** The rename is mechanical but
wide: `package.json` (including the explicit `npm --prefix webapp ci` added by
009 stage 1), `tsconfig.json`, `vitest.config.ts`, `.dockerignore`,
`.gitignore`, `spec-spine.toml` (its `standalone_npm_packages` list and the
comment explaining the old placement), the prose in `README.md`, `CLAUDE.md`,
and `AGENTS.md`, and cross-references in specs 001, 002, 004, and 009.
`spec-spine.toml` is spec 000 territory, so that touch lands as a coordinated
000 edit or a cited waiver.

**Two traps, both verified 2026-07-16.** First, the on-disk
`frontend/node_modules` husk must be cleared before `git mv webapp frontend` or
the move collides. Second, and less obvious: **that husk masks the gate.**
Flipping this spec's `establishes` to `frontend/` before the code moves looks
green locally, because the husk makes `frontend/` a real directory on a
developer's disk. On CI's fresh clone `frontend/` does not exist (zero tracked
files), so the same edge raises `I-007 [frontend/] ... is not a directory`, the
007 shard goes stale on blocking diagnostics, and `govern` fails. Proven by
moving the husk aside and re-running `spec-spine index`. So the edge and the
code move in one commit, and the husk is deleted in that same commit rather than
left to make future local runs lie.

**Acceptance for this update** (in addition to §3, which is unchanged because
this is a pure move with no behavior change): no `webapp` reference survives
outside git history; `frontend/` is this spec's territory and 002 no longer
claims it; typecheck, vitest, the SPA build into `backend/web/dist`, and the
image build are all green; spine gates and `couple` pass.
