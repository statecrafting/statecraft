---
id: "004-tenants-github-app"
title: "Tenants: OAuth login + per-org GitHub App installation"
status: approved
created: "2026-07-14"
implementation: pending
depends_on:
  - "002-app-shell"
  - "003-postgres-adoption"
establishes:
  - { kind: directory, path: "tenants/" }
summary: >
  The tenancy spine of milestone M2: a user authenticates against the
  control plane (embedded rauthy, chassis auth), creates a tenant, and
  installs the Stagecraft GitHub App into their own GitHub org; from
  then on everything the platform does for them keys off the
  installation_id and happens inside their org. Nobody joins our org;
  code sovereignty is the product's first-class property. This spec
  owns the tenants service: tenant + installation records on
  CoreLedger, the App installation handshake, webhook receipt, and an
  installation-token mint helper the factory (spec 005) consumes.
---

# 004: Tenants + GitHub App

## 1. Operator prerequisites (SATISFIED 2026-07-14: the App exists)

Use the existing GitHub App; do not create a new one:

- **"StageCraft.ing GitHub App"**: App ID `3319911`, slug
  `stagecraft-ing-github-app`, Client ID `Iv23liGNXeou5MxTTKxR`,
  public link `https://github.com/apps/stagecraft-ing-github-app`.
  Already installed org-wide on stagecraft-ing (installation id
  `125344051`, all repositories), which doubles as the test
  installation for e2e.
- Permissions are a superset of what this spec needs (read: issues,
  metadata, org administration, org plan, pull requests; read&write:
  actions, administration, checks, code, members, secrets,
  workflows). Request nothing new.
- **Credentials** live in the central infra config
  `~/.config/oap/infra/hetzner/.env`: `GITHUB_APP_ID`,
  `GITHUB_APP_PRIVATE_KEY_B64` (base64-encoded PEM: decode before
  signing App JWTs), `GITHUB_WEBHOOK_SECRET`. Wire them into Encore
  secrets for this app; never commit or echo values. Use
  `GITHUB_APP_SLUG=stagecraft-ing-github-app`.
- The App's webhook is active and points at the legacy plane
  (`https://stagecraft.ing/api/github/webhook`). For local dev,
  leave it; implement and unit-test HMAC verification regardless.
  Repointing the webhook to the new control plane happens when it has
  a public URL (fleet-deployed), not before.

## 2. Territory

`tenants/`: an Encore.ts service: `encore.service.ts`, api endpoints,
CoreLedger entities, github-app token helper, webhook endpoint.

## 3. Behavior

- **Entities** (CoreLedger decorators): `Tenant` (id, name, ownerUserId,
  createdAt), `Installation` (id, tenantId, githubOrg, installationId,
  status active|suspended|removed, createdAt, updatedAt). One tenant
  may hold multiple installations; an installation belongs to exactly
  one tenant.
- **API** (all under /api/v1, auth required via the chassis auth
  middleware; auth handler identity = the logged-in user):
  - `POST /tenants` create (name); creator becomes owner.
  - `GET /tenants` list mine; `GET /tenants/:id` detail incl.
    installations.
  - `GET /tenants/:id/github/install-url`: returns the App's
    installation URL (`https://github.com/apps/<slug>/installations/new`)
    with `state` set to a signed, short-lived token binding tenantId +
    userId (HMAC with the webhook secret is acceptable v1).
  - `GET /github/setup` (the App's Setup URL callback): verifies
    `state`, reads `installation_id` from the query, verifies via the
    App JWT that the installation exists and matches the org, persists
    the Installation, redirects to the webapp.
  - `GET /tenants/:id/repos`: lists repos visible to the installation
    (installation token, GET /installation/repositories).
- **Webhook** `POST /github/webhook` (no session auth; HMAC-verified
  with `GITHUB_WEBHOOK_SECRET`, constant-time compare): handle
  `installation` events (created/deleted/suspend/unsuspend) by
  upserting Installation status. Unknown events: 204, log, ignore.
- **Token helper** (internal, exported for factory): mint an App JWT
  (RS256, 10-min exp, iss = app id) and exchange for an installation
  access token (POST /app/installations/{id}/access_tokens), cached in
  hiqlite KV with TTL ~50 min (tokens live 60). No Octokit dependency
  required; plain fetch against api.github.com with
  `X-GitHub-Api-Version: 2022-11-28` is fine and keeps the surface
  auditable.
- Rate limiting on the public endpoints via the chassis lib/rate-limit.

## 4. Acceptance

- Unit: state-token round-trip, webhook HMAC verify (reject bad sig),
  entity persistence round-trips on Postgres.
- Manual e2e (document the click path in the PR/commit message): login,
  create tenant, install-url -> GitHub -> setup callback persists the
  installation, `GET /tenants/:id/repos` returns the org's repos.
- Spine gates + verify verb green.

## 5. Out of scope

- Invites/multi-user tenants and roles beyond owner (later spec).
- Repo creation and stamping (spec 005 consumes the token helper).
- Billing/seats.
