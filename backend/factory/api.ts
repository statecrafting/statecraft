/**
 * Factory API (spec 005 §3). Auth as spec 004: every endpoint requires auth and
 * is owner-scoped through the tenant (a job whose tenant the caller does not own
 * reads as 404). POST kicks the async pipeline and returns the job; the two GETs
 * report status. Posture is REQUEST-EXPLICIT: a stamp with no posture is
 * rejected, never defaulted.
 */
import { APIError, api } from "encore.dev/api";
import { getAuthData } from "~encore/auth";

import { getOwnedTenant, listInstallationsForTenant } from "../tenants/store";

import { isPosture } from "./cert";
import { TEMPLATE_REF } from "./config";
import type { Posture, StampJob } from "./entities";
import { runStampPipeline } from "./pipeline";
import { createOrGetLiveJob, getJob, listJobsForTenant } from "./store";

export interface StampJobView {
  id: string;
  tenantId: string;
  appName: string;
  org: string;
  templateRef: string;
  contractVersion: string;
  posture: string;
  status: string;
  certHash: string | null;
  checksRunId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

function toView(j: StampJob): StampJobView {
  return {
    id: j.id,
    tenantId: j.tenantId,
    appName: j.appName,
    org: j.org,
    templateRef: j.templateRef,
    contractVersion: j.contractVersion,
    posture: j.posture,
    status: j.status,
    certHash: j.certHash,
    checksRunId: j.checksRunId,
    error: j.error,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  };
}

interface CreateStampRequest {
  id: string;
  appName: string;
  targetOrg: string;
  frontend?: string;
  posture: string;
}

/**
 * POST /api/v1/tenants/:id/stamps: queue a stamp job and kick the pipeline.
 * Idempotent: a live job for the same tenant + appName is returned as-is.
 */
export const createStamp = api(
  { expose: true, auth: true, method: "POST", path: "/api/v1/tenants/:id/stamps" },
  async ({ id, appName, targetOrg, posture }: CreateStampRequest): Promise<StampJobView> => {
    const auth = getAuthData()!;
    const tenant = await getOwnedTenant(id, auth.userID);
    if (!tenant) throw APIError.notFound("tenant not found");

    const name = (appName ?? "").trim();
    if (!name) throw APIError.invalidArgument("appName is required");
    const org = (targetOrg ?? "").trim();
    if (!org) throw APIError.invalidArgument("targetOrg is required");
    if (!posture || !isPosture(posture)) {
      throw APIError.invalidArgument("posture is required and must be one of none, assisted, autonomous");
    }

    const installs = await listInstallationsForTenant(id);
    const inst = installs.find((i) => i.githubOrg === org && i.status === "active");
    if (!inst) {
      throw APIError.failedPrecondition(`tenant has no active installation for org ${org}`);
    }

    const { job, created } = await createOrGetLiveJob({
      tenantId: id,
      installationId: inst.installationId,
      appName: name,
      org,
      templateRef: TEMPLATE_REF,
      contractVersion: "",
      posture: posture as Posture,
    });
    if (created) void runStampPipeline(job.id).catch(() => {});
    return toView(job);
  },
);

interface StampJobParams {
  jobId: string;
}

/** GET /api/v1/stamps/:jobId: job status (owner-scoped via the job's tenant). */
export const getStamp = api(
  { expose: true, auth: true, method: "GET", path: "/api/v1/stamps/:jobId" },
  async ({ jobId }: StampJobParams): Promise<StampJobView> => {
    const auth = getAuthData()!;
    const job = await getJob(jobId);
    if (!job) throw APIError.notFound("stamp job not found");
    const tenant = await getOwnedTenant(job.tenantId, auth.userID);
    if (!tenant) throw APIError.notFound("stamp job not found");
    return toView(job);
  },
);

interface ListStampsResponse {
  stamps: StampJobView[];
}

/** GET /api/v1/tenants/:id/stamps: the tenant's stamp jobs, newest first. */
export const listStamps = api(
  { expose: true, auth: true, method: "GET", path: "/api/v1/tenants/:id/stamps" },
  async ({ id }: { id: string }): Promise<ListStampsResponse> => {
    const auth = getAuthData()!;
    const tenant = await getOwnedTenant(id, auth.userID);
    if (!tenant) throw APIError.notFound("tenant not found");
    const rows = await listJobsForTenant(id);
    return { stamps: rows.map(toView) };
  },
);
