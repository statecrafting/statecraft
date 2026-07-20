---
id: "006-fleet"
title: "Fleet: deployd's core as an in-process addon, placing EnRaHiTu apps"
status: approved
created: "2026-07-14"
implementation: complete
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
    control: protect `FLEET_S3_RESTIC_PASSWORD`.

    **Renamed 2026-07-20 (from `RESTIC_PASSWORD`).** Spec 009 §4.3 rule 2
    proposed backing the control plane's own `/data` volume up by reusing
    this credential. That was rejected: it would encrypt the platform's
    unreconstructible identity plane (both signing keypairs, the OIDC
    client secret, rauthy's whole user database) under the same repository
    password as tenant data, and hand any holder of a tenant-scope
    credential the platform's identity backup. The platform got its own
    `PLATFORM_S3_*` group instead, and the unqualified name could no
    longer tell the two backup domains apart. Historical entries below
    keep the old spelling, since they record what was true when written.

    The rename is inbound only. `addon/fleet-native` still passes the
    value into the backup Job as restic's own `RESTIC_PASSWORD` env var,
    which is restic's CLI contract and is deliberately untouched.
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
    zone in the same account as `statecraft.ing`). TLS issuer =
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
    `oap-bootstrap` keeps working under the statecraft paradigm.

## 4. Acceptance

- Rust: fleet-native unit tests against a kind/k3d cluster in CI are
  ideal but optional v1; minimum is `cargo test` for resource-shape
  construction (golden YAML/JSON) without a live cluster.
- E2E (manual, documented): deploy one stamped app image to the real
  cluster; it serves /health through its Ingress; update to a new tag;
  backup produces an artifact; remove tears everything down.
- Scale check for M3 (milestone validation, capacity-gated): ten apps
  placed on the cluster without manual kubectl; status endpoint accurate
  for all ten. Deferred to M3 with dedicated capacity + per-app resource
  limits (see the 2026-07-16 live-E2E note); the single-app E2E already
  exercised placement + status accuracy end to end.
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
  secret key and a `FLEET_S3_RESTIC_PASSWORD`, and a real stamped image ref
  (§4 E2E).
- **Scale check** (ten apps on one box) (§4 scale check).
- A dedicated fleet ServiceAccount (namespace-create + workload rights only)
  before any non-operator touches the fleet (§3 operator prerequisites).

Flip to `implementation: complete` once the live E2E holds.

### Live E2E attempt 2026-07-15 (first real deploy on hetzner-k3s)

Driven from the local control plane against the live cluster. **Placement is
proven**: `placeApp` created the full shape live: the Namespace, the Deployment
(Recreate, 1 replica), the PVC Bound to a real hcloud block volume (RWO), the
ClusterIP Service on the container's http port, and the nginx Ingress at
`<app>.deployd.xyz` carrying the cert-manager DNS-01 ClusterIssuer annotation.
Four issues surfaced; the first is fixed here, the rest are tracked:

1. **Gate-actor bug (fixed in this change).** Fleet is the first
   `POST /governance/gate` consumer and its calls omitted the actor, so the
   gate's `actor-authenticated` check denied every gated verb. `gateOrDeny`
   now attaches `actor` + `authenticated: true` from the request auth context;
   verified live (the deploy passed the gate after the fix).
2. **Pull-secret provisioning (fixed 2026-07-16).** The deploy set no
   `imagePullSecret` and the API exposed none, so a private image could not be
   pulled without an operator-provisioned namespace secret + SA patch. Fixed:
   see the 2026-07-16 note.
3. **`runAsNonRoot` without `runAsUser`/`fsGroup` (fixed 2026-07-16).** The
   hardened container securityContext forbade root but set no `runAsUser`;
   enrahitu images declare no `USER` (root). Setting `runAsUser`/`fsGroup` on
   the pod let the container start. Fixed: see the 2026-07-16 note.
4. **No deployable amd64 enrahitu image (open).** No published enrahitu image
   exists (enrahitu's image workflow never pushes); the GHCR stamped-app images
   are non-chassis Encore apps that crash without SQL config. Blocked on an
   amd64 enrahitu image (still open after enrahitu v0.2.0; see the 2026-07-16
   note for why v0.2.0 did not resolve it).

Full deploy -> `/health` -> update -> backup -> remove + the scale check still
need a real image and the ingress/domain/backup-secret prerequisites; this spec
stays `in-progress`. See the 2026-07-16 note.

### 2026-07-16: code fixes #2/#3 landed; live E2E still blocked on external state

The two code-level findings are fixed and all gates are green (`cargo test` 12,
`build:addon`, typecheck, `build:app`, vitest 111, spine compile/index/lint/index
check):

- **#2 pull-secret** is now plumbed end to end. `FLEET_IMAGE_PULL_SECRET` (a
  non-secret env: the name of a `dockerconfigjson` Secret the operator creates
  in the app namespace) is read in `backend/fleet/config.ts` and set as
  `imagePullSecret` on the `placeApp`/`updateApp` spec in `api.ts` (omitted when
  empty). The addon already wired `image_pull_secret` onto the pod's
  `imagePullSecrets`. Provisioning the Secret in the namespace stays an operator
  step (§3 operator prerequisites).
