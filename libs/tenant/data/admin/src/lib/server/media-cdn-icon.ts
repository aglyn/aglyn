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

import {
  formatSiteIconSpec,
  normalizeSiteIconBackground,
  SITE_ICON_BACKGROUND_PARAM,
  SITE_ICON_PARAM,
  SITE_ICON_VERSION_PARAM,
  siteIconSourceTypeDerivable,
  siteIconUsesBackground,
  DEFAULT_SITE_ICON_BACKGROUND,
  type SiteIconSpec,
} from '@aglyn/aglyn/app-utils/site-icon-set'
import type { NextApiRequest, NextApiResponse } from 'next'

import type { MediaCdnRateLimitRefusal } from './media-cdn-rate-limit'
import { MEDIA_VARIANT_SOURCE_MAX_BYTES } from './media-variants'
import { renderSiteIcon } from './site-icon-render'

/**
 * The `?icon=` representation of a media CDN URL (AGL-3484): one icon of a
 * site's derived set, drawn from the asset's current bytes.
 *
 * `serveMediaCdn` calls this only after every gate it applies to the bytes —
 * scope, lockdown, quarantine, the private signature and the stale-pin
 * redirect — so an icon is served exactly where its source would be.
 *
 * ## Derived once, cached by version
 *
 * The URL a page names carries `v`, the asset's `contentHash`. While `v` is
 * current the icon is drawn once and held for a year by the edge and the
 * browser (`immutable`): the same URL can never need different bytes, because
 * a DAM Replace changes the hash and so the URL the next render names. A
 * stale `v` 302s to the current one under the stable URL's revalidated policy,
 * which is how a page rendered before a Replace reaches the new icon. A URL
 * with no `v` (the source's hash is unknown) is served under the stable
 * policy with an ETag keyed on the hash, exactly as the asset itself is.
 *
 * ## Anything the renderer cannot draw falls back to the original
 *
 * A non-image, an ICO (which `sharp` cannot decode), a source over the
 * variant generator's fetch ceiling, or a file that fails to decode: each
 * 302s to the asset's plain URL. A favicon link must never be the reason a
 * tab shows nothing.
 */

/** The fields of a stored asset this representation reads. */
export interface MediaCdnIconSource {
  /** The media document's `contentType`. */
  contentType: unknown
  /** The media document's `contentHash`; `''` for a legacy asset. */
  contentHash: string
  /** `/api/media/cdn/{scope}/{mediaId}` — the asset's stable URL. */
  stablePath: string
  /** The Storage object, as far as this reads it. */
  file: {
    getMetadata(): Promise<[{ size?: string | number } | null | undefined]>
    download(): Promise<[Buffer]>
  }
}

const firstValue = (value: unknown): string | undefined => {
  const raw = Array.isArray(value) ? value[0] : value
  return typeof raw === 'string' && raw !== '' ? raw : undefined
}

/**
 * The query this representation names, rebuilt from the parameters it reads —
 * never forwarded whole, for `mediaCdnForwardedQuery`'s reasons. `exp`/`sig`
 * ride along so a signed asset's redirect still serves.
 */
function iconQuery(
  query: NextApiRequest['query'],
  pairs: Array<[string, string | undefined]>,
): string {
  const params = new URLSearchParams()
  for (const [key, value] of pairs) if (value) params.set(key, value)
  for (const key of ['exp', 'sig']) {
    const value = firstValue(query[key])
    if (value) params.set(key, value)
  }
  const encoded = params.toString()
  return encoded ? `?${encoded}` : ''
}

/** The `ETag` of one derived icon: the source's hash plus the representation. */
export function mediaCdnIconEtag(
  contentHash: string,
  spec: SiteIconSpec,
  background: string | undefined,
): string | null {
  if (!contentHash) return null
  const plate = background ? `-${background}` : ''
  return `"${contentHash}-icon-${formatSiteIconSpec(spec)}${plate}"`
}

export async function serveMediaCdnIcon(options: {
  req: NextApiRequest
  res: NextApiResponse
  spec: SiteIconSpec
  source: MediaCdnIconSource
  /** Forces `private, no-store` on a signed asset, as the handler's does. */
  setCacheControl: (value: string) => void
  cacheControl: { stable: string; immutable: string }
  /** The caller's delivery count; `null` means serve. */
  rateLimit: () => Promise<MediaCdnRateLimitRefusal | null>
}): Promise<void> {
  const { req, res, spec, source, setCacheControl, cacheControl } = options
  const background = siteIconUsesBackground(spec)
    ? (normalizeSiteIconBackground(
        `#${firstValue(req.query[SITE_ICON_BACKGROUND_PARAM]) ?? ''}`,
      ) ?? DEFAULT_SITE_ICON_BACKGROUND)
    : undefined
  const version = firstValue(req.query[SITE_ICON_VERSION_PARAM])
  const { contentHash } = source

  const original = (cache: string) => {
    res.removeHeader('ETag')
    setCacheControl(cache)
    res.setHeader('Location', `${source.stablePath}${iconQuery(req.query, [])}`)
    res.status(302).end()
  }

  if (!siteIconSourceTypeDerivable(source.contentType)) {
    original(cacheControl.stable)
    return
  }
  if (version && contentHash && version !== contentHash) {
    setCacheControl(cacheControl.stable)
    res.setHeader(
      'Location',
      `${source.stablePath}${iconQuery(req.query, [
        [SITE_ICON_PARAM, formatSiteIconSpec(spec)],
        [SITE_ICON_BACKGROUND_PARAM, background],
        [SITE_ICON_VERSION_PARAM, contentHash],
      ])}`,
    )
    res.status(302).end()
    return
  }

  const etag = mediaCdnIconEtag(contentHash, spec, background)
  setCacheControl(
    version && version === contentHash
      ? cacheControl.immutable
      : cacheControl.stable,
  )
  if (etag) {
    res.setHeader('ETag', etag)
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end()
      return
    }
  }

  const counted = req.method === 'GET' ? options.rateLimit() : null
  const [metadata] = await source.file.getMetadata().catch(() => [null])
  if (!metadata) {
    res.removeHeader('ETag')
    setCacheControl('public, max-age=60')
    res.status(404).json({ error: 'Not found' })
    return
  }
  if (Number(metadata.size ?? 0) > MEDIA_VARIANT_SOURCE_MAX_BYTES) {
    original(cacheControl.stable)
    return
  }
  const refused = await counted
  if (refused) {
    res.removeHeader('ETag')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Retry-After', String(refused.retryAfterSeconds))
    res.status(429).json({ error: 'Too many requests' })
    return
  }

  let icon: { body: Buffer; contentType: string }
  try {
    const [bytes] = await source.file.download()
    icon = await renderSiteIcon({ source: bytes, spec, background })
  } catch (error) {
    // A file that will not decode is a property of the upload, not of the
    // request, but it is not cached either: a Replace must be able to fix it.
    console.error('[media-cdn] site icon render failed', source.stablePath, error)
    original('no-store')
    return
  }

  res.setHeader('Content-Type', icon.contentType)
  res.setHeader('Content-Length', String(icon.body.length))
  res.setHeader(
    'Content-Disposition',
    `inline; filename="icon-${formatSiteIconSpec(spec)}.${
      spec.plate === 'ico' ? 'ico' : 'png'
    }"`,
  )
  if (req.method === 'HEAD') {
    res.status(200).end()
    return
  }
  res.status(200).end(icon.body)
}
