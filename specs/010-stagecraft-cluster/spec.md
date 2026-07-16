---
id: "010-stagecraft-cluster"
title: "The stagecraft cluster: Flux GitOps, SOPS secrets, platform services"
status: approved
created: "2026-07-16"
implementation: pending
depends_on:
  - "001-stagecraft-thesis"
establishes:
  - { kind: directory, path: "infra/" }
summary: >
  Stagecraft does not own the cluster it runs on: the nodes are named for
  OAP, and Flux reconciles this cluster from the open-agentic-platform
  repository. Build a stagecraft-owned hetzner-k3s cluster alongside the
  existing one, reconciled by Flux from a stagecraft-owned GitOps tree,
  with one documented secret source that generates both the local-dev
  `.env` and the SOPS-encrypted cluster secrets Flux decrypts in-cluster.
  Stand up the platform services (cert-manager, ingress-nginx, rauthy,
  Postgres, NSQ, minio, prometheus/grafana), cut DNS when proven, then
  delete the old cluster. Blue-green at the cluster level: rollback is a
  DNS change.
---

# 010: The stagecraft cluster

## 1. Purpose

The cluster stagecraft runs on is OAP's. Verified 2026-07-16 against the
live cluster:

- The nodes are `oap-hetzner-master1` and `oap-hetzner-pool-worker-worker1`.
- Flux's GitRepository is
  `ssh://git@github.com/stagecraft-ing/open-agentic-platform` (public, **not**
  archived, last pushed 2026-07-15). It reconciles cert-manager,
  ingress-nginx, rauthy, monitoring, and reflector into this cluster from
  another product's repository.
- The cluster carries research-era state: `nsqd`, `minio`, a Postgres whose
  `stagecraft` database holds OAP's schema (`factory_artifact_substrate` 277
  rows, `audit_log` 143, `users` 3), two OAP sweeper CronJobs failing on
  roughly a 50% duty cycle, a `stagecraft` Helm release at revision 256, and
  an ACME http-solver pod stuck for 8 days.

Stagecraft is a greenfield rewrite of the OAP thesis (spec 001 §2). Its
cluster should be one too. Reconciling a product's infrastructure from a
different product's repository is not a rot emergency (the source repo is
alive), but it is a correctness and ownership defect, and it blocks the
explicit, documented infrastructure this spec exists to establish.

**Blue-green at the cluster level, not in place.** There are no live fleet
apps to migrate (verified 2026-07-16: no app namespaces exist; spec 006's
live E2E ended with its own remove step), so the only cost of building
alongside is a few days of double spend, and rollback is a DNS change rather
than a restore. Migrating a live cluster's GitOps source is painful;
starting clean is not.

## 2. Territory

- `infra/`: everything infrastructure, owned by this spec.
  - `infra/hetzner/`: cluster provisioning (hetzner-k3s config, node
    pools, the operator bootstrap).
  - `infra/gitops/clusters/stagecraft-hetzner/`: the Flux entrypoint and
    the kustomizations it reconciles.
  - `infra/secrets/catalog.toml`: the single documented secret source.
  - `infra/secrets/*.sops.yaml`: SOPS-encrypted cluster secrets.

**In-repo GitOps, not a second repository** (decided 2026-07-16). The Flux
tree lives in this repo so it is governed by the same spine as everything
else: `spec-spine couple` binds an infrastructure change to this spec the
same way it binds a code change, and there is one source of truth rather
than two. The cost is that Flux needs read access to this repo (a deploy
key) and reconciles a repo that also holds application code; path-scoped
kustomizations make that a non-issue. The alternative (a standalone
`stagecraft-gitops` repo) buys separation but puts the cluster's definition
outside the governance this product sells, which is the wrong trade here.

**Cross-spec touches at implementation.** `.env.example` and
`infra.config.json` are spec 002 territory; the secret catalog generates the
former and must agree with the latter. Wiring a generator invocation into
`package.json` is likewise a 002 touch. These land with a `Spec-Drift-Waiver:`
or a coordinated 002 edit, not by silently widening this spec's territory.

