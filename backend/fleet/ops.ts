/**
 * Fleet state machines (spec 006 §2/§3), kept as data so they are unit-testable.
 *
 * `FleetOp` is the per-verb intent journal: running -> succeeded | failed.
 * `FleetApp` is the app lifecycle; `removed` is terminal, and every live state
 * can be removed. Observed status from the addon is written directly (it is a
 * fact about the cluster, not a command), so the app machine only constrains the
 * intentful transitions the endpoints drive.
 */
import type { FleetAppStatus } from "./entities";

export type FleetOpKind = "deploy" | "update" | "backup" | "remove";
export type FleetOpStatus = "pending" | "running" | "succeeded" | "failed";

const ALLOWED_OP: Record<FleetOpStatus, readonly FleetOpStatus[]> = {
  pending: ["running", "failed"],
  running: ["succeeded", "failed"],
  succeeded: [],
  failed: [],
};

export function canTransitionOp(from: FleetOpStatus, to: FleetOpStatus): boolean {
  return (ALLOWED_OP[from] ?? []).includes(to);
}

export class InvalidOpTransitionError extends Error {
  constructor(from: FleetOpStatus, to: FleetOpStatus) {
    super(`invalid fleet-op transition: ${from} -> ${to}`);
    this.name = "InvalidOpTransitionError";
  }
}

const ALLOWED_APP: Record<FleetAppStatus, readonly FleetAppStatus[]> = {
  placing: ["running", "failed", "removed"],
  running: ["updating", "failed", "removed"],
  updating: ["running", "failed", "removed"],
  failed: ["placing", "running", "updating", "removed"],
  removed: [],
};

export function canTransitionApp(from: FleetAppStatus, to: FleetAppStatus): boolean {
  return (ALLOWED_APP[from] ?? []).includes(to);
}

export function isRemoved(status: FleetAppStatus): boolean {
  return status === "removed";
}

export class InvalidAppTransitionError extends Error {
  constructor(from: FleetAppStatus, to: FleetAppStatus) {
    super(`invalid fleet-app transition: ${from} -> ${to}`);
    this.name = "InvalidAppTransitionError";
  }
}

/**
 * A DNS-1123 label. The app name is both a Kubernetes resource name and the
 * `<name>.<FLEET_BASE_DOMAIN>` subdomain label, so it must be a lowercase label.
 */
export function isValidAppName(name: string): boolean {
  return name.length <= 63 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name);
}
