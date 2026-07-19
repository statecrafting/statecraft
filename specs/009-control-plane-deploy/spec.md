---
id: "009-control-plane-deploy"
title: "Self-hosted control plane deployment (OAP-independent)"
status: approved
created: "2026-07-16"
implementation: in-progress
summary: >
  Give statecraft its own deployment story so the spec-governed control plane
  runs on the statecraft-owned cluster (spec 010) with no dependency on the
  open-agentic-platform (OAP) chart, CD, or secret set. Publish the
  single-container image to statecraft's own GHCR namespace (stage 1, done),
  then stand the control plane up on the 010 cluster as a platform-grade K8s
  deployment reachable at app.statecraft.ing, wired to the real Encore secret
  contract and seeded with its own rauthy client. Port the OAP CI tooling
  worth keeping (AI PR review + changelog, the PR gate pattern), adapted to be
  OAP-free.
depends_on:
  - "002-app-shell"
  - "008-governance-attestation"
  - "010-statecraft-cluster"
establishes:
  - ".github/workflows/image.yml"
  - ".dockerignore"
# Further ownership edges land with their units during implementation (owned
# paths and this spec move together): the `deploy/` directory arrives with its
# manifests in stage 2, and .github/workflows/{cd,ai-pr-review,ai-changelog}.yml
# with theirs (see §2 Territory). `deploy/` is deliberately not declared while
# it does not exist: this spec is `in-progress`, so spec-spine enforces that a
# declared directory unit is a real directory (I-007).
---

# 009: Self-hosted control plane deployment

## 1. Purpose

statecraft is "the first production EnRaHiTu app" and "allowed to be a
platform-grade K8s deployment" (spec 001 §3), but it has no deployment of its
own. What runs on the old cluster is the OAP build
(`ghcr.io/statecrafting/open-agentic-platform/statecraft`), deployed by OAP's
Helm chart and `cd-statecraft.yml`. Everything needed to build, publish, deploy,
and operate the control plane must live in this repo. This spec makes statecraft
self-hosting and severs the OAP dependency.

Two corrections to the original framing, verified 2026-07-16:

- **The OAP repo is not archived.** `statecrafting/open-agentic-platform` is
  public and was last pushed 2026-07-15. The dependency on it is an ownership
  defect, not decay.
- **The OAP build is a different application, not an older statecraft.** Its pod
  environment carries no database URL at all (`SECRETS_DIR`, `OIDC_ENDPOINT`,
  `DEPLOYD_*`, `OIDC_M2M_CLIENT_*_FILE`), and the `statecraft` database it backs
  holds the research-era schema. There is no upgrade path from it to this repo's
  control plane, and none is wanted: it is discarded, not migrated.

The trigger is concrete: the control plane has no reachable URL. Verified
2026-07-16, **no `app.statecraft.ing` ingress exists at all**: the only ingresses
are `minio.statecraft.ing` and `statecraft.ing` (the apex, which DNS routes to
the GitHub Pages marketing site), so nginx answers the unmatched host with its
default backend and the `Kubernetes Ingress Controller Fake Certificate`. The
OAP control plane has therefore been unreachable, and `app.statecraft.ing`
currently gives a TLS warning followed by a 404. The chosen public host is
**app.statecraft.ing**.

**Scope after the 010 re-scope (2026-07-16).** This spec no longer stands the
control plane up on the OAP cluster, nor retires the OAP release: spec 010
builds a statecraft-owned cluster alongside and deletes the old one, taking the
OAP release and its database with it. Stage 1 (the image) is cluster-independent
and already done. What remains here is the deploy itself, targeting 010's
cluster, plus the ported CI.

## 2. Territory

- `.github/workflows/image.yml`: build the single-container image from
  `docker/Dockerfile` (the enrahitu chassis, spec 002) and push to
  **`ghcr.io/statecrafting/statecraft`** on release/`workflow_dispatch`,
  multi-arch amd64 (the fleet cluster is x86-64), the same push+manifest shape
  proved for the enrahitu image.
- `deploy/`: a statecraft-owned Helm chart (or plain manifests + a
  `values-hetzner.yaml`) standing up the Deployment, the database it needs
  (CoreLedger driver, spec 003), a Service, an Ingress at
  `app.<domain>` with the cert-manager DNS-01 issuer, and the secret wiring.
  **Manifests only: this spec is the documentation.** `deploy/README.md` was
  removed 2026-07-16 because it restated the topology, the secret contract, and
  the cutover, and then drifted from all three (it carried the same OAP-era
  secret names corrected below). A README that paraphrases its own spec is a
  second source of truth that no gate checks, since `**/README.md` is a coupling
  bypass prefix. The directory holds deployable artifacts; the contract lives
  here.
- `.github/workflows/cd.yml`: on push to `main` (sha-pinned image) and on
  `workflow_dispatch`, build+push then `helm upgrade`/apply against the cluster;
  never floats `latest` onto the running release.
