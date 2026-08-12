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
 * A usable `src` for a picked media asset.
 *
 * Lifted out of the listing detail editor when the publish form gained a
 * media picker of its own (AGL-1080). The CDN path is same-origin and
 * relative, so it needs the origin prefixed before it can be written into
 * markdown that renders elsewhere — a second hand-rolled copy would have
 * gotten that subtly wrong and produced images that work in the console and
 * break on the listing page.
 */
export function mediaSrc(media: {
  url?: string
  cdnPath?: string
}): string {
  // `cdnPath` FIRST (AGL-1215). It is keyed by media id, so it survives a
  // folder move — which physically copies the object, rewrites `url` and
  // deletes the original, permanently breaking anything holding the old
  // raw URL. Preferring `url` meant this helper emitted the fragile form
  // for every paid org, where both fields are always populated. `url`
  // stays the fallback for free-tier orgs (`cdnPath` is a paid `mediaCdn`
  // entitlement) and legacy uploads that predate it.
  if (media.cdnPath)
    return typeof window === 'undefined'
      ? media.cdnPath
      : `${window.location.origin}${media.cdnPath}`
  if (media.url) return media.url
  return ''
}

/**
 * A `src` for a THUMBNAIL — a grid tile, a picker cell, a preview strip.
 *
 * Separate from {@link mediaSrc} because the two answer different questions.
 * `mediaSrc` produces a URL that gets *persisted* (markdown bodies, listing
 * images), so it must stay width-free. This one produces a URL that is only
 * ever rendered, so it can ask for the smallest generated WebP variant.
 *
 * The DAM grid read `media.url` directly, which is the raw
 * `firebasestorage.googleapis.com` download URL: every tile fetched the
 * FULL-SIZE original straight from Cloud Storage, bypassing both the WebP
 * variants (AGL-175) and the Vercel edge cache. A library page of 24 assets
 * at ~200 KB each is ~4.8 MB of Storage egress per view, re-fetched by every
 * viewer, where the 320px variants are ~15 KB each.
 *
 * `?w=` degrades safely: `serveMediaCdn` only serves a variant when the
 * asset's `variants` array actually contains that width, and otherwise
 * serves the original — so an SVG, a small logo, or an asset uploaded before
 * variants existed still renders, just without the saving.
 */
export function mediaThumbnailSrc(
  media: { url?: string; cdnPath?: string },
  width: number,
): string {
  const cdnPath = media.cdnPath
  // No `cdnPath` means a free-tier or private asset, and a width parameter
  // on a raw storage URL means nothing — appending one would only fork the
  // browser cache for identical bytes.
  if (!cdnPath) return mediaSrc(media)
  // A signed private URL already carries `?exp=&sig=`; a second `?` makes a
  // path the route rejects outright.
  if (cdnPath.includes('?')) return mediaSrc(media)
  return `${mediaSrc(media)}?w=${width}`
}

export default mediaSrc
