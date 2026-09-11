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

import type { MediaRef } from '@aglyn/aglyn/server'
// By path rather than through a barrel: every `@aglyn/aglyn` barrel
// re-exports `app-utils/server` into published pages, and the overlay stays
// out of them.
import {
  VIDEO_ASSET_FACT_FIELDS,
  type VideoAssetDocument,
  type VideoAssetFacts,
  videoAssetDocumentPath,
  videoAssetFactsFromDocument,
  videoAssetFactsKey,
} from '@aglyn/aglyn/app-utils/video-asset-facts'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

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
 * `videoAssetFactsFromDocument` decides, per placement, from the projected
 * document: an entry exists only for a film that is live, not private, and
 * visible to this site under the host-qualified scope the page renders — the
 * verdict the CDN reaches when the player asks for the bytes. The besigner
 * canvas decides through the same function, so the editor and the page agree
 * about which films answer. Anything else gets no entry and keeps its stored
 * props, and so does every film when the read fails: fail-open like every
 * other compose read, because a Firestore fault must not strip the players on
 * a live page of their shape.
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
    const path = videoAssetDocumentPath(ref)
    if (!path) continue
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
      const document: VideoAssetDocument = {}
      for (const field of VIDEO_ASSET_FACT_FIELDS) {
        document[field] = snapshot.get(field)
      }
      for (const ref of documents.get(paths[index]) ?? []) {
        const found = videoAssetFactsFromDocument(document, ref, hostId)
        if (found) facts.set(videoAssetFactsKey(ref), found)
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