## 3. Behavior

### Cluster

hetzner-k3s, x86-64, nodes named `stagecraft-hetzner-*`, provisioned
alongside the existing cluster and never sharing its state. The operator
kubeconfig is `~/.config/stagecraft-ing/infra/hetzner/kubeconfig`; the
operator `.env` is its sibling. Both paths exist and are empty as of
2026-07-16.

### GitOps

Flux bootstrapped against this repository at
`infra/gitops/clusters/stagecraft-hetzner`. Acceptance includes a
zero-hit grep: no manifest, HelmRelease, or GitRepository on the new cluster
may reference `open-agentic-platform`.

### Secrets: one documented source, two outputs

`infra/secrets/catalog.toml` is the single source. It holds names,
descriptions, ownership, required/optional status, and the consumer of each
value. **It holds no values.** From it:

- **`.env.example`** is generated: commented, documented, committed. The
  catalog carries the prose so the generated artifact does not have to.
- **The local-dev `.env`** (gitignored, at
  `~/.config/stagecraft-ing/infra/hetzner/.env`) is validated against the
  catalog: missing required keys and unknown keys both fail.
- **Cluster secrets** are SOPS-encrypted YAML under `infra/secrets/`,
  committed, and decrypted in-cluster by Flux. The `age` private key is
  bootstrapped once into `flux-system` and never committed; the public key
  is committed so any operator can encrypt.

This is the reason SOPS beats a hand-carried `.env`: the values live
encrypted in git, documentation sits beside them, no plaintext rests on
disk, and every rotation is an auditable commit.

**The JWT signing keys are minted into the operator `.env`** (decided
2026-07-16). The four `JWT_*` keys (`JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`,
`JWT_REFRESH_PRIVATE_KEY`, `JWT_REFRESH_PUBLIC_KEY`) exist in no `.env` and on
no cluster today; they are RS256 PEMs produced by `npm run generate-keys`, which
writes them into a gitignored `keys/` that is deliberately absent from images.
Spec 009 cannot satisfy "a real login completes" without them. They are
generated once, written into
`~/.config/stagecraft-ing/infra/hetzner/.env` alongside every other operator
secret, declared in the catalog, and delivered to the cluster through SOPS like
the rest. The operator `.env` is therefore the origin of record for key material,
and the catalog is what makes that origin explicit rather than folkloric.

### Platform services

Reconciled as Flux HelmReleases from `infra/gitops/`:

- **cert-manager**, with both ClusterIssuers (`letsencrypt-prod` and
  `letsencrypt-prod-dns01-cloudflare`); the DNS-01 solver uses
  `CLOUDFLARE_DNS_API_TOKEN` from the catalog.
- **ingress-nginx**, **reflector**.
- **rauthy** at `auth.<domain>`, fresh (see below).
- **Postgres**, born empty. Postgres stays as the CoreLedger driver target
  (spec 003); only OAP's data is discarded.
- **NSQ**. Encore's self-host infra schema supports exactly three pub/sub
  backends (`gcp_pubsub`, `aws_sns_sqs`, `nsq`; verified 2026-07-16 against
  `https://encore.dev/schemas/infra.schema.json`). NSQ is therefore the
  only self-hostable choice, and `nsqd` on the old cluster was Encore's
  backend rather than OAP cruft.
- **minio**, backing Encore's `object_storage`.
- **prometheus + grafana**, backing Encore's `metrics`.

### Rauthy: rebuild, do not migrate

Verified 2026-07-16: **rauthy has no backup.** Its `rauthy-config`
`config.toml` is 591 bytes and contains only `[server] pub_url`; its 29
environment variables contain no `S3`, `BACKUP`, or `BUCKET` entry; and no
backup CronJob exists anywhere on the cluster. All state lives on the
`data-rauthy-0` PVC and nowhere else.

