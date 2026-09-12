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
  MEDIA_ASSET_FACT_FIELDS,
  type MediaAssetDocument,
  type MediaAssetFacts,
  mediaAssetDocumentPath,
  mediaAssetFactsFromDocument,
  mediaAssetFactsKey,
} from '@aglyn/aglyn/app-utils/media-asset-facts'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

/**
 * How many documents ONE composition reads facts for.
 *
 * A backstop sized well above what pages place, not a budget they are
 * expected to approach. A page placing more keeps the pick-time copy on the
 * rest, which is how every one of them rendered before these facts were read.
 * Which ones are read is decided by the order the composition hands them
 * over: the social card's references first (AGL-2850), then the placements in
 * the order `mediaAssetRefs` lists them, films, then images, each from the top
 * of the page down.
 */
export const MEDIA_ASSET_FACTS_PER_RENDER = 100

/**
 * The current facts of each placed image and film this page may be shown, and
 * of each asset its social card names, keyed by `mediaAssetFactsKey`
 * (AGL-2807, AGL-2833, AGL-2850). `media-asset-facts.ts` in `@aglyn/aglyn`
 * owns what is done with a placement's, and `social-image-facts.ts` beside
 * this reader owns a card's.
 *
 * ## One read for the whole page
 *
 * Every document goes out in ONE `getAll`, projected to
 * `MEDIA_ASSET_FACT_FIELDS`, however many elements and scope spellings place
 * it, and a document is read once however many nodes name it. Firestore bills
 * per document, so the cost of a composition is the number of distinct assets
 * it places, up to {@link MEDIA_ASSET_FACTS_PER_RENDER}.
 *
 * ## Why this read is not behind the render cache
 *
 * Every other compose read is busted by the publish announce
 * (`tenant-data:{hostId}`) and falls back to an hour's TTL for a write that
 * never announces itself. A replace is exactly such a write: it goes through
 * the console's `/api/media/replace` and tells the tenant nothing. Cached
 * here, a replaced asset's facts could outlive the page's own ISR window by a
 * second hour.
 *
 * ## What it answers for, and what it leaves to the node
 *
 * `mediaAssetFactsFromDocument` decides, per placement, from the projected
 * document: an entry exists only for an asset that is live, not private, and
 * visible to this site under the host-qualified scope the page renders, the
 * verdict the CDN reaches when the browser asks for the bytes. The console's
 * canvas and Preview decide through the same function, so the editor and the
 * page agree about which assets answer. Anything else gets no entry and keeps
 * its stored props, and so does every asset when the read fails. That is
 * fail-open like every other compose read, because a Firestore fault must not
 * strip the images and players on a live page of their shape.
 */
export async function getMediaAssetFacts(options: {
  hostId: string
  refs: readonly MediaRef[]
}): Promise<Map<string, MediaAssetFacts>> {
  const { hostId, refs } = options
  const facts = new Map<string, MediaAssetFacts>()
  /** One read per DOCUMENT, however many scope spellings place it. */
  const documents = new Map<string, MediaRef[]>()
  for (const ref of refs) {
    const path = mediaAssetDocumentPath(ref)
    if (!path) continue
    const placements = documents.get(path)
    if (placements) placements.push(ref)
    else if (documents.size < MEDIA_ASSET_FACTS_PER_RENDER) {
      documents.set(path, [ref])
    }
  }
  if (!documents.size) return facts
  try {
    const firestore = firebaseAdmin.app().firestore()
    const paths = [...documents.keys()]
    const snapshots = await firestore.getAll(
      ...paths.map((path) => firestore.doc(path)),
      { fieldMask: [...MEDIA_ASSET_FACT_FIELDS] },
    )
    snapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) return
      const document: MediaAssetDocument = {}
      for (const field of MEDIA_ASSET_FACT_FIELDS) {
        document[field] = snapshot.get(field)
      }
      for (const ref of documents.get(paths[index]) ?? []) {
        const found = mediaAssetFactsFromDocument(document, ref, hostId)
        if (found) facts.set(mediaAssetFactsKey(ref), found)
      }
    })
    return facts
  } catch (error) {
    console.error(
      '[media-asset-facts] read failed; placements keep their stored props',
      error,
    )
    return new Map()
  }
}

export default getMediaAssetFacts
