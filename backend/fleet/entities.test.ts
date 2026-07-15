/**
 * FleetApp / FleetOp persistence round-trips (spec 006 §4). libSQL arm always
 * runs; the Postgres arm runs under TEST_POSTGRES_URL (CI sets it), mirroring the
 * factory/tenants/core-ledger skip pattern.
 */
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Ledger, LibsqlDriver, PostgresDriver } from "../core/ledger";

import { FleetApp, FleetOp } from "./entities";

const PG_URL = process.env.TEST_POSTGRES_URL;

interface Arm {
  name: string;
  skip: boolean;
  make: () => Ledger;
}

const arms: Arm[] = [
  {
    name: "libsql",
    skip: false,
    make: () =>
      new Ledger(new LibsqlDriver({ url: `file:${join(tmpdir(), `fleet-${randomUUID()}.db`)}` })),
  },
  {
    name: "postgres",
    skip: !PG_URL,
    make: () => new Ledger(new PostgresDriver({ url: PG_URL! })),
  },
];

for (const arm of arms) {
  const suite = arm.skip ? describe.skip : describe;
  suite(`fleet entities on ${arm.name}`, () => {
    let ledger: Ledger;

    beforeAll(async () => {
      ledger = arm.make();
      await ledger.init([FleetApp, FleetOp]);
    });

    afterAll(async () => {
      await ledger?.close();
    });

    it("round-trips a FleetApp with a nullable stampJobId and integer volumeSize", async () => {
      const repo = ledger.repo(FleetApp);
      const app = Object.assign(new FleetApp(), {
        tenantId: `t-${randomUUID()}`,
        name: `acme-${randomUUID().slice(0, 8)}`,
        namespace: `t-${randomUUID()}`,
        image: "ghcr.io/acme/app:v1",
        volumeSize: 3,
        host: "acme.deployd.xyz",
        status: "placing" as const,
      });
      await repo.insert(app);

      const back = await repo.findById(app.id);
      expect(back?.image).toBe("ghcr.io/acme/app:v1");
      expect(back?.volumeSize).toBe(3);
      expect(back?.status).toBe("placing");
      expect(back?.stampJobId).toBeNull();

      await repo.updateById(app.id, {
        status: "running",
        image: "ghcr.io/acme/app:v2",
        updatedAt: new Date(),
      });
      const done = await repo.findById(app.id);
      expect(done?.status).toBe("running");
      expect(done?.image).toBe("ghcr.io/acme/app:v2");
    });

    it("round-trips a FleetOp intent-journal row", async () => {
      const repo = ledger.repo(FleetOp);
      const op = Object.assign(new FleetOp(), {
        appId: randomUUID(),
        kind: "backup" as const,
        status: "running" as const,
      });
      await repo.insert(op);

      const back = await repo.findById(op.id);
      expect(back?.kind).toBe("backup");
      expect(back?.status).toBe("running");
      expect(back?.log).toBeNull();

      await repo.updateById(op.id, {
        status: "succeeded",
        log: "restic s3:.../t-x/acme tag acme-1",
      });
      const done = await repo.findById(op.id);
      expect(done?.status).toBe("succeeded");
      expect(done?.log).toContain("restic");
    });
  });
}
