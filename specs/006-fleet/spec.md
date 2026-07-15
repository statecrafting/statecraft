---
id: "006-fleet"
title: "Fleet: deployd's core as an in-process addon, placing EnRaHiTu apps"
status: approved
created: "2026-07-14"
implementation: in-progress
depends_on:
  - "005-factory-service"
establishes:
  - { kind: directory, path: "backend/fleet/" }
  - { kind: directory, path: "addon/fleet-native/" }
summary: >
  Milestone M3: operate stamped apps. The unit of placement is "one
  EnRaHiTu container + one volume + one ingress" on the existing
  hetzner-k3s cluster. deployd-api-rs (the OAP-era Rust K8s
  orchestrator, axum + hiqlite) donates its orchestration core as a
  napi-rs addon (the hiqlite-native pattern): the axum HTTP layer
  disappears, the K8s knowledge stays. A fleet/ Encore service exposes
  deploy / status / update / backup over the addon. Done-when is a
  fleet of ten stamped apps on one box with update and backup
  exercised.
---

# 006: Fleet

## 1. Source of the K8s knowledge (reference, not a port)

The OAP archive `~/Dev2/open-agentic-platform` (readable; if missing,
stop and report) was expected to donate a Rust `kube-rs` orchestration
core. It does not have one (verified 2026-07-15): `deployd-api-rs/src/
k8s.rs` is only a cluster-reachability probe, its deploy/rollout/status
engine shells out to the `helm` CLI (`helm.rs`), and the sole `kube-rs`
`Api<T>` code in the crate is `rbac.rs` (Namespace + RoleBinding). The
actual resource shapes live as Helm chart YAML (`platform/charts/
acme-vue-encore/templates/*.yaml`).

So `addon/fleet-native` is a native `kube-rs` implementation informed by
that source, not a port of it (Option A, decided 2026-07-15):

- **Reuse the patterns** from `deployd-api-rs/src/rbac.rs`:
  `kube::Client::try_default()` client resolution, the
  create-or-tolerate-409 idempotency idiom, and `is_valid_tenant_
  namespace` (DNS-1123 + reserved-namespace blocklist).
- **Reuse the shapes** from the `acme-vue-encore` chart templates and
  `helm.rs::build_values` (artifact-ref splitting, env, probes,
  ingress/TLS wiring) as the field reference for the resources fleet
  builds.
- **Write fresh** what deployd delegated to `helm --wait`: rollout
  waiting and status reading against `Deployment.status` via `kube-rs`.
- Leave behind the axum layer, its auth (M2M tokens), and its standalone
  hiqlite state (job state lives in CoreLedger here).

Fleet's placement shape (§3) is a minimal, stateful single-container
form distinct from that full tenant-app chart; it is authored here, not
lifted.

## 2. Territory

- `addon/fleet-native/`: napi-rs cdylib crate `fleet-native` (own
  Cargo.toml with the spec-spine manifest key pointing here; add to
  `spec-spine.toml` standalone lists). Exposes async fns:
  `placeApp(spec)`, `appStatus(name, ns)`, `updateApp(spec)`,
  `backupApp(name, ns, target)`, `removeApp(name, ns)`; all take/return
  JSON-serializable plain objects; kubeconfig path or in-cluster config
  resolved Rust-side.
- `backend/fleet/`: Encore.ts service (services live under `backend/`,
  the convention 002 established and 004/005/008 follow): entities
  `FleetApp` (id, tenantId,
  stampJobId?, name, namespace, image, volumeSize, host, status
  placing|running|updating|failed|removed, createdAt, updatedAt) and
  `FleetOp` (id, appId, kind deploy|update|backup|remove, status,
  log?, createdAt); endpoints POST /tenants/:id/fleet (deploy),
  GET /fleet/:appId (status refreshed via addon), POST /fleet/:appId/update,
  POST /fleet/:appId/backup, DELETE /fleet/:appId.

## 3. Behavior

- **Placement shape** per app: one Deployment (single replica; the
  EnRaHiTu container is stateful via its volume: Recreate strategy, not
  RollingUpdate), one PVC (default 1Gi), one ClusterIP Service, one
  Ingress (ingressClassName `nginx`, host `<app>.<FLEET_BASE_DOMAIN>`,
  TLS via the cert-manager ClusterIssuer
  `letsencrypt-prod-dns01-cloudflare` (DNS-01)), one Namespace per
  tenant (`t-<tenantId>`), baseline NetworkPolicy deny +
  allow-ingress-controller.
- **Image source** v1: a registry reference supplied in the deploy
  request (the image-publish pipeline is a later spec; for the ten-app
  milestone, images are pushed manually or by enrahitu's image
  workflow). Record the exact ref on FleetApp.
- **Update** = image ref change, Recreate rollout, wait for ready, or
  mark failed with the rollout error.
