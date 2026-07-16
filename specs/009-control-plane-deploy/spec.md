---
id: "009-control-plane-deploy"
title: "Self-hosted control plane deployment (OAP-independent)"
status: approved
created: "2026-07-16"
implementation: in-progress
summary: >
  Give stagecraft its own deployment story so the spec-governed control plane
  runs on the fleet cluster owned entirely by this repo, with no dependency on
  the archived open-agentic-platform (OAP) chart or CD. Publish the
  single-container image to stagecraft's own GHCR namespace, stand it up as a
  platform-grade K8s deployment reachable at app.stagecraft.ing, seed its own
  rauthy client, and cut over from the OAP-built stagecraft release. Port the
  OAP CI tooling worth keeping (AI PR review + changelog, the PR gate pattern),
  adapted to be OAP-free.
depends_on:
  - "002-app-shell"
  - "008-governance-attestation"
establishes:
  - { kind: directory, path: "deploy/" }
# Further ownership edges land with their units during implementation (owned
# paths and this spec move together): .github/workflows/{image,cd,ai-pr-review,
# ai-changelog}.yml (see §2 Territory).
---

# 009: Self-hosted control plane deployment

## 1. Purpose

Stagecraft is "the first production EnRaHiTu app" and "allowed to be a
platform-grade K8s deployment" (spec 001 §3), but it has no deployment of its
own. What runs on the cluster today at the apex is the **archived OAP build**
(`ghcr.io/stagecraft-ing/open-agentic-platform/stagecraft`), deployed by OAP's
Helm chart and `cd-stagecraft.yml`. OAP is retired: everything needed to build,
publish, deploy, and operate the control plane must live in this repo. This spec
makes stagecraft self-hosting and severs the OAP dependency.

The trigger is concrete: the control plane has no reachable URL (its OAP ingress
targets the apex `stagecraft.ing`, which is the GitHub Pages marketing site).
The chosen public host is **app.stagecraft.ing** (DNS A record to the worker
ingress already provisioned under this effort).

## 2. Territory

- `.github/workflows/image.yml`: build the single-container image from
  `docker/Dockerfile` (the enrahitu chassis, spec 002) and push to
  **`ghcr.io/stagecraft-ing/stagecraft`** on release/`workflow_dispatch`,
  multi-arch amd64 (the fleet cluster is x86-64), the same push+manifest shape
  proved for the enrahitu image.
- `deploy/`: a stagecraft-owned Helm chart (or plain manifests + a
  `values-hetzner.yaml`) standing up the Deployment, the Postgres it needs
  (CoreLedger driver, spec 003), a Service, an Ingress at
  `app.<domain>` with the cert-manager DNS-01 issuer, and the secret wiring.
- `.github/workflows/cd.yml`: on push to `main` (sha-pinned image) and on
  `workflow_dispatch`, build+push then `helm upgrade`/apply against the cluster;
  never floats `latest` onto the running release.
- `.github/workflows/ai-pr-review.yml` + `ai-changelog.yml`: ported from OAP
  (spec 085), the Claude-CLI PR reviewer + changelog, stripped of OAP-specific
  paths and secrets.

## 3. Behavior

- **Image.** One amd64 (multi-arch capable) image at
  `ghcr.io/stagecraft-ing/stagecraft:<sha>` + `:latest` + the release tag.
  Private is acceptable; the deploy provides pull creds (a namespace
  `dockerconfigjson` secret), matching the fleet finding that the cluster's
  reflector-synced `ghcr-pull` carries bot creds without access to new packages.
- **Deploy topology.** The control plane runs the Postgres driver (spec 003) on
  the cluster (not the fleet's per-app libSQL shape): a single-replica
  Deployment + a managed Postgres (StatefulSet or the existing cluster
  Postgres), a PVC for the workspace, a ClusterIP Service on `:4000`, an Ingress
  `app.<domain>` (ingressClassName `nginx`, TLS via
  `letsencrypt-prod-dns01-cloudflare`, whose deployd.xyz + tenants solvers this
  effort already extended).
- **Auth.** Reuse the platform rauthy at `auth.<domain>` as the IdP. The deploy
  seeds/updates the stagecraft rauthy OIDC client so its `redirect_uris`
  allow-list includes `https://app.<domain>/...` (additive convergence, the
  pattern OAP's seed-rauthy used), owned by a stagecraft-side seed step. The
  app's public origin (`APP_BASE_URL`) is `https://app.<domain>`.
- **Secrets.** A stagecraft-owned secret set (DB URL, OIDC M2M client id/secret,
  PAT encryption key, `APP_BASE_URL`) sourced without OAP: from the operator
  infra `.env` at deploy time and/or a stagecraft-managed cluster Secret. No
  External Secrets dependency on an OAP backend.
- **Cutover.** Bring up the new deployment (its own Helm release name, distinct
  from the OAP `stagecraft` release), verify `app.<domain>` serves and login
  works, then repoint / retire the OAP release and its apex ingress. The apex
  `stagecraft.ing` stays the marketing site; the control plane lives at
  `app.stagecraft.ing`. Document a rollback (the OAP release is left installed
  but scaled/ingress-disabled until the new one is proven).
- **Ported CI (OAP-free).** `ai-pr-review.yml` runs the Claude CLI over the PR
  diff and posts a review (no `ANTHROPIC_API_KEY` committed; auth via the
  workflow's configured credential). `ai-changelog.yml` its companion. The PR
  **gate** is already covered by this repo's `spec-spine.yml` (coupling) +
  `verify.yml` (typecheck/test); port only the missing orchestration if a single
  required check is wanted, not OAP's service-specific fan-out.

## 4. Acceptance

- `image.yml` publishes a pullable `ghcr.io/stagecraft-ing/stagecraft` image;
  verified by pulling it.
- The stagecraft-owned deploy stands up the control plane on the cluster with no
  OAP chart/CD/secret dependency; `https://app.stagecraft.ing` serves the
  governance UI over a valid cert and a real login completes against rauthy.
- The OAP `stagecraft` release is retired (or demoted to standby) without
  breaking the platform (auth, deployd, fleet, marketing site unaffected).
- `ai-pr-review.yml` runs on a PR and posts a review; spine gates + verify green.

## 5. Out of scope

- Non-hetzner deployment targets (values for other clouds); hetzner first.
- Porting OAP's research-era services or their service-specific CI
  (axiomregent, opc, deployd-api, desktop, tenant-app, etc.).
- Re-homing the marketing site (`stagecraft.ing` apex stays GitHub Pages).
- Multi-replica / HA control plane (single replica, like the current shape).