- `.github/workflows/ai-pr-review.yml` + `ai-changelog.yml`: ported from OAP
  (spec 085), the Claude-CLI PR reviewer + changelog, stripped of OAP-specific
  paths and secrets.

## 3. Behavior

- **Image.** One amd64 (multi-arch capable) image at
  `ghcr.io/statecrafting/statecraft:<sha>` + `:latest` + the release tag.
  Private is acceptable; the deploy provides pull creds (a namespace
  `dockerconfigjson` secret), matching the fleet finding that the cluster's
  reflector-synced `ghcr-pull` carries bot creds without access to new packages.
- **Deploy topology.** On the spec 010 cluster. The control plane runs the
  Postgres driver (spec 003), not the fleet's per-app libSQL shape: a
  single-replica Deployment against 010's Postgres in **its own database, born
  empty**, a PVC for the workspace, a ClusterIP Service on `:4000`, and an
  Ingress `app.<domain>` (ingressClassName `nginx`, TLS via
  `letsencrypt-prod-dns01-cloudflare`). This is the ingress that does not exist
  today (§1) and creating it is what makes the host real.
- **Auth.** Reuse the platform rauthy at `auth.<domain>` (installed and seeded
  by spec 010) as the IdP. This deploy converges the statecraft OIDC client's
  `redirect_uris` allow-list to include `https://app.<domain>/...`, additively:
  it never removes an existing URI. The app's public origin is
  `WEBAPP_BASE_URL=https://app.<domain>`.
- **Secrets: the real contract** (corrected 2026-07-16; the original list was
  OAP's, not this app's). The app declares **11 Encore secrets**, each mapped
  `$env` to an identically-named environment variable by `infra.config.json`
  (spec 002 territory), so the deploy's job is simply to put these 11 on the
  pod: `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `JWT_REFRESH_PRIVATE_KEY`,
  `JWT_REFRESH_PUBLIC_KEY`, `RAUTHY_CLIENT_SECRET`, `GITHUB_APP_ID`,
  `GITHUB_APP_PRIVATE_KEY_B64`, `GITHUB_WEBHOOK_SECRET`, `RESTIC_PASSWORD`,
  `FLEET_S3_ACCESS_KEY_ID`, `FLEET_S3_SECRET_ACCESS_KEY`. Alongside them, the
  non-secret env the services read directly: `ENRAHITU_LEDGER_URL` (the
  Postgres URL; the driver is chosen by scheme, spec 003), `WEBAPP_BASE_URL`,
  `RAUTHY_UPSTREAM`, `ENRAHITU_KEYS_DIR`, `FLEET_BASE_DOMAIN`,
  `FLEET_IMAGE_PULL_SECRET`, the `FLEET_BACKUP_*` trio, `FACTORY_TEMPLATE_REPO`
  / `FACTORY_TEMPLATE_REF` / `FACTORY_DATA_DIR`, and
  `statecraft_GOVERNANCE_CONFIG_DIR` / `statecraft_GOVERNANCE_STATE_DIR`. All of
  it flows from spec 010's secret catalog. There is no `APP_BASE_URL`, no
  `PAT_ENCRYPTION_KEY`, and no `OIDC_M2M_CLIENT_ID`/`OIDC_M2M_CLIENT_SECRET` in
  this codebase; those are OAP's names and appear nowhere outside the earlier
  draft of this spec.
- **The JWT signing keys are an operator prerequisite.** The four `JWT_*`
  secrets exist in no `.env` and no cluster secret: they are minted by
  `npm run generate-keys` into a gitignored `keys/` that is deliberately absent
  from images. Without them, login returns 500 and the acceptance below cannot
  hold. They must be generated once, added to spec 010's catalog, and delivered
  via SOPS like every other cluster secret. Custody is the operator's call and
  is recorded when 010 lands.
- **`infra.config.json` needs a production origin.** Its `metadata.base_url` is
  `http://localhost:8080` and `env_name` is `selfhost`. The deployed
  configuration must carry the real origin. That file is spec 002 territory, so
  the change lands with a coordinated 002 edit or a cited waiver.
- **Cutover.** Spec 010 owns cluster-level cutover and the teardown that
  discards the OAP release and its database. This spec's cutover is narrower:
  bring the control plane up on the 010 cluster under its own release name,
  verify `app.<domain>` serves the governance UI over a valid cert and a real
  rauthy login completes, and only then let 010 cut the DNS. The apex
  `statecraft.ing` stays the marketing site; the control plane lives at
  `app.statecraft.ing`. Rollback is 010's: the old cluster stays until proven.
