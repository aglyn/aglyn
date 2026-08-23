/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Plugin scheduled jobs (AGL-435, Strapi cron parity): `/server` entries
 * register named jobs with an interval; a guarded platform runner route
 * (`/api/plugins/run-jobs`, secret header, invoked by the deployment's
 * scheduler) executes the due ones. The REGISTRY is pure — due-ness and
 * last-run persistence belong to the runner, so core stays storage-free.
 * Handlers must be idempotent and bounded (they share the API process).
 */

/*==========================================
 * THE LOCKDOWN GATE FOR BACKGROUND WORK (AGL-2495, from the AGL-1621 drill).
 *
 * A job runs on PLATFORM credentials, from a secret-gated route, with no
 * visitor, no session and no org — so none of the gates that cover the
 * visitor-facing write paths are anywhere near it. That is exactly the shape
 * the drill found in `publish-schedule-job.ts`: a scheduled publish firing on
 * a locked host. The commerce and bookings beats are the sharper version of
 * the same thing, because they touch orders, stock and money for a host that
 * may be suspended for abuse, non-payment or a legal takedown.
 *
 * ## Why the gate lives HERE and not at the six call sites
 *
 * Six call-site edits close six holes and guarantee the seventh is forgotten.
 * Gating in the job contract means the seventh job is covered the day it is
 * written: `lockdown` below is REQUIRED, so a new `registerPluginJob({…})`
 * does not compile until its author has answered "what does this touch".
 *
 * (The nx boundary is NOT why. `libs/plugins/*` CAN import
 * `@aglyn/tenant-data-admin` — it carries `scope:data` and `scope:aglyn`,
 * both on the `aglyn:addons` allowlist, and 196 files in `libs/plugins`
 * already do. The AGL-2495 sweep recorded the opposite as its reason for
 * deferring; it was wrong about the constraint and right about the design.)
 *
 * ## Why core cannot just call `getSiteLockdown` itself
 *
 * `@aglyn/tenant-data-admin` imports `@aglyn/aglyn/server`, so a core import
 * of it is a project CYCLE. Hence the same registry shape the platform uses
 * for every other app↔core edge (`registerOrderFulfilmentService`,
 * `registerBillingWebhookHandler`, `registerSitePageResolver`): the host app
 * registers the resolver from a place that may import the admin lib, and core
 * looks it up. Nothing is imported statically in either direction and a
 * self-host build with a different carrier registers its own.
 *
 * ## Fail-open is INHERITED, not re-decided
 *
 * The gate asks whatever the app registered — on the tenant that is
 * `getSiteLockdown`, which owns the fail-open/fail-closed decision (and the
 * takedown-class ratchet on top of it). This module deliberately holds no
 * parallel notion of what a lock is: it has one question and no opinion.
 *=========================================*/

/**
 * The one question a beat asks before touching a host: is a lock active that
 * forbids this write? Resolved by the host app, never by core.
 */
export type PluginJobHostLockedResolver = (
  hostId: string,
) => Promise<boolean> | boolean

let hostLockedResolver: PluginJobHostLockedResolver | null = null

/**
 * Registers the platform's per-host lockdown verdict for background work,
 * from a place that may import the admin data lib — on this platform,
 * `apps/tenant/utils/plugin-job-lockdown.ts`, loaded for its side effect by
 * the runner route beside the core job registrations.
 *
 * Idempotent and last-registration-wins, unlike `registerOrderFulfilmentService`
 * next door: that one holds a capability with a plugin OWNER, where a second
 * claimant is a misconfiguration. This is infrastructure the deployment
 * supplies exactly once, and a process that loads the module twice must not
 * throw on the second pass.
 */
export function registerPluginJobHostLockdown(
  resolver: PluginJobHostLockedResolver,
): void {
  hostLockedResolver = resolver
}

/** Has the deployment wired a verdict? Reported by the runner route. */
export function hasPluginJobHostLockdown(): boolean {
  return hostLockedResolver !== null
}

/** Test seam: forget the registration. */
export function resetPluginJobHostLockdownForTests(): void {
  hostLockedResolver = null
}

/**
 * The gate handed to a `per-host` job. One method, so there is exactly one
 * thing to call and one thing for the coverage guard to look for:
 *
 *   if (await gate.isLocked(hostId)) continue
 *
 * SKIPPED, NOT DROPPED is the caller's obligation and the reason this
 * answers a question rather than performing the skip: `continue` leaves the
 * row exactly as it was, so the work lands on the next beat after the lift.
 * A gate that swallowed the row — stamping it done, deleting it, advancing a
 * cursor past it — would turn a pause into a cancellation, which is what
 * `publish-schedule-job.ts` argued at length and what every job here copies.
 */
export interface PluginJobHostGate {
  isLocked(hostId: string): Promise<boolean>
}

