---
id: "009-control-plane-deploy"
title: "The control-plane deploy: one governed container on the statecraft cluster"
status: approved
created: "2026-07-16"
implementation: in-progress
depends_on:
  - "002-app-shell"
  - "008-governance-attestation"
  - "010-statecraft-cluster"
establishes:
  - ".github/workflows/image.yml"
  - ".dockerignore"
# Further ownership edges land with their units during implementation (owned
# paths and this spec move together): the manifest subtree
# infra/gitops/clusters/statecraft-hetzner/statecraft/ and its tier file arrive
# with the manifests in stage 2 (relocated from a top-level `deploy/` on
# 2026-07-20, see section 3), and .github/workflows/{cd,ai-pr-review,
# ai-changelog}.yml with theirs. The subtree is deliberately not declared while
# it does not exist: this spec is `in-progress`, so spec-spine enforces that a
# declared directory unit is a real directory (I-007).
summary: >
  Stand the control plane up on the spec 010 cluster as a platform-grade K8s
  deployment at app.statecraft.ing. Rewritten ground-up 2026-07-19 to the
  two-plane thesis (001 section 3), which unpauses it. The rewrite inverts the
  deploy's job: the published image is embedded-rauthy and self-seeds its own
  identity on first boot, so the shared-rauthy secret set is void, five of the
  eleven Encore secrets are discarded by the entrypoint if injected, and the
  /data volume becomes the identity anchor of the platform. What the deploy
  still owes the container: seven real secrets, the non-secret env, a Postgres
  URL, an ingress, and one seeder pass for the only thing first boot cannot
  seed (the upstream GitHub provider, which rauthy has no declarative
  bootstrap for). Operator surfaces gate on the custom statecraft_operator
  role, seeded here; rauthy_admin stays break-glass. Live bring-up is a human
  checkpoint.
---

# 009: The control-plane deploy

## 1. Purpose

The control plane has no deployment. Stage 1 (the image) landed 2026-07-16
and is cluster-independent; stage 2 stopped before a manifest was written and
was paused while the thesis was rewritten. This spec is that rewrite, and it
unpauses the work.

Under the two-plane model (001 section 3.1) the platform **is** one EnRaHiTu
app, and that changes what a deploy means. The previous version of this spec
deployed an application against platform services: a rauthy installed on the
cluster, key material minted by an operator and delivered through SOPS, a
seeder converging an OIDC client against a shared IdP. None of that survives.
The container carries its own IdP, mints its own signing keys, generates its
own client secret, and bootstraps its own admin. The deploy's job shrinks to
placing one container plus one volume plus one ingress, handing it the few
things it genuinely cannot mint for itself, and seeding the one thing its
first boot cannot reach.

This is the unit of placement the fleet sells (001 section 3.2), executed on
the platform first. The deploy that stands statecraft up is the same shape the
fleet will run for every tenant app, which is the point of being the first
production EnRaHiTu app.

**What still holds from the previous version.** The chosen public host is
`app.statecraft.ing`; the apex stays the GitHub Pages marketing site. The
control plane runs the Postgres driver against its own born-empty database
(spec 003, thesis section 3.2), not the fleet's per-app libSQL shape. The OAP
dependency is severed: the OAP build was a different application, its database
held research-era schema, and both went with the old cluster when spec 010
tore it down on 2026-07-17. Nothing is migrated.

## 2. What the realignment changes

The image is not a detail of this spec; it is the reason the spec inverts. All
of the following is verified against the published artifact
(`docker/Dockerfile`, `docker/entrypoint.sh`, `docker/first-boot.mjs`) and
against rauthy 0.36.0, the pinned upstream.

### 2.1 The image is embedded-rauthy and self-seeds

rauthy is not embeddable as a library (knowledge://grand-refactor/01-grounding-record
section 2): binary-only entrypoint, its hiqlite behind a private `OnceLock`,
and the published `rauthy-client` is a remote OIDC client rather than an embed.
"Embedded rauthy" therefore means a **peer process inside the container**, and
that is exactly what ships: the Dockerfile copies the `ghcr.io/sebadob/rauthy:0.36.0`
binary in beside the app, and the entrypoint runs it on loopback `127.0.0.1:8081`
with die-together supervision. It is reachable only through the app's own
`/auth/*` passthrough proxy (`backend/idp/proxy.ts`, spec 002, which owns
`backend/idp/` and brought the rauthy proxy in with the chassis).

`docker/first-boot.mjs` runs before either process and generates into the
`/data` volume. The first four rows below are written once and never
overwritten, so restarts and upgrades keep their identity:

| Material | Path under `/data` |
|---|---|
| Access + refresh RS256 keypairs | `keys/{access,refresh}-{private,public}.pem` |
| The rauthy OIDC client secret | `keys/rauthy-client-secret` |
| The rauthy bootstrap admin password | `rauthy/admin-password` |
| rauthy `ENC_KEYS` / `ENC_KEY_ACTIVE`, its hiqlite Raft + API secrets, and the app's own hiqlite secrets | `rauthy/secrets.env` |
| The declarative rauthy client bootstrap, redirect URIs derived from `ENRAHITU_PUBLIC_URL` | `rauthy/bootstrap/clients.json` |

