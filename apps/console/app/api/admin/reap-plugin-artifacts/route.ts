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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import { pluginArtifactClaims } from '@aglyn/aglyn/plugin-manager/plugin-artifact-inventory'
import { serverPluginLoader } from '../../../../utils/server-plugin-loader'
import { isCronDryRun } from '../../../../utils/cron-auth'
import { recordCronBeat } from '../../../../utils/cron-beat'
import {
  authorizeMaintenanceActor,
  recordStaffMaintenanceRun,
} from '../../../../utils/server/maintenance-actor'
import {
  findMaintenanceJob,
  refuseStaffRun,
  type StaffRunRequest,
} from '../../../../utils/maintenance-jobs'
import {
  ArtifactObject,
  artifactClaimKey,
  planArtifactReap,
} from '../../../../utils/server/reap-plugin-artifacts'

/**
 * This job's console descriptor (AGL-1949) — the confirmation phrase and the
 * audit action, shared with the Staff → Maintenance page rather than
 * transcribed into it.
 */
const JOB = findMaintenanceJob('reap-plugin-artifacts') as ReturnType<
  typeof findMaintenanceJob
> &
  object

/** Objects younger than this are never reaped (mid-publish guard). */
const MIN_AGE_DAYS = 7
/** Ceiling on permanent deletions per run. */
const MAX_DELETES = 200

/**
 * The most claims one run will walk before refusing to reap at all.
 *
 * Not a page cap — the walk is exhaustive by construction. This is the
 * ceiling past which the run declines to draw a conclusion, because the ONE
 * unsafe outcome here is an incomplete claim set: every object this job
 * deletes is deleted precisely because nothing claimed it, and a claim the
 * scan never reached looks exactly like a claim that does not exist. The
 * bucket has no object versioning, so that mistake is permanent.
 *
 * Refusing is therefore the safe answer, and it is loud: the run reports the
 * ceiling it hit rather than reaping what it managed to see.
 *
 * IT STAYS HERE THOUGH THE WALK MOVED (AGL-3080). How far this deployment is
 * willing to read before it declines to delete is the console's policy about
 * its own bucket, so the plugin is TOLD the threshold and reports against it
 * rather than choosing one — a plugin that raised its own ceiling would be
 * widening the platform's appetite for a permanent delete.
 */
const MAX_CLAIMS_SCANNED = 100_000

/**
 * Scheduled orphan reaping for the plugin-artifacts bucket (AGL-942).
 * Same invocation contract as the other scheduled routes: POST with
 * `x-cron-secret`, or Vercel Cron's bearer GET (`isCronAuthorized`).
 *
 * `?dryRun=1` (or `{ dryRun: true }`) reports the plan without deleting —
 * that is what `tools/scripts/reap-plugin-artifacts.mjs` sends by default,
 * so a human can read the list before any bytes go away. Deletions are
 * permanent: the bucket has no object versioning.
 *
 * Why a route rather than a standalone script: the join needs the Admin SDK
 * AND `PLUGIN_ARTIFACTS_BUCKET`, both of which the console runtime already
 * has, and it keeps the deletion rules in one place instead of drifting
 * between a script and a server.
 */
