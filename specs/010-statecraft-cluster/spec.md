---
id: "010-statecraft-cluster"
title: "The statecraft cluster: Flux GitOps, SOPS secrets, platform services"
status: approved
created: "2026-07-16"
implementation: in-progress
depends_on:
  - "001-statecraft-thesis"
establishes:
  - { kind: directory, path: "infra/" }
summary: >
  statecraft did not own the cluster it ran on: the nodes were named for
  OAP and Flux reconciled it from the open-agentic-platform repository.
  Build a statecraft-owned hetzner-k3s cluster reconciled by Flux from a
  statecraft-owned in-repo GitOps tree, with one documented secret source
  that generates both the local-dev `.env` and the SOPS-encrypted cluster
  secrets Flux decrypts in-cluster. Stand up the platform services
  (cert-manager, ingress-nginx, rauthy, Postgres, NSQ, prometheus/grafana);
  object storage is Hetzner Object Storage, not an in-cluster service. The
  old cluster was torn down first (2026-07-17), because it was not worth
  keeping as a fallback, so this is a greenfield build: DNS points at the
  new cluster once it serves, and there is no blue-green rollback target.
---

# 010: The statecraft cluster

## 1. Purpose

The cluster statecraft runs on is OAP's. Verified 2026-07-16 against the
live cluster:

- The nodes are `oap-hetzner-master1` and `oap-hetzner-pool-worker-worker1`.
- Flux's GitRepository is
  `ssh://git@github.com/statecrafting/open-agentic-platform` (public, **not**
  archived, last pushed 2026-07-15). It reconciles cert-manager,
  ingress-nginx, rauthy, monitoring, and reflector into this cluster from
  another product's repository.
- The cluster carries research-era state: `nsqd`, `minio`, a Postgres whose
  `statecraft` database holds OAP's schema (`factory_artifact_substrate` 277
  rows, `audit_log` 143, `users` 3), two OAP sweeper CronJobs failing on
  roughly a 50% duty cycle, a `statecraft` Helm release at revision 256, and
  an ACME http-solver pod stuck for 8 days.

statecraft is a greenfield rewrite of the OAP thesis (spec 001 §2). Its
cluster should be one too. Reconciling a product's infrastructure from a
different product's repository is not a rot emergency (the source repo is
alive), but it is a correctness and ownership defect, and it blocks the
explicit, documented infrastructure this spec exists to establish.

**Greenfield, not in place.** There are no live fleet apps to migrate
(verified 2026-07-16: no app namespaces exist; spec 006's live E2E ended
with its own remove step). Migrating a live cluster's GitOps source is
painful; starting clean is not.

**Status note (2026-07-17).** Three decisions refined this spec after it was
written:

