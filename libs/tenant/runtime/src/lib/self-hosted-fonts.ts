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

import type { HostTheme } from '@aglyn/shared-data-types'
// By path: the theme lib's barrel carries React providers a server module
// has no use for (AGL-405).
import { getGoogleFontsUrl } from '@aglyn/shared-ui-theme/util/host-theme'
import {
  type GoogleFontFace,
  googleFontFileUrl,
  isSelfHostedFontPath,
  parseGoogleFontFaces,
  selfHostedFontFaceCss,
  selfHostedFontPreloads,
} from '@aglyn/shared-ui-theme/util/self-hosted-fonts'

/**
 * The tenant's half of self-hosted theme fonts (AGL-3485): fetching Google's
 * stylesheet for a theme, and serving the files it names from the site's own
 * origin. What is done with the stylesheet, and why, is the note on
 * `@aglyn/shared-ui-theme/util/self-hosted-fonts`.
 */

/**
 * A current desktop Chrome. Google's CSS2 API picks the font FORMAT from the
 * user agent, and a server's default agent is answered with TrueType; this
 * one is answered with WOFF2, the format every browser a site supports reads.
 */
const WOFF2_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'

/** How long one process trusts a stylesheet it fetched. */
const STYLESHEET_TTL_MS = 24 * 60 * 60 * 1000

/** How long a failed fetch is remembered before it is tried again. */
const FAILURE_TTL_MS = 5 * 60 * 1000

/** How long a page render waits for Google before falling back. */
const STYLESHEET_TIMEOUT_MS = 2_500

/** The largest font file the route will pass on. */
const MAX_FONT_BYTES = 2 * 1024 * 1024

/** A font file's URL never changes its bytes: the version is in the path. */
export const SELF_HOSTED_FONT_CACHE_CONTROL =
  'public, max-age=31536000, s-maxage=31536000, immutable'

const stylesheets = new Map<
  string,
  { expires: number; faces: Promise<GoogleFontFace[] | null> }
>()

/** Test seam: the process cache would otherwise leak between cases. */
export function resetSelfHostedFontsForTests(): void {
  stylesheets.clear()
}

/**
 * Google's faces for a stylesheet URL, from this process's cache when it has
 * them. Null when the fetch failed or answered with nothing usable; the page
 * then links the stylesheet as it always did, rather than losing its font.
 *
 * Asked through `fetch` with a day's revalidation, which on the server is
 * Next's data cache: a cold process reads the stored stylesheet rather than
 * asking Google again.
 */
function facesFor(url: string): Promise<GoogleFontFace[] | null> {
  const now = Date.now()
  const held = stylesheets.get(url)
  if (held && held.expires > now) return held.faces
  const faces = fetch(url, {
    headers: { 'User-Agent': WOFF2_USER_AGENT },
    signal: AbortSignal.timeout(STYLESHEET_TIMEOUT_MS),
    next: { revalidate: STYLESHEET_TTL_MS / 1000 },
  } as RequestInit)
    .then(async (response) => {
      if (!response.ok) return null
      const parsed = parseGoogleFontFaces(await response.text())
      return parsed.length ? parsed : null
    })
    .catch(() => null)
  stylesheets.set(url, { expires: now + STYLESHEET_TTL_MS, faces })
  void faces.then((found) => {
    if (!found) stylesheets.set(url, { expires: now + FAILURE_TTL_MS, faces })
  })
  return faces
}

/** What a page inlines in its head for its theme's fonts. */
export interface SelfHostedThemeFonts {
  /** The `@font-face` rules, every `src` on the site's own origin. */
  css: string
  /** The one or two files the first screen paints with, to preload. */
  preloads: string[]
}

/**
 * The theme's Google fonts as rules to inline and files to preload, or null
 * when the theme loads none or Google could not be read — in which case the
 * caller links the stylesheet as before.
 */
export async function selfHostedThemeFonts(
  theme: Pick<HostTheme, 'fonts' | 'typography'> | undefined,
): Promise<SelfHostedThemeFonts | null> {
  const url = getGoogleFontsUrl(theme?.fonts)
  if (!url) return null
  const faces = await facesFor(url)
  if (!faces) return null
  return {
    css: selfHostedFontFaceCss(faces),
    preloads: selfHostedFontPreloads(theme, faces),
  }
}

/**
 * One font file, fetched from Google and answered from the site's origin with
 * a year-long `immutable` policy. `path` is the part below `/s/` on Google's
 * origin (`inter/v18/….woff2`); anything else is a 404, so this route cannot
 * be pointed at any other URL.
 *
 * The edge keeps the answer for the year too (`s-maxage`), so Google is asked
 * once per file per edge region rather than once per visitor.
 */
export async function serveSelfHostedFont(path: string): Promise<Response> {
  const notFound = () =>
    new Response('Not found', {
      status: 404,
      headers: { 'Cache-Control': 'public, max-age=300' },
    })
  if (!isSelfHostedFontPath(path)) return notFound()
  let upstream: Response
  try {
    upstream = await fetch(googleFontFileUrl(path), {
      headers: { 'User-Agent': WOFF2_USER_AGENT },
      cache: 'force-cache',
    })
  } catch {
    return new Response('Font unavailable', {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
  if (upstream.status === 404) return notFound()
  const length = Number(upstream.headers.get('content-length') ?? 0)
  if (!upstream.ok || !upstream.body || length > MAX_FONT_BYTES) {
    return new Response('Font unavailable', {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'font/woff2',
      'Cache-Control': SELF_HOSTED_FONT_CACHE_CONTROL,
      'X-Content-Type-Options': 'nosniff',
      // Fonts are fetched in CORS mode; a site reached on two hostnames (its
      // own domain and its platform subdomain) shares one cached answer.
      'Access-Control-Allow-Origin': '*',
      ...(length ? { 'Content-Length': String(length) } : {}),
    },
  })
}
