/**
 * Fleet API (spec 006 §2). Auth as spec 004/005: every endpoint requires auth
 * and is owner-scoped through the tenant (an app whose tenant the caller does
 * not own reads as 404). Every mutating verb opens a FleetOp intent-journal row,
 * gates through governance (spec 008, soft dependency), calls the fleet-native
 * addon, then records an attestation. remove requires the app name echoed back.
 */
import { APIError, api } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { governance } from "~encore/clients";

import { logError, logInfo } from "../lib/logger";
import { authorizeTenant, principalFrom } from "../tenants/access/authz";
import { activeInstallationForTenant } from "../tenants/store";

import { backupTarget, fleetBaseDomain, fleetImagePullSecret } from "./config";
import type { FleetApp, FleetAppStatus } from "./entities";
import { gateOrDeny } from "./gate";
import * as native from "./native";
import { isValidAppName } from "./ops";
import {
  createApp,
  finishOp,
  getAccessibleFleetApp,
  getApp,
  listAppsForTenant,
  namespaceFor,
  observeApp,
  setAppStatus,
  startOp,
} from "./store";

export interface FleetAppView {
  id: string;
  tenantId: string;
  stampJobId: string | null;
  name: string;
  namespace: string;
  image: string;
  volumeSize: number;
  host: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

function toView(a: FleetApp): FleetAppView {
  return {
    id: a.id,
    tenantId: a.tenantId,
    stampJobId: a.stampJobId,
    name: a.name,
    namespace: a.namespace,
    image: a.image,
    volumeSize: a.volumeSize,
    host: a.host,
    status: a.status,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

/** Best-effort attestation record; a governance outage must not fail a completed op. */
async function record(
  kind: "deploy" | "update" | "backup" | "remove",
  app: FleetApp,
  actor: string,
  payload: Record<string, unknown>,
  configHash: string | null,
): Promise<void> {
  try {
    await governance.record({
      kind,
      subject: app.id,
      actor,
      payload,
      ...(configHash ? { configHash } : {}),
    });
  } catch (err) {
    logError("fleet.record_failed", { app: app.id, kind, err: String(err) });
  }
}

/**
 * Provisioning verbs require an active installation (spec 011 §5.7). Teardown
 * verbs (remove) never do, so cleanup of an unlinked tenant stays reachable.
 */
async function requireActiveInstallation(tenantId: string): Promise<void> {
  const inst = await activeInstallationForTenant(tenantId);
  if (!inst) {
    throw APIError.failedPrecondition(
      "tenant has no active GitHub App installation; install the App before provisioning",
    );
  }
}

interface DeployRequest {
  id: string;
  name: string;
  image: string;
  volumeSize?: number;
  stampJobId?: string;
}

/**
 * POST /api/v1/tenants/:id/fleet: place an app. Gated soft (deploy is a
 * create-class verb). Writes a FleetApp (placing) and a FleetOp before the addon
 * runs, then reconciles both from the rollout result.
 */
export const deploy = api(
  { expose: true, auth: true, method: "POST", path: "/api/v1/tenants/:id/fleet" },
  async ({ id, name, image, volumeSize, stampJobId }: DeployRequest): Promise<FleetAppView> => {
    const auth = getAuthData()!;
    const tenant = await authorizeTenant(id, principalFrom(auth), "write");
    if (!tenant) throw APIError.notFound("tenant not found");
    await requireActiveInstallation(id);

    const appName = (name ?? "").trim().toLowerCase();
    if (!isValidAppName(appName)) {
      throw APIError.invalidArgument("name must be a DNS-1123 label (lowercase letters, digits, hyphens)");
    }
    const img = (image ?? "").trim();
    if (!img) throw APIError.invalidArgument("image is required");

    const domain = fleetBaseDomain();
    if (!domain) throw APIError.failedPrecondition("FLEET_BASE_DOMAIN is not configured");

    const namespace = namespaceFor(id);
    const host = `${appName}.${domain}`;
    const size = volumeSize && volumeSize > 0 ? volumeSize : 1;
    const pullSecret = fleetImagePullSecret();

    const gated = await gateOrDeny("deploy", { tenantId: id, app: appName, image: img }, "soft");
    const app = await createApp({
      tenantId: id,
      stampJobId: stampJobId ?? null,
      name: appName,
      namespace,
      image: img,
      volumeSize: size,
      host,
    });
    const op = await startOp(app.id, "deploy");

    try {
      const status = await native.placeApp({
        name: appName,
        namespace,
        image: img,
        host,
        volumeSizeGi: size,
        ...(pullSecret ? { imagePullSecret: pullSecret } : {}),
      });
      const ok = status.status === "running";
      await setAppStatus(app.id, ok ? "running" : "failed", {
        image: status.image || img,
        host: status.host || host,
      });
      await finishOp(op.id, ok ? "succeeded" : "failed", status.message ?? null);
      await record("deploy", app, auth.userID, { tenantId: id, app: appName, namespace, image: img, host }, gated.configHash);
      logInfo("fleet.deployed", { app: app.id, namespace, host, ok });
      return toView((await getApp(app.id))!);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await observeApp(app.id, "failed");
      await finishOp(op.id, "failed", message.slice(0, 500));
      logError("fleet.deploy_failed", { app: app.id, message });
      throw APIError.internal(`deploy failed: ${message}`);
    }
  },
);

interface AppParams {
  appId: string;
}

/** GET /api/v1/fleet/:appId: the app, with status refreshed from the addon (best-effort). */
export const status = api(
  { expose: true, auth: true, method: "GET", path: "/api/v1/fleet/:appId" },
  async ({ appId }: AppParams): Promise<FleetAppView> => {
    const auth = getAuthData()!;
    const app = await getAccessibleFleetApp(appId, principalFrom(auth), "read");
    if (!app) throw APIError.notFound("app not found");
    if (app.status === "removed") return toView(app);

    try {
      const live = await native.appStatus(app.name, app.namespace);
      await observeApp(app.id, live.status as FleetAppStatus, {
        host: live.host || app.host,
        image: live.image || app.image,
      });
      return toView((await getApp(app.id))!);
    } catch (err) {
      // Cluster unreachable: return last-known state rather than fail the read.
      logError("fleet.status_refresh_failed", { app: app.id, err: String(err) });
      return toView(app);
    }
  },
);

interface UpdateRequest {
  appId: string;
  image: string;
}

/** POST /api/v1/fleet/:appId/update: change the image (Recreate rollout). Gated strict. */
export const update = api(
  { expose: true, auth: true, method: "POST", path: "/api/v1/fleet/:appId/update" },
  async ({ appId, image }: UpdateRequest): Promise<FleetAppView> => {
    const auth = getAuthData()!;
    const app = await getAccessibleFleetApp(appId, principalFrom(auth), "write");
    if (!app) throw APIError.notFound("app not found");
    const img = (image ?? "").trim();
    if (!img) throw APIError.invalidArgument("image is required");
    await requireActiveInstallation(app.tenantId);

    const gated = await gateOrDeny("update", { tenantId: app.tenantId, app: app.name, image: img }, "strict");
    const op = await startOp(app.id, "update");
    await setAppStatus(app.id, "updating");

    try {
      const pullSecret = fleetImagePullSecret();
      const live = await native.updateApp({
        name: app.name,
        namespace: app.namespace,
        image: img,
        host: app.host,
        volumeSizeGi: app.volumeSize,
        ...(pullSecret ? { imagePullSecret: pullSecret } : {}),
      });
      const ok = live.status === "running";
      await setAppStatus(app.id, ok ? "running" : "failed", { image: img, host: live.host || app.host });
      await finishOp(op.id, ok ? "succeeded" : "failed", live.message ?? null);
      await record("update", app, auth.userID, { tenantId: app.tenantId, app: app.name, image: img }, gated.configHash);
      logInfo("fleet.updated", { app: app.id, image: img, ok });
      return toView((await getApp(app.id))!);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await observeApp(app.id, "failed");
      await finishOp(op.id, "failed", message.slice(0, 500));
      logError("fleet.update_failed", { app: app.id, message });
      throw APIError.internal(`update failed: ${message}`);
    }
  },
);

export interface BackupResponse {
  repository: string;
  tag: string;
  jobName: string;
}

/** POST /api/v1/fleet/:appId/backup: scale-down restic backup to Hetzner Object Storage. Gated soft. */
export const backup = api(
  { expose: true, auth: true, method: "POST", path: "/api/v1/fleet/:appId/backup" },
  async ({ appId }: AppParams): Promise<BackupResponse> => {
    const auth = getAuthData()!;
    const app = await getAccessibleFleetApp(appId, principalFrom(auth), "write");
    if (!app) throw APIError.notFound("app not found");
    const target = backupTarget();
    if (!target) throw APIError.failedPrecondition("backup target is not configured (FLEET_S3_RESTIC_PASSWORD / S3 keys)");
    await requireActiveInstallation(app.tenantId);

    const gated = await gateOrDeny("backup", { tenantId: app.tenantId, app: app.name }, "soft");
    const op = await startOp(app.id, "backup");

    try {
      const result = await native.backupApp(app.name, app.namespace, target);
      await finishOp(op.id, "succeeded", `restic ${result.repository} tag ${result.tag}`);
      await record("backup", app, auth.userID, { tenantId: app.tenantId, app: app.name, repository: result.repository, tag: result.tag }, gated.configHash);
      logInfo("fleet.backed_up", { app: app.id, repository: result.repository, tag: result.tag });
      return { repository: result.repository, tag: result.tag, jobName: result.jobName };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await finishOp(op.id, "failed", message.slice(0, 500));
      logError("fleet.backup_failed", { app: app.id, message });
      throw APIError.internal(`backup failed: ${message}`);
    }
  },
);

interface RemoveRequest {
  appId: string;
  /** Must equal the app name (spec 006 §3 destructive guard). */
  confirm: string;
}

/** DELETE /api/v1/fleet/:appId: tear the app's resources down. Gated strict; name-confirm guarded. */
export const remove = api(
  { expose: true, auth: true, method: "DELETE", path: "/api/v1/fleet/:appId" },
  async ({ appId, confirm }: RemoveRequest): Promise<FleetAppView> => {
    const auth = getAuthData()!;
    const app = await getAccessibleFleetApp(appId, principalFrom(auth), "write");
    if (!app) throw APIError.notFound("app not found");
    if ((confirm ?? "") !== app.name) {
      throw APIError.invalidArgument(`confirm must equal the app name "${app.name}"`);
    }

    const gated = await gateOrDeny("remove", { tenantId: app.tenantId, app: app.name, appId }, "strict");
    const op = await startOp(app.id, "remove");

    try {
      await native.removeApp(app.name, app.namespace);
      await setAppStatus(app.id, "removed");
      await finishOp(op.id, "succeeded");
      await record("remove", app, auth.userID, { tenantId: app.tenantId, app: app.name, namespace: app.namespace }, gated.configHash);
      logInfo("fleet.removed", { app: app.id });
      return toView((await getApp(app.id))!);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await finishOp(op.id, "failed", message.slice(0, 500));
      logError("fleet.remove_failed", { app: app.id, message });
      throw APIError.internal(`remove failed: ${message}`);
    }
  },
);

interface TenantParams {
  id: string;
}

interface ListFleetResponse {
  apps: FleetAppView[];
}

/** GET /api/v1/tenants/:id/fleet: the tenant's apps, newest first. */
export const listFleet = api(
  { expose: true, auth: true, method: "GET", path: "/api/v1/tenants/:id/fleet" },
  async ({ id }: TenantParams): Promise<ListFleetResponse> => {
    const auth = getAuthData()!;
    const tenant = await authorizeTenant(id, principalFrom(auth), "read");
    if (!tenant) throw APIError.notFound("tenant not found");
    const rows = await listAppsForTenant(id);
    return { apps: rows.map(toView) };
  },
);

interface TenantAppSummaryParams {
  tenantId: string;
}

export interface TenantAppSummary {
  /** Apps not in the terminal `removed` state (the delete-tenant precondition). */
  activeCount: number;
  total: number;
}

/**
 * GET /fleet/internal/tenants/:tenantId/summary: app counts for a tenant.
 * Internal (expose:false), called by the tenants service to enforce the
 * delete-tenant precondition (spec 011 §5.5) without a tenants<->fleet cycle.
 */
export const tenantAppSummary = api(
  { expose: false, method: "GET", path: "/fleet/internal/tenants/:tenantId/summary" },
  async ({ tenantId }: TenantAppSummaryParams): Promise<TenantAppSummary> => {
    const rows = await listAppsForTenant(tenantId);
    const active = rows.filter((a) => a.status !== "removed");
    return { activeCount: active.length, total: rows.length };
  },
);
