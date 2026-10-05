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

// By path rather than through a barrel, as `get-media-asset-facts` does.
import {
  MEDIA_ASSET_FACT_FIELDS,
  type MediaAssetDocument,
  mediaAssetDocumentPath,
  mediaAssetFactsFromDocument,
} from '@aglyn/aglyn/app-utils/media-asset-facts'
import {
  mediaRefFromCdnPath,
  parseMediaRef,
} from '@aglyn/aglyn/app-utils/media-ref'
import type { SiteIconSourceFacts } from '@aglyn/aglyn/app-utils/site-icon-set'
// The one module, not the barrel: the `[host]` layout reads this, and the
// barrel drags the render cache's `next/cache` into every importer.
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'

/** The two fields an icon source adds to the facts projection. */
const SITE_ICON_FACT_FIELDS = [
  ...MEDIA_ASSET_FACT_FIELDS,
  'contentType',
  'contentHash',
] as const

/**
 * The type and content hash of each site-icon source (AGL-3484), keyed by the
 * resolved src the caller passed in.
 *
 * The derived icon set needs both: the type decides whether the source can be
 * drawn from (an ICO cannot) and whether it passes through as an SVG, and the
 * hash is the `v` that lets every derived icon be cached for a year while a
 * DAM Replace still reaches it.
 *
 * Takes RESOLVED srcs — `/api/media/cdn/{scope}/{id}`, relative or absolute —
 * because that is what the favicon chain already produces (the site's own,
 * then the org's white-label mark). A src that is not ours gets no entry.
 *
 * One `getAll` for all of them, projected; at most three documents on a page
 * (favicon, app icon, logo). Not behind the render cache, for
 * `get-media-asset-facts`'s reason: a Replace announces nothing to the tenant,
 * so a cached hash could outlive the page's own window by another hour. The
 * same gates decide an entry: a deleted, private or out-of-scope asset gets
 * none, and neither does any asset when the read fails — the icons then
 * derive without a version, which the CDN serves under its revalidated policy.
 */
export async function getSiteIconFacts(options: {
  hostId: string | undefined
  srcs: ReadonlyArray<string | undefined | null>
}): Promise<Map<string, SiteIconSourceFacts>> {
  const { hostId } = options
  const facts = new Map<string, SiteIconSourceFacts>()
  if (!hostId) return facts
  /** One read per document, however many srcs name it. */
  const documents = new Map<string, Array<{ src: string; scope: string }>>()
  for (const src of options.srcs) {
    if (!src) continue
    const ref = parseMediaRef(mediaRefFromCdnPath(src))
    const path = ref ? mediaAssetDocumentPath(ref) : null
    if (!ref || !path) continue
    const named = documents.get(path) ?? []
    named.push({ src, scope: ref.scope })
    documents.set(path, named)
  }
  if (!documents.size) return facts
  try {
    const firestore = firebaseAdmin.app().firestore()
    const paths = [...documents.keys()]
    const snapshots = await firestore.getAll(
      ...paths.map((path) => firestore.doc(path)),
      { fieldMask: [...SITE_ICON_FACT_FIELDS] },
    )
    snapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) return
      const document: MediaAssetDocument = {}
      for (const field of MEDIA_ASSET_FACT_FIELDS) {
        document[field] = snapshot.get(field)
      }
      const contentType = snapshot.get('contentType')
      const contentHash = snapshot.get('contentHash')
      for (const { src, scope } of documents.get(paths[index]) ?? []) {
        if (!mediaAssetFactsFromDocument(document, { scope }, hostId)) continue
        facts.set(src, {
          ...(typeof contentType === 'string' ? { contentType } : {}),
          ...(typeof contentHash === 'string' && contentHash
            ? { contentHash }
            : {}),
        })
      }
    })
    return facts
  } catch (error) {
    console.error('[site-icon-facts] read failed; icons derive unversioned', error)
    return new Map()
  }
}

export default getSiteIconFacts