- **#3 runAsNonRoot start** is fixed in `addon/fleet-native/src/resources.rs`.
  The container now runs as UID/GID 1000 (the `node:24-slim` `node` user) with a
  pod-level `fsGroup: 1000` so the RWO PVC at `/data` is writable, the exact
  direction the 2026-07-15 E2E verified. Golden `cargo test` asserts the
  securityContext (12 tests).

Nothing in statecraft's own territory now blocks acceptance. What remains is
external and outside spec 006 (§5):

1. **A pullable amd64 enrahitu image (finding #4 stands).** enrahitu v0.2.0
   published only the npm toolchain (`publish.yml`). Its `image.yml` builds and
   smokes a native amd64 image but never pushes it (it runs on
   `workflow_dispatch`/weekly, with no registry login or `docker push`), so no
   deployable image exists. Publishing one is enrahitu's image pipeline (a later
   spec), not statecraft's.
2. **An ingress entrypoint.** ingress-nginx on the cluster is ClusterIP, not
   hostNetwork, so `*.deployd.xyz` has no external target; a hostNetwork ingress
   DaemonSet plus the Cloudflare `*.deployd.xyz` record are needed before
   `/health` is reachable through the Ingress.
3. **Domain + backup secrets in the infra `.env`.** `FLEET_BASE_DOMAIN`,
   `FLEET_S3_ACCESS_KEY_ID`, and `FLEET_S3_SECRET_ACCESS_KEY` (plus the
   `.env.example` + `oap-bootstrap` reconciliation) are still unprovisioned.

The live E2E (deploy -> `/health` -> update -> backup -> remove) and the ten-app
scale check need all three. §4 acceptance is a live-cluster gate, not a code
gate. (Resolved the same day; see the note below.)

### 2026-07-16 (later): live E2E passed on deployd.xyz; 006 complete

All three prerequisites were cleared and the single-app E2E ran green against the
real hetzner-k3s cluster, driven through the fleet-native addon:

- **Entrypoint + DNS + TLS.** The ingress-nginx DaemonSet already binds worker1's
  hostPort 80/443, so no cluster rebuild was needed; a `*.deployd.xyz` A record
  to worker1 was added, and a `deployd.xyz` DNS-01 solver was appended to the
  `letsencrypt-prod-dns01-cloudflare` ClusterIssuer (additive; the platform's
  `tenants.statecraft.ing` solver untouched).
- **Secrets.** `FLEET_S3_*` + `RESTIC_PASSWORD` were already in the infra `.env`;
  `FLEET_BASE_DOMAIN=deployd.xyz` was added.
- **Image.** Pulled the private `ghcr.io/statecrafting/enrahitu` (enrahitu #19).

E2E result at `e2e.deployd.xyz`: **deploy** placed the full shape, the pod ran as
non-root (UID/GID 1000, finding #3) after pulling the private image (finding #2),
and `GET https://e2e.deployd.xyz/health` returned `200 {"status":"ok"}` behind a
**valid Let's Encrypt certificate**; **update** did a Recreate rollout to a new
tag (200); **backup** ran the scale-down restic Job to Hetzner Object Storage
(Job Complete, artifact recorded) and scaled back to 1/1; **remove** tore the app
resources down (health -> 503). The platform (issuer, ingress, its certs) stayed
healthy throughout.

The **ten-app scale check is deferred to the M3 milestone** (its own §4 label): on
this shared 1-worker cluster, and with the Deployment setting no per-app resource
requests/limits, ten heavy rauthy+app+hiqlite pods would risk OOM pressure on the
production platform pods. It needs dedicated capacity + per-app limits, so it runs
as the M3 "fleet of ten" validation, not a 006 code gate. Residuals for that work:
per-app resource limits; a production image-pull-secret story (the cluster's
reflector-synced `ghcr-pull` carries bot creds without access to the private
image, so the E2E used a dedicated secret, or publish the image public); and
`ENRAHITU_PUBLIC_URL` injection (the fleet injects only `PORT`, fine for `/health`
but full auth flows need the public URL). With the single-app E2E holding, 006 is
`complete`.

## 5. Out of scope

- Autoscaling, multi-replica, multi-cluster, non-K8s targets.
- Image building/publishing pipeline (later spec).
- Turso credential provisioning for tenant apps (later spec, pairs
  with the paid durability tier).
