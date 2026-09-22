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
 * What the marketplace stores in the artifacts bucket (AGL-3080).
 *
 * The platform's two scheduled sweeps — the orphan reaper and the verdict
 * re-verifier — used to walk `pluginVersions` and `marketplaceListings`
 * themselves, from `/api/admin` routes. Both collections are this plugin's,
 * so the walk is, and the routes ask through
 * `core.plugin-artifact-inventory` instead.
 *
 * ⛔ THE WALK IS EXHAUSTIVE OR IT IS A REFUSAL. The reaper deletes exactly
 * the objects nothing here claims, from a bucket with no object versioning,
 * and a claim this walk never reached is indistinguishable from a claim that
 * does not exist. So a page that throws aborts the whole answer, and passing
 * the caller's `maxScanned` refuses rather than handing back what it managed
 * to see. Paging exists for the query timeout and the memory, never to make
 * the scan optional.
 */

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  readPluginContributions,
  type StoredBundleVerdict,
} from '@aglyn/aglyn/server'
import type {
  PluginArtifactClaim,
  PluginArtifactInventorySource,
  PluginArtifactListing,
  PluginArtifactVerdict,
  PluginArtifactVersion,
} from '@aglyn/aglyn/plugin-manager/plugin-artifact-inventory'

/** Version documents read per query while walking the collection group. */
const SCAN_PAGE = 500

/** Where a reviewer opens one stored version — this plugin's staff page. */
function reviewLinkFor(listingId: string, version: string): string {
  return `/admin/plugin-reviews/${listingId}?version=${encodeURIComponent(version)}`
}

/** What one walk collects per document before the owners are read. */
interface ScannedVersion {
  doc: FirebaseFirestore.QueryDocumentSnapshot
  listingId: string
  version: string
  sha256: string
}

interface OwnerFacts {
  name: string
  reviewStatus: string
}

/**
 * One exhaustive walk of every stored version, shared by both listings.
 *
 * The `select` is the only difference between them — see the contract's note
 * on why the reaper leaves the manifests on the server — so the paging, the
 * ceiling and the refusal wording are written once. Two copies of a walk
 * whose failure mode is a permanent delete is one copy too many.
 */
async function walkVersions(
  maxScanned: number,
  fields: readonly string[] | null,
): Promise<
  | {
      outcome: 'listed'
      found: ScannedVersion[]
      owners: Map<string, OwnerFacts>
      scanned: number
    }
  | { outcome: 'refused'; reason: string; scanned: number }
> {
  const firestore = firebaseAdmin.app().firestore()
  const found: ScannedVersion[] = []
  const listingIds = new Set<string>()
  let scanned = 0
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null
  for (;;) {
    let query = firestore
      .collectionGroup('pluginVersions')
      .orderBy('__name__') as FirebaseFirestore.Query
    if (fields) query = query.select(...fields)
    query = query.limit(SCAN_PAGE)
    const page = await (cursor ? query.startAfter(cursor) : query).get()
    if (page.empty) break
    for (const doc of page.docs) {
      scanned += 1
      const listingId = doc.ref.parent.parent?.id
      const sha256 = doc.get('sha256')
      if (!listingId || typeof sha256 !== 'string' || !sha256) continue
      found.push({
        doc,
        listingId,
        version: String(doc.get('version') ?? doc.id),
        sha256,
      })
      listingIds.add(listingId)
    }
    if (scanned > maxScanned) {
      return {
        outcome: 'refused',
        reason:
          `Refusing to answer: more than ${maxScanned} stored plugin ` +
          'version claims. A claim set this run could not finish reading ' +
          'cannot be acted on.',
        scanned,
      }
    }
    cursor = page.docs[page.docs.length - 1] ?? null
    if (page.docs.length < SCAN_PAGE) break
  }
  /*
   * Which of the claiming listings still exist, and what they are called.
   * Read once per listing rather than once per version: a listing with forty
   * versions is one document either way, and the reaper needs only the
   * existence while the re-verifier needs the name for its report.
   */
  const owners = new Map<string, OwnerFacts>()
  const refs = [...listingIds].map((id) =>
    firestore.collection('marketplaceListings').doc(id),
  )
  if (refs.length) {
    const snapshots = await firestore.getAll(...refs)
    for (const snapshot of snapshots) {
      if (!snapshot.exists) continue
      owners.set(snapshot.id, {
        name: String(snapshot.get('displayName') ?? snapshot.id),
        reviewStatus: String(snapshot.get('reviewStatus') ?? 'unknown'),
      })
    }
  }
  return { outcome: 'listed', found, owners, scanned }
}

export const marketplaceArtifactInventory: PluginArtifactInventorySource = {
  async listClaims(options): Promise<PluginArtifactListing<PluginArtifactClaim>> {
    // The two path segments and the hash are all the reaper's join reads.
    const walk = await walkVersions(options.maxScanned, ['sha256', 'version'])
    if (walk.outcome === 'refused') return walk
    return {
      outcome: 'listed',
      rows: walk.found.map((one) => ({
        listingId: one.listingId,
        version: one.version,
        sha256: one.sha256,
        ownerLive: walk.owners.has(one.listingId),
      })),
      scanned: walk.scanned,
    }
  },

  async listVersions(
    options,
  ): Promise<PluginArtifactListing<PluginArtifactVersion>> {
    const walk = await walkVersions(options.maxScanned, null)
    if (walk.outcome === 'refused') return walk
    return {
      outcome: 'listed',
      rows: walk.found.map((one) => {
        const owner = walk.owners.get(one.listingId)
        const declaredNetwork = one.doc.get('manifest.capabilities.network')
        return {
          listingId: one.listingId,
          version: one.version,
          sha256: one.sha256,
          ownerLive: Boolean(owner),
          // The id, never a blank: a report row naming nothing would send a
          // reviewer looking for a listing called "".
          ownerName: owner?.name ?? one.listingId,
          reviewStatus: owner?.reviewStatus ?? 'unknown',
          activeInstalls: Number(one.doc.get('activeInstalls') ?? 0),
          reviewLink: reviewLinkFor(one.listingId, one.version),
          storedVerdict: one.doc.get('verification') as
            | StoredBundleVerdict
            | undefined,
          declaredNetwork: Array.isArray(declaredNetwork)
            ? declaredNetwork.map((origin: unknown) => String(origin))
            : [],
          declaredContributions:
            readPluginContributions(one.doc.get('manifest.contributes')) ??
            null,
          // The document this row was read from, not one found again by id:
          // a version's document id and its `version` field are not
          // guaranteed to be the same string, and writing by id could create
          // a sibling document holding a verdict nothing reads.
          record: (verdict: PluginArtifactVerdict) =>
            one.doc.ref
              .set(
                {
                  verification: {
                    ...verdict,
                    checkedAt:
                      firebaseAdmin.firestore.FieldValue.serverTimestamp(),
                  },
                },
                { merge: true },
              )
              .then(() => undefined),
        }
      }),
      scanned: walk.scanned,
    }
  },
}