The fifth row is the exception and it matters: `clients.json` is rewritten
unconditionally on **every** boot, with no existence guard. That is harmless
in itself, because rauthy only reads bootstrap data while its database is
uninitialized, but it produces a trap worth naming here rather than
discovering live. After a public-URL change the file on disk shows correct,
freshly derived redirect URIs while the client actually registered in rauthy
still carries the old ones, and nothing reconciles the two. The file is not
evidence of the running configuration. Section 4.3 rule 3 is the operational
consequence.

The container's only identity inputs are `ENRAHITU_PUBLIC_URL` and
`ENRAHITU_ADMIN_EMAIL`. Everything else about who it is, it decides for itself
on first contact with an empty volume.

### 2.2 Five of the eleven Encore secrets are discarded if injected

`infra.config.json` declares 11 Encore secrets, each `$env`-bound to an
identically named variable. The previous version of this spec concluded that
"the deploy's job is simply to put these 11 on the pod". That is now false for
five of them: the entrypoint **unconditionally exports them from `/data`**
immediately before starting the app, so anything the pod injected is
overwritten in the same shell.

**Discarded if injected** (self-generated, read from `/data/keys/`):
`JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `JWT_REFRESH_PRIVATE_KEY`,
`JWT_REFRESH_PUBLIC_KEY`, `RAUTHY_CLIENT_SECRET`.

**Genuinely required from the deploy** (nothing in the image can mint them):
`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_B64`, `GITHUB_WEBHOOK_SECRET`,
`FLEET_S3_RESTIC_PASSWORD`, `FLEET_S3_ACCESS_KEY_ID`,
`FLEET_S3_SECRET_ACCESS_KEY`, and `SMTP_PASSWORD`. (The restic key was
spelled `RESTIC_PASSWORD` until the 2026-07-20 credential split; see section
4.3 rule 2.)

**`SMTP_PASSWORD` joined that list on 2026-07-20**, when section 4.8 item 1
was closed by wiring rauthy's mail transport in the entrypoint. It is the
only secret among the five SMTP keys; the other four are non-secret and
travel as plain env (section 4.4). Before that change the embedded rauthy
kept rauthy's `smtp_url = 'localhost'` default, so every send failed and
password reset, email verification, and MFA recovery did not work.

The cluster Secret this deploy creates therefore carries **seven** keys, not
eleven. `infra.config.json` keeps all 11 declarations unchanged: Encore
requires every `secret()` a service calls to be defined, and the entrypoint is
what satisfies the five. The rule this spec adopts is that **injecting a
discarded secret is forbidden, not merely redundant**: a Secret key that the
container silently ignores reads as configured while having no effect, which
is the failure mode that produced the previous version's incorrect secret
list.

**A twelfth secret is declared and undeliverable.** `backend/governance/config.ts:51`
declares `secret("GovernanceAnchorKey")`, the Ed25519 anchor signing key of
spec 008's attestation chain. It appears in neither `infra.config.json` nor
the operator catalog, and it is spelled in PascalCase where the other eleven
are `SCREAMING_SNAKE_CASE`, so it has no `$env` binding and no delivery path.
It does not block boot today: Encore resolves secrets lazily at call time, and
nothing calls this one yet. It becomes a hard failure the moment spec 008's
anchor signing is exercised. Closing it means adding the mapping and the
catalog key; this spec records the gap and defers the fix to whichever of 008
or the substrate rewrite lights up the consumer, since inventing a delivery
path for an unused secret would be guessing at its custody.

**The prior "operator prerequisite" is void.** The previous version held that
the four `JWT_*` PEMs "exist in no `.env` and no cluster secret", must be
minted by `npm run generate-keys`, and must be delivered via SOPS or login
returns 500. Two corrections. They now exist in the operator `.env` as real
multi-line PEMs (verified), and more importantly delivering them would be a
no-op for the container, which mints its own. `npm run generate-keys` remains
a genuine prerequisite for a **local** run against a working tree (it writes
the gitignored `keys/`), and that is the only claim this spec makes for it.

### 2.3 The shared-rauthy secret set is void

Spec 010 section 2.1 retired the cluster rauthy and kept its key material,
stating that "every `RAUTHY_*` key the catalog declares is still required, now
by the embedded rauthy inside the control-plane container", and delegated
their delivery here. Delivery is this spec's, and this spec finds the premise
does not survive contact with the image: the embedded rauthy generates its own
`ENC_KEYS`, its own hiqlite Raft and API secrets, and its own bootstrap admin
password, and the entrypoint passes it a deliberately scoped environment that
includes none of the catalog's values.

Against the catalog, the embedded topology settles as follows.

- **Dead, self-generated in-container:** `RAUTHY_RAFT_SECRET`,
  `RAUTHY_API_SECRET`, `RAUTHY_ADMIN_PASSWORD`, `RAUTHY_ENC_KEY_ID`,
  `RAUTHY_ENC_KEY`, `HIQLITE_SECRET_RAFT`, `HIQLITE_SECRET_API`,
  `RAUTHY_CLIENT_SECRET`, and the four `JWT_*` PEMs.
- **Dead, fixed by the chassis:** `RAUTHY_CLIENT_ID`. The entrypoint hardcodes
  the client id `enrahitu`; the catalog key cannot change it.
- **Dead, never wired into the image:** `RAUTHY_S3_ACCESS_KEY_ID` /
  `RAUTHY_S3_SECRET_ACCESS_KEY` (rauthy's hiqlite S3 backups) and the whole
  SMTP group. The entrypoint exports neither, so the embedded rauthy has no
  backup target and no mail transport. Both are real capability losses and are
  carried as named gaps in section 4.8, not quietly dropped.
- **Live, and now the only rauthy keys with a consumer:**
  `GITHUB_UPSTREAM_CLIENT_ID` / `GITHUB_UPSTREAM_CLIENT_SECRET` (section 4.5)
  and `RAUTHY_ADMIN_TOKEN`, the API key the seeder authenticates with. The
  catalog already describes that key in rauthy's `<name>$<secret>` form with
  consumer "seed-rauthy job", which is the mechanism section 4.5 specifies.
  Its description overstates the job's scope, though: it claims the job
  converges "OIDC clients, scopes, and upstream providers", where only the
  provider needs the API. The client is seeded declaratively at first boot
  (section 2.1) and scopes are not converged at all. Narrowing that
  description belongs with the pruning below.
- **Redefined:** `RAUTHY_URL` (section 2.4).
- **Stale, and not this spec's to delete:** `APP_BASE_URL` is declared with
  consumer "app, rauthy redirect", but no code reads it; the app reads
  `WEBAPP_BASE_URL` and `FRONTEND_URL`. `OIDC_SPA_CLIENT_ID`, `OIDC_M2M_CLIENT_ID`, and
  `OIDC_M2M_CLIENT_SECRET` are OAP names with no consumer in this codebase.

**The catalog edit was proposed here and performed in 010.**
`infra/secrets/catalog.toml` is spec 010 territory. Pruning roughly a dozen
keys from a live operator `.env` is a cluster-secret change with its own
validation gate (`npm run secrets:validate` fails on unknown keys), and 010
section 2.1 asserted these keys were required. Resolving that contradiction by
editing the catalog from inside this spec is exactly the move the coherence
guard forbids, so it was raised as human checkpoint 1 (section 6).

**Resolved 2026-07-20.** The operator decided the contradiction in favor of the
verified image behavior and authorized amending spec 010 rather than retaining
the keys. Spec 010 section 2.1 now carries the amendment and the per-key
decision: fourteen keys dropped, the four `JWT_*` PEMs and
`RAUTHY_CLIENT_SECRET` kept but demoted to `required = false` with their local
run named as the consumer (they cannot be dropped, because `npm run
secrets:check` requires every `infra.config.json` secret to be catalogued), and
`RAUTHY_S3_*` plus the SMTP group kept against the named gaps of section 4.8.
The catalog went from 47 keys to 33. Checkpoint 1 is closed; pruning the live
operator `.env` moved to 010's own checkpoint 6.

### 2.4 `auth.statecraft.ing` does not return

Spec 010 section 2.1 retired the `auth.<DOMAIN>` host and handed this spec the
question of whether it survives at all, declining to guess. It does not
survive, and the answer is structural rather than a preference.

The entrypoint sets `RAUTHY_ISSUER="$PUBLIC_URL/auth/v1/"`, gives rauthy
`PUB_URL` equal to the app's own host with `PROXY_MODE=true`, and binds it to
loopback where nothing but the app's proxy can reach it. The whole rauthy
surface (discovery, authorize, token, JWKS, the account UI, the admin UI) is
served same-origin below `https://app.statecraft.ing/auth/`. A second host
could only be an ingress pointed at the same proxy path, and it would mint a
second issuer identity for one IdP.

