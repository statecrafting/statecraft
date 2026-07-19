import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import {
  degradeOn404,
  factory,
  isDegraded,
  tenants,
  type Degraded,
  type InstallationView,
  type RepoView,
  type StampJobView,
  type TenantView,
} from "../lib/api";
import { formatDate, StatusBadge } from "../lib/ui";

interface TenantDetailData {
  tenant: TenantView;
  installations: InstallationView[];
  installUrl: string;
  repos: RepoView[] | null; // null when there is no active installation (412)
  stamps: StampJobView[] | Degraded;
}

export async function tenantDetailLoader({ params }: LoaderFunctionArgs): Promise<TenantDetailData> {
  const id = params.id as string;
  const detail = await tenants.get(id);
  const { url } = await tenants.installUrl(id);

  const hasActive = detail.installations.some((i) => i.status === "active");
  let repos: RepoView[] | null = null;
  if (hasActive) {
    try {
      repos = (await tenants.repos(id)).repos;
    } catch {
      // 412 (no active installation) or a transient repo-fetch failure: the
      // repos panel simply stays empty rather than failing the whole page.
      repos = null;
    }
  }

  const stamps = await degradeOn404(
    factory.list(id).then((r) => r.stamps),
    "The factory",
  );

  return { tenant: detail.tenant, installations: detail.installations, installUrl: url, repos, stamps };
}

export function TenantDetail() {
  const { tenant, installations, installUrl, repos, stamps } =
    useLoaderData() as TenantDetailData;
  const hasActive = installations.some((i) => i.status === "active");

  return (
    <section>
      <p className="breadcrumb">
        <Link to="/">Tenants</Link> / {tenant.name}
      </p>
      <div className="page-head">
        <h1>{tenant.name}</h1>
        <div className="btn-row">
          <Link className="btn btn-primary" to={`/tenants/${tenant.id}/stamps/new`}>
            Stamp an app
          </Link>
          <Link className="btn" to={`/tenants/${tenant.id}/fleet`}>
            Fleet
          </Link>
        </div>
      </div>

      <div className="card">
        <dl className="kv">
          <dt>tenant id</dt>
          <dd>
            <code>{tenant.id}</code>
          </dd>
          <dt>created</dt>
          <dd>{formatDate(tenant.createdAt)}</dd>
        </dl>
      </div>

      <h2 className="section-title">GitHub installations</h2>
      {installations.length === 0 ? (
        <div className="card empty">
          <p>No GitHub App installation yet.</p>
          <p className="muted">
            Install the statecraft App into your GitHub org so the factory can stamp repos into it.
            Nobody joins our org; your code stays in yours.
          </p>
          {/* Full-page navigation to GitHub; it redirects back to "/?github=installed". */}
          <a className="btn btn-primary" href={installUrl}>
            Install the statecraft App
          </a>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>org</th>
                    <th>status</th>
                    <th>installation id</th>
                    <th>added</th>
                  </tr>
                </thead>
                <tbody>
                  {installations.map((inst) => (
                    <tr key={inst.id}>
                      <td>{inst.githubOrg}</td>
                      <td>
                        <StatusBadge status={inst.status} />
                      </td>
                      <td>
                        <code>{inst.installationId}</code>
                      </td>
                      <td>{formatDate(inst.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="hint">
            <a href={installUrl}>Install into another org</a>
          </p>
        </>
      )}

      {hasActive && (
        <>
          <h2 className="section-title">Repositories</h2>
          <div className="card">
            {repos === null ? (
              <p className="muted">Repositories are unavailable for this installation right now.</p>
            ) : repos.length === 0 ? (
              <p className="muted">No repositories visible to the installation yet.</p>
            ) : (
              <ul className="tenant-list">
                {repos.map((repo) => (
                  <li key={repo.id} className="tenant-row">
                    <a href={repo.htmlUrl} target="_blank" rel="noreferrer">
                      {repo.fullName}
                    </a>
                    {repo.private && <span className="badge badge-muted">private</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <h2 className="section-title">Recent stamps</h2>
      {isDegraded(stamps) ? (
        <div className="notice">{stamps.reason}</div>
      ) : stamps.length === 0 ? (
        <div className="card">
          <p className="muted">No stamp jobs yet.</p>
        </div>
      ) : (
        <div className="card">
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>app</th>
                  <th>org</th>
                  <th>posture</th>
                  <th>status</th>
                  <th>started</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {stamps.map((job) => (
                  <tr key={job.id}>
                    <td>{job.appName}</td>
                    <td>{job.org}</td>
                    <td>{job.posture}</td>
                    <td>
                      <StatusBadge status={job.status} />
                    </td>
                    <td>{formatDate(job.createdAt)}</td>
                    <td>
                      <Link to={`/stamps/${job.id}`}>view</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
