import { describe, expect, it } from "vitest";

import type { FleetAppStatus } from "./entities";
import {
  canTransitionApp,
  canTransitionOp,
  type FleetOpStatus,
  isValidAppName,
} from "./ops";

describe("fleet-op state machine", () => {
  it("walks running -> succeeded and running -> failed", () => {
    expect(canTransitionOp("running", "succeeded")).toBe(true);
    expect(canTransitionOp("running", "failed")).toBe(true);
  });

  it("treats succeeded and failed as terminal", () => {
    for (const s of ["succeeded", "failed"] as FleetOpStatus[]) {
      expect(canTransitionOp(s, "running")).toBe(false);
      expect(canTransitionOp(s, "succeeded")).toBe(false);
    }
  });

  it("rejects skipping straight to succeeded from pending", () => {
    expect(canTransitionOp("pending", "succeeded")).toBe(false);
    expect(canTransitionOp("pending", "running")).toBe(true);
  });
});

describe("fleet-app state machine", () => {
  it("allows the deploy and update happy paths", () => {
    expect(canTransitionApp("placing", "running")).toBe(true);
    expect(canTransitionApp("running", "updating")).toBe(true);
    expect(canTransitionApp("updating", "running")).toBe(true);
  });

  it("allows removal from every live state", () => {
    for (const s of ["placing", "running", "updating", "failed"] as FleetAppStatus[]) {
      expect(canTransitionApp(s, "removed")).toBe(true);
    }
  });

  it("treats removed as terminal", () => {
    for (const s of ["running", "placing", "updating", "failed"] as FleetAppStatus[]) {
      expect(canTransitionApp("removed", s)).toBe(false);
    }
  });

  it("lets a failed app recover", () => {
    expect(canTransitionApp("failed", "running")).toBe(true);
    expect(canTransitionApp("failed", "updating")).toBe(true);
  });
});

describe("app name validation (DNS-1123 label)", () => {
  it("accepts well-formed labels", () => {
    for (const n of ["a", "acme", "acme-store", "app123", "a1-b2-c3"]) {
      expect(isValidAppName(n)).toBe(true);
    }
  });

  it("rejects malformed labels", () => {
    for (const n of ["", "-lead", "trail-", "Upper", "under_score", "dot.dot", "sla/sh", "a".repeat(64)]) {
      expect(isValidAppName(n)).toBe(false);
    }
  });
});
