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

import { mediaRefFromStorageUrl, resolveMediaSrc } from './media-ref'

/** The shape every helper here reads off a media document. */
interface MediaSrcInput {
  url?: string
  cdnPath?: string
  private?: boolean
}

/**
 * The CDN path an asset is delivered from, or undefined for a private asset.
 *
 * `cdnPath` when the document has one. A non-private asset without it was
 * uploaded before the CDN reached every plan (AGL-1152), and its path is read
 * off the Storage download URL instead (AGL-3506) — that URL goes from
 * Google's edge to the visitor with no code of ours on it, so the bandwidth
 * band never counts it and a lockdown cannot refuse it. A private asset has
 * no public path by design and keeps its stored `url`, which the console
 * shows to its own staff.
 */
function deliveryCdnPath(media: MediaSrcInput): string | undefined {
  if (media.cdnPath) return media.cdnPath
  if (media.private) return undefined
  const ref = mediaRefFromStorageUrl(media.url)
  return ref ? resolveMediaSrc(ref) : undefined
}

/**
 * A usable `src` for a picked media asset.
 *
 * Lifted out of the listing detail editor when the publish form gained a
 * media picker of its own (AGL-1080).
 *
 * NO LONGER THE WRITER FOR MARKDOWN BODIES (AGL-1705). This helper used to
 * justify prefixing the origin by saying the markdown "renders elsewhere".
 * That claim was checked and is false: the marketplace README's only renderer
 * is the console's own `marketplaceListing` slot, and `apps/tenant` does not
 * import the marketplace plugin. The two README writers and the blog body now
 * store `mediaNodeSrc`'s `media:` reference, which `resolveMediaSrc` turns
 * back into this same `/api/media/cdn/…` path at render — without freezing
 * either the origin or the route shape into the document.
 *
 * What is left for this helper is the listing's image FIELDS —
 * `previewImageUrl`, `logoUrl`, `screenshots` — read out of band by
 * `og:image` and by `resolveSocialImage`, where an absolute URL is the point
 * (AGL-1701). The origin prefix stays for them.
 */
export function mediaSrc(media: MediaSrcInput): string {
  // The CDN path FIRST (AGL-1215). It is keyed by media id, so it survives a
  // folder move — which physically copies the object, rewrites `url` and
  // deletes the original, permanently breaking anything holding the old
  // raw URL. `url` stays the fallback for a private asset and for a value
  // that names no library object.
  const cdnPath = deliveryCdnPath(media)
  if (cdnPath)
    return typeof window === 'undefined'
      ? cdnPath
      : `${window.location.origin}${cdnPath}`
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
  media: MediaSrcInput,
  width: number,
): string {
  const cdnPath = deliveryCdnPath(media)
  // No CDN path means a private asset, and a width parameter on a raw
  // storage URL means nothing — appending one would only fork the browser
  // cache for identical bytes.
  if (!cdnPath) return mediaSrc(media)
  // A signed private URL already carries `?exp=&sig=`; a second `?` makes a
  // path the route rejects outright.
  if (cdnPath.includes('?')) return mediaSrc(media)
  return `${mediaSrc(media)}?w=${width}`
}

/**
 * A `src` for a VIDEO's poster still, or `undefined` when it has none
 * (AGL-2742).
 *
 * The DAM grid drew a video tile as a `<video src>` pointing at the master.
 * A browser paints a first frame by fetching enough of the file to decode
 * one, so a folder of eight clips was tens of megabytes of Storage egress
 * per view — the same defect {@link mediaThumbnailSrc} was written to fix for
 * images, on the type where each tile costs a hundred times more. And unlike
 * an image tile it could not be helped by a variant, because until now a
 * video had nothing smaller to serve.
 *
 * Returns `undefined` rather than a fallback URL on purpose: the caller has
 * to branch anyway (a `<video>` with no poster still needs `preload="none"`
 * so it stops fetching), and an "always answers" helper would hand back a URL
 * that 404s for every video uploaded before this shipped.
 *
 * Mirrors `Aglyn.mediaPosterSrc` for a media DOCUMENT rather than a stored
 * `media:` reference — the console holds documents, the renderer holds
 * references, and neither can use the other's input.
 */
export function mediaPosterThumbnailSrc(
  media: {
    url?: string
    cdnPath?: string
    poster?: { variants?: number[] } | null
  },
  width?: number,
): string | undefined {
  // A poster is only reachable through the CDN route, so a free-tier or
  // private asset has no URL that could serve one — the same reason
  // `mediaThumbnailSrc` gives up on `?w=` there.
  if (!media.poster || !media.cdnPath || media.cdnPath.includes('?')) {
    return undefined
  }
  const variants = media.poster.variants ?? []
  // Only a width that was actually generated. `serveMediaCdn` would fall
  // back to the full poster for any other, which works and defeats the point
  // — a 1920px still in a 116px tile.
  const narrowed = width && variants.includes(width) ? `&w=${width}` : ''
  return `${mediaSrc(media)}?poster=1${narrowed}`
}

export default mediaSrc
