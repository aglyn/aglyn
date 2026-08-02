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
import { isCronAuthorized } from '../../../../utils/cron-auth'
import {
  ArtifactObject,
  artifactClaimKey,
  planArtifactReap,
} from '../../../../utils/server/reap-plugin-artifacts'

/** Objects younger than this are never reaped (mid-publish guard). */
const MIN_AGE_DAYS = 7
/** Ceiling on permanent deletions per run. */
const MAX_DELETES = 200

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
  if (!isCronAuthorized(headers)) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  const bucketName = process.env.PLUGIN_ARTIFACTS_BUCKET
  if (!bucketName) {
    return Response.json(
      { error: 'Plugin artifacts are not configured (PLUGIN_ARTIFACTS_BUCKET).' },
      { status: 501 },
    )
  }

  // Dry run is the SAFE default for a GET (a browser or a curl someone
  // pasted); the cron POSTs with an explicit dryRun=0.
  const dryRunParam = (body as { dryRun?: unknown } | undefined)?.dryRun ??
    query['dryRun']
  const dryRun =
    dryRunParam === undefined
      ? method === 'GET'
      : dryRunParam !== '0' && dryRunParam !== 'false' && dryRunParam !== false

  try {
    const app = firebaseAdmin.app()
    const firestore = app.firestore()
    const bucket = app.storage().bucket(bucketName)

    const [files] = await bucket.getFiles({ prefix: 'artifacts/' })
    const objects: ArtifactObject[] = files.map((file) => ({
      name: file.name,
      createdAt: new Date(file.metadata?.timeCreated ?? 0),
      size: Number(file.metadata?.size ?? 0),
    }))

    // Every claim in the platform, in one collection-group read. The version
    // doc is the ONLY thing that keeps bytes alive — see the module comment
    // on why install pins deliberately do not enter this decision.
    const versions = await firestore.collectionGroup('pluginVersions').get()
    const claimed = new Set<string>()
    const listingIds = new Set<string>()
    for (const doc of versions.docs) {
      const listingId = doc.ref.parent.parent?.id
      const sha256 = doc.get('sha256')
      if (!listingId || typeof sha256 !== 'string' || !sha256) continue
      claimed.add(artifactClaimKey(listingId, doc.id, sha256))
      listingIds.add(listingId)
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
