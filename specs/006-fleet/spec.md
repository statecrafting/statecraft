---
id: "006-fleet"
title: "Fleet: deployd's core as an in-process addon, placing EnRaHiTu apps"
status: approved
created: "2026-07-14"
implementation: pending
depends_on:
  - "005-factory-service"
establishes:
  - { kind: directory, path: "fleet/" }
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

## 1. Harvest source (requires operator-granted read access)

The orchestration core is harvested, not reinvented, from the OAP
archive: `~/Dev2/open-agentic-platform/platform/services/deployd-api-rs`
(Rust, axum + hiqlite + kube). The implementing session needs that path
readable (`claude --add-dir ~/Dev2/open-agentic-platform`); if access
is missing, stop and report. Harvest the K8s resource construction
(Deployment/StatefulSet, PVC, Service, Ingress), rollout waiting, and
status readers; leave behind the axum layer, its auth (M2M tokens), and
its standalone hiqlite state (job state moves to CoreLedger here).

## 2. Territory

- `addon/fleet-native/`: napi-rs cdylib crate `fleet-native` (own
  Cargo.toml with the spec-spine manifest key pointing here; add to
  `spec-spine.toml` standalone lists). Exposes async fns:
  `placeApp(spec)`, `appStatus(name, ns)`, `updateApp(spec)`,
  `backupApp(name, ns, target)`, `removeApp(name, ns)`; all take/return
  JSON-serializable plain objects; kubeconfig path or in-cluster config
  resolved Rust-side.
- `fleet/`: Encore.ts service: entities `FleetApp` (id, tenantId,
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
  Ingress (host `<app>.<FLEET_BASE_DOMAIN>`, TLS via the cluster's
  existing issuer), one Namespace per tenant (`t-<tenantId>`), baseline
  NetworkPolicy deny + allow-ingress-controller.
- **Image source** v1: a registry reference supplied in the deploy
  request (the image-publish pipeline is a later spec; for the ten-app
  milestone, images are pushed manually or by enrahitu's image
  workflow). Record the exact ref on FleetApp.
- **Update** = image ref change, Recreate rollout, wait for ready, or
  mark failed with the rollout error.
- **Backup** v1: snapshot the volume by exec-ing a tar of /data to a
  restic/rclone target if configured, else scale-down + PVC clone;
  choose ONE mechanism, document it in this spec via amendment before
  implementing, and record the artifact location on FleetOp. (The
  choice needs cluster facts the implementing session must check:
  CSI snapshot support on the hetzner-k3s storage class.)
- **Destructive guards**: removeApp requires the literal app name
  echoed in the request body (`confirm: "<name>"`); every mutating verb
  writes a FleetOp row first (intent journal) and updates it on
  completion. When spec 008 lands, gate remove/update through
  action-gate and record ops to the attestation ledger (soft
  dependency, same pattern as spec 005 §3.3).
- Operator prerequisites: the cluster credentials exist at the central
  infra config: kubeconfig at `~/.config/oap/infra/hetzner/kubeconfig`
  (mode 0600) and cluster env at `~/.config/oap/infra/hetzner/.env`
  (HCLOUD_TOKEN, DOMAIN, CLOUDFLARE_DNS_API_TOKEN, LETSENCRYPT_EMAIL
  among others; read key names, never echo values). v1 may use this
  admin kubeconfig directly; graduating to a dedicated ServiceAccount
  (namespace-create + workload rights only) is a required follow-up
  before any non-operator touches the fleet. `FLEET_BASE_DOMAIN` and
  the TLS issuer name still need choosing: stop and report if unset.

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

## 5. Out of scope

- Autoscaling, multi-replica, multi-cluster, non-K8s targets.
- Image building/publishing pipeline (later spec).
- Turso credential provisioning for tenant apps (later spec, pairs
  with the paid durability tier).
