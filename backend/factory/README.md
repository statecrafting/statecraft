<!-- Spec-Linkage: 005-factory-service -->
# factory (spec 005)

Turns "customer wants an app named X" into a born-green repo in the customer's
GitHub org: export the pinned enrahitu template, read its `template.toml`
contract (and nothing else), run the scaffold verb with the slot values, emit
the born-with certificate, create the repo via the tenant's installation token,
push, and watch the born-with verify workflow until green. Completes milestone
M2 with spec 004. The contract boundary is absolute: any factory behavior that
depends on template internals beyond `template.toml` is a defect.

## Files

- `config.ts`: pinned template ref (`FACTORY_TEMPLATE_REF`, default a recorded
  enrahitu SHA at contract 0.5.0), repo URL, data dir, timeouts.
- `contract.ts`: a small self-contained `template.toml` reader + version gating
  (`>=0.1.0 <1.0.0`) + slot validation + capability gates. Pure, unit-tested.
- `cert.ts`: builds the born-with cert and computes its keysorted-canonical
  sha256, byte-identical to the template's `verify-born-with.mjs`. Pure, tested
  against the golden fixture.
- `entities.ts` / `store.ts`: the `StampJob` CoreLedger entity + data access;
  idempotent job creation and state-machine-guarded transitions.
- `jobs.ts`: the status state machine (`queued -> stamping -> pushing ->
  verifying -> green`, `failed` from any live state). Pure, tested.
- `git.ts` / `scaffold.ts` / `github.ts`: the IO layer (git archive/push, the
  scaffold verb, GitHub repo creation + verify polling).
- `pipeline.ts`: the async stamp pipeline; capabilities gated on the contract
  version actually read (scaffold verb, cert emission).
- `api.ts`: the `/api/v1` endpoints.

## API

Auth as spec 004 (owner-scoped through the tenant):

- `POST /api/v1/tenants/:id/stamps` `{ appName, targetOrg, frontend?, posture }`:
  queue a stamp and kick the pipeline. `posture` is required (REQUEST-EXPLICIT:
  `none | assisted | autonomous`), never defaulted. Idempotent: a live job for
  the same tenant + appName is returned as-is.
- `GET /api/v1/stamps/:jobId`: job status.
- `GET /api/v1/tenants/:id/stamps`: the tenant's stamp jobs.

## Contract coupling

The factory pins `FACTORY_TEMPLATE_REF` to a known-good enrahitu commit (never
floating main). The current pin is contract 0.5.0, which has the scaffold verb
(v0.4) and the `[provenance]` cert table (v0.3), so the factory takes the
preferred scaffold + cert path. Capabilities are gated on the contract version
actually read, so a repointed older pin degrades (v0 factory-side substitution,
cert skipped) rather than breaking, and a newer pin upgrades automatically.

Signed certificates (born-with certVersion 2) are out of scope here (spec 005
§5); step 3 emits the unsigned v1 cert by design.

## Manual e2e (spec 005 §4)

Documented click path (needs spec 004's installation + the App secrets):

1. Log in; create a tenant; install the App into an org (spec 004 flow).
2. `POST /api/v1/tenants/:id/stamps { "appName": "smoke-<date>", "targetOrg":
   "<org>", "posture": "assisted" }` -> job id.
3. Poll `GET /api/v1/stamps/:jobId` until `status: green`.
4. The resulting repo exists in the customer org and its verify run is green on
   GitHub. This is the M2 core loop.

The pipeline's IO steps (git, scaffold, GitHub) run only in this manual e2e; CI
exercises the pure core (contract parsing, cert hashing, slot validation, the
job state machine, and entity persistence on libSQL + Postgres).