Consequences: the issuer is `https://app.statecraft.ing/auth/v1/`; the
catalog's `RAUTHY_URL` is redefined from `https://auth.<DOMAIN>` to
`https://<APP_HOST>/auth/v1/` or dropped as derived; and the `auth`
DNS record should be removed rather than repointed (checkpoint 4).

**Settled 2026-07-20: dropped, not redefined.** Of the two options above, spec
010 section 2.1 took the second. `RAUTHY_URL` had no consumer (no code reads
it, and the entrypoint derives the issuer from `ENRAHITU_PUBLIC_URL`), so
keeping it would restate in a settable variable a value the container computes
for itself. `APP_BASE_URL` was dropped with it, and the validator's
`https://auth.<DOMAIN>` derived-agreement formula went with both. Checkpoint 4,
the DNS record removal, is unaffected and still outstanding.

**Noted, and accepted:** the rauthy admin UI is publicly reachable at
`https://app.statecraft.ing/auth/v1/admin`, protected by rauthy's own login.
This is not a regression (the retired `auth.<DOMAIN>` was equally public) but
it is now on the same host as the product, and it is the break-glass surface
of section 4.6. Restricting it at the edge is deferred: doing it in ingress
means path-matching an upstream's UI routes, which breaks on upstream layout
changes, and the substrate rewrite is the right place for the app's proxy to
gate it.

### 2.5 The deferred Grafana OIDC item is void

