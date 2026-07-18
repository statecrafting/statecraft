# statecraft-hetzner (Flux GitOps)

The statecraft-owned cluster's declarative definition (spec 010). Flux
reconciles this path from this repository; no object here references
`open-agentic-platform`.

## Topology

```
kustomization.yaml            root: explicit list, delegates to four tiers
├── flux-system/              bootstrap-managed (flux bootstrap writes it)
├── namespaces/               cert-manager, ingress-nginx, rauthy-system,
│                             monitoring, statecraft-system
├── secrets/                  SOPS-encrypted Secrets, decrypted in-cluster
│                             by Flux from flux-system/sops-age
├── infrastructure/           HelmReleases + raw workloads
│   ├── cert-manager.yaml     v1.19.3  (jetstack)
│   ├── ingress-nginx.yaml    4.15.1   (DaemonSet + hostPort)
│   ├── reflector.yaml        9.1.6    (emberstack)
│   ├── monitoring.yaml       kube-prometheus-stack 86.2.2 (+ Grafana OIDC)
│   ├── rauthy.yaml           in-tree ../charts/rauthy (image 0.35.0)
│   ├── postgres.yaml         raw StatefulSet, postgres:17 (born empty)
│   └── nsq.yaml              raw Deployment, nsqio/nsq:v1.3.0
├── manifests/                ClusterIssuers (DNS-01 default + HTTP-01)
└── charts/rauthy/            vendored rauthy chart (referenced by rauthy.yaml)
```

## Ordering

`namespaces` (no deps) -> `secrets` + `infrastructure` (both dependsOn
namespaces) -> `manifests` (dependsOn infrastructure). `infrastructure`
reports Ready on a cert-manager healthCheck alone, so a not-yet-decrypted
secret cannot block the tier; secret-dependent releases retry until the
`secrets` tier lands their Secret.

## Certs

Every platform host uses the **DNS-01 Cloudflare** ClusterIssuer
(`letsencrypt-prod-dns01-cloudflare`), not HTTP-01: on a greenfield cluster
DNS points nowhere until cutover, and DNS-01 proves control via a TXT record
without the host being reachable, so certs issue before the DNS flip. The
issuer needs the `cloudflare-api-token` Secret in `cert-manager`.

## Version bumps

Chart and image versions are pinned deliberately; a bump is its own edit in
its own PR, re-validated against the CRD-schema evolution the chart publishes.