That state is recreatable: the only account is the operator's, and every
OIDC client id/secret (platform, both upstream providers, Grafana, the three
sweepers) is already in the secret catalog. So rauthy is installed fresh and
seeded from the catalog, not migrated. Reuse `RAUTHY_ENC_KEY` and
`RAUTHY_ENC_KEY_ID` so the encryption convention carries across.

### Cutover

The new cluster proves itself before anything moves. DNS records to repoint:
`auth`, `deploy`, `grafana`, `minio`, and (once spec 009 lands) `app`, all
under `stagecraft.ing`, plus the fleet's `deployd.xyz`. Note that `auth` is
Cloudflare-proxied today while `app` is a direct A record to the worker, so
the records are not uniform and each is checked individually. The apex
`stagecraft.ing` stays GitHub Pages and is not touched.

Rollback is repointing DNS at the old cluster, which stays running and
untouched until the new one is proven.

### Teardown

Only after the new cluster serves every host: delete the old cluster. The
OAP `stagecraft` database dies with it, intentionally and without export
(decided 2026-07-16). Nothing else on it is load-bearing.

## 4. Acceptance

- A cluster whose nodes are named `stagecraft-hetzner-*` is Ready, and its
  kubeconfig is the one at `~/.config/stagecraft-ing/infra/hetzner/`.
- Flux reconciles it from this repository; no object on the cluster
  references `open-agentic-platform`.
- `infra/secrets/catalog.toml` generates `.env.example`, validates a real
  `.env`, and its SOPS-encrypted counterparts are decrypted in-cluster by
  Flux (verified by a Secret materializing from ciphertext in git).
- `https://auth.<domain>` serves rauthy over a valid cert, the operator's
  admin login completes, and the seeded OIDC clients match the catalog.
- cert-manager issues real certs for every host via the DNS-01 issuer; no
  host serves the ingress default certificate.
- The fleet (spec 006) places an app on the new cluster and its live verbs
  still pass, proving the cluster is a valid fleet target.
- DNS is cut, every host serves from the new cluster, and the old cluster is
  deleted.

## 5. Out of scope

- **The control plane deployment itself.** Spec 009 targets this cluster
  once it exists; this spec stops at the platform.
- **Secrets at rest inside the control plane.** Verified 2026-07-16: the
  control plane stores no secret at rest anywhere. Every CoreLedger entity
  was inspected: `tenant`, `installation` (holds `installationId`, a public
  identifier), `stamp_job`, and `user_account` contain no credential, and
  `refresh_token` stores a `tokenHash`, hashed rather than encrypted, which
  is correct because it is compared and never read back. This is by design:
  spec 004's GitHub App flow mints short-lived installation tokens from the
  App private key instead of storing customer credentials, which is why
  OAP's `PAT_ENCRYPTION_KEY` has no successor here. The most secure secret
  store is the one that does not exist.

  **This decision is conditional on App reach** (2026-07-16). It holds only
  while the installation token can do everything the console must do: not just
  reads and commits, but scheduling, dispatching Actions runs, and any other
  verb the governance UI exposes. Those are App permissions (`actions: write`
  and friends), so the condition is satisfiable by widening the App's permission
  set, which the installation flow re-consents. If a required console verb ever
  turns out to be reachable only with a user-supplied credential, this decision
  reopens and the crypto service becomes real work rather than a deferred note.
  Verifying the App's permission set covers the console's verbs is a spec 004
  concern and a gate on that claim, not an assumption to carry silently.

  Should a consumer ever appear (a customer-supplied registry credential, a BYO
  cloud credential, or a stored PAT), the mechanism is `cryptr`
  (ChaCha20Poly1305, same author as rauthy and hiqlite, and the source of the
  `ENC_KEYS`/`ENC_KEY_ACTIVE` versioned-key convention rauthy already uses),
  specced then, against a real caller.
- Non-hetzner targets, and multi-cluster or HA topologies.
- Re-homing the marketing site: the apex stays GitHub Pages.
