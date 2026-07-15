/**
 * Fleet data access on CoreLedger (spec 006 §2).
 *
 * Schema is ensured eagerly at load. Command transitions (deploy/update/remove)
 * go through `setAppStatus`, which enforces the FleetApp machine; status
 * observed from the cluster is written with `observeApp` (a fact, not a command,
 * so it is not machine-constrained). Every mutating verb opens a FleetOp with
 * `startOp` and closes it with `finishOp` (the intent journal). CoreLedger has no
 * native upsert, so writes use the find-then-write-in-a-transaction idiom.
 */
import { ledger } from "../core/ledger";

import { getOwnedTenant } from "../tenants/store";

import { type FleetAppStatus, FleetApp, FleetOp } from "./entities";
import {
  canTransitionApp,
  canTransitionOp,
  type FleetOpKind,
  type FleetOpStatus,
  InvalidAppTransitionError,
  InvalidOpTransitionError,
} from "./ops";

export const dbReady: Promise<void> = ledger().init([FleetApp, FleetOp]);
dbReady.catch(() => {});

export { ledger };

export function apps() {
  return ledger().repo(FleetApp);
}

export function ops() {
  return ledger().repo(FleetOp);
}

/** One namespace per tenant (spec 006 §3). */
export function namespaceFor(tenantId: string): string {
  return `t-${tenantId}`;
}

export async function getApp(id: string): Promise<FleetApp | null> {
  await dbReady;
  return apps().findById(id);
}

export async function listAppsForTenant(tenantId: string): Promise<FleetApp[]> {
  await dbReady;
  return apps().findWhere({ tenantId }, { orderBy: "createdAt", direction: "desc" });
}

/** The app, only if the caller owns its tenant (else null: existence is not leaked). */
export async function getOwnedFleetApp(
  appId: string,
  ownerUserId: string,
): Promise<FleetApp | null> {
  await dbReady;
  const app = await apps().findById(appId);
  if (!app) return null;
  const tenant = await getOwnedTenant(app.tenantId, ownerUserId);
  if (!tenant) return null;
  return app;
}

export interface CreateAppInput {
  tenantId: string;
  stampJobId: string | null;
  name: string;
  namespace: string;
  image: string;
  volumeSize: number;
  host: string;
}

export async function createApp(input: CreateAppInput): Promise<FleetApp> {
  await dbReady;
  const now = new Date();
  const app = Object.assign(new FleetApp(), {
    tenantId: input.tenantId,
    stampJobId: input.stampJobId,
    name: input.name,
    namespace: input.namespace,
    image: input.image,
    volumeSize: input.volumeSize,
    host: input.host,
    status: "placing" as FleetAppStatus,
    createdAt: now,
    updatedAt: now,
  });
  await apps().insert(app);
  return app;
}

/** Intentful status change, enforcing the FleetApp machine (deploy/update/remove). */
export async function setAppStatus(
  id: string,
  to: FleetAppStatus,
  patch: Partial<Pick<FleetApp, "image" | "host">> = {},
): Promise<void> {
  await dbReady;
  const now = new Date();
  await ledger().transaction(async ({ repo }) => {
    const rows = repo(FleetApp);
    const app = await rows.findById(id);
    if (!app) throw new Error(`fleet app ${id} not found`);
    if (app.status !== to && !canTransitionApp(app.status, to)) {
      throw new InvalidAppTransitionError(app.status, to);
    }
    await rows.updateById(id, { status: to, updatedAt: now, ...patch });
  });
}

/** Record status observed from the cluster (unconstrained; a fact, not a command). */
export async function observeApp(
  id: string,
  status: FleetAppStatus,
  patch: Partial<Pick<FleetApp, "image" | "host">> = {},
): Promise<void> {
  await dbReady;
  await apps().updateById(id, { status, updatedAt: new Date(), ...patch });
}

/** Open the intent journal for a mutating verb (spec 006 §3). */
export async function startOp(appId: string, kind: FleetOpKind): Promise<FleetOp> {
  await dbReady;
  const op = Object.assign(new FleetOp(), {
    appId,
    kind,
    status: "running" as FleetOpStatus,
    createdAt: new Date(),
  });
  await ops().insert(op);
  return op;
}

/** Close the intent journal, recording the outcome (and any log / artifact). */
export async function finishOp(
  id: string,
  to: FleetOpStatus,
  log: string | null = null,
): Promise<void> {
  await dbReady;
  await ledger().transaction(async ({ repo }) => {
    const rows = repo(FleetOp);
    const op = await rows.findById(id);
    if (!op) return;
    if (!canTransitionOp(op.status, to)) throw new InvalidOpTransitionError(op.status, to);
    await rows.updateById(id, { status: to, log });
  });
}
