/**
 * GitHub REST for the factory (spec 005 §3 steps 4 and 6): create the customer
 * repo and watch its born-green verify run. Uses the tenant's installation
 * token from the tenants service (spec 004's exported helper); the factory owns
 * its own thin REST client rather than reaching into tenants' internals. Plain
 * fetch against api.github.com with the pinned API version, matching the
 * auditable-surface convention spec 004 §3 set.
 */
import { getInstallationToken } from "../tenants/github-app";

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";

interface GhOptions {
  method?: string;
  token: string;
  body?: unknown;
}

async function gh<T>(path: string, opts: GhOptions): Promise<T> {
  const res = await fetch(`${GITHUB_API_BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${opts.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": "stagecraft-factory",
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`GitHub ${opts.method ?? "GET"} ${path} failed: ${res.status} ${detail}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface CreatedRepo {
  name: string;
  fullName: string;
  defaultBranch: string;
  htmlUrl: string;
}

interface RawRepo {
  name: string;
  full_name: string;
  default_branch: string;
  html_url: string;
}

/** Create a private repo in the customer org (spec 005 §3 step 4). */
export async function createRepo(
  installationId: string,
  org: string,
  name: string,
): Promise<CreatedRepo> {
  const token = await getInstallationToken(installationId);
  const repo = await gh<RawRepo>(`/orgs/${encodeURIComponent(org)}/repos`, {
    method: "POST",
    token,
    body: { name, private: true, auto_init: false },
  });
  return {
    name: repo.name,
    fullName: repo.full_name,
    defaultBranch: repo.default_branch || "main",
    htmlUrl: repo.html_url,
  };
}

export interface ExistingRepo {
  fullName: string;
  defaultBranch: string;
  htmlUrl: string;
}

/**
 * Fetch an existing repo (adopt mode, spec 005 §3). Throws if it does not exist
 * or the installation cannot see it, so the pipeline fails the job with a precise
 * error instead of pushing into the void.
 */
export async function getRepo(
  installationId: string,
  org: string,
  repo: string,
): Promise<ExistingRepo> {
  const token = await getInstallationToken(installationId);
  const r = await gh<RawRepo>(
    `/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`,
    { token },
  );
  return { fullName: r.full_name, defaultBranch: r.default_branch || "main", htmlUrl: r.html_url };
}

export interface PullRequest {
  url: string;
  number: number;
}

interface RawPull {
  html_url: string;
  number: number;
}

/**
 * Open a pull request from the stamp branch into the repo's default branch
 * (adopt mode, spec 005 §3). The PR diff is the reconciliation surface a human
 * reviews before merge; the born-green verify then runs on the PR head.
 */
export async function openPullRequest(
  installationId: string,
  org: string,
  repo: string,
  input: { head: string; base: string; title: string; body: string },
): Promise<PullRequest> {
  const token = await getInstallationToken(installationId);
  const pr = await gh<RawPull>(
    `/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/pulls`,
    {
      method: "POST",
      token,
      body: { title: input.title, head: input.head, base: input.base, body: input.body },
    },
  );
  return { url: pr.html_url, number: pr.number };
}

export interface VerifyResult {
  green: boolean;
  runId: string | null;
}

interface RawRun {
  id: number;
  name?: string;
  path?: string;
  status: string;
  conclusion: string | null;
  head_sha: string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Poll the repo's workflow runs for the verify workflow on the pushed SHA until
 * it completes or the timeout elapses (spec 005 §3 step 6).
 */
export async function waitForVerify(
  installationId: string,
  org: string,
  repo: string,
  headSha: string,
  timeoutMs: number,
  intervalMs: number,
): Promise<VerifyResult> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const token = await getInstallationToken(installationId);
    const data = await gh<{ workflow_runs?: RawRun[] }>(
      `/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/actions/runs?head_sha=${encodeURIComponent(headSha)}&per_page=20`,
      { token },
    );
    const runs = data.workflow_runs ?? [];
    const verify = runs.find(
      (r) =>
        (r.name ?? "").toLowerCase().includes("verify") || (r.path ?? "").includes("verify"),
    );
    if (verify && verify.status === "completed") {
      return { green: verify.conclusion === "success", runId: String(verify.id) };
    }
    if (Date.now() >= deadline) {
      return { green: false, runId: verify ? String(verify.id) : null };
    }
    await sleep(intervalMs);
  }
}
