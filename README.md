# statecraft
 
The governed agentic delivery control plane: intent becomes a governed
spec, the factory stamps an application from the
[EnRaHiTu template](https://github.com/statecrafting/enrahitu), the fleet
operates the resulting hermetic containers, and the customer's code lives
in the customer's GitHub org the entire time.

statecraft is itself the first production EnRaHiTu app: one container,
embedded [rauthy](https://github.com/sebadob/rauthy) as the platform IdP,
[hiqlite](https://github.com/sebadob/hiqlite) in-process, CoreLedger for
durable state (on Postgres; stamped customer apps run the same decorator
API on libSQL/Turso). Every fleet operation sold to customers is
rehearsed on the platform itself first.

## Status

Born governed. The spec spine is the authoritative design record; the app
shell (spec 002) and the governance spine (spec 008) have now landed:

- `specs/000-bootstrap/` defines the spec system itself.
- `specs/001-statecraft-thesis/` is the product thesis, the consolidation
  record (what moves here from the Open Agentic Platform research era),
  the service map, and the milestone ladder (M1 template contract through
  M5 paying agencies).

Services land under their own numbered specs as their build starts:
`tenants/` (GitHub App installations), `factory/` (stamping, consuming
enrahitu's `template.toml` contract), `fleet/` (deployd's orchestration
core as an in-process napi addon), `frontend/` (governance UI, Vite +
React Router v7).

## Chassis

statecraft is stamped from the
[enrahitu template](https://github.com/statecrafting/enrahitu) as its
first production consumer. The app shell (spec 002) imports the slimmed
two-directory chassis (`backend/` + `frontend/`) at enrahitu commit
`83a4551` (2026-07-15); the Encore toolchain and the hiqlite addon arrive
as pinned `@enrahitu/*` npm packages (`0.1.0`), not vendored source. The
imported chassis is Apache-2.0 entering this AGPL-3.0 repo, the sanctioned
direction. There is no born-with provenance cert here yet: that is minted
by the factory (spec 005) when it stamps apps, and statecraft will carry
its own once the factory can emit one.

## The product family

| Repo | License | Role |
|---|---|---|
| [enrahitu](https://github.com/statecrafting/enrahitu) | Apache-2.0 | The template chassis: Encore.ts + rauthy + hiqlite + Turso, single container |
| statecraft (this repo) | AGPL-3.0 | The control plane: tenants, factory, fleet, governance UI |
| [statecraft-cli](https://github.com/statecrafting/statecraft-cli) | Apache-2.0 | The CLI + MCP server: governance verbs for humans and agents |
| [statecraft.ing](https://github.com/statecrafting/statecraft.ing) | n/a | Website and docs |

## Governance

Governed by [spec-spine](https://github.com/statecrafting/spec-spine)
(`cargo install spec-spine-cli`):

```bash
spec-spine compile   # specs -> .derived/spec-registry/by-spec/
spec-spine index     # code linkage -> .derived/codebase-index/
spec-spine lint      # corpus conformance
spec-spine couple --base origin/main --head HEAD   # the PR coupling gate
```

Read `.derived/**` only through `spec-spine` subcommands; the shards are
compiler-owned.

## License

AGPL-3.0 (see [LICENSE](LICENSE)): hosting a modified control plane
commercially requires publishing the modifications, while self-hosting
stays free. The artifacts customers touch (the template, the CLI) are
Apache-2.0 in their own repos; apps stamped from the template belong to
their owners.
