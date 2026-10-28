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

/*==========================================
 * AN IMPORTED PAGE'S PHOTOS, INTO THE SITE'S OWN MEDIA LIBRARY (AGL-3976).
 *
 * Every picture goes through the media library's server door
 * (`pluginMediaIngest().ingest`), which checks the member, the site's
 * lockdown, the bytes' structure, the takedown list and the storage band
 * exactly as an upload does. This module only fetches and names:
 *
 * - **Never a second copy.** A picture's SOURCE KEY is `import:` and a hash
 *   of its address with any fragment and tracking parameter removed. The
 *   library is asked for that key first (`findImportedPhoto`); a logo every
 *   page shows is stored once and placed everywhere. An ingest that cannot
 *   answer the question stores nothing, rather than risk the second copy.
 * - **The safe fetch.** Bytes are read through `fetchPublicTextDetailed`,
 *   the SSRF-guarded fetch the crawler uses (public https only, the socket
 *   pinned, every redirect checked again), as AglynBot, capped in size and
 *   time, and only as JPEG, PNG, WebP or GIF: the raster types the library
 *   takes from a server.
 *=========================================*/

import type { PluginMediaIngest } from '@aglyn/aglyn/plugin-manager/plugin-media-ingest'
import { createHash } from 'node:crypto'
import {
  fetchPublicTextDetailed,
  type PublicFetchOptions,
  type PublicFetchResult,
} from '../jobs/ai-theme-brand-inputs'
import type { AiSiteImportPage, AiSiteImportPhoto } from '../model/ai-site-import'
import { AGLYN_BOT_USER_AGENT, type SiteImportPage } from './site-import-crawl'

/** The largest picture brought in. */
export const SITE_IMPORT_IMAGE_MAX_BYTES = 8 * 1024 * 1024

/** A picture smaller than this is a spacer or a tracking pixel, not a photo. */
export const SITE_IMPORT_IMAGE_MIN_BYTES = 1_024

/** One picture's own clock. */
export const SITE_IMPORT_IMAGE_TIMEOUT_MS = 8_000

const RASTER = /^image\/(?:jpeg|jpg|pjpeg|png|webp|gif)\b/i

const NOT_A_PHOTO = /\.(?:svg|ico|bmp|tiff?|avif|heic)$/i

const TRACKING_PARAM = /^(?:utm_[a-z]+|fbclid|gclid|msclkid|_ga|ref)$/i

const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/pjpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** A picture's address as it is fetched and keyed: https, no fragment or tracking; `null` for one that is not a photo. */
export function siteImportImageUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(String(raw ?? '').trim())
  } catch {
    return null
  }
  if (url.protocol === 'http:') url.protocol = 'https:'
  if (url.protocol !== 'https:' || url.username || url.password) return null
  if (url.port && url.port !== '443') return null
  if (NOT_A_PHOTO.test(url.pathname)) return null
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key)
  }
  return url.toString()
}

/** The key a site's library holds an imported picture by. */
export function siteImportImageKey(url: string): string {
  return `import:${createHash('sha256').update(url).digest('hex').slice(0, 32)}`
}

/** A file name for the library, from the picture's address and type. */
export function siteImportImageFileName(url: string, contentType: string): string {
  let base = 'photo'
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '')
    base = last.replace(/\.[a-z0-9]+$/i, '').replace(/[^a-zA-Z0-9 _-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'photo'
  } catch {
    // An address that does not decode keeps the plain name.
  }
  const type = contentType.split(';')[0].trim().toLowerCase()
  return `${base.slice(0, 80)}.${EXTENSION[type] ?? 'jpg'}`
}

export interface SiteImportPhotosInput {
  hostId: string
  /** The member the photos are stored as: the job's creator. */
  uid: string
  domain: string
  images: ReadonlyArray<{ url: string; alt: string }>
  signal?: AbortSignal
  /** When the pass must stop asking for more. */
  deadlineAt: number
}

export interface SiteImportPhotosDeps {
  ingest: PluginMediaIngest | null
  fetch?: (url: string, options: PublicFetchOptions) => Promise<PublicFetchResult>
  now?: () => number
}

/**
 * Brings one page's pictures into the site's library, reusing any the
 * library already holds by key. Never throws for anything a picture does.
 */