1. A brief attempt to *reuse* the existing cluster in place (rename OAP to
   statecraft, swap Flux's source live) was tried and reverted: it inverts
   almost every clause here, keeps the OAP node identity and etcd, and gives
   up the "born clean" half of the thesis. Back to build-new.
2. The old cluster was **torn down first** rather than kept as a blue-green
   fallback, because the operator judged it not worth keeping. The original
   plan's "delete old last, after new is proven" sequencing is therefore
   moot, and there is no rollback cluster. Teardown is done (see §3).
3. In-cluster **minio is dropped** for Hetzner Object Storage (see Platform
   services). This is the design change that most affects the secret catalog.

The greenfield build proceeds from a verified-empty Hetzner project.

**Live bring-up note (2026-07-18).** The platform layer was built and brought
up live. What is done:

- The in-repo half: `infra/secrets/catalog.toml` + a dependency-free generator
  (`infra/secrets/catalog.ts`) producing `infra/hetzner/.env.example` and
  validating the operator `.env`; the `infra/gitops/clusters/statecraft-hetzner`
  Flux tree (four tiers with `dependsOn`); five SOPS-encrypted secrets.
- Flux was bootstrapped (`flux bootstrap github`, deploy-key path) against the
  `feat/010-platform-layer` branch. All four tiers reconcile Ready. The five
  SOPS secrets **materialize in-cluster from ciphertext in git** (the acceptance
  the OAP reference never actually met). cert-manager, ingress-nginx, reflector,
  rauthy, Postgres, NSQ, and kube-prometheus-stack (Prometheus + Grafana) are
  all healthy. `rauthy` reports `db_healthy: true`.
- Certs issue via the **DNS-01 Cloudflare** ClusterIssuer (rauthy-tls,
  grafana-tls), which is why they issued before DNS cutover. No object on the
  cluster references `open-agentic-platform` (zero-hit grep verified).
- DNS: `auth.statecraft.ing` (Cloudflare-proxied) and `grafana.statecraft.ing`
  (direct) were created pointing at the worker node and both serve over a valid
  cert. These records did not previously exist (they died with the old cluster),
  so the cutover was additive.

Two operational facts that the hetzner-k3s `cluster.yaml` schema does not
express, recorded here as design truth:

- **The Hetzner firewall must allow inbound TCP 80/443.** hetzner-k3s creates a
  firewall with SSH/API/NodePort rules only; the ingress-nginx hostPort is
  unreachable until 80/443 are opened. Added live via `hcloud firewall
  add-rule`; re-running `hetzner-k3s create` may reset the firewall and need
  them re-added. Not expressible in `cluster.yaml`; it is an operator step.
- **ingress-nginx runs only on the worker.** The DaemonSet does not tolerate the
  control-plane taint, so only the worker serves 80/443; DNS points at the
  worker IP.

What remains (keeps this spec `in-progress`):

- **Operator admin login** to rauthy (browser, session-based; not scripted).
- **OIDC client seeding.** rauthy is fresh, so the catalog's client
  ids/secrets (from the old rauthy) are not yet realized in it. Grafana's OIDC
  login and the app clients (`OIDC_SPA`, `OIDC_M2M`, `RAUTHY_CLIENT`) need
  seeding; the app clients are spec 009's concern (its chart runs the seeder).
- **object_storage read/write** against the Hetzner bucket needs the Encore app
  (spec 009); only "no in-cluster minio" is verifiable now (it holds).
- **Fleet E2E** (spec 006 places an app): blocked on the same items the spec 006
  live run flagged (an amd64 enrahitu image, pull-secret provisioning).
- **`deploy.` / `app.` DNS**: their services (deployd-api, the control plane)
  are not deployed here, so those records are deferred to specs 006 / 009.
- **Repoint Flux from `feat/010-platform-layer` to `main`** after the PR merges
  (patch the `flux-system` GitRepository `spec.ref.branch`).

## 2. Territory

- `infra/`: everything infrastructure, owned by this spec.
  - `infra/hetzner/`: cluster provisioning (hetzner-k3s config, node
    pools, the operator bootstrap).
  - `infra/gitops/clusters/statecraft-hetzner/`: the Flux entrypoint and
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
`statecraft-gitops` repo) buys separation but puts the cluster's definition
outside the governance this product sells, which is the wrong trade here.

**Cross-spec touches at implementation.** The catalog documents the operator
and cluster secret surface (the `.env` at
`~/.config/statecrafting/infra/hetzner/`). It generates its own committed
example, `infra/hetzner/.env.example` (this spec's territory, beside
`cluster.yaml`), rather than the root `.env.example`: the root file is spec
002's local-dev ledger doc, a developer running `npm run dev` sets none of the
operator secrets, so folding the full cluster surface into the root example
would be a regression, and the reference cluster kept the two separate. The
catalog must *agree with* (not rewrite) two spec 002 artifacts:
`infra.config.json` (every secret Encore injects must be declared in the
catalog) and the root `.env.example`. Agreement is a validation the generator
enforces, not an authoring edit. The one genuine 002 touch is wiring the
generator scripts into `package.json`, which lands with a `Spec-Drift-Waiver:`
or a coordinated 002 edit, not by silently widening this spec's territory.

## 3. Behavior

### Cluster

hetzner-k3s, x86-64, nodes named `statecraft-hetzner-*`, provisioned
alongside the existing cluster and never sharing its state. The operator
kubeconfig is `~/.config/statecrafting/infra/hetzner/kubeconfig`; the
operator `.env` is its sibling. Both paths exist and are empty as of
2026-07-16.

### GitOps

Flux bootstrapped against this repository at
`infra/gitops/clusters/statecraft-hetzner`. Acceptance includes a
zero-hit grep: no manifest, HelmRelease, or GitRepository on the new cluster
may reference `open-agentic-platform`.

### Secrets: one documented source, two outputs

`infra/secrets/catalog.toml` is the single source. It holds names,
descriptions, ownership, required/optional status, and the consumer of each
value. **It holds no values.** From it:

- **`.env.example`** is generated: commented, documented, committed. The
  catalog carries the prose so the generated artifact does not have to.
- **The local-dev `.env`** (gitignored, at
  `~/.config/statecrafting/infra/hetzner/.env`) is validated against the
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
`~/.config/statecrafting/infra/hetzner/.env` alongside every other operator
secret, declared in the catalog, and delivered to the cluster through SOPS like
the rest. The operator `.env` is therefore the origin of record for key material,
and the catalog is what makes that origin explicit rather than folkloric.

### Platform services

Reconciled by Flux from `infra/gitops/`. Most are HelmReleases; Postgres and
NSQ are raw manifests (still Flux-reconciled), because NSQ has no maintained
chart and a single born-empty Postgres on the official image sidesteps the
Bitnami catalog changes (mid-2025) that leave the old `bitnami/postgresql`
tags in `ImagePullBackOff`:

