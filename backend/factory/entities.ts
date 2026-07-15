/**
 * Factory CoreLedger entity (spec 005 §3).
 *
 * One `StampJob` row per stamp request; the async pipeline records progress by
 * transitioning `status` and filling `certHash` / `checksRunId` / `error`. The
 * pipeline re-reads the job, so everything it needs (including `posture`, which
 * feeds the born-with cert) is persisted here. CoreLedger runs the Postgres
 * driver in the control plane; no Encore SQLDatabase, no direct SQL.
 */
import { randomUUID } from "node:crypto";

import { Column, Entity } from "../core/ledger";

import type { StampStatus } from "./jobs";

export type Posture = "none" | "assisted" | "autonomous";

@Entity("stamp_job")
export class StampJob {
  @Column({ primary: true }) id = randomUUID();
  @Column({ index: true }) tenantId = "";
  @Column() installationId = "";
  @Column({ index: true }) appName = "";
  @Column() org = "";
  @Column() templateRef = "";
  @Column() contractVersion = "";
  @Column() posture: Posture = "none";
  @Column({ index: true }) status: StampStatus = "queued";
  @Column({ nullable: true }) checksRunId: string | null = null;
  @Column({ nullable: true }) certHash: string | null = null;
  @Column({ nullable: true }) error: string | null = null;
  @Column({ type: "timestamp" }) createdAt = new Date();
  @Column({ type: "timestamp" }) updatedAt = new Date();
}
