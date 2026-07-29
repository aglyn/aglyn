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

import {
  checkPluginBundle,
  isStoredVerdictCurrent,
  PLUGIN_VERIFIER_VERSION,
  pluginArtifactPath,
  pluginRequestFromWeb,
  type StoredBundleVerdict,
} from '@aglyn/aglyn/server'
import { firebaseAdmin, notifyStaff } from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { isCronAuthorized } from '../../../../utils/cron-auth'
import {
  reverifyOutcome,
  summariseReverify,
  type ReverifyEntry,
} from '../../../../utils/server/reverify-plugin-versions'

/** Artifacts downloaded per run — a ceiling on time and egress, not on truth. */
const MAX_VERSIONS = 250

/**
 * Re-runs the static verifier across every stored version (AGL-1086).
 *
 * A verdict is cached on the version doc (AGL-962) and recomputed when the
 * checker moves on — but only when a reviewer OPENS that version. So a bump
 * like AGL-964 or AGL-1087 leaves every version nobody looks at holding a
 * verdict from a checker that no longer exists, and a version that would now
 * fail stays live and unflagged. That is backwards: the point of new checks
 * is finding what nobody had a reason to look for.
 *
 * This sweeps them. Versions whose stored verdict is already current are
 * skipped without downloading anything, so a run after a quiet week costs
 * one collection-group read; `force` re-downloads everything.
 *
 * It REPORTS. A regression on a live version notifies staff and lands in
 * adminAudit, and nothing else happens — no delist, no revocation. The
 * verifier is a lint, and a lint that can stop a plugin in every workspace
 * is a kill switch with no human in it.
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
      { error: 'Re-verification is not configured (CRON_SECRET).' },
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

  const asFlag = (value: unknown): boolean =>
    value !== undefined && value !== '0' && value !== 'false' && value !== false
  const payload = body as { dryRun?: unknown; force?: unknown } | undefined
  // A GET is somebody's curl or a browser: report, never write. The cron
  // POSTs, and writing back a verdict is what makes the next reviewer's page
  // load free, so a dry run is not the default there.
  const dryRunInput = payload?.dryRun ?? query['dryRun']
  const dryRun = dryRunInput === undefined ? method === 'GET' : asFlag(dryRunInput)
  const force = asFlag(payload?.force ?? query['force'])

  try {
    const app = firebaseAdmin.app()
    const firestore = app.firestore()
    const bucket = app.storage().bucket(bucketName)

    const versions = await firestore.collectionGroup('pluginVersions').get()

    // Listing state and name, read once per listing rather than per version.
    const listingIds = [
      ...new Set(
        versions.docs
          .map((doc) => doc.ref.parent.parent?.id)
          .filter((id): id is string => Boolean(id)),
      ),
    ]
    const listings = new Map<string, { name: string; reviewStatus: string }>()
    if (listingIds.length) {
      const snapshots = await firestore.getAll(
        ...listingIds.map((id) =>
          firestore.collection('communityListings').doc(id),
        ),
      )
      for (const snapshot of snapshots) {
        if (!snapshot.exists) continue
        listings.set(snapshot.id, {
          name: String(snapshot.get('displayName') ?? snapshot.id),
          reviewStatus: String(snapshot.get('reviewStatus') ?? 'unknown'),
        })
      }
    }

    const entries: ReverifyEntry[] = []
    let skipped = 0
    let downloaded = 0
    let deferredByCap = 0

    for (const doc of versions.docs) {
      const listingId = doc.ref.parent.parent?.id
      const sha256 = String(doc.get('sha256') ?? '')
      const version = String(doc.get('version') ?? doc.id)
      if (!listingId || !sha256) continue

      const stored = doc.get('verification') as StoredBundleVerdict | undefined
      if (!force && isStoredVerdictCurrent(stored, sha256)) {
        skipped += 1
        continue
      }
      if (downloaded >= MAX_VERSIONS) {
        deferredByCap += 1
        continue
      }

      const listing = listings.get(listingId)
      const declaredNetwork = doc.get('manifest.capabilities.network')
      let result: ReturnType<typeof checkPluginBundle> | null = null
      try {
        const [bytes] = await bucket
          .file(pluginArtifactPath(listingId, version, sha256))
          .download()
        downloaded += 1
        result = checkPluginBundle(bytes.toString('utf8'), {
          declaredNetwork: Array.isArray(declaredNetwork)
            ? declaredNetwork.map((origin: unknown) => String(origin))
            : [],
        })
      } catch {
        // An artifact we cannot read is reported, never assumed clean.
        result = null
      }

      entries.push({
        listingId,
        listingName: listing?.name ?? listingId,
        version,
        outcome: reverifyOutcome(stored, result),
        reviewStatus: listing?.reviewStatus ?? 'unknown',
        activeInstalls: Number(doc.get('activeInstalls') ?? 0),
        problems:
          result?.problems
            .filter((problem) => problem.level === 'error')
            .map((problem) => problem.message) ?? [],
      })

      if (result && !dryRun) {
        await doc.ref
          .set(
            {
              verification: {
                ok: result.ok,
                problems: result.problems,
                checks: result.checks,
                sha256,
                verifierVersion: PLUGIN_VERIFIER_VERSION,
                checkedAt: FieldValue.serverTimestamp(),
              },
            },
            { merge: true },
          )
          .catch(() => undefined)
      }
    }

    const summary = summariseReverify(entries)

    // A regression on live, installed bytes is the one outcome that needs a
    // person today: we told those workspaces this code was checked.
    if (!dryRun && summary.needsStaff.length) {
      const first = summary.needsStaff[0]
      await notifyStaff({
        type: 'system.pluginVerifierRegression',
        title: `${summary.needsStaff.length} live plugin version(s) now fail the verifier`,
        body:
          `${first.listingName} v${first.version} — ${first.problems[0] ?? 'see the review page'}` +
          (summary.needsStaff.length > 1
            ? ` (and ${summary.needsStaff.length - 1} more)`
            : ''),
        link: `/admin/plugin-reviews/${first.listingId}?version=${encodeURIComponent(first.version)}`,
      })
      await firestore
        .collection('adminAudit')
        .add({
          actorUid: 'system:cron',
          action: 'plugins.verifier.regression',
          target: `verifier:${PLUGIN_VERIFIER_VERSION}`,
          after: {
            regressed: summary.needsStaff.map((entry) => ({
              listingId: entry.listingId,
              version: entry.version,
              activeInstalls: entry.activeInstalls,
              problems: entry.problems,
            })),
          },
          at: FieldValue.serverTimestamp(),
        })
        .catch(() => undefined)
    }

    return Response.json(
      {
        dryRun,
        force,
        verifierVersion: PLUGIN_VERIFIER_VERSION,
        // `skipped` is the healthy number: a verdict already current for
        // these exact bytes from this exact checker.
        skipped,
        downloaded,
        deferredByCap,
        ...summary,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Re-verification failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
