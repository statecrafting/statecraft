import { Link, useLoaderData, useSearchParams } from "react-router";

import { tenants, type TenantView } from "../lib/api";
import { formatDate } from "../lib/ui";

export async function dashboardLoader() {
  const { tenants: list } = await tenants.list();
  return { tenants: list };
}

export function Dashboard() {
  const { tenants: list } = useLoaderData() as { tenants: TenantView[] };
  // GitHub's App-install flow redirects back to "/?github=installed&tenant=<id>"
  // (or github=error); surface the outcome rather than swallowing it.
  const [params] = useSearchParams();
  const github = params.get("github");
  const githubTenant = params.get("tenant");

  return (
    <section>
      {github === "installed" && (
        <div className="banner">
          GitHub App installed.{" "}
          {githubTenant && <Link to={`/tenants/${githubTenant}`}>Open the tenant</Link>}
        </div>
      )}
      {github === "error" && (
        <div className="banner bad">
          The GitHub App installation could not be verified. Try the install link again.
        </div>
      )}

      <div className="page-head">
        <h1>Tenants</h1>
        <Link className="btn btn-primary" to="/tenants/new">
          New tenant
        </Link>
      </div>

      {list.length === 0 ? (
        <div className="card empty">
          <p>No tenants yet.</p>
          <p className="muted">
            A tenant is a customer GitHub org you install the statecraft App into. Stamped repos
            are born in that org.
          </p>
          <Link className="btn btn-primary" to="/tenants/new">
            Create your first tenant
          </Link>
        </div>
      ) : (
        <ul className="tenant-list">
          {list.map((t) => (
            <li key={t.id} className="card tenant-row">
              <Link to={`/tenants/${t.id}`} className="tenant-name">
                {t.name}
              </Link>
              <span className="muted">created {formatDate(t.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