- **Backup** v1 (mechanism chosen 2026-07-15; the cluster facts below
  were verified against the live hetzner-k3s cluster): a per-app
  **scale-down + ephemeral restic Job**, recorded on FleetOp.
  - **Mechanism.** `hcloud-volumes` is ReadWriteOnce single-attach, so
    a backup Job cannot mount the app's PVC while the app pod holds it.
    `backupApp` scales the Deployment to 0, runs a short Job that mounts
    the freed PVC and `restic backup /data` to the target, then scales
    back to 1. Record the restic snapshot id + repo path on FleetOp.
  - **Consistency.** Scaling to 0 sends SIGTERM; the EnRaHiTu container
    shuts down gracefully (flushing and closing its embedded libSQL /
    WAL), so the Job reads a quiesced volume: a clean-shutdown-consistent
    backup. The brief downtime (tens of seconds at current data sizes)
    buys correctness; a live crash-consistent copy can need WAL recovery
    on restore.
  - **Destination.** Hetzner Object Storage (S3-compatible), endpoint
    `https://nbg1.your-objectstorage.com`, bucket `oap-fleet-backups-prod`
    (eu-central), path scheme `<namespace>/<app>`, matching the existing
    `oap-deployd-backups-prod` convention. Off-cluster and in a different
    failure domain than the app's block volume; in-cluster MinIO was
    rejected for sharing the failure domain it must survive. The Hetzner
    S3 credential is project-scoped (valid for every bucket in the
    project), so restic client-side encryption is the real at-rest
    control: protect `RESTIC_PASSWORD`.
  - **v2 (no-downtime) is not a config flag.** CSI VolumeSnapshot is
    unavailable here (the hcloud-csi-controller runs no csi-snapshotter
    sidecar, no VolumeSnapshotClass CRDs exist, and Hetzner block volumes
    expose no snapshot/clone API primitive), so "PVC clone" is not a
    cheap follow-up. A real no-downtime path needs a snapshot-capable
    storage layer (Longhorn / OpenEBS) or an app-level online export (the
    EnRaHiTu app's own libSQL / Turso backup): a storage-architecture
    decision for a later spec.
- **Destructive guards**: removeApp requires the literal app name
  echoed in the request body (`confirm: "<name>"`); every mutating verb
  writes a FleetOp row first (intent journal) and updates it on
  completion. When spec 008 lands, gate remove/update through
  action-gate and record ops to the attestation ledger (soft
  dependency, same pattern as spec 005 §3.3).
- Operator prerequisites (verified against the live cluster 2026-07-15):
  - Cluster credentials at the central infra config: kubeconfig at
    `~/.config/oap/infra/hetzner/kubeconfig` (mode 0600) and cluster env
    at `~/.config/oap/infra/hetzner/.env` (HCLOUD_TOKEN, DOMAIN,
    CLOUDFLARE_DNS_API_TOKEN, LETSENCRYPT_EMAIL among others; read key
    names, never echo values). v1 may use this admin kubeconfig
    directly; graduating to a dedicated ServiceAccount (namespace-create
    + workload rights only) is a required follow-up before any
    non-operator touches the fleet.
  - **Domain / TLS.** `FLEET_BASE_DOMAIN` = `deployd.xyz` (a Cloudflare
    zone in the same account as `stagecraft.ing`). TLS issuer =
    `letsencrypt-prod-dns01-cloudflare`; ingress class `nginx`. Before
    live E2E: create `*.deployd.xyz` in Cloudflare pointing at the
    ingress entrypoint (a hostNetwork ingress-nginx DaemonSet on a
    cluster node, fronted by Cloudflare proxy) and confirm the
    `CLOUDFLARE_DNS_API_TOKEN` covers the zone.
  - **Backup secrets** (bucket `oap-fleet-backups-prod` + S3 credential
    `fleet-backups-prod` provisioned 2026-07-15): `RESTIC_PASSWORD`
    (`openssl rand -base64 32`), the Hetzner Object Storage S3
    access-key-id + secret-access-key, and endpoint
    `https://nbg1.your-objectstorage.com`. These plus `FLEET_BASE_DOMAIN`
    are not yet in the infra `.env`; adding them there and to the OAP
    `platform/infra/hetzner/.env.example` is a follow-up so
    `oap-bootstrap` keeps working under the stagecraft paradigm.

## 4. Acceptance

- Rust: fleet-native unit tests against a kind/k3d cluster in CI are
  ideal but optional v1; minimum is `cargo test` for resource-shape
  construction (golden YAML/JSON) without a live cluster.
- E2E (manual, documented): deploy one stamped app image to the real
  cluster; it serves /health through its Ingress; update to a new tag;
  backup produces an artifact; remove tears everything down.
- Scale check for M3: ten apps placed on the cluster without manual
  kubectl; status endpoint accurate for all ten.
- Spine gates + verify verb green.

## Status (2026-07-15)

Implemented and green at the code level; kept `implementation: in-progress`
until the live E2E acceptance holds (it needs external state this session
cannot provide).

Done:

- `addon/fleet-native`: native `kube-rs` builders for the placement shape plus
  deploy / status / update / backup / remove; golden `cargo test` (11) green;
  the node-feature build links and the addon loads in-process.
- `backend/fleet`: the Encore service (FleetApp / FleetOp entities, the intent
  journal, the action-gate soft hook as the first `POST /governance/gate`
  consumer, the five verbs plus list); typecheck, `build:app`, and vitest
  green.
- Spine gates (compile / index / lint / index check) green.

Deferred (external state), keeping this spec in-progress:

- **Live E2E** (deploy a real image, serve `/health` through the Ingress,
  update, produce a backup artifact, remove): needs cluster access,
  `*.deployd.xyz` DNS with the Cloudflare token covering the zone, the fleet S3
  secret key and a `RESTIC_PASSWORD`, and a real stamped image ref (§4 E2E).
- **Scale check** (ten apps on one box) (§4 scale check).
- A dedicated fleet ServiceAccount (namespace-create + workload rights only)
  before any non-operator touches the fleet (§3 operator prerequisites).

Flip to `implementation: complete` once the live E2E holds.

## 5. Out of scope

- Autoscaling, multi-replica, multi-cluster, non-K8s targets.
- Image building/publishing pipeline (later spec).
- Turso credential provisioning for tenant apps (later spec, pairs
  with the paid durability tier).