PR #29 deferred a Grafana OIDC client item from spec 010 to this spec. It is
void, not inherited. Thesis section 3.4 forbids a separate Grafana OIDC client
and any standalone monitoring identity; spec 010 section 2.2 then dropped
Grafana outright with its `grafana-oidc` Secret and both `GRAFANA_OIDC_*`
catalog keys. There is no client to seed, no Grafana to seed it for, and no
successor task. Platform observability is the in-substrate flag-gated
`frontend-admin` (section 4.7).

## 3. Territory

- `.github/workflows/image.yml`: builds the single-container image from
  `docker/Dockerfile` (the enrahitu chassis, spec 002) and pushes to
  `ghcr.io/statecrafting/statecraft` on release and `workflow_dispatch`, amd64
  (the cluster is x86-64). **Landed; see section 4.1.**
- `.dockerignore`.
- `infra/gitops/clusters/statecraft-hetzner/statecraft/` and its tier file
  `infra/gitops/clusters/statecraft-hetzner/statecraft-kustomization.yaml`:
  the statecraft-owned manifests for the Deployment, PVC, Service, Ingress,
  Secret, the seeder Job, and the `/data` backup CronJob (section 4.3 rule 2).
  **Manifests only: this spec is the documentation.** A `README.md` beside
  them is forbidden for the reason one was removed on 2026-07-16: it restated
  the topology and then drifted, and `**/README.md` is a coupling bypass
  prefix, so such a file is a second source of truth no gate checks.

  **Relocated 2026-07-20, from a top-level `deploy/`.** Two claims justified
  the separate directory and both were wrong. The first was that these
  manifests are the artifact the fleet reuses per tenant. They are not:
  `addon/fleet-native/src/resources.rs` builds every tenant resource as typed
  `k8s-openapi` structs in Rust, and spec 006 §1 states its placement shape is
  "distinct from that full tenant-app chart; it is authored here, not lifted".
  There is no chart for tenants to reuse, so section 1's "same shape the fleet
  will run" is a claim about topology (container + volume + ingress), not
  about a shared artifact. The second was that spec ownership required a
  separate root directory. It does not: nested ownership is this corpus's
  established pattern, with spec 002 owning `backend/` while 004, 005, 006,
  and 008 own subdirectories inside it. Spec 010 keeps `infra/`; this spec
  owns the subtree above.

  What decided it is maintainability rather than governance. A second
  top-level location for Kubernetes YAML is how OAP arrived at five of them,
  with cert-manager ClusterIssuers duplicated across `k8s/bootstrap/` and
  `gitops/clusters/hetzner-prod/manifests/`. One Flux tree with one tier per
  concern is the structure that keeps the coupling gate meaningful, and the
  app is a tier like any other: `dependsOn: infrastructure`, so Postgres,
  ingress-nginx, and cert-manager are Ready before the control plane places.

  The one genuine spec 010 touch is a single line added to that tree's root
  `kustomization.yaml` resource list, which is a coordinated edit, not a
  waiver.
- `.github/workflows/cd.yml`: on push to `main` (sha-pinned) and on
  `workflow_dispatch`; never floats `latest` onto the running release.
- `.github/workflows/ai-pr-review.yml` and `ai-changelog.yml`: ported from OAP
  spec 085, stripped of OAP paths and secrets.

**Cross-spec touches**, each requiring a coordinated edit or a cited waiver:
`infra.config.json` (spec 002) needs a production origin and a metrics block
(sections 4.2, 4.7). `infra/secrets/catalog.toml` (spec 010) needed the pruning
of section 2.3 and the `RAUTHY_URL` decision of section 2.4; **both landed
2026-07-20** in spec 010 section 2.1, on operator authorization, as a 010-owned
edit rather than a cross-spec touch from here.

## 4. Behavior

### 4.1 Image

One amd64 image at `ghcr.io/statecrafting/statecraft:<sha>`, `:latest`, and
the release tag. Private is acceptable; the deploy provides a namespace
`dockerconfigjson` pull secret, matching the fleet finding that the
reflector-synced `ghcr-pull` carries bot credentials without access to new
packages.

**Met 2026-07-16.** The build uses the npm toolchain rather than a vendored
cross-build: `npm ci` on a linux runner pulls the prebuilt Encore runtime,
tsparser, and hiqlite from the `@enrahitu/*-linux-x64` optional dependencies,
and only statecraft's own `governance-native` and `fleet-native` addons build
in CI. Two fixes were needed to reach green: `build:web` needed an explicit
`npm --prefix frontend ci` (the frontend is not a root workspace), and the
prebuilt toolchain binaries require `GLIBC_2.39`, which moved the build to
`ubuntu-24.04` and bumped `docker/Dockerfile.base` from `node:24-slim`
(bookworm, glibc 2.36) to `node:24-trixie-slim` (glibc 2.41). That spec 002
chassis touch was waived at the time and is worth an enrahitu follow-up: the
chassis publishes 2.39 toolchain binaries against a 2.36 base image.

There is no `/health` smoke test in the image job: the control plane needs
Postgres to be healthy, so runtime verification belongs to the deploy.

### 4.2 Topology

On the spec 010 cluster, in its own namespace:

