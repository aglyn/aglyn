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
 * The three attributes that defer an image to its own turn (AGL-2486).
 *
 * ## What this is for
 *
 * The Image element already ranks itself: the lead image is `eager` and every
 * later one is `lazy` + `low` + `async`. That reasoning is written out at the
 * `fetchPriority` prop in `libs/plugins/mui/src/lib/components/image.tsx` and
 * is not repeated here.
 *
 * What that fix could not reach is every OTHER `<img>` a published page
 * renders: a product grid, a related-products rail, a wishlist, a cart line,
 * an event thumbnail, a Product card. Those carried **no loading hint at
 * all** — which is `eager` at the browser's default priority. So a product
 * grid four sections down was fetched EAGERLY, at a HIGHER priority than the
 * `lazy` + `low` Image element in the section the reader was actually looking
 * at. That is the reported symptom — "images several sections below the fold
 * load before the current section" — and it survived the Image-element fix
 * precisely because ranking the Image elements against each other says
 * nothing about the images that opted out of the ranking entirely.
 *
 * Uniformly `lazy` is also what produces the second half of what the item
 * asks for. There is no "next section" hint to give a browser: Chrome fetches
 * a `lazy` image once it comes within its viewport-distance threshold, so
 * ordering among deferred images falls out of distance from the viewport on
 * its own — but ONLY once every image is in that scheme. One unhinted image
 * does not merely rank badly, it leaves the scheme.
 *
 * ## Deliberately NOT applied to
 *
 * The image at the top of a page, which is the LCP candidate: the Image
 * element's lead image, and the product-detail gallery hero. Making those
 * `lazy` would re-introduce the ORIGINAL bug this issue opened with — an LCP
 * image not discovered until after layout. Those sites carry a comment
 * saying so, because "finish the job" is the obvious next edit and it is
 * wrong.
 *
 * ## Why a shared constant rather than three literals
 *
 * The set only works if it is the same set everywhere: an image with `lazy`
 * but no `fetchpriority` outranks an image with both, so a partially-applied
 * hint re-creates a smaller version of the same inversion. Two of the three
 * sites in `collection.tsx` were exactly that — `loading="lazy"` and nothing
 * else — which is why this is a named thing to spread rather than a habit to
 * remember.
 *
 * Spread it, never mutate it:
 *
 * ```tsx
 * <Box component="img" src={url} alt="" {...DEFERRED_IMAGE_ATTRIBUTES} />
 * ```
 */
export const DEFERRED_IMAGE_ATTRIBUTES = Object.freeze({
  /** Not fetched until the browser decides it is near the viewport. */
  loading: 'lazy',
  /**
   * And when it is fetched, it does not compete with the section on screen.
   * One-directional on purpose: deprioritising an image provably not being
   * looked at cannot starve whatever the LCP turns out to be, whereas
   * PROMOTING one is a claim about every other request in flight that no
   * render-time function is in a position to make.
   */
  fetchPriority: 'low',
  /**
   * Decoded off the main thread. A deferred image has no paint deadline, so
   * decoding it synchronously is main-thread time spent on pixels nobody is
   * looking at yet — which is the same budget item 22 is about.
   */
  decoding: 'async',
} as const)
