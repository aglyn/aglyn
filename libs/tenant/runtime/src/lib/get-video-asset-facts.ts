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

import { hostQualifiedScope, type MediaRef } from '@aglyn/aglyn/server'
// By path rather than through a barrel: the overlay is server-only, and every
// `@aglyn/aglyn` barrel re-exports `app-utils/server` into published pages.
import {
  type VideoAssetFacts,
  videoAssetFactsKey,
} from '@aglyn/aglyn/app-utils/video-asset-facts'
import {
  firebaseAdmin,
  mediaCdnScopeRefusal,
  parseMediaCdnScope,
} from '@aglyn/tenant-data-admin'

/**
 * Every field the facts are decided from, and the projection sent to
 * Firestore — ONE list. `video` and `poster` are the facts. The other three
 * are the gates `serveMediaCdn` applies before it will serve a film at all, so
 * a page never publishes the length or shape of a film its own URL refuses.
 */
const VIDEO_ASSET_FACT_FIELDS = [
  'video',
  'poster',
  'deletedAt',
  'private',
  'visibleTo',
] as const

/**
 * How many films ONE composition reads facts for.
 *
 * A backstop, not a plan: a page placing more keeps the pick-time copy on the
 * rest, which is exactly how every one of them rendered before these facts
 * were read.
 */
export const VIDEO_ASSET_FACTS_PER_RENDER = 100

/**
 * The current facts of each placed film this page may be shown, keyed by
 * `videoAssetFactsKey` (AGL-2807). `video-asset-facts.ts` in `@aglyn/aglyn`
 * owns what is done with them.
 *
 * ## Why this read is not behind the render cache
 *
 * Every other compose read is busted by the publish announce
 * (`tenant-data:{hostId}`) and falls back to an hour's TTL for a write that
 * never announces itself. A replace is exactly such a write: it goes through
 * the console's `/api/media/replace` and tells the tenant nothing. Cached
 * here, a replaced film's facts could outlive the page's own ISR window by a
 * second hour. Uncached, the cost is one projected batch per composition,
 * issued only for a page that places a library film.
 *
 * ## What it answers for, and what it leaves to the node
 *
 * An entry exists only for a film whose document was read, is live, is not
 * private, and is visible to this site under the host-qualified scope the page
 * renders — the verdict the CDN reaches when the player asks for the bytes.
 * Anything else gets no entry and keeps its stored props, and so does every
 * film when the read fails: fail-open like every other compose read, because a
 * Firestore fault must not strip the players on a live page of their shape.
 */
export async function getVideoAssetFacts(options: {
  hostId: string
  refs: readonly MediaRef[]
}): Promise<Map<string, VideoAssetFacts>> {
  const { hostId, refs } = options
  const facts = new Map<string, VideoAssetFacts>()
  /** One read per DOCUMENT, however many scope spellings place it. */
  const documents = new Map<string, MediaRef[]>()
  for (const ref of refs) {
    const scope = parseMediaCdnScope(ref.scope)
    if (!scope) continue
    const path = `${scope.isOrg ? 'orgs' : 'hosts'}/${scope.scopeId}/media/${ref.mediaId}`
    const placements = documents.get(path)
    if (placements) placements.push(ref)
    else if (documents.size < VIDEO_ASSET_FACTS_PER_RENDER) {
      documents.set(path, [ref])
    }
  }
  if (!documents.size) return facts
  try {
    const firestore = firebaseAdmin.app().firestore()
    const paths = [...documents.keys()]
    const snapshots = await firestore.getAll(
      ...paths.map((path) => firestore.doc(path)),
      { fieldMask: [...VIDEO_ASSET_FACT_FIELDS] },
    )
    snapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) return
      if (snapshot.get('deletedAt') || snapshot.get('private') === true) return
      for (const ref of documents.get(paths[index]) ?? []) {
        // The URL the page renders names the site doing the rendering
        // (`resolveMediaSrc`), so visibility is asked of THAT scope — the one
        // the CDN will be asked about when the player requests the film.
        const served = parseMediaCdnScope(hostQualifiedScope(ref.scope, hostId))
        if (!served || mediaCdnScopeRefusal(served, snapshot.get('visibleTo'))) {
          continue
        }
        facts.set(videoAssetFactsKey(ref), {
          video: snapshot.get('video'),
          poster: snapshot.get('poster'),
        })
      }
    })
    return facts
  } catch (error) {
    console.error(
      '[video-asset-facts] read failed; placements keep their stored props',
      error,
    )
    return new Map()
  }
}

export default getVideoAssetFacts
