---
id: "010-statecraft-cluster"
title: "The statecraft cluster: the substrate beneath the control-plane container"
status: approved
created: "2026-07-16"
implementation: in-progress
depends_on:
  - "001-statecraft-thesis"
establishes:
  - { kind: directory, path: "infra/" }
summary: >
  The statecraft-owned hetzner-k3s cluster, reconciled by Flux from an
  in-repo GitOps tree, with one documented secret source that generates
  the operator `.env.example` and the SOPS-encrypted secrets Flux
  decrypts in-cluster. Rewritten ground-up 2026-07-19 to the two-plane
  thesis (001 §3): identity and observability moved inside the
  control-plane container, so the cluster keeps only what a container
  cannot do for itself. The standalone cluster rauthy is retired
  (embedded rauthy is THE platform IdP) and cluster Grafana is dropped
  with its OIDC client (platform observability is the in-substrate
  flag-gated admin dashboard); Prometheus is kept, demoted to an
  unexposed in-cluster metrics sink. What stands: the Flux tree, SOPS,
  cert-manager, ingress-nginx, reflector, Postgres, NSQ, and Hetzner
  Object Storage. The cluster is live (PRs #27-#29); this rewrite is the
  first change that prunes services from it.
---

# 010: The statecraft cluster

## 1. Purpose

The cluster is what a container cannot do for itself.

Under the two-plane model (001 §3.1) the platform is ONE EnRaHiTu app:
identity lives in the container (embedded rauthy), observability lives in
the container (the flag-gated admin dashboard), and durable state sits
behind CoreLedger. What is left for the cluster is the substrate beneath
that container: machines, ingress, certificates, secret delivery, the
data services the control plane's drivers target, and a place for metrics
to land.

This spec is rewritten ground-up on 2026-07-19 to that shape. Its
previous version provisioned the platform's identity provider and the
platform's operator dashboard as cluster services. The thesis rewrite
moved both inside the control-plane container, so those parts are
**retired here rather than amended** (§2). Everything the cluster still
owes the platform is restated below on its own terms.

**History, compressed.** The cluster statecraft ran on was OAP's: nodes
named `oap-hetzner-*`, Flux reconciling from the `open-agentic-platform`
repository, carrying research-era state. It was torn down on 2026-07-17
rather than kept as a fallback, and a statecraft-owned cluster was built
greenfield from a verified-empty Hetzner project. The platform layer came
up live on 2026-07-18 and Flux was repointed from the feature branch to
`main` (PRs #27-#29). Both `statecraft-hetzner-*` nodes are Ready, every
Flux tier reconciles, the SOPS secrets materialize from ciphertext in
git, and no object on the cluster references `open-agentic-platform`.
There was never a blue-green rollback target and there is none now.

## 2. What the realignment retires

The cluster is live, so this section is not a plan: it is a list of
services that get pruned from a running cluster when this spec merges
(§6).

### 2.1 The cluster rauthy is retired

Thesis 001 §3.3 is literal: embedded rauthy is THE platform IdP, the
control plane hosts it in-container, and there is no standalone cluster
rauthy and no second IdP. This spec is where that becomes true of the
cluster.

**What goes:** the `rauthy` HelmRelease, the vendored in-tree chart at
`charts/rauthy/`, the `rauthy-system` namespace, and the two SOPS
secrets that fed it (`rauthy-secrets`, `rauthy-smtp-secret`). The
previous spec's "rauthy: rebuild, do not migrate" decision is void, because
there is nothing here to rebuild.

**What stays:** the key material. The IdP moved; it did not disappear.
Every `RAUTHY_*` key the catalog declares is still required, now by the
embedded rauthy inside the control-plane container: the hiqlite Raft and
API secrets, the bootstrap admin password, the `ENC_KEYS` pair, the SMTP
group, the upstream OAuth provider groups, the S3 backup credentials, and
the admin token the seed job uses. Their catalog `consumer` annotations
are restated to name the control-plane container instead of a cluster
service. Their **delivery** (a Secret in the control-plane namespace,
shaped to whatever the control-plane chart expects) belongs to spec 009,
which re-encrypts them from the operator `.env`. That file is the origin
of record for key material, so deleting the ciphertext here loses
nothing.

**Cost, accepted:** `auth.statecraft.ing` stops serving when this merges.
Nothing consumes it. The rauthy on this cluster is fresh, carries no
seeded OIDC clients (client seeding was always spec 009's seeder pass),
and the control plane it would authenticate for is not deployed. The host
returns with 009.

**Handed to 009, not pre-empted here:** whether `auth.<DOMAIN>` survives
as a distinct host at all. The embedded rauthy is reached through the
app's own same-origin `/auth/v1` proxy (spec 007), so the control plane
may serve the issuer at `https://<DOMAIN>/auth/v1/` and leave `auth.`
vestigial. `RAUTHY_URL` therefore keeps its current definition
(`https://auth.<DOMAIN>`) until 009 decides; this spec does not guess.

### 2.2 Grafana is dropped; Prometheus is kept, demoted

Thesis 001 §3.4 pivots platform observability to the in-substrate
flag-gated `frontend-admin`, same-origin behind `statecraft_operator`,
with no separate Grafana OIDC client and no standalone monitoring
identity. That settles the two halves of the monitoring stack
differently, so this spec decides each explicitly.

**Grafana: dropped, with its OIDC client.** Grafana's sole auth path here
was rauthy `generic_oauth` against a dedicated OIDC client. The pivot
forbids that client, and the cluster rauthy it authenticated against is
retired by §2.1, so keeping Grafana would mean either an unauthenticated
dashboard reachable at ingress or reinstating exactly the standalone
monitoring identity the thesis removes. Neither is acceptable, and the
client was never actually registered in rauthy, so nobody has ever logged
in. The Grafana subchart, its ingress, its `grafana-oidc` Secret, and the
`GRAFANA_OIDC_CLIENT_ID` / `GRAFANA_OIDC_CLIENT_SECRET` catalog keys all
go. The stale `rauthy_admin` role mapping in its config goes with it,
which is convenient: fork 6 of the realignment record replaced that role
with `statecraft_operator`, and this was its last appearance.

**Prometheus: kept, as an unexposed sink.** It is demoted from "the
metrics stack that serves Grafana" to a data plane with no UI and no
identity: no ingress, no LoadBalancer, reachable only in-cluster. Kept
because:

- The substrate contract (001 §3.4) requires every EnRaHiTu app to expose
  Prometheus `/metrics` and OTel traces. Something has to receive them.
  The in-substrate dashboard is a renderer, not a time-series store.
- Cluster-plane signals (node health, ingress, Flux reconciliation, pod
  restarts across the fleet) are invisible from inside any one container.
  They are the operator's only view of the machines the fleet places onto,
  and no in-container dashboard can reconstruct them.
- The fleet's per-tenant Grafana/Prometheus add-on (001 §3.4, spec 006) is
  this same machinery at tenant scope. Dropping the platform's copy would
  mean rebuilding it when the add-on ships.

The demotion is a change of role, not of configuration: only Grafana ever
carried an ingress, so removing Grafana leaves Prometheus in exactly the
posture named here. **Who reads it is deferred.** Whether `frontend-admin`
queries it server-side is a 009 and substrate question; this spec
provisions the sink and asserts nothing about the consumer. Until a
consumer exists the operator reads it through `kubectl port-forward`,
which is deliberate: an operator-only path that needs no second identity
at the edge.

**Alternative recorded and rejected:** dropping Prometheus alongside
Grafana. It would save one HelmRelease and a 20Gi volume, at the price of
blinding the cluster at precisely the layer the in-container dashboard
cannot see.

### 2.3 What stands

Unchanged by the realignment, and restated so the retirements above are
not read as a wider retreat:

- **The in-repo Flux GitOps tree**, four tiers with `dependsOn`
  (`namespaces` -> `secrets` + `infrastructure` -> `manifests`). Decided
  2026-07-16 and still right: the cluster's definition is governed by the
  same spine as everything else, so `spec-spine couple` binds an
  infrastructure change to this spec the way it binds a code change. The
  cost (Flux needs a deploy key on a repo that also holds application
  code) is contained by path-scoped kustomizations.
- **SOPS** for cluster secrets: values encrypted in git, documentation
  beside them, no plaintext at rest, every rotation an auditable commit.
- **cert-manager**, both ClusterIssuers, DNS-01 Cloudflare as the default.
- **ingress-nginx**, DaemonSet with hostPort.
- **reflector**, which clones annotated Secrets across namespaces for the
  tenant wildcard TLS cert and the `ghcr-pull` secret (specs 004/006/009).
  It never had anything to do with rauthy or Grafana.
- **Postgres** (raw StatefulSet, born empty), the CoreLedger driver target
  (spec 003, thesis §3.2).
- **NSQ** (raw manifest). Encore's self-host infra schema supports exactly
  three pub/sub backends (`gcp_pubsub`, `aws_sns_sqs`, `nsq`), so NSQ is
  the only self-hostable choice.
- **Hetzner Object Storage**, not an in-cluster service. The old cluster's
  minio was dropped 2026-07-17; with a managed S3 already in the picture a
  self-hosted one was pure redundancy, and block storage is better
  reserved for workloads that need it.
- **The secret catalog** as the single documented source (§4).

## 3. Territory

- `infra/`: everything infrastructure, owned by this spec.
  - `infra/hetzner/`: cluster provisioning (hetzner-k3s config, node
    pools, the operator bootstrap) and the generated `.env.example`.
  - `infra/gitops/clusters/statecraft-hetzner/`: the Flux entrypoint and
    the kustomizations it reconciles.
  - `infra/secrets/catalog.toml`: the single documented secret source,
    with `catalog.ts` as its generator and validator.
  - `infra/gitops/clusters/statecraft-hetzner/secrets/*.sops.yaml`:
    SOPS-encrypted cluster secrets.

**Cross-spec touches.** The catalog documents the operator and cluster
secret surface (the `.env` at `~/.config/statecrafting/infra/hetzner/`).
It generates its own committed example beside `cluster.yaml` rather than
the root `.env.example`, which is spec 002's local-dev ledger doc: a
developer running `npm run dev` sets none of the operator secrets. The
catalog must *agree with* (not rewrite) two spec 002 artifacts,
`infra.config.json` and the root `.env.example`; agreement is a
validation the generator enforces, not an authoring edit. The one genuine
002 touch is wiring the generator scripts into `package.json`.

## 4. Behavior

### Cluster

hetzner-k3s, x86-64, nodes named `statecraft-hetzner-*`. The operator
kubeconfig is `~/.config/statecrafting/infra/hetzner/kubeconfig`; the
operator `.env` is its sibling.

Two operational facts the hetzner-k3s `cluster.yaml` schema cannot
express, recorded here as design truth:

- **The Hetzner firewall must allow inbound TCP 80/443.** hetzner-k3s
  creates a firewall with SSH/API/NodePort rules only, so the
  ingress-nginx hostPort is unreachable until 80/443 are opened. Added
  live via `hcloud firewall add-rule`; re-running `hetzner-k3s create`
  may reset the firewall and require re-adding them. It is an operator
  step, not a manifest.
- **ingress-nginx runs only on the worker.** The DaemonSet does not
  tolerate the control-plane taint, so only the worker serves 80/443 and
  DNS points at the worker IP.

### GitOps

Flux is bootstrapped against this repository at
`infra/gitops/clusters/statecraft-hetzner`, tracking `main`. Acceptance
includes a zero-hit grep: no manifest, HelmRelease, or GitRepository on
the cluster may reference `open-agentic-platform`.

Every tier sets `prune: true`. That is what makes §2's retirements take
effect on merge, and it is why they are a human checkpoint (§6).

### Secrets: one documented source, two outputs

`infra/secrets/catalog.toml` is the single source. It holds names,
descriptions, ownership, required/optional status, and the consumer of
each value. **It holds no values.** From it:

- **`infra/hetzner/.env.example`** is generated: commented, documented,
  committed. The catalog carries the prose so the artifact need not.
- **The operator `.env`** (gitignored, at
  `~/.config/statecrafting/infra/hetzner/.env`) is validated against the
  catalog: missing required keys and unknown keys both fail.
- **Cluster secrets** are SOPS-encrypted YAML, committed, decrypted
  in-cluster by Flux. The `age` private key is bootstrapped once into
  `flux-system` and never committed; the public key is committed so any
  operator can encrypt.

**The operator `.env` is the origin of record for key material.** The four
`JWT_*` RS256 PEMs are minted once by `npm run generate-keys`, written
there beside every other operator secret, declared in the catalog, and
delivered to the cluster through SOPS like the rest. That origin is what
lets §2.1 delete rauthy ciphertext from the tree without losing anything:
009 re-encrypts from the same file.

### Platform services

Reconciled by Flux from `infra/gitops/`. Most are HelmReleases; Postgres
and NSQ are raw manifests (still Flux-reconciled), because NSQ has no
maintained chart and a single born-empty Postgres on the official image
sidesteps the Bitnami catalog changes that leave old `bitnami/postgresql`
tags in `ImagePullBackOff`.

- **cert-manager** (HelmRelease) with both ClusterIssuers. The DNS-01
  Cloudflare issuer is the default every platform host uses, so certs
  issue before DNS is cut over; HTTP-01 cannot solve an unreachable host
  on a greenfield cluster. The solver uses `CLOUDFLARE_DNS_API_TOKEN`.
- **ingress-nginx**, **reflector** (HelmReleases).
- **Postgres** (raw StatefulSet, `postgres:17`), born empty.
- **NSQ** (raw manifest), Encore's pub/sub backend.
- **Prometheus** (kube-prometheus-stack HelmRelease, Grafana subchart
  disabled). It receives the control plane's Encore `remote_write`, scrapes
  the pull targets (ingress-nginx, Flux, node-exporter, kube-state-metrics),
  and is reachable only in-cluster (§2.2). Alertmanager and the bundled
  default rules stay off; alerting policy is a later spec, not a chart
  default.

**No identity provider and no operator UI run on this cluster.** Both are
properties of the control-plane container (specs 009 and the substrate
rewrite). A future service that wants either must be argued against
thesis §3.3 and §3.4 first, not added here.

### Object storage

Hetzner Object Storage. Encore's `object_storage` uses the `s3` backend
against the `statecraft-encore-object-storage` bucket, addressed by
`OBJECT_STORAGE_S3_*`; rauthy's hiqlite backups (`RAUTHY_S3_*`) and the
fleet's restic backups (`FLEET_S3_*`) target their own buckets. These
buckets are a separate Hetzner service and survived the 2026-07-17
teardown.

### DNS

Under `statecraft.ing`: `auth` is retired with §2.1 and returns with 009
(possibly as nothing, if the issuer moves same-origin); `grafana` is
retired outright and its record should be removed (§6); `app` and
`deploy` arrive with specs 009 and 006. The fleet places tenant apps
under `deployd.xyz`. `auth` is Cloudflare-proxied while `app` is a direct
A record to the worker, so records are not uniform and each is checked
individually. The apex stays GitHub Pages and is not touched.

## 5. Acceptance

Met and holding:

- Nodes named `statecraft-hetzner-*` are Ready, under the kubeconfig at
  `~/.config/statecrafting/infra/hetzner/`.
- Flux reconciles the cluster from this repository, tracking `main`; no
  object on the cluster references `open-agentic-platform`.
- `infra/secrets/catalog.toml` generates `.env.example`, validates a real
  `.env`, and its SOPS counterparts decrypt in-cluster (verified by a
  Secret materializing from ciphertext in git).
- cert-manager issues real certs via the DNS-01 issuer for every host the
  cluster still serves; no host serves the ingress default certificate.

New with this rewrite, verified by absence and by posture:

- No rauthy, no Grafana, and no in-cluster minio runs on the cluster. The
  `rauthy-system` namespace is gone.
- Prometheus is Ready, receives `remote_write`, scrapes its pull targets,
  and is reachable only in-cluster: no Ingress and no LoadBalancer
  Service resolves to it.
- Every remaining Flux kustomization and HelmRelease reports Ready after
  the prune, with no orphaned namespace and no orphaned Secret once the
  hand-deleted `grafana-tls` leftover of §6.2 is cleared.

Gated on other specs, and not this spec's to close:

- Encore's `object_storage` reads and writes the Hetzner bucket (009).
- The fleet places an app on this cluster and its live verbs pass (006).
- A real login completes against the control plane's embedded rauthy
  (009). This replaces the previous version's `auth.<domain>` and
  operator-admin-login acceptances, which retired with §2.1.

## 6. Human checkpoints

`prune: true` means merging this spec mutates a live cluster with no
further prompt. Each of these is an operator action, proposed here rather
than performed:

1. **Approve the prune.** On merge Flux deletes the rauthy StatefulSet
   and its PVC, the Grafana deployment and its PVC, the `rauthy-system`
   namespace, and three Secrets. Reversible by reverting the commit,
   except for the volumes' contents, which are: a fresh rauthy DB holding
   one bootstrap admin, and a Grafana instance nobody ever logged into.
2. **Verify the prune landed clean**: all tiers Ready, Prometheus still
   Ready and still unexposed. Two leftovers are expected rather than
   automatic. The `grafana-tls` Secret survives in the `monitoring`
   namespace, because deleting the Ingress deletes the cert-manager
   Certificate that owns it but cert-manager does not delete the backing
   Secret unless `enableCertificateOwnerRef` is set; delete it by hand.
   Confirm the Grafana PVC went with the subchart. The `rauthy-tls`
   Secret needs no such step, since its whole namespace is removed.
3. **Prune the operator `.env`.** Dropping the two `GRAFANA_OIDC_*` keys
   from the catalog makes them unknown keys, so `npm run
   secrets:validate` now fails against the live operator file until those
   two lines are deleted from it. Confirmed by running it. The rauthy
   keys stay and must not be removed; 009 re-encrypts from them.
4. **Remove the `grafana.statecraft.ing` DNS record** at Cloudflare. It
   is out-of-band, like the firewall rules; nothing in this tree manages
   it.
5. **Re-add firewall rules 80/443** after any `hetzner-k3s create` rerun.

## 7. Out of scope

- **The control plane deployment itself.** Spec 009 targets this cluster;
  this spec stops at the substrate beneath it. That now includes the
  embedded rauthy's secret delivery, its ingress, and the `auth.<DOMAIN>`
  question (§2.1).
- **The admin dashboard.** `frontend-admin` is an in-container surface
  arriving with the substrate rewrite (thesis §3.4); the cluster provides
  it nothing but a metrics sink it may or may not read.
- **Alerting policy.** A later spec, not a chart default.
- **Secrets at rest inside the control plane.** The control plane stores
  no secret at rest: every CoreLedger entity was inspected and none holds
  a credential, and `refresh_token` stores a hash it compares rather than
  reads back. This is by design, because spec 004's GitHub App flow mints
  short-lived installation tokens instead of storing customer
  credentials, which is why OAP's `PAT_ENCRYPTION_KEY` has no successor.

  **The decision is conditional on App reach.** It holds only while the
  installation token can do everything the console must do, including
  scheduling and dispatching Actions runs. Those are App permissions, so
  the condition is satisfiable by widening the App's permission set, which
  the installation flow re-consents. If a console verb turns out to need a
  user-supplied credential, this reopens and the crypto service becomes
  real work; verifying the App's permission set covers the console's verbs
  is a spec 004 gate on that claim, not an assumption to carry silently.
  Should a consumer appear, the mechanism is `cryptr`
  (ChaCha20Poly1305, the source of the `ENC_KEYS` convention rauthy
  already uses), specced then, against a real caller.
- Non-hetzner targets, and multi-cluster or HA topologies.
- Re-homing the marketing site: the apex stays GitHub Pages.