- A **single-replica Deployment**. Single replica is not a simplification to
  be lifted later: the container runs one embedded rauthy and one app hiqlite
  against one volume, so a second replica is a second IdP, not a second copy.
  Horizontal scale is a substrate question (hiqlite Raft membership), not a
  `replicas:` value.
- A **PVC mounted at `/data`**, `ReadWriteOnce` on `hcloud-volumes`. Section
  4.3 is why this is the most important object in the manifest set.
- A **ClusterIP Service** on the app's port.
- An **Ingress at `app.statecraft.ing`**, `ingressClassName: nginx`, TLS via
  `letsencrypt-prod-dns01-cloudflare`. This is the ingress that has never
  existed; creating it is what makes the host real. DNS is an A record to the
  worker, because ingress-nginx tolerates no control-plane taint (spec 010
  section 4).
- A **Secret** with the seven keys of section 2.2, and **no others**.
- **Postgres**: the control plane's own born-empty database on 010's Postgres,
  addressed by `ENRAHITU_LEDGER_URL`; the driver is chosen by URL scheme (spec
  003). CoreLedger's schema init is CREATE-only with no auto-migration, which
  a born-empty database satisfies exactly; it is also why the database must be
  born empty rather than reused.

`infra.config.json` carries `metadata.base_url: http://localhost:8080` and
`env_name: selfhost`. The deployed configuration must carry the real origin.

**`metadata.cloud` must stop saying `local`.** It currently does, while
`env_type` says `production`, and that combination silently disables Encore's
missing-secret guard. `secret()` returns a resolver that throws
`secret <name> is not set` when the value is absent from the runtime config,
**except** when the app metadata reports the Local cloud, where it returns the
empty string instead. `"local"` is exactly the string that maps to that case.
So in the deployed control plane as configured today, a secret that the deploy
forgets, misspells, or fails to mount does not crash the pod: it reads as `""`
and the service proceeds with an empty credential. Several config helpers then
treat empty as "fall back to plain env", which compounds the silence.

The deployed configuration sets `cloud` to a value outside Encore's known set
(`local`, `encore`, `aws`, `gcp`, `azure`), which maps to Unspecified and
restores fail-loud resolution. This is the single highest-value line in the
deployed config, because it converts the failure mode of section 2.2's
seven-key Secret from a silent misconfiguration into a crash loop.

### 4.3 The volume is the identity anchor

This is the load-bearing operational consequence of the embedded topology and
it has no counterpart in the previous version of this spec.

Every piece of the platform's identity now lives in one PVC: both signing
keypairs, the OIDC client secret, rauthy's encryption keys, and rauthy's
entire hiqlite database, which holds the users, the roles, the client, and
(after section 4.5) the upstream provider configuration. Under the retired
shared-rauthy topology that state lived in the cluster and was reconstructible
from SOPS ciphertext in git. It is not reconstructible now: the material was
generated in-container and exists nowhere else.

Losing the volume is therefore not a restart, it is the loss of the platform's
identity plane: every session and token invalid, every user gone, the upstream
provider unconfigured, and a new client secret that no longer matches anything.
Three rules follow.

1. **The PVC is never deleted as a remediation step.** Recreating the pod is
   safe; recreating the volume is a re-founding.
2. **The volume must be backed up before the platform carries anything real.**
   rauthy's own S3 backup path is not wired into the image (section 2.3), so
   the interim mechanism is volume-level: a scheduled `restic` CronJob against
   a Hetzner bucket. Wiring rauthy's native backups is an enrahitu chassis
   change, tracked in section 4.8.

   **Corrected 2026-07-20.** This rule previously said the job should reuse
   `RESTIC_PASSWORD` and the `FLEET_S3_*` credentials the pod already holds.
   It must not. Those protect **tenant** app volumes and travel with the
   placement path; `/data` is the platform's identity plane, and rule 1 above
   is the whole reason it is treated differently. Reusing the tenant
   credential would encrypt the one artifact this section calls
   unreconstructible under a repository password whose blast radius is every
   tenant, to save two catalog entries. The operator provisioned a separate
   bucket and the `PLATFORM_S3_*` group (spec 010 §4) instead:
   `PLATFORM_S3_ACCESS_KEY_ID`, `PLATFORM_S3_SECRET_ACCESS_KEY`,
   `PLATFORM_S3_RESTIC_PASSWORD`.

   Those three are **not** on the pod. They mount on the CronJob's own Secret,
   on the same reasoning section 4.5 applies to the seeder Job, so the pod
   Secret stays at the seven keys of section 2.2. Custody of
   `PLATFORM_S3_RESTIC_PASSWORD` belongs with the break-glass material
   (section 4.6): losing it and the volume together is unrecoverable, since
   nothing else decrypts the backup.
3. **`ENRAHITU_PUBLIC_URL` must be correct before first boot.** The client
   bootstrap derives `redirect_uris`, `post_logout_redirect_uris`, and
   `allowed_origins` from it, and rauthy applies bootstrap data only while its
   database is uninitialized (`migrate_init_prod` returns early once the JWKS
   table is non-empty). Booting once with the wrong public URL leaves a client
   whose redirect URIs are permanently wrong from bootstrap's point of view;
   the fix is then an admin-API correction, not a redeploy. Set it to
   `https://app.statecraft.ing` from the first boot.

