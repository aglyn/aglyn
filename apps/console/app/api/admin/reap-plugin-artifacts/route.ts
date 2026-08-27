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

/** Claim documents read per query while walking the collection group. */
const CLAIM_SCAN_PAGE = 500

/**
 * The most claims one run will walk before refusing to reap at all.
 *
 * Not a page cap — the walk below is exhaustive by construction. This is the
 * ceiling past which the run declines to draw a conclusion, because the ONE
 * unsafe outcome here is an incomplete claim set: every object this job
 * deletes is deleted precisely because nothing claimed it, and a claim the
 * scan never reached looks exactly like a claim that does not exist. The
 * bucket has no object versioning, so that mistake is permanent.
 *
 * Refusing is therefore the safe answer, and it is loud: the run reports the
 * ceiling it hit rather than reaping what it managed to see.
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
  const actor = await authorizeMaintenanceActor(headers)
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
     * Every claim in the platform. The version doc is the ONLY thing that
     * keeps bytes alive — see the module comment on why install pins
     * deliberately do not enter this decision.
     *
     * ## Why this is walked in pages, and why it still must be COMPLETE
     *
     * It was one unbounded `.get()` over the whole collection group, which
     * materialises every version document on the platform in memory at once
     * and grows with the marketplace rather than with anything this run does.
     * That fails eventually, and it fails on a scheduled job nobody is
     * watching.
     *
     * Paging fixes the memory and the query timeout. It must not be mistaken
     * for making the scan optional: a claim the walk never reached is
     * indistinguishable from a claim that does not exist, and this job
     * deletes exactly the objects nothing claims. So the loop runs to
     * exhaustion, a throw anywhere in it aborts the whole request before a
     * single delete, and passing `MAX_CLAIMS_SCANNED` refuses the run instead
     * of reaping against a partial set.
     *
     * `select('sha256')` because that and the document path are all the join
     * reads. It does not reduce the number of documents billed — Firestore
     * charges per document — but a version document carries its manifest, and
     * none of that needs to cross the wire.
     */
    const claimed = new Set<string>()
    const listingIds = new Set<string>()
    let claimsScanned = 0
    let claimCursor: FirebaseFirestore.QueryDocumentSnapshot | null = null
    for (;;) {
      const base = firestore
        .collectionGroup('pluginVersions')
        .orderBy('__name__')
        .select('sha256')
        .limit(CLAIM_SCAN_PAGE)
      const page = await (claimCursor ? base.startAfter(claimCursor) : base).get()
      if (page.empty) break
      for (const doc of page.docs) {
        claimsScanned += 1
        const listingId = doc.ref.parent.parent?.id
        const sha256 = doc.get('sha256')
        if (!listingId || typeof sha256 !== 'string' || !sha256) continue
        claimed.add(artifactClaimKey(listingId, doc.id, sha256))
        listingIds.add(listingId)
      }
      if (claimsScanned > MAX_CLAIMS_SCANNED) {
        return Response.json(
          {
            error:
              `Refusing to reap: more than ${MAX_CLAIMS_SCANNED} plugin ` +
              'version claims. Deleting against a claim set this run could ' +
              'not finish reading would delete live artifacts permanently.',
            claimsScanned,
          },
          { status: 507 },
        )
      }
      claimCursor = page.docs[page.docs.length - 1] ?? null
      if (page.docs.length < CLAIM_SCAN_PAGE) break
    }

    // Which of those listings still exist — an orphaned subcollection is
    // reported, never reaped (its installs still load).
    const liveListingIds = new Set<string>()
    const listingRefs = [...listingIds].map((id) =>
      firestore.collection('marketplaceListings').doc(id),
    )
    if (listingRefs.length) {
      const snapshots = await firestore.getAll(...listingRefs)
      for (const snapshot of snapshots) {
        if (snapshot.exists) liveListingIds.add(snapshot.id)
      }
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
