---
id: "001-statecraft-thesis"
title: "statecraft: the governed agentic delivery control plane"
status: approved
created: "2026-07-14"
implementation: pending
depends_on:
  - "000-bootstrap"
establishes:
  - "README.md"
summary: >
  The product thesis and the consolidation record. statecraft is the
  control plane for governed AI-native software delivery: intent becomes a
  governed spec, the factory stamps an application from the EnRaHiTu
  template, the fleet operates the resulting hermetic containers, and the
  customer's code lives in the customer's GitHub org the entire time.
  statecraft is itself the first production EnRaHiTu app: one container,
  embedded rauthy as the platform IdP, hiqlite in-process, CoreLedger for
  durable state (on Postgres via enrahitu spec 011). This spec records
  what consolidates here from the OAP era and the milestone ladder that
  orders the build.
---

# 001: statecraft thesis

## 1. Purpose

statecraft sells one loop: **intent -> governed spec -> factory-stamped
app -> hermetic container -> operated fleet**, with code sovereignty (the
customer's repos, in the customer's GitHub org) as a first-class property,
not a concession. The control plane charges for seats and per-app backend
hosting; the EnRaHiTu single-container shape (one image + one volume, no
managed Postgres/Redis/Auth0 in COGS) is the unit-economics weapon, and
Turso replica sync is the natural paid durability tier.

Provenance: this repo consolidates the Open Agentic Platform research era.
The OAP monorepo (224 specs) is the design archive; designs lifted from it
are cited as knowledge://open-agentic-platform/... links rather than
migrated wholesale. The consolidation decision is dated 2026-07-14.

## 2. What consolidates here

| Predecessor | Fate here |
|---|---|
| `platform/services/statecraft` (Encore.ts SaaS, OAP) | Rebuilt as the control plane services on the EnRaHiTu substrate |
| `deployd-api-rs` (axum + hiqlite K8s orchestrator, OAP) | Orchestration core becomes `addon/fleet-native` (napi-rs, in-process); the axum HTTP layer disappears |
| `factory-encore` (repo stamping) | Absorbed as the `factory/` service, consuming enrahitu's versioned template contract (enrahitu spec 009) |
| OPC (Tauri desktop cockpit, OAP) | Retired as a desktop app; governance verbs move to the statecraft-cli repo (CLI + MCP server) |
| `template-encore` (previous chassis) | Retired after absorption into enrahitu (enrahitu spec 010) |

## 3. Architecture

statecraft is the first production EnRaHiTu app, deliberately: every fleet
operation sold to customers is rehearsed on the platform itself first.

- **One container.** The control plane ships in the EnRaHiTu
  single-container shape: embedded rauthy is the platform IdP, hiqlite
  runs in-process (cache, rate limits), CoreLedger owns durable state.
- **CoreLedger on Postgres** (enrahitu spec 011). The control plane
  carries webhook bursts, audit writes, and multi-tenant state, so it
  runs the Postgres driver on the existing K8s cluster while stamped
  customer apps run libSQL/Turso. Same decorator API; the driver-swap
  scaling thesis is validated on ourselves. The hermetic
  one-container-one-volume claim belongs to stamped apps; the control
  plane is allowed to be a platform-grade K8s deployment.
- **Governance UI in the frontend slot**, built with Vite + React Router
  v7 (the platform is not a template; it owes nothing to template
  frontend flavors).
- **Fleet v1 targets the existing hetzner-k3s cluster** via the deployd
  orchestration core; the abstraction is "place an EnRaHiTu container +
  volume + ingress", which deployd already almost speaks. No raw-docker
  rebuild.

### Service map

```
addon/     fleet-native (deployd core, napi-rs) + hiqlite-native (from the chassis)
core/      CoreLedger (chassis) + the Postgres driver (enrahitu spec 011)
auth/ idp/ the EnRaHiTu auth baseline, platform-tenant flavored
tenants/   GitHub App installations, workspaces, invites
factory/   stamping service; reads template.toml (enrahitu spec 009) and nothing else
fleet/     deploy / update / backup orchestration over fleet-native
frontend/  governance UI (Vite + React Router v7)
```

Each service graduates into its own numbered spec when its build starts;
this thesis holds the map until then.

## 4. Tenancy

Per-customer GitHub App installation (the Vercel/Renovate pattern): the
user logs in via OAuth, creates a tenant, installs the statecraft GitHub
App into their own org, and everything keys off `installation_id`. Nobody
joins our org; stamped repos are born in the customer's org. Code
sovereignty is a selling point, not a limitation.

## 5. Licensing

AGPL-3.0 for this repo: the SaaS shield (hosting a modified control plane
commercially requires publishing the modifications) while keeping the
free self-hosted single-tenant tier real. The artifacts customers touch
stay permissive: the enrahitu template is Apache-2.0 (stamped apps copy
template code and must be unencumbered) and statecraft-cli is Apache-2.0
(the funnel and the MCP bridge). No open-core split is pre-built; a
closed sliver gets carved out only when something is genuinely worth
closing.

## 6. Milestone ladder

Each milestone falsifies a hypothesis before the next spends effort:

- **M1: template contract.** enrahitu publishes template.toml (enrahitu
  spec 009, v0 landed 2026-07-14); the factory consumes only it.
- **M2: stranger onboarding.** A person who has never seen the system
  goes from login to a running stamped app in 15 minutes (tenants/ +
  factory/ + GitHub App flow).
- **M3: fleet of ten.** Ten stamped apps operated on one box (fleet/ +
  fleet-native), with update and backup verbs exercised.
- **M4: the agent bridge.** statecraft-cli's MCP server lets an agent
  request approvals, check coupling, and trigger factory stages under
  governance.
- **M5: three paying agencies.** The verdict. Everything before M5 is
  preparation.

## 7. Out of scope

- Migrating the OAP spec corpus (harvest with provenance links only).
- Template authoring and the template contract (enrahitu repo).
- CLI/MCP implementation (statecraft-cli repo).
- Multi-cloud fleet targets; v1 is the existing hetzner-k3s posture.
