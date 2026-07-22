---
id: "012-frontend-admin-adoption"
title: "frontend-admin adoption: the platform operator dashboard"
status: approved
created: "2026-07-21"
implementation: pending
depends_on:
  - "001-statecraft-thesis"
  - "002-app-shell"
  - "009-control-plane-deploy"
  - "011-tenant-lifecycle"
establishes:
  - { kind: directory, path: "frontend-admin/" }
summary: >
  statecraft adopts the substrate's flag-gated admin dashboard
  (enrahitu specs 022/023: the observability contract and
  frontend-admin) as the platform operator dashboard promised by
  thesis section 3.4: same-origin, gated on statecraft_operator,
  rendering the platform's own /metrics, traces, service catalog, and
  app model. This is the piece specs 001 and 010 already committed to
  ("platform observability is the in-substrate flag-gated admin
  dashboard"; cluster Grafana was dropped on that promise), landing as
  a chassis capability consumed here, not as platform-original code.
  The domain operator console (all-tenants, spec 011) stays in
  frontend/; frontend-admin is the substrate observability surface.
  The platform's /metrics becomes the scrape target for spec 010's
  in-cluster Prometheus and must not be exposed at the public ingress.
---

# 012: frontend-admin adoption

## 1. Purpose

Thesis §3.4 retired the idea of a platform-external observability
stack: no Grafana OIDC client, no standalone monitoring identity;
"platform observability is the in-substrate admin dashboard". Spec 010
already cashed that promise by dropping cluster Grafana and demoting
Prometheus to an unexposed in-cluster metrics sink with, so far,
nothing to scrape. This spec is where the promise lands: the chassis
grows the dashboard (enrahitu 022/023), and statecraft, as the first
production EnRaHiTu app, turns it on, gates it on
`statecraft_operator`, and points Prometheus at its own `/metrics`.

The boundary with spec 011 is deliberate: frontend-admin is the
substrate surface (what every governed cell gets: metrics, traces,
catalog, app model), while the tenants console is platform domain UI
and lives in `frontend/` under spec 011. Nothing statecraft-specific
is forked into the chassis dashboard.

## 2. Cross-repo dependency

This spec cannot start until, in the enrahitu repo:

- **enrahitu 022 (observability contract)** has landed: `/metrics`
  and OTel tracing with the in-app trace buffer, `app-model.json`
  reporting `observability.otel: true`.
- **enrahitu 023 (frontend-admin)** has landed: the dashboard app,
  its same-origin admin API, the operator-role gate, and the
  template contract bump that names the flag.
- The updated chassis is published/consumable the way spec 002
  imported it (chassis import plus pinned `@statecrafting/*`
  packages; the statecrafting 002/003 repoints should be complete so
  no `@enrahitu/*` names re-enter this tree).

If any of these are missing when a session picks this spec up: stop
and report exactly what is needed; do not mock the dashboard or
hand-roll metrics endpoints here.

## 3. Territory

- `frontend-admin/` (new top-level directory): the platform's copy of
  the chassis admin dashboard, on the same import discipline spec 002
  used for `backend/` + `frontend/` (imported, then owned here).
- Coordinated edits in other specs' territory, each paired with a
  dated pointer amendment: spec 002's chassis plumbing (build wiring,
  admin service enablement), spec 009's deploy env (flag + any new
  non-secret env), spec 010's `infra/` (ingress exclusion for
  `/metrics` and `/admin`, Prometheus scrape config).

## 4. Behavior

- **Adopt, do not fork.** The dashboard arrives from the chassis at a
  pinned enrahitu commit (recorded in this spec when taken), with the
  platform's identity: gated on `statecraft_operator` (the
  `<app>_operator` convention instantiated), branded neutrally as
  shipped by the template.
- **Flag on.** The platform enables the admin surface via the
  mechanism enrahitu 023 defines (stamp-time slot + runtime env);
  statecraft runs with it on in production, since the operator
  dashboard is the platform's own observability.
- **Observability live.** `/metrics` serves the platform's Prometheus
  metrics; OTel tracing is on with the in-app buffer feeding the
  traces surface. Spec 010's Prometheus scrapes the platform Service
  on `/metrics`; the public ingress must not route `/metrics`, and
  `/admin` is reachable only through the app with an authenticated
  operator session (server-side enforced).
- **Access.** Every admin API route and the dashboard itself return
  `permissionDenied` without `statecraft_operator`; `rauthy_admin`
  alone grants nothing here (role separation per thesis §3.3).

## 5. Acceptance

1. An operator (holder of `statecraft_operator`) opens the dashboard
   at the platform origin and sees live platform data: the service
   catalog, at least one real trace, and the app model surface.
2. A signed-in non-operator receives `permissionDenied` on the
   dashboard and on every admin API route; an unauthenticated request
   is redirected to login.
3. In-cluster Prometheus shows the platform target UP and platform
   metric families queryable; `curl https://app.statecraft.ing/metrics`
   from the public internet does not serve metrics.
4. `app-model.json` for the platform records the admin/observability
   posture truthfully (`observability.otel: true`, operator role
   `statecraft_operator`).
5. Gates green: spec-spine compile/index/lint/index check plus the
   chassis npm gates.

## 6. Out of scope

- Building dashboard surfaces themselves (enrahitu 023 owns the
  dashboard; defects and features go upstream).
- The tenants/operator domain console (spec 011).
- Per-tenant observability add-ons sold through the fleet (spec 006
  territory, later).
- Alerting and log aggregation.