### 4.4 Environment

`ENRAHITU_PUBLIC_URL=https://app.statecraft.ing` is the single most important
variable (section 4.3), and `ENRAHITU_ADMIN_EMAIL` sets the bootstrap admin
identity.

**Set by the entrypoint; the deploy must not set them.** `NODE_ENV`,
`AUTH_DRIVER`, `FRONTEND_URL`, `RAUTHY_ISSUER`, `RAUTHY_CLIENT_ID`,
`RAUTHY_REDIRECT_URI`, `RAUTHY_UPSTREAM`, `ENRAHITU_KEYS_DIR`,
`ENRAHITU_HIQ_DATA_DIR`, `ENRAHITU_HIQ_ADDR_RAFT`, `ENRAHITU_HIQ_ADDR_API`.

**Honored if set, and required here:** `ENRAHITU_LEDGER_URL`. The entrypoint
defaults it to a file URL on the volume, so the deploy supplies the Postgres
URL to select the Postgres driver. `ENRAHITU_LEDGER_POOL_SIZE` is optional.

**Read by services, set by the deploy:** `FLEET_BASE_DOMAIN`,
`FLEET_IMAGE_PULL_SECRET`, `FLEET_BACKUP_BUCKET`, `FLEET_BACKUP_S3_ENDPOINT`,
`FLEET_RESTIC_IMAGE`, `FACTORY_TEMPLATE_REPO`, `FACTORY_TEMPLATE_REF`,
`FACTORY_DATA_DIR`, `STATECRAFT_GOVERNANCE_CONFIG_DIR`,
`STATECRAFT_GOVERNANCE_STATE_DIR`. **Correction:** the previous version wrote
the last two with a lowercase `statecraft_` prefix; the code reads them
uppercase. Environment variable names are case-sensitive, so an operator
following the old spelling would have set variables nothing reads. The same
lowercase spelling survives in a doc comment at `backend/governance/config.ts:16`
(spec 008 territory, comment only, no behavior); worth correcting there when
that file is next touched.

**Read by the embedded rauthy, set by the deploy (added 2026-07-20):**
`SMTP_URL`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_FROM`. These four are
non-secret and travel as plain env; the fifth, `SMTP_PASSWORD`, is the seventh
key of the pod Secret (section 2.2). The entrypoint forwards all five into the
rauthy subshell only when `SMTP_URL` is set, so omitting the group is a
supported configuration that disables mail rather than a failure (section 4.8
item 1). They are consumed by rauthy, not by any Encore service, which is why
they appear here rather than in `infra.config.json`.

`WEBAPP_BASE_URL` is **optional and deliberately left unset**. It only steers
the post-install redirect of the GitHub App flow, and an unset value yields a
relative redirect that lands on this app's own origin, which is correct for a
same-origin deploy. Setting it duplicates the origin in a second place that
can drift.

### 4.5 Identity seeding: what first boot cannot do

First boot seeds the OIDC client and can seed roles, groups, users, scopes,
and API keys, because rauthy reads each from a JSON file in `BOOTSTRAP_DIR`.
It **cannot** seed an upstream auth provider: rauthy 0.36's bootstrap types
are `Client`, `User`, `Group`, `Role`, `Scope`, `UserAttribute`, and `ApiKey`,
and there is no provider among them. Thesis section 3.3 nonetheless requires
customers to authenticate with GitHub OAuth as an upstream provider, so the
gap is real and load-bearing rather than cosmetic.

The mechanism is an API-driven seeder, and rauthy supports it directly:
`POST /auth/v1/providers/create` authorizes via
`validate_api_key_or_admin_session(AccessGroup::AuthProviders, AccessRights::Create)`,
so a bootstrapped API key suffices and no admin session is needed.

The deploy therefore runs a **seeder Job**, after the pod is healthy:

1. First boot bootstraps an API key with `AuthProviders: create` access,
   through `api_keys.json` in `BOOTSTRAP_DIR` (or the `BOOTSTRAP_API_KEY` /
   `BOOTSTRAP_API_KEY_SECRET` pair). Its value is the catalog's
   `RAUTHY_ADMIN_TOKEN`, in rauthy's `<name>$<secret>` form.
2. The Job calls `POST /auth/v1/providers/create` with
   `GITHUB_UPSTREAM_CLIENT_ID` and `GITHUB_UPSTREAM_CLIENT_SECRET`, both of
   which are present in the operator `.env` (verified; the "never ported"
   concern is closed).
3. The Job is **idempotent and convergent**: it lists providers first and
   skips or updates rather than creating a duplicate, because it reruns on
   every deploy while first boot happens once.

The Job's three credentials (`RAUTHY_ADMIN_TOKEN` and the two
`GITHUB_UPSTREAM_*` values) live in **their own Secret, mounted only on the
Job**, never on the app pod. The pod's Secret stays at the seven keys of section
2.2: the control plane never needs to authenticate as an IdP administrator,
and mounting a provider-management credential beside the application would
hand every code path in the app the ability to rewrite the identity plane.

Writing the API key into `BOOTSTRAP_DIR` is an enrahitu chassis change
(`first-boot.mjs` composes that directory), tracked in section 4.8. Until it
lands, the seeder's fallback is an operator-performed provider creation
through the admin UI using the break-glass account, which is a human
checkpoint rather than an automated step.

**The `statecraft_operator` role is seeded the same way**, and more simply,
since roles do have a declarative path: a `roles.json` carrying
`statecraft_operator`. The role flows to the app automatically:
`backend/auth/rauthy.ts` reads the `roles` claim (falling back to `groups`),
and the client's requested scopes already include `groups`. Assigning the role
to the first operator account is a human step (checkpoint 5), because it is an
authorization grant and should not be automated on first boot.

**Gating surfaces on that role is not this spec's work.** `backend/lib/roles.ts`
provides `requireRole`/`hasRole` with any-of semantics, tested, and with no
production callers today. The surfaces that must gate on `statecraft_operator`
(chiefly `frontend-admin`) arrive with the substrate rewrite (thesis section
3.4). This spec provisions the role and the claim path; wiring the checks
belongs to the specs that own those endpoints.

### 4.6 Break-glass

`rauthy_admin` administers the IdP itself and stays with break-glass accounts
(thesis section 3.3). In this topology the break-glass credential is the
bootstrap admin password generated at first boot into
`/data/rauthy/admin-password`, reachable only by `kubectl exec` into the pod,
and used at `https://app.statecraft.ing/auth/v1/admin`.