- **Ported CI (OAP-free).** `ai-pr-review.yml` runs the Claude CLI over the PR
  diff and posts a review (no `ANTHROPIC_API_KEY` committed; auth via the
  workflow's configured credential). `ai-changelog.yml` its companion. The PR
  **gate** is already covered by this repo's `spec-spine.yml` (coupling) +
  `verify.yml` (typecheck/test); port only the missing orchestration if a single
  required check is wanted, not OAP's service-specific fan-out.

## 4. Acceptance

- `image.yml` publishes a pullable `ghcr.io/statecrafting/statecraft` image;
  verified by pulling it. **(Met 2026-07-16, stage 1.)**
- The statecraft-owned deploy stands up the control plane on the spec 010
  cluster with no OAP chart, CD, or secret dependency, wired to the 11 Encore
  secrets and the non-secret env named in §3, against its own empty database.
- `https://app.statecraft.ing` serves the governance UI over a valid
  cert (not the ingress default) and a real rauthy login completes end to end.
- `ai-pr-review.yml` runs on a PR and posts a review; spine gates + verify green.

Retiring the OAP release is **no longer this spec's acceptance**: the old
cluster is deleted wholesale by spec 010, which takes the release and its
database with it.

## Status (2026-07-16)

Stage 1 (image publish) in progress. Finding: `scripts/docker-build.sh` (owned
by spec 002) was a verbatim enrahitu copy referencing vendored paths
(`vendor/encore/`, `packages/toolchain/`, `addon/hiqlite-native.*.node`) that do
not exist here, so statecraft had no working image build. `.github/workflows/image.yml`
replaces it with an npm-toolchain build (no vendored cross-build): `npm ci` on a
linux runner pulls the prebuilt linux Encore runtime / tsparser / hiqlite from
the `@enrahitu/*-linux-x64` optional-dependency packages; only statecraft's own
`governance-native` + `fleet-native` addons build here. amd64 only (the cluster
is x86-64), on ubuntu-22.04 (glibc <= the node:24-slim base). No `/health` smoke
in the image job: the control plane needs Postgres (spec 003) to be healthy, so
runtime verification moves to the deploy stage. The legacy 002 `docker-build.sh`
is left untouched (dead code) and gets retired/adapted when the deploy stage
lands.

Validated (dispatched on a branch, iterated to green): `ghcr.io/statecrafting/statecraft`
is published and pullable (`:latest` + `:<sha>`, amd64). Two fixes landed to get
there: `build:web` needed an explicit `npm --prefix frontend ci` (frontend is not a
root workspace), and the prebuilt `@enrahitu/toolchain-linux-x64` binaries require
`GLIBC_2.39`, so the build moved to `ubuntu-24.04` and `docker/Dockerfile.base`
(spec 002) was bumped `node:24-slim` (bookworm, glibc 2.36) -> `node:24-trixie-slim`
(glibc 2.41). That 002 chassis touch is waived here (the enrahitu chassis publishes
2.39 toolchain binaries but a 2.36 base image, an upstream mismatch worth an
enrahitu follow-up).

### Stage 2 re-scoped onto spec 010 (2026-07-16)

Stage 2 (the deploy) was opened against the OAP cluster and stopped before any
manifest was written, on four findings from the live cluster:

1. **This spec's secret list was OAP's, not this app's.** `APP_BASE_URL`,
   `PAT_ENCRYPTION_KEY`, and `OIDC_M2M_CLIENT_ID`/`SECRET` appear nowhere in
   this codebase outside this spec and `deploy/README.md`. They are real keys in
   the operator `.env` and are what the *running OAP pod* consumes
   (`OIDC_M2M_CLIENT_ID_FILE`), so the draft was written from the operator
   secret store and the OAP deployment rather than from this repo's code. The
   app reads `WEBAPP_BASE_URL` (`backend/tenants/config.ts:34`) and takes its
   secrets through Encore `secret()` + `infra.config.json`. §3 is corrected;
   `deploy/README.md` likewise.
2. **The JWT signing keys do not exist** in the operator `.env` or on the
   cluster (§3). Login cannot work until they are minted.
3. **The `statecraft` database holds live OAP data** (`factory_artifact_substrate`
   277 rows, `audit_log` 143, `users` 3, its own `schema_migrations`) under a
   schema unrelated to CoreLedger's, so it could never have been reused. It is
   discarded with the old cluster.
4. **Flux would not have fought a cutover**, which was the standing risk: its
   `manifests` kustomization owns 3 objects (2 cluster-scoped, 1 in
   cert-manager) and nothing in `statecraft-system`. The OAP release is plain
   Helm from the archived CD (`meta.helm.sh/release-name: statecraft`, deploy
   revision 206, release v256).

Rather than deploy onto a cluster named for another product and then migrate,
spec 010 builds the statecraft cluster alongside and this spec targets it.
Stage 1 is unaffected: the image is cluster-independent and already published.
Stage 2 resumes once 010 lands.

## 5. Out of scope

- **The cluster and the platform services on it** (the cluster itself, Flux,
  SOPS, rauthy, Postgres, NSQ, minio, prometheus/grafana, DNS cutover, and the
  old cluster's teardown): all spec 010. This spec deploys one application onto
  a cluster it assumes exists.
- Non-hetzner deployment targets (values for other clouds); hetzner first.
- Porting OAP's research-era services or their service-specific CI
  (axiomregent, opc, deployd-api, desktop, tenant-app, etc.).
- Re-homing the marketing site (`statecraft.ing` apex stays GitHub Pages).
- Multi-replica / HA control plane (single replica, like the current shape).
