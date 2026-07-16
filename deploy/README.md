# deploy/: self-hosted control plane deployment (spec 009)

The stagecraft-owned deployment of the control plane. Everything here is owned by
`specs/009-control-plane-deploy`; nothing depends on the archived
open-agentic-platform (OAP) chart, CD, or secret backend.

## Target topology (hetzner-k3s, the fleet cluster)

- **Image** `ghcr.io/stagecraft-ing/stagecraft:<sha>` built from `docker/Dockerfile`
  (the enrahitu chassis, spec 002), published by `.github/workflows/image.yml`.
- **Workload** a single-replica Deployment (the EnRaHiTu single-container shape),
  listening on `:4000`, with a workspace PVC. The control plane runs the Postgres
  driver (spec 003), so it needs a Postgres it owns (not the fleet's per-app
  libSQL shape).
- **Ingress** `app.<domain>` (default `app.stagecraft.ing`), ingressClassName
  `nginx`, TLS via the `letsencrypt-prod-dns01-cloudflare` ClusterIssuer. The
  wildcard-free `app.stagecraft.ing` A record to the worker ingress is already
  provisioned. The apex `stagecraft.ing` stays the GitHub Pages marketing site.
- **Auth** reuse the platform rauthy at `auth.<domain>`. A stagecraft-side seed
  step converges the stagecraft OIDC client's `redirect_uris` to include
  `https://app.<domain>/...` (additive, never removes existing URIs).

## Secrets (OAP-free)

`APP_BASE_URL=https://app.<domain>`, the CoreLedger Postgres URL, the OIDC M2M
client id/secret, and the PAT encryption key. Sourced at deploy time from the
operator infra `.env` and/or a stagecraft-managed cluster Secret. No External
Secrets dependency on an OAP backend.

## Cutover from the OAP release

1. Install the new release under a distinct name (leave the OAP `stagecraft`
   release running).
2. Verify `https://app.stagecraft.ing` serves the UI over a valid cert and a
   real rauthy login completes.
3. Retire the OAP release (scale to zero / disable its apex ingress). The apex
   marketing site, `auth`, `deploy`, and the fleet are unaffected.
4. **Rollback**: the OAP release stays installed but demoted until the new one is
   proven; re-enable it if the new deployment regresses.

## Contents (added as stages land)

- `values-hetzner.yaml` / manifests: the deploy definition.
- Referenced from `.github/workflows/cd.yml` (build+push+apply on push to main).

Acceptance and the full behavior contract live in
`specs/009-control-plane-deploy/spec.md`.
