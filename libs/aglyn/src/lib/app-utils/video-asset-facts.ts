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
 * A placed film's length, shape and poster, read from the DAM asset as it is
 * NOW rather than as it was when it was picked (AGL-2807).
 *
 * The film-only face of `media-asset-facts.ts`, which owns the rule, the
 * reasons for it, where a document is read from, which reads answer, and the
 * same overlay for images (AGL-2833). Everything here is that module
 * restricted to Video nodes: an image in the map is neither listed nor
 * rewritten, and an answer carries a film's records only. It serves a caller
 * that lays only a film's facts over a tree.
 */

import {
  applyMediaAssetFacts,
  type MediaAssetDocument,
  type MediaAssetFacts,
  mediaAssetDocumentPath,
  mediaAssetFactsFromDocument,
  mediaAssetFactsKey,
  mediaAssetRefs,
} from './media-asset-facts'
import type { MediaRef } from './media-ref'
import { VIDEO_COMPONENT_ID } from './video-object'

/** What a readable film's media document records, as the overlay consumes it. */
export type VideoAssetFacts = Pick<MediaAssetFacts, 'video' | 'poster'>

/** A film's media document, read the way every placed asset's is. */
export type VideoAssetDocument = MediaAssetDocument

/**
 * The key a film's facts are filed under: the reference's own scope and id.
 * One key for either element, see {@link mediaAssetFactsKey}.
 */
export function videoAssetFactsKey(
  ref: Pick<MediaRef, 'scope' | 'mediaId'>,
): string {
  return mediaAssetFactsKey(ref)
}

/**
 * Where a film's media document lives. One path for either element, see
 * {@link mediaAssetDocumentPath}.
 */
export function videoAssetDocumentPath(
  ref: Pick<MediaRef, 'scope' | 'mediaId'>,
): string | null {
  return mediaAssetDocumentPath(ref)
}

/**
 * The film facts one read of a document yields for a placement rendered on
 * `hostId`'s pages, or `undefined` when the placement keeps its stored props.
 * Whether the read answers at all is {@link mediaAssetFactsFromDocument}'s
 * verdict, the one the composition reaches for every asset a page places.
 */
export function videoAssetFactsFromDocument(
  document: VideoAssetDocument | null | undefined,
  ref: Pick<MediaRef, 'scope'>,
  hostId: string,
): VideoAssetFacts | undefined {
  const facts = mediaAssetFactsFromDocument(document, ref, hostId)
  return facts && { video: facts.video, poster: facts.poster }
}

/**
 * Every distinct library film the Video nodes in a map play, in document
 * order. `[]` for a page that places none.
 */
export function videoAssetRefs(
  nodes: Record<string, unknown> | null | undefined,
): MediaRef[] {
  return mediaAssetRefs(nodes, { only: VIDEO_COMPONENT_ID })
}

/**
 * The composed map with each placed film's facts laid over its node. A film
 * with no entry keeps its stored props, and the SAME map comes back when
 * nothing applies.
 */
export function applyVideoAssetFacts<T extends Record<string, unknown>>(
  nodes: T,
  facts: ReadonlyMap<string, VideoAssetFacts>,
): T {
  return applyMediaAssetFacts(nodes, facts, { only: VIDEO_COMPONENT_ID })
}
