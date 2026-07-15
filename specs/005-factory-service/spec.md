---
id: "005-factory-service"
title: "Factory: stamp EnRaHiTu apps into customer orgs"
status: approved
created: "2026-07-14"
implementation: complete
depends_on:
  - "004-tenants-github-app"
establishes:
  - { kind: directory, path: "backend/factory/" }
summary: >
  The factory turns "customer wants an app named X" into a born-green
  repo in the customer's GitHub org: clone the pinned enrahitu template,
  read its template.toml contract (and nothing else), run the scaffold
  verb with the slot values, emit the born-with certificate, create the
  repo via the tenant's installation token, push, and watch the
  born-with verify workflow until green. Completes milestone M2
  together with spec 004. The contract boundary is absolute: any
  factory behavior that depends on template internals beyond
  template.toml is a defect.
---

# 005: Factory service

## 1. Cross-repo dependencies (read first)

- enrahitu spec 014 (scaffold verb) and spec 012 (born-with cert) are
  the preferred substrate. If the pinned template's contract version
  is still 0.1.0 (no scaffold verb, no [provenance]), implement the v0
  fallback: factory-side substitution per the recipe in enrahitu spec
  014 §3 (steps 2, 3, 5) and skip cert emission with a logged warning.
  Gate each capability on the contract version actually read, so the
  factory upgrades itself when the template does.

## 2. Territory

`backend/factory/`: an Encore.ts service, under `backend/` per the
chassis convention spec 002 established and spec 008/004 followed (the
thesis's illustrative `factory/` path predates the slimmed layout;
corrected here before coding). Files: `encore.service.ts`, api
endpoints, CoreLedger entities, template cache, stamp pipeline.

## 3. Behavior

- **Template source**: `git@github.com:stagecraft-ing/enrahitu.git`,
  pinned by config to a commit SHA (env `FACTORY_TEMPLATE_REF`,
  default a recorded known-good SHA; never floating main). A warmup
  step keeps a local bare-clone cache under the app's data dir and
  fetches on demand; stamping always exports from the pinned SHA
  (`git archive` semantics: tracked files only, no .git).
- **Contract read**: parse template.toml; enforce
  `[contract].version` within the supported range. The range is the
  major-0 line, `>=0.1.0 <1.0.0`, consistent with §4 (accept 0.1/0.2/0.3,
  reject 1.0); the pinned template is currently 0.5.0 (scaffold verb at
  v0.4, provenance at v0.3), so the earlier `^0.1` shorthand was stale and
  is corrected here before coding. Validate requested slots against
  `[slots]`. Reject stamps whose contract the factory does not support,
  with a precise error.
- **Entities**: `StampJob` (id, tenantId, installationId, appName,
  org, templateRef, contractVersion, posture, status
  queued|stamping|pushing|verifying|green|failed, checksRunId?,
  certHash?, createdAt, updatedAt, error?). `posture` is persisted on
  the job because step 3 builds the cert from the request's posture and
  the pipeline runs asynchronously (it re-reads the job); added here
  before coding.
- **API** (auth as spec 004): `POST /tenants/:id/stamps` (appName,
  targetOrg, frontend?, posture) -> job id; `GET /stamps/:jobId` status;
  `GET /tenants/:id/stamps` list. `posture` is required (REQUEST-EXPLICIT,
  §3 step 3); the API rejects a stamp with no posture rather than
  defaulting it.
- **Pipeline** (async; Encore endpoint kicks it and the job records
  progress; keep it single-flight per job, resumable by status):
  1. Export pinned template to a temp workdir.
  2. Scaffold: run the contract's scaffold verb with slots; or v0
     fallback (§1).
  3. Cert (contract >= 0.2): build the born-with certificate per
     enrahitu spec 012 §3 (posture from the stamp request, default
     REQUEST-EXPLICIT: the API requires the caller to pass posture;
     never default it silently), keysorted-canonical sha256 hash,
     place at `.stagecraft/born-with.json`, run the contract's
     provenance verify command, store certHash on the job. Record to
     the attestation ledger when spec 008 exists (soft dependency:
     call its recorder if the service is present).
  4. Create the repo in the customer org via the installation token
     (POST /orgs/{org}/repos, private by default), default branch main.
  5. Push the stamped tree as the initial commit using the
     installation token over https
     (`https://x-access-token:<token>@github.com/<org>/<repo>.git`);
     commit author "Stagecraft Factory".
  6. Verify born-green: poll the repo's check runs / workflow runs for
     the verify workflow on the pushed SHA until success or a 30-min
     timeout; record status green|failed.
- **Idempotency**: re-POSTing the same appName for the same tenant
  while a job is live returns the live job; a repo-name collision at
  step 4 fails the job with the GitHub error surfaced.

## 4. Acceptance

- Unit: contract parsing (accept 0.1/0.2/0.3 fixtures, reject 1.0),
  slot validation, job state machine transitions, cert hash matches an
  independently computed keysorted sha256 fixture.
- E2E (manual, documented): stamp `smoke-<date>` into the test org
  from spec 004's installation; the job reaches `green`; the resulting
  repo's verify run is green on GitHub. This is the M2 core loop.
- Spine gates + verify verb green.

COMPLETE 2026-07-15: unit tests cover contract parsing (accept 0.1/0.2/0.3,
reject 1.0), slot validation, the job state machine, and cert-hash equality
with the independently computed golden (byte-identical to the template's own
verify-born-with.mjs); StampJob persistence round-trips on libSQL and
Postgres; spine gates + `verify` green. The pinned template is contract
0.5.0, so the factory takes the scaffold + cert path. The E2E is manual and
documented (backend/factory/README.md, §4): running it live needs a real
installation and the App secrets, and creates a repo in the customer org, so
it is an operator step, not a CI gate. The pipeline's IO layer (git, scaffold,
GitHub) is implemented and typechecks/builds; it is exercised end-to-end only
by that manual run.

## 5. Out of scope

- Signed certificates (born-with certVersion 2, enrahitu spec 012 §7):
  emission through the vended tenant-emit CLI with a platform-minted
  Ed25519 key set as a repo CI secret at repo creation (the mint sits
  on the spec 004/005 boundary when this lands), repo-side
  re-verification via pinned tenant-tail, and the spec 008 ledger
  anchor as the countersign. Step 3 above is the unsigned v1 flow by
  design.
- Deployment of the stamped app (fleet, spec 006).
- Template authoring, flavors' contents (enrahitu repo).
- Multi-template support (one pinned chassis for now).
- GitHub Enterprise/GHES endpoints.
