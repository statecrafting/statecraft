/**
 * The stamp pipeline (spec 005 §3): export the pinned template, read its
 * contract, build the born-with cert, run the scaffold verb, create the repo,
 * push the tree, and watch the born-green verify run. The endpoint kicks this
 * un-awaited; progress is recorded on the StampJob via the status state machine,
 * so a reader (GET /stamps/:jobId) always sees where it is. Capabilities are
 * gated on the contract version actually read (scaffold verb, cert emission), so
 * the factory upgrades itself when the template does (spec 005 §1).
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { logError, logInfo } from "../lib/logger";
import { getInstallationToken } from "../tenants/github-app";

import { buildCert, certHash } from "./cert";
import {
  FACTORY_STAMPED_BY_ID,
  TEMPLATE_CACHE_DIR,
  TEMPLATE_REPO,
  VERIFY_POLL_INTERVAL_MS,
  VERIFY_TIMEOUT_MS,
} from "./config";
import {
  assertSupportedContract,
  hasScaffoldVerb,
  readContract,
  type ResolvedSlots,
  supportsCert,
  validateSlots,
} from "./contract";
import { ensureTemplateCache, exportPinned, pushInitialCommit, resolveRef } from "./git";
import { createRepo, waitForVerify } from "./github";
import { runScaffold } from "./scaffold";
import { fail, getJob, patchJob, transition } from "./store";

/** Minimal factory-side substitution for a contract with no scaffold verb (enrahitu spec 014 §3 step 2). */
async function v0Substitute(workdir: string, slots: ResolvedSlots): Promise<void> {
  const pkgPath = join(workdir, "package.json");
  try {
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as Record<string, unknown>;
    pkg.name = slots.appName;
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  } catch {
    // No package.json to substitute: nothing to do.
  }
}

export async function runStampPipeline(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  if (!job) return;
  let workdir: string | undefined;

  try {
    await transition(jobId, "stamping");

    // 1. Export the pinned template tree.
    await ensureTemplateCache(TEMPLATE_CACHE_DIR, TEMPLATE_REPO);
    const pinnedSha = await resolveRef(TEMPLATE_CACHE_DIR, job.templateRef);
    workdir = await mkdtemp(join(tmpdir(), "factory-stamp-"));
    await exportPinned(TEMPLATE_CACHE_DIR, pinnedSha, workdir);

    // 2. Read + validate the contract.
    const contract = readContract(await readFile(join(workdir, "template.toml"), "utf8"));
    assertSupportedContract(contract);
    await patchJob(jobId, { contractVersion: contract.contractVersion });
    const slots = validateSlots(contract, { appName: job.appName, org: job.org });

    // 3. Build the born-with cert (gated on contract support).
    let certPath: string | undefined;
    let hash: string | undefined;
    if (supportsCert(contract)) {
      const cert = buildCert({
        appName: job.appName,
        org: job.org,
        templateName: contract.templateName,
        templateVersion: contract.templateVersion,
        contractVersion: contract.contractVersion,
        commit: pinnedSha,
        posture: job.posture,
        stampedById: FACTORY_STAMPED_BY_ID,
      });
      hash = certHash(cert);
      certPath = join(tmpdir(), `factory-cert-${jobId}.json`);
      await writeFile(certPath, `${JSON.stringify(cert, null, 2)}\n`, "utf8");
    } else {
      logInfo("factory.cert_skipped", { jobId, contractVersion: contract.contractVersion });
    }

    // 4. Scaffold (preferred) or v0 fallback.
    if (hasScaffoldVerb(contract)) {
      await runScaffold({
        workdir,
        appName: slots.appName,
        org: slots.org,
        frontend: slots.frontend || undefined,
        certPath,
        stampedFrom: pinnedSha,
      });
    } else {
      await v0Substitute(workdir, slots);
      if (certPath) {
        const dest = join(workdir, ".stagecraft", "born-with.json");
        await mkdir(join(workdir, ".stagecraft"), { recursive: true });
        await writeFile(dest, await readFile(certPath, "utf8"), "utf8");
      }
    }

    if (hash) await patchJob(jobId, { certHash: hash });
    if (certPath) await rm(certPath, { force: true }).catch(() => {});

    // 5. Create the customer repo.
    await transition(jobId, "pushing");
    const repo = await createRepo(job.installationId, job.org, job.appName);

    // 6. Push the stamped tree.
    const token = await getInstallationToken(job.installationId);
    const headSha = await pushInitialCommit({
      workdir,
      org: job.org,
      repo: repo.name,
      token,
      message: `Stamp ${job.appName} from enrahitu ${pinnedSha.slice(0, 7)}`,
    });

    // 7. Watch the born-green verify run.
    await transition(jobId, "verifying");
    const result = await waitForVerify(
      job.installationId,
      job.org,
      repo.name,
      headSha,
      VERIFY_TIMEOUT_MS,
      VERIFY_POLL_INTERVAL_MS,
    );
    const patch: Partial<{ checksRunId: string; error: string }> = {};
    if (result.runId) patch.checksRunId = result.runId;
    if (!result.green) patch.error = "born-green verify run did not pass";
    await transition(jobId, result.green ? "green" : "failed", patch);
    logInfo("factory.stamp_done", { jobId, green: result.green, repo: repo.fullName });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError("factory.stamp_failed", { jobId, message });
    await fail(jobId, message).catch(() => {});
  } finally {
    if (workdir) await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}
