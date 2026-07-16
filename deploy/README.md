# deploy/: self-hosted control plane deployment (spec 009)

The stagecraft-owned deployment of the control plane. Everything here is owned by
`specs/009-control-plane-deploy`; nothing depends on the open-agentic-platform
(OAP) chart, CD, or secret backend.

This deploys **one application onto a cluster it assumes exists**. The cluster
itself, Flux, SOPS, and the platform services (rauthy, Postgres, NSQ, minio,
prometheus/grafana) are `specs/010-stagecraft-cluster`.

## Target topology (the spec 010 cluster)

- **Image** `ghcr.io/stagecraft-ing/stagecraft:<sha>` built from `docker/Dockerfile`
  (the enrahitu chassis, spec 002), published by `.github/workflows/image.yml`.
  Stage 1, done: the image is published and pullable (amd64).
- **Workload** a single-replica Deployment (the EnRaHiTu single-container shape),
  listening on `:4000`, with a workspace PVC. The control plane runs the Postgres
  driver (spec 003), against **its own database, born empty**, on the cluster
  Postgres. It never reuses OAP's `stagecraft` database, whose schema is
  unrelated.
- **Ingress** `app.<domain>` (default `app.stagecraft.ing`), ingressClassName
  `nginx`, TLS via the `letsencrypt-prod-dns01-cloudflare` ClusterIssuer. No such
  ingress exists today, which is why the host currently serves the nginx default
  backend behind a fake certificate. The apex `stagecraft.ing` stays the GitHub
  Pages marketing site.
- **Auth** reuse the platform rauthy at `auth.<domain>` (installed and seeded by
  spec 010). A seed step converges the stagecraft OIDC client's `redirect_uris`
  to include `https://app.<domain>/...` (additive, never removes existing URIs).

## Secrets (the real contract)

All values flow from spec 010's secret catalog. The app declares **11 Encore
secrets**, each mapped `$env` to an identically-named environment variable by
`infra.config.json`, so the deploy's job is to put these 11 on the pod:

```
JWT_PRIVATE_KEY  JWT_PUBLIC_KEY  JWT_REFRESH_PRIVATE_KEY  JWT_REFRESH_PUBLIC_KEY
RAUTHY_CLIENT_SECRET
GITHUB_APP_ID  GITHUB_APP_PRIVATE_KEY_B64  GITHUB_WEBHOOK_SECRET
RESTIC_PASSWORD  FLEET_S3_ACCESS_KEY_ID  FLEET_S3_SECRET_ACCESS_KEY
```

Plus the non-secret environment the services read directly:
`ENRAHITU_LEDGER_URL` (the Postgres URL; the driver is chosen by scheme),
`WEBAPP_BASE_URL`, `RAUTHY_UPSTREAM`, `ENRAHITU_KEYS_DIR`, `FLEET_BASE_DOMAIN`,
`FLEET_IMAGE_PULL_SECRET`, the `FLEET_BACKUP_*` trio, the `FACTORY_*` trio, and
the `STAGECRAFT_GOVERNANCE_*` pair.

There is **no** `APP_BASE_URL`, `PAT_ENCRYPTION_KEY`, or `OIDC_M2M_CLIENT_ID` /
`OIDC_M2M_CLIENT_SECRET` in this codebase. Those are OAP's names; an earlier
draft of this file and of spec 009 carried them over by mistake (corrected
2026-07-16). The app's public origin is `WEBAPP_BASE_URL`.

**Operator prerequisite:** the four `JWT_*` keys exist in no `.env` and no
cluster secret. They are minted by `npm run generate-keys` into a gitignored
`keys/` that is absent from images. Without them, login returns 500. They are
generated once and delivered through spec 010's catalog like every other secret.

## Cutover

Spec 010 owns cluster-level cutover and deletes the old cluster wholesale,
taking the OAP `stagecraft` release and its database with it. This deploy's part
is narrower:

1. Bring the control plane up on the 010 cluster under its own release name.
2. Verify `https://app.stagecraft.ing` serves the UI over a valid cert (not the
   ingress default) and a real rauthy login completes.
3. Only then does 010 cut DNS.

**Rollback** is 010's: the old cluster stays running and untouched until the new
one is proven, so reverting is a DNS change.

## Contents (added as stages land)

- `values-hetzner.yaml` / manifests: the deploy definition.
- Referenced from `.github/workflows/cd.yml` (build+push+apply on push to main).

Acceptance and the full behavior contract live in
`specs/009-control-plane-deploy/spec.md`.