That is an acceptable posture (possession of it already implies cluster
access, so it grants no privilege an operator lacked) but it is not a
credential policy. Rotating it to a named human account with MFA, and
recording custody, is checkpoint 6.

### 4.7 Observability

Spec 010 provisioned the metrics sink: Prometheus with
`enableRemoteWriteReceiver: true`, no ingress, no LoadBalancer, in-cluster
only. This spec supplies the producer. Encore's self-host metrics config takes
`{ type: "prometheus", remote_write_url, collection_interval }` in
`infra.config.json`, which currently has **no metrics block at all**, so the
control plane emits nothing today. Adding it, pointed at the in-cluster
Prometheus service, is a spec 002 touch and a coordinated edit.

**A contract delta, recorded rather than resolved.** Thesis section 3.4 states
that every EnRaHiTu app exposes a Prometheus `/metrics` endpoint, which is a
pull contract. Encore's self-host metrics is push: its exporter does
`remote_write` and there is no scrape endpoint, as spec 010's own
`monitoring.yaml` notes. The control plane will therefore satisfy the
*intent* of the observability contract (its signals reach the platform sink)
while not satisfying its *letter* (no `/metrics` to scrape). Exposing a real
pull endpoint is a substrate capability that does not exist yet; it belongs to
the enrahitu rewrite that owns the contract, not to this deploy. Flagged for
that spec (section 4.8) rather than settled by weakening the thesis.

OTel traces are in the same position and are not configured here.

### 4.8 Upstream gaps this deploy surfaces

Four items belong to the enrahitu chassis, not to this repo, and are recorded
here because this deploy is what makes them concrete. **Item 1 was closed on
2026-07-20**; the other three stand.