async function handler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders, query, body } =
    await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST' && method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  if (!process.env.CRON_SECRET) {
    return Response.json(
      { error: 'Artifact reaping is not configured (CRON_SECRET).' },
      { status: 501 },
    )
  }
  // Staff, or the scheduler (AGL-1949). This route was cron-secret-only, so
  // the artifacts bucket — already invisible to the Firebase console — could
  // only be inspected from a shell holding the production secret.
  let actor: Awaited<ReturnType<typeof authorizeMaintenanceActor>>
  try {
    actor = await authorizeMaintenanceActor(headers)
  } catch (error) {
    // A staff token that could not be checked at all: an outage, not a
    // refusal, so it answers 500 rather than 401 (AGL-2816).
    console.error('[admin/reap-plugin-artifacts] token verification failed', error)
    return Response.json({ error: 'Could not check your sign-in' }, { status: 500 })
  }
  if (!actor) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  // AGL-1955 — the mark `/api/health/crons` reads to notice this job going
  // AWAY. Stamped on the invocation, not on the work, so a run that finds
  // nothing to do still proves the schedule is alive; the SCHEDULER's POST
  // only, because a human pressing the button in the console is not the cron
  // and must not make a job that stopped being scheduled read as alive.
  if (method === 'POST' && actor.kind === 'cron') {
    await recordCronBeat('reap-plugin-artifacts')
  }
  const bucketName = process.env.PLUGIN_ARTIFACTS_BUCKET
  if (!bucketName) {
    return Response.json(
      { error: 'Plugin artifacts are not configured (PLUGIN_ARTIFACTS_BUCKET).' },
      { status: 501 },
    )
  }

  // Dry run is the SAFE default for a GET (a browser or a curl someone
  // pasted); the cron POSTs with an explicit dryRun=0. The rule moved into
  // `isCronDryRun` (AGL-2084) — this route and `reverify-plugin-versions` each
  // had their own transcription of it, and `audit-archive`, which deletes
  // Firestore rows, was the copy nobody ever wrote.
  const dryRun = isCronDryRun({ method, query, body })

  /*==========================================
   * A CONSOLE BUTTON IS WORSE THAN CURL UNLESS IT IS HARDER TO FIRE (AGL-1949).
   *
   * Deletions here are permanent — the bucket has no object versioning, so
   * there is nothing to restore from. A staff-triggered real run therefore
   * needs a reason AND the exact typed phrase, enforced HERE and not only in
   * the page: a control that lives only in the UI is not a control.
   *
   * The scheduler is untouched — it has no user, no reason and no phrase.
   *=========================================*/
  if (actor.kind === 'staff' && !dryRun) {
    const refusal = refuseStaffRun(JOB, (body ?? {}) as StaffRunRequest)
    if (refusal) return Response.json({ error: refusal }, { status: 400 })
  }

  try {
    const app = firebaseAdmin.app()
    const firestore = app.firestore()
    // Recorded BEFORE any object is deleted. The run audits the object list
    // it removed, but only on success — a sweep that dies halfway is exactly
    // when "who asked for this, and why now" is the open question.
    if (actor.kind === 'staff' && !dryRun) {
      await recordStaffMaintenanceRun(
        firestore,
        JOB,
        actor,
        String((body as { reason?: unknown } | undefined)?.reason ?? ''),
      )
    }
    const bucket = app.storage().bucket(bucketName)

    const [files] = await bucket.getFiles({ prefix: 'artifacts/' })
    const objects: ArtifactObject[] = files.map((file) => ({
      name: file.name,
      createdAt: new Date(file.metadata?.timeCreated ?? 0),
      size: Number(file.metadata?.size ?? 0),
    }))

    /*
     * Every claim in the platform, from the plugin that stores them
     * (AGL-3080). This route used to walk `pluginVersions` and
     * `marketplaceListings` itself — a plugin's storage reached around the
     * plugin, from `/api/admin`.
     *
     * ## Why an unowned bucket REFUSES rather than reaps
     *
     * A claim nothing reported is indistinguishable from a claim that does
     * not exist, and this job deletes exactly the objects nothing claims,
     * permanently, from a bucket with no object versioning. So
     * `pluginArtifactClaims` never answers an empty list that means "could
     * not read": nothing registered, a throw inside the walk, and a walk
     * that passed `MAX_CLAIMS_SCANNED` all arrive as a refusal, and the run
     * stops here with its reason instead.
     *
     * `ensureAll` first, and awaited — the whole reason a runtime registry
     * is safe for this reader is that it loads the plugins before it asks.
     */
    await serverPluginLoader.ensureAll(['consoleApi'])
    const claims = await pluginArtifactClaims({
      maxScanned: MAX_CLAIMS_SCANNED,
    })
    if (claims.outcome === 'refused') {
      return Response.json(
        { error: claims.reason, claimsScanned: claims.scanned },
        { status: 507 },
      )
    }
    const claimed = new Set<string>()
    const liveListingIds = new Set<string>()
    for (const claim of claims.rows) {
      claimed.add(
        artifactClaimKey(claim.listingId, claim.version, claim.sha256),
      )
      // Reported, never reaped: the owning record is gone but installs still
      // resolve the version by path, so the bytes are still being loaded.
      if (claim.ownerLive) liveListingIds.add(claim.listingId)
    }

    const plan = planArtifactReap(objects, claimed, liveListingIds, {
      minAgeDays: MIN_AGE_DAYS,
      maxDeletes: MAX_DELETES,
      now: new Date(),
    })

    let deleted = 0
    if (!dryRun && plan.toDelete.length) {
      for (const name of plan.toDelete) {
        await bucket.file(name).delete({ ignoreNotFound: true })
        deleted += 1
      }
      await firestore
        .collection('adminAudit')
        .add({
          actorUid: 'system:cron',
          action: 'plugins.artifacts.reap',
          target: `gs://${bucketName}`,
          after: {
            deleted: plan.toDelete,
            bytesFreed: plan.bytesToFree,
          },
          at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        })
        .catch(() => undefined)
    }

    return Response.json(
      {
        dryRun,
        bucket: bucketName,
        minAgeDays: MIN_AGE_DAYS,
        scanned: plan.scanned,
        kept: plan.kept,
        tooNew: plan.tooNew,
        orphans: plan.toDelete.length,
        deleted,
        bytesFreed: dryRun ? 0 : plan.bytesToFree,
        bytesReclaimable: plan.bytesToFree,
        deferredByCap: plan.deferredByCap,
        // Reported, never deleted — a human decides on these.
        orphanedListings: plan.orphanedListings,
        unrecognized: plan.unrecognized,
        objects: plan.toDelete,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Artifact reaping failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }

/**
 * Cron routes run long: this one sweeps every org (AGL-1141).
 *
 * Vercel Hobby defaults a function to 10s, and nothing here set a duration —
 * so `report-usage` 504d with FUNCTION_INVOCATION_TIMEOUT at 10.2s on
 * 2026-07-31 having succeeded the day before. A pass sitting right on the
 * boundary fails intermittently, which reads as flaky rather than as a limit.
 */
export const maxDuration = 60
