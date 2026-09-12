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
 * A page's social card, described by the assets it names as they are NOW
 * (AGL-2850).
 *
 * A card's reference is stored with the pixel pair its picker copied from the
 * asset: on the host, on each screen, on each template screen. A replace
 * (AGL-2732) rewrites the asset's pair and cannot reach those copies, so the
 * head is handed what each named asset's document records when the page is
 * composed, and `resolveSocialImage` prefers that to the copy.
 *
 * The documents are read in the batch `composeNodesWithChrome` already issues
 * for the images and films a page places (`get-media-asset-facts.ts`), so a
 * card adds documents to that read rather than a read of its own. This module
 * turns the card's references into the batch's input and the batch's answer
 * into the head's view, and it reads on its own only for a page that composes
 * nothing.
 */

import {
  intrinsicMediaSize,
  type MediaRef,
  parseMediaRef,
  type SocialImageAssetFacts,
} from '@aglyn/aglyn/server'
// By path rather than through a barrel: the overlay is server-only, and every
// `@aglyn/aglyn` barrel re-exports `app-utils/server` into published pages.
import {
  IMAGE_COMPONENT_ID,
  type MediaAssetFacts,
  mediaAssetFactsKey,
} from '@aglyn/aglyn/app-utils/media-asset-facts'
import getMediaAssetFacts from './get-media-asset-facts'

/** The references a card may resolve from, in the head's precedence order. */
export type SocialCardImages = ReadonlyArray<string | null | undefined>

/**
 * The card handed to a composition, so the assets it names are read in the
 * page's one facts batch.
 */
export interface ComposeSocialImages {
  /**
   * The references the head resolves the card from: a screen's and the host's
   * `seo.image`, an entry's cover, an author's pictures. Unset, blank and
   * non-library values are skipped.
   */
  images: SocialCardImages
  /**
   * Called once the batch answers, with each reference's current pair. Not
   * called when it answered for none of them (no usable pair, an asset this
   * site may not be shown, a failed read), which leaves the card on the pair
   * stored beside its reference.
   */
  onFacts: (facts: SocialImageAssetFacts) => void
}

/**
 * Each distinct library asset the references name, in the order given.
 *
 * `[]` when none is a library reference, so a caller that gates its read on
 * the length spends nothing. A pinned and an unpinned reference to one asset
 * are one entry: a pin names bytes, not a different asset.
 */
export function socialImageRefs(images: SocialCardImages): MediaRef[] {
  const refs: MediaRef[] = []
  const seen = new Set<string>()
  for (const image of images) {
    const ref = parseMediaRef(image)
    if (!ref) continue
    const key = mediaAssetFactsKey(ref)
    if (seen.has(key)) continue
    seen.add(key)
    refs.push(ref)
  }
  return refs
}

/**
 * What the head is told: the current pair of each reference whose document
 * records a usable one, keyed by the reference exactly as it is stored.
 * `undefined` when none does, which the head reads as "emit the stored copy",
 * the same answer a failed read gets.
 *
 * A usable pair passes the gate a placed image's does (`intrinsicMediaSize`):
 * both halves, finite and positive. The card and the Image element agree on
 * what a document's pair is worth.
 */
export function socialImageAssetFacts(
  images: SocialCardImages,
  facts: ReadonlyMap<string, MediaAssetFacts>,
): SocialImageAssetFacts | undefined {
  let answered: Record<string, { width: number; height: number }> | undefined
  for (const image of images) {
    const ref = parseMediaRef(image)
    const found = ref ? facts.get(mediaAssetFactsKey(ref)) : undefined
    if (!found) continue
    const { intrinsicWidth, intrinsicHeight } = intrinsicMediaSize({
      componentId: IMAGE_COMPONENT_ID,
      propName: 'src',
      assetWidth: found.width,
      assetHeight: found.height,
    })
    if (intrinsicWidth === undefined || intrinsicHeight === undefined) continue
    if (!answered) answered = {}
    answered[image as string] = {
      width: intrinsicWidth,
      height: intrinsicHeight,
    }
  }
  return answered
}

/**
 * A composition's `socialImages` option, with somewhere for its facts to land.
 *
 * The composition answers with nodes and reports the card through a callback,
 * so a caller that hands both on needs a place for the callback to write. This
 * is that place, once, rather than a closure at every caller.
 */
export function collectSocialImageFacts(images: SocialCardImages): {
  /** Hand to `composeScreenNodes` or `composeNodesWithChrome`. */
  socialImages: ComposeSocialImages
  /** `{ socialImageFacts }` once the batch answered for the card, else `{}`. */
  collected: () => { socialImageFacts?: SocialImageAssetFacts }
} {
  let reported: SocialImageAssetFacts | undefined
  return {
    socialImages: {
      images,
      onFacts: (facts) => {
        reported = facts
      },
    },
    collected: () => (reported ? { socialImageFacts: reported } : {}),
  }
}

/**
 * The card's current pairs for a page that composes NOTHING, so has no batch
 * for its documents to join: a password-protected screen, whose nodes stay
 * withheld until unlock while its head still shares the card.
 *
 * ONE projected read, through the composition's own reader, so the verdict on
 * which assets this site may be shown is the CDN's here too. No read at all
 * when no reference names a library asset.
 *
 * Fail-open: any failure answers `undefined` and the card keeps its stored
 * pair. A page is never lost to the description of its share card.
 */
export async function getSocialImageAssetFacts(options: {
  hostId: string
  images: SocialCardImages
}): Promise<SocialImageAssetFacts | undefined> {
  const { hostId, images } = options
  try {
    const refs = socialImageRefs(images)
    if (!refs.length) return undefined
    return socialImageAssetFacts(
      images,
      await getMediaAssetFacts({ hostId, refs }),
    )
  } catch (error) {
    console.error(
      '[social-image-facts] read failed; the card keeps its stored pair',
      error,
    )
    return undefined
  }
}

export default getSocialImageAssetFacts