1. **The embedded rauthy has no SMTP. CLOSED 2026-07-20.** The entrypoint
   exported no mail configuration, so rauthy kept its `smtp_url = 'localhost'`
   default and every send failed: no password reset, no email verification, no
   MFA recovery. It was closed rather than carried because the cost was eight
   lines and the credentials already existed. `docker/entrypoint.sh` now passes
   the five SMTP variables into the rauthy subshell, gated on `SMTP_URL` so a
   local trial of the image still needs no mail server. rauthy reads those
   exact names (its `config.toml` documents each as "overwritten by:
   `SMTP_*`") and the catalog's smtp group already used the same spellings, so
   no translation layer was needed.

   **Why it mattered less than it looks, and still mattered.** Thesis section
   3.3 puts exactly two populations in this IdP: customers authenticating
   through GitHub OAuth upstream, and operators. Neither signs up with a
   password, so the headline flows never needed mail: GitHub already verified
   the address, and the break-glass admin password is read from
   `/data/rauthy/admin-password` by `kubectl exec` rather than emailed. What
   did need it is recovery on the margins, which is exactly where an identity
   plane must not be brittle: MFA reset, email-change verification, and the
   named human operator account of section 4.6 checkpoint 6.

   **This is a spec 002 touch, and a divergence from upstream.**
   `docker/entrypoint.sh` was byte-identical to enrahitu's copy before this
   change. Mirroring it into `statecrafting/enrahitu` is a follow-up; until
   that lands the two differ, and the next chassis sync must not silently
   revert this.

   Unlike `ENRAHITU_PUBLIC_URL` and `ENRAHITU_ADMIN_EMAIL`, SMTP is read per
   send rather than at bootstrap, so getting it wrong is a redeploy and never
   a re-founding (contrast section 4.3 rule 3).
2. **The embedded rauthy has no backup target.** `RAUTHY_S3_*` is unwired;
   see section 4.3 rule 2 for the interim.
3. **`BOOTSTRAP_DIR` carries only `clients.json`.** Roles and the seeder API
   key need `first-boot.mjs` to compose `roles.json` and `api_keys.json`
   (section 4.5).
4. **No `/metrics` pull endpoint** (section 4.7).

None of these block the deploy; all four constrain what the deployed platform
can honestly claim, which is why they are named.

### 4.9 Ported CI

`ai-pr-review.yml` runs the Claude CLI over the PR diff and posts a review;
`ai-changelog.yml` is its companion. No API key is committed. The PR **gate**
is already covered by this repo's `spec-spine.yml` (coupling) and `verify.yml`
(typecheck/test); port only the missing orchestration if a single required
check is wanted, not OAP's service-specific fan-out.

## 5. Acceptance

- `image.yml` publishes a pullable `ghcr.io/statecrafting/statecraft`,
  verified by pulling it. **(Met 2026-07-16.)**
- The deploy stands the control plane up on the 010 cluster with no OAP chart,
  CD, or secret dependency, against its own born-empty database.
- The pod's Secret carries exactly the seven keys of section 2.2. Verified by
  absence as much as presence: no `JWT_*` and no `RAUTHY_CLIENT_SECRET` is
  injected.
- Missing secrets fail loud: with `metadata.cloud` off `local` (section 4.2),
  removing a required key from the Secret crash-loops the pod rather than
  yielding an empty credential. Verified once, deliberately, before go-live.
- `https://app.statecraft.ing` serves the governance UI over a real cert (not
  the ingress default certificate).
- OIDC discovery at `https://app.statecraft.ing/auth/v1/.well-known/openid-configuration`
  returns an issuer of `https://app.statecraft.ing/auth/v1/`, and no
  `auth.statecraft.ing` host resolves.
- A real login completes end to end against the container's embedded rauthy.
  This closes spec 010's deferred acceptance.
- A GitHub upstream login completes, proving the seeder's provider
  configuration (section 4.5).
- An account holding `statecraft_operator` presents that role in its claims,
  observable through the app's own user model.
- Prometheus shows control-plane series arriving by `remote_write`.
- The volume backup of section 4.3 rule 2 exists and a restore has been
  rehearsed at least once.
- `ai-pr-review.yml` runs on a PR and posts a review; spine gates and verify
  green.

Retiring the OAP release is not this spec's acceptance: the old cluster was
deleted wholesale by spec 010 on 2026-07-17, taking the release and its
database with it.

## 6. Human checkpoints

Live bring-up is operator work, proposed here rather than performed.

1. **Decide the catalog pruning. CLOSED 2026-07-20.** Section 2.3 found that
   roughly a dozen catalog keys lost their consumer, contradicting spec 010
   section 2.1's statement that every `RAUTHY_*` key is still required. The
   operator decided to amend 010 to the verified image behavior rather than
   retain the keys, and the amendment landed in 010 section 2.1 with the
   per-key decision (section 2.3 above). What remains is operator work on the
   live `.env`, tracked as 010 checkpoint 6, not a decision.
2. **Delete the two `GRAFANA_OIDC_*` lines** from the operator `.env`, which
   is spec 010 checkpoint 3. **Done:** `npm run secrets:validate` was green
   against the live file on 2026-07-20 before the catalog amendment, which is
   only possible with both lines gone.
3. **Confirm `ENRAHITU_PUBLIC_URL` before the first boot.** Section 4.3 rule
   3; the cheapest checkpoint here and the most expensive to miss.
4. **Remove the `auth.statecraft.ing` DNS record** (section 2.4) and add the
   `app` A record to the worker IP. Out-of-band at Cloudflare, like the
   firewall rules.
5. **Grant `statecraft_operator`** to the first operator account, and confirm
   the claim reaches the app.
6. **Take custody of the break-glass admin credential** (section 4.6): read it
   from the volume, rotate it to a named account with MFA, and record where it
   lives.
7. **Verify the volume backup and rehearse a restore** before the platform
   holds anything real (section 4.3 rule 2).

## 7. Out of scope

- **The cluster and its platform services**: Flux, SOPS, cert-manager,
  ingress-nginx, reflector, Postgres, NSQ, Prometheus, object storage, and DNS
  provisioning are all spec 010. This spec deploys one application onto a
  cluster it assumes exists.
- **The enrahitu chassis changes of section 4.8.** They are named here and
  owned upstream; this spec deploys the image as published.
- **Gating operator surfaces on `statecraft_operator`** (section 4.5) and
  `frontend-admin` itself, which arrives with the substrate rewrite.
- **A crypto service for stored credentials.** Spec 010 section 7 records that
  the control plane stores no secret at rest and that OAP's
  `PAT_ENCRYPTION_KEY` has no successor, because spec 004's GitHub App flow
  mints short-lived installation tokens instead of storing customer
  credentials. Its absence from the operator `.env` is therefore correct and
  is not a gap this deploy fills. That decision stays conditional on the App's
  permission set covering every console verb, which is a spec 004 gate.
- **Alerting policy**, and the question of which consumer reads Prometheus.
- Non-hetzner deployment targets.
- Multi-replica or HA control plane (section 4.2 explains why this is
  structural, not deferred tuning).
- Re-homing the marketing site: the apex stays GitHub Pages.
</content>
</invoke>