/**
 * The gate as the runner builds it. Exported because the MANUAL doors —
 * `commerce/process-abandoned`, `bookings/reminders` and the other
 * `x-cron-secret` entry points that still exist for ops — call the same scan
 * functions and must ask the same question. A forced pass is still a pass.
 *
 * NO resolver registered answers "not locked", loudly and once. That is the
 * fail-open direction on purpose: a deployment that has not wired a carrier
 * (a self-host, a test process) must not have every background job welded
 * shut by infrastructure it never asked for. The loss is real and is why
 * `hasPluginJobHostLockdown` is reported by the runner route rather than
 * left to be inferred from nothing happening.
 */
export function pluginJobHostGate(): PluginJobHostGate {
  return {
    isLocked: async (hostId: string) => {
      if (!hostId) return false
      if (!hostLockedResolver) {
        warnMissingResolver()
        return false
      }
      return (await hostLockedResolver(hostId)) === true
    },
  }
}

let warnedMissingResolver = false
function warnMissingResolver(): void {
  if (warnedMissingResolver) return
  warnedMissingResolver = true
  console.error(
    '[plugin-jobs] no host lockdown resolver is registered — background ' +
      'jobs are running UNGATED. Register one with ' +
      'registerPluginJobHostLockdown() from the app that owns the runner.',
  )
}

/** Test seam: let the "warned once" latch be re-armed. */
export function resetPluginJobLockdownWarningForTests(): void {
  warnedMissingResolver = false
}

/**
 * What a job touches, and therefore what the runner owes it. REQUIRED on
 * every registration — the point of the field is that a new job cannot
 * compile without its author answering.
 */
export type PluginJobLockdown =
  /**
   * The job acts FOR HOSTS. The runner injects a {@link PluginJobHostGate}
   * and the handler must ask it for every host it is about to touch.
   */
  | { scope: 'per-host' }
  /**
   * The job touches nothing a lock could be about. `reason` is the argument,
   * and `lockdown-tenant-api-coverage.spec.ts` holds the set by name so a new
   * one has to be argued rather than declared.
   */
  | { scope: 'platform'; reason: string }

export interface PluginJob {
  pluginId: string
  /** Stable job name, unique within the plugin ('expire-stale-holds'). */
  name: string
  intervalMinutes: number
  description?: string
  /** See {@link PluginJobLockdown}. Required, deliberately. */
  lockdown: PluginJobLockdown
  handler: (gate: PluginJobHostGate) => Promise<void> | void
}

const jobs = new Map<string, PluginJob>()

export const pluginJobKey = (job: Pick<PluginJob, 'pluginId' | 'name'>) =>
  `${job.pluginId}:${job.name}`

/** Idempotent per pluginId:name. */
export function registerPluginJob(job: PluginJob): void {
  jobs.set(pluginJobKey(job), job)
}

export function listPluginJobs(): PluginJob[] {
  return [...jobs.values()]
}

export interface PluginJobResult {
  key: string
  ok: boolean
  error?: string
}

/**
 * The gate a `platform`-scoped job gets: one that REFUSES to answer.
 *
 * A declaration of `platform` scope is a claim that there is no host to ask
 * about. If such a job asks anyway, the claim is false and the registration
 * is the thing that needs fixing — so the runner surfaces it as that job's
 * own failure (isolated, like every other job error) instead of quietly
 * answering "not locked" and letting a mislabelled job mutate a locked site.
 *
 * This is the one place the contract is enforced at RUNTIME rather than by
 * the type or by the guard, and it is enforceable precisely because asking
 * is the only way to get an answer.
 */
function refusingGate(key: string): PluginJobHostGate {
  return {
    isLocked: async (hostId: string) => {
      throw new Error(
        `plugin job ${key} declared lockdown scope 'platform' but asked ` +
          `about host "${hostId}". Declare { scope: 'per-host' } instead.`,
      )
    },
  }
}

/**
 * Runs the jobs `due` selects (default: all), sequentially with error
 * isolation — one broken job never blocks the rest.
 *
 * Every handler is handed a {@link PluginJobHostGate} (AGL-2495). It is a
 * parameter rather than something the handler imports so that the runner
 * stays the single place the verdict comes from: swap what
 * `registerPluginJobHostLockdown` holds and every job on the beat changes
 * behaviour together, including one written next month.
 */
export async function runPluginJobs(
  due?: (job: PluginJob) => boolean,
): Promise<PluginJobResult[]> {
  const results: PluginJobResult[] = []
  for (const job of jobs.values()) {
    if (due && !due(job)) continue
    const key = pluginJobKey(job)
    try {
      await job.handler(
        job.lockdown?.scope === 'platform'
          ? refusingGate(key)
          : pluginJobHostGate(),
      )
      results.push({ key, ok: true })
    } catch (error) {
      console.error(`plugin job ${key} failed:`, error)
      results.push({ key, ok: false, error: String(error) })
    }
  }
  return results
}
