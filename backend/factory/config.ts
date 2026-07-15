/**
 * Factory configuration (spec 005 §3).
 *
 * The template source is pinned to a commit SHA, never floating main: the
 * factory always stamps from a known-good tree. The pin defaults to a recorded
 * enrahitu commit (contract 0.5.0: scaffold verb + provenance) and is
 * overridable via env so the factory can be pointed at a newer known-good SHA
 * without a code change. The template repo is public, so it is cloned over
 * https with no credentials; the customer repo is pushed over https with the
 * tenant's installation token.
 */
import { join } from "node:path";

/** Public enrahitu template repo. Overridable (e.g. a mirror) via env. */
export const TEMPLATE_REPO =
  process.env.FACTORY_TEMPLATE_REPO ?? "https://github.com/stagecraft-ing/enrahitu.git";

/**
 * Pinned template commit. Default: enrahitu main #16 @ contract 0.5.0 (scaffold
 * verb v0.4, provenance v0.3), which carries the born-with pages.yml with the
 * project-Pages base-path fix (enrahitu spec 013) that the opt-in Pages
 * provisioning (spec 005 §3) depends on: an older pin has no (or a
 * base-path-buggy) pages.yml. Never floating main (spec 005 §3).
 */
export const TEMPLATE_REF =
  process.env.FACTORY_TEMPLATE_REF ?? "4a4eab1405ad159f8d3c9b01cc612798ea2e9f26";

/** The bare-clone cache and per-job workdirs live under the app data dir. */
export const FACTORY_DATA_DIR =
  process.env.FACTORY_DATA_DIR ?? join(process.cwd(), ".data", "factory");

export const TEMPLATE_CACHE_DIR = join(FACTORY_DATA_DIR, "enrahitu.git");

/** Identity recorded in the born-with cert's stampedBy field. */
export const FACTORY_STAMPED_BY_ID = "stagecraft/factory@1";

/** Git commit author for the initial stamped commit (spec 005 §3 step 5). */
export const FACTORY_GIT_AUTHOR_NAME = "Stagecraft Factory";
export const FACTORY_GIT_AUTHOR_EMAIL = "factory@stagecraft.ing";

/** How long to wait for the born-green verify run before failing (spec 005 §3 step 6). */
export const VERIFY_TIMEOUT_MS = 30 * 60 * 1000;
export const VERIFY_POLL_INTERVAL_MS = 15 * 1000;