- **cert-manager** (HelmRelease), with both ClusterIssuers (`letsencrypt-prod`
  and `letsencrypt-prod-dns01-cloudflare`); the DNS-01 solver uses
  `CLOUDFLARE_DNS_API_TOKEN` from the catalog. Per Acceptance, the DNS-01
  issuer is the default every platform host uses, so certs issue before DNS is
  cut over (HTTP-01 cannot solve an unreachable host on a greenfield cluster).
- **ingress-nginx**, **reflector** (HelmReleases).
- **rauthy** at `auth.<domain>`, fresh (see below); the in-tree vendored chart.
- **Postgres** (raw StatefulSet, `postgres:17`), born empty. Postgres stays as
  the CoreLedger driver target (spec 003); only OAP's data is discarded.
- **NSQ** (raw manifest). Encore's self-host infra schema supports exactly
  three pub/sub backends (`gcp_pubsub`, `aws_sns_sqs`, `nsq`; verified
  2026-07-16 against `https://encore.dev/schemas/infra.schema.json`). NSQ is
  therefore the only self-hostable choice, and `nsqd` on the old cluster was
  Encore's backend rather than OAP cruft.
- **prometheus + grafana** (kube-prometheus-stack HelmRelease), backing
  Encore's `metrics`.

**Object storage is Hetzner Object Storage, not an in-cluster service**
(decided 2026-07-17). The old cluster ran an in-cluster minio; it is
dropped. Encore's `object_storage` uses the `s3` backend pointed at the
`statecraft-encore-object-storage` bucket, addressed by
`OBJECT_STORAGE_S3_ACCESS_KEY_ID` / `OBJECT_STORAGE_S3_SECRET_ACCESS_KEY`
in the catalog; rauthy backups (`RAUTHY_S3_*`) and the fleet's restic
backups (`FLEET_S3_*`) already target Hetzner Object Storage buckets.
Dropping minio removes a stateful pod, a 20 GB volume, and `MINIO_ROOT_*`
from the secret surface. The rationale: with a managed S3 already in the
picture, a self-hosted one was pure redundancy, and block storage is
better reserved for workloads that genuinely need it (Postgres, the fleet's
per-app volumes, prometheus). Nothing pointed at the in-cluster minio, so
the drop is clean.

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

DNS records to point at the new cluster once it serves: `auth`, `deploy`,
`grafana`, and (once spec 009 lands) `app`, all under `statecraft.ing`, plus
the fleet's `deployd.xyz`. Note that `auth` is Cloudflare-proxied while `app`
is a direct A record to the worker, so the records are not uniform and each
is checked individually. The apex `statecraft.ing` stays GitHub Pages and is
not touched.

The old cluster was torn down first (2026-07-17), so there is **no
blue-green rollback target**: this is a greenfield build. Until the new
cluster serves and DNS is pointed at it, the hosts are simply down. That is
an accepted consequence of the operator's decision that the old cluster was
not worth keeping; the mitigation is to bring the new cluster up and verified
before pointing DNS, not to keep a fallback.

### Teardown

Already done: the old cluster was deleted 2026-07-17 (2 servers, 7 CSI
volumes, network, firewall, ssh-key, primary IPs; Hetzner project verified
empty). The OAP `statecraft` database died with it, intentionally and without
export. External Hetzner Object Storage buckets are a separate service and
were preserved. (A brief reuse-in-place attempt on 2026-07-17 was reverted
to this build-new plan before any cluster state was changed by it.)

## 4. Acceptance

- A cluster whose nodes are named `statecraft-hetzner-*` is Ready, and its
  kubeconfig is the one at `~/.config/statecrafting/infra/hetzner/`.
- Flux reconciles it from this repository; no object on the cluster
  references `open-agentic-platform`.
- `infra/secrets/catalog.toml` generates `.env.example`, validates a real
  `.env`, and its SOPS-encrypted counterparts are decrypted in-cluster by
  Flux (verified by a Secret materializing from ciphertext in git).
- `https://auth.<domain>` serves rauthy over a valid cert, the operator's
  admin login completes, and the seeded OIDC clients match the catalog.
- cert-manager issues real certs for every host via the DNS-01 issuer; no
  host serves the ingress default certificate.
- Encore's `object_storage` reads and writes the
  `statecraft-encore-object-storage` Hetzner bucket; no in-cluster minio
  exists.
- The fleet (spec 006) places an app on the new cluster and its live verbs
  still pass, proving the cluster is a valid fleet target.
- DNS is pointed at the new cluster and every host serves from it. (The old
  cluster is already deleted; there is nothing left to tear down.)

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