export async function bringInSiteImportPhotos(
  input: SiteImportPhotosInput,
  deps: SiteImportPhotosDeps,
): Promise<NonNullable<AiSiteImportPage['photos']>> {
  const now = deps.now ?? Date.now
  const fetchBytes = deps.fetch ?? fetchPublicTextDetailed
  const assets: AiSiteImportPhoto[] = []
  let brought = 0
  let reused = 0
  let skipped = 0
  const ingest = deps.ingest
  // No library door, or one that cannot say what it already holds: nothing
  // is stored, because a picture stored without that check could be a copy.
  if (!ingest?.findImportedPhoto) {
    return { brought, reused, skipped: input.images.length, assets }
  }
  const seen = new Set<string>()
  for (const image of input.images) {
    const url = siteImportImageUrl(image.url)
    if (!url || seen.has(url)) {
      if (!url) skipped += 1
      continue
    }
    seen.add(url)
    if (input.signal?.aborted || now() >= input.deadlineAt) {
      skipped += 1
      continue
    }
    const sourceKey = siteImportImageKey(url)
    try {
      const held = await ingest.findImportedPhoto({ hostId: input.hostId, sourceKey })
      if (held) {
        reused += 1
        assets.push({
          mediaId: held.mediaId,
          src: held.src,
          ...(held.width ? { width: held.width } : {}),
          ...(held.height ? { height: held.height } : {}),
          ...(held.alt || image.alt ? { alt: held.alt || image.alt } : {}),
        })
        continue
      }
      const fetched = await fetchBytes(url, {
        maxBytes: SITE_IMPORT_IMAGE_MAX_BYTES,
        accept: RASTER,
        acceptHeader: 'image/webp,image/png,image/jpeg,image/gif;q=0.9',
        userAgent: AGLYN_BOT_USER_AGENT,
        timeoutMs: Math.max(1, Math.min(SITE_IMPORT_IMAGE_TIMEOUT_MS, input.deadlineAt - now())),
        refuseOver: true,
        binary: true,
        ...(input.signal ? { signal: input.signal } : {}),
      })
      if (!fetched.ok || !fetched.data || fetched.data.byteLength < SITE_IMPORT_IMAGE_MIN_BYTES) {
        skipped += 1
        continue
      }
      const contentType = fetched.contentType.split(';')[0].trim().toLowerCase().replace('image/jpg', 'image/jpeg').replace('image/pjpeg', 'image/jpeg')
      const stored = await ingest.ingest({
        hostId: input.hostId,
        uid: input.uid,
        fileName: siteImportImageFileName(url, contentType),
        contentType,
        bytes: fetched.data,
        ...(image.alt ? { alt: image.alt.slice(0, 250) } : {}),
        importedFrom: { key: sourceKey, url, domain: input.domain },
      })
      if (!stored.ok) {
        skipped += 1
        continue
      }
      brought += 1
      assets.push({
        mediaId: stored.mediaId,
        src: stored.src,
        ...(stored.width ? { width: stored.width } : {}),
        ...(stored.height ? { height: stored.height } : {}),
        ...(image.alt ? { alt: image.alt.slice(0, 250) } : {}),
      })
    } catch (error) {
      console.warn('[site-import] a photo could not be brought in', { hostId: input.hostId, error })
      skipped += 1
    }
  }
  return { brought, reused, skipped, assets }
}

/*------------------------------------------
 * The site's logo (AGL-4083)
 *-----------------------------------------*/

/**
 * A picture that may be the site's logo, where it was found. `type` is what
 * its address or its declared type says: `svg`, a raster, or `null` when
 * neither says (a media library address with no extension); the ingest
 * reads the answer's own type either way.
 */
export interface SiteImportLogoCandidate {
  url: string
  alt: string
  source: 'header' | 'footer' | 'structured-data' | 'apple-touch-icon' | 'icon'
  type: 'svg' | 'raster' | null
}

/** A logo's address as it is fetched: https, no fragment or tracking parameter. An SVG is a logo, unlike a photo. */
export function siteImportLogoUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(String(raw ?? '').trim())
  } catch {
    return null
  }
  if (url.protocol === 'http:') url.protocol = 'https:'
  if (url.protocol !== 'https:' || url.username || url.password) return null
  if (url.port && url.port !== '443') return null
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key)
  }
  return url.toString()
}

function logoTypeOf(url: string, declared?: string | null): SiteImportLogoCandidate['type'] {
  const type = (declared ?? '').toLowerCase()
  if (type.includes('svg')) return 'svg'
  if (/^image\/(?:png|jpe?g|webp|gif|x-icon|vnd\.microsoft\.icon)/.test(type)) return 'raster'
  let path: string
  try {
    path = new URL(url).pathname.toLowerCase()
  } catch {
    return null
  }
  if (path.endsWith('.svg')) return 'svg'
  if (/\.(?:png|jpe?g|webp|gif|ico)$/.test(path)) return 'raster'
  return null
}

/**
 * The pictures that may be the site's logo (AGL-4083), the likeliest first:
 * the picture in the header's link home, any header picture that says it is
 * the logo or the site's name, the footer's, the structured data's logo,
 * then the largest touch icon and the largest icon. Each address once.
 */
export function siteImportLogoCandidates(
  page: Pick<SiteImportPage, 'brand' | 'images' | 'icons' | 'siteName' | 'organization' | 'title'>,
): SiteImportLogoCandidate[] {
  const name = (page.siteName || page.organization?.name || '').trim().toLowerCase()
  const says = (image: { url: string; alt: string }) => {
    const alt = image.alt.trim().toLowerCase()
    return /\blogo\b/i.test(image.alt) || /logo/i.test(image.url) || (!!name && (alt === name || alt === `${name} logo`))
  }
  const out: SiteImportLogoCandidate[] = []
  const add = (raw: string, alt: string, source: SiteImportLogoCandidate['source'], declared?: string | null) => {
    const url = siteImportLogoUrl(raw)
    if (!url || out.some((entry) => entry.url === url)) return
    out.push({ url, alt: alt.slice(0, 250), source, type: logoTypeOf(url, declared) })
  }
  if (page.brand?.logo && page.brand.region !== 'footer') add(page.brand.logo.url, page.brand.logo.alt, 'header')
  for (const image of page.images) if (image.region === 'header' && says(image)) add(image.url, image.alt, 'header')
  for (const image of page.images) if (image.region === 'footer' && says(image)) add(image.url, image.alt, 'footer')
  if (page.organization?.logo) add(page.organization.logo, page.organization.name, 'structured-data')
  const touch = page.icons.filter((icon) => icon.rel === 'apple-touch-icon').sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0]
  if (touch) add(touch.url, '', 'apple-touch-icon', touch.type)
  const icon = page.icons.filter((entry) => entry.rel === 'icon').sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0]
  if (icon) add(icon.url, '', 'icon', icon.type)
  return out
}
