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

import type {
  HostTheme,
  HostThemeFont,
  HostThemeFontCategory,
  HostThemeFontMetrics,
} from '@aglyn/shared-data-types'
import {
  boundedAwait,
  createSettledValueCache,
} from '@aglyn/shared-util-http/bounded-await'
import { resolveMediaSrc } from '@aglyn/aglyn/app-utils/media-ref'
import {
  themeFontFacts,
  type ThemeFontFacts,
} from '@aglyn/aglyn/plugin-manager/plugin-theme-font-catalog'
// By path: the theme lib's barrel carries React providers a server module
// has no use for (AGL-405).
import {
  type GoogleFontFace,
  googleFontFileUrl,
  googleFontSheetUrl,
  isSelfHostedFontPath,
  mergeSharedFiles,
  metricFallbackFontFaceCss,
  offeredWeights,
  parseGoogleFontFaces,
  type SiteFontFace,
  siteFontFaceCss,
  siteFontFaceFromGoogle,
  siteFontPreloads,
  type ThemeFontNeed,
  themeFontNeeds,
} from '@aglyn/shared-ui-theme/util/self-hosted-fonts'

/**
 * The tenant's half of self-hosted theme fonts (AGL-3485, AGL-3656): working
 * out which faces a theme draws with, asking Google for them, choosing how
 * each family is delivered, and serving the files from the site's own
 * origin. What is done with the rules, and why, is the note on
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

/** How long one process trusts a stylesheet, a file size or a choice. */
const STYLESHEET_TTL_MS = 24 * 60 * 60 * 1000

/** How long a failed fetch is remembered before it is tried again. */
const FAILURE_TTL_MS = 5 * 60 * 1000

/** How long a page render waits for Google before going without. */
const STYLESHEET_TIMEOUT_MS = 2_500

/** How long a render waits for a file's size before choosing without it. */
const SIZE_TIMEOUT_MS = 1_500

/** The largest font file the route will pass on. */
const MAX_FONT_BYTES = 2 * 1024 * 1024

/** A font file's URL never changes its bytes: the version is in the path. */
export const SELF_HOSTED_FONT_CACHE_CONTROL =
  'public, max-age=31536000, s-maxage=31536000, immutable'

/**
 * What this process learned: each stylesheet's faces, each file's size, and
 * each family's delivery. VALUES, never an in-flight promise — the
 * settled-value cache refuses one. A promise held across requests is awaited
 * by renders that did not create it, and one that never settles stalled every
 * page of every site on the instance until the function timed out
 * (AGL-3565).
 */
const stylesheets = createSettledValueCache<string, GoogleFontFace[] | null>()
const fileSizes = createSettledValueCache<string, number | null>()
/** A family's delivery, and whether it was chosen with every fact in hand. */
interface Delivery {
  faces: GoogleFontFace[] | null
  /** False when a sheet or a size was missing and the statics were the default. */
  decided: boolean
}
const deliveries = createSettledValueCache<string, Delivery>()

/** Test seam: the process caches would otherwise leak between cases. */
export function resetSelfHostedFontsForTests(): void {
  stylesheets.clear()
  fileSizes.clear()
  deliveries.clear()
}

/**
 * Google's faces for a stylesheet URL, or null; never waits past `ms`. The
 * deadline is a real timer (`boundedAwait`): an abort signal alone did not
 * bound Next's patched fetch on Vercel, whose promise could never settle.
 */
function fetchFaces(url: string, ms: number): Promise<GoogleFontFace[] | null> {
  return boundedAwait(
    (signal) =>
      fetch(url, {
        headers: { 'User-Agent': WOFF2_USER_AGENT },
        signal,
        next: { revalidate: STYLESHEET_TTL_MS / 1000 },
      } as RequestInit)
        .then(async (response) => {
          if (!response.ok) return null
          const parsed = parseGoogleFontFaces(await response.text())
          return parsed.length ? parsed : null
        })
        .catch(() => null),
    ms,
    null,
    'self-hosted-fonts.stylesheet',
  )
}

/**
 * Google's faces for a stylesheet URL, from this process's cache when it has
 * them; null when the fetch failed, timed out or answered with nothing
 * usable. Asked through `fetch` with a day's revalidation, which on the
 * server is Next's data cache: a cold process reads the stored stylesheet
 * rather than asking Google again.
 */
function facesFor(url: string): Promise<GoogleFontFace[] | null> {
  return stylesheets.readThrough(
    url,
    () => fetchFaces(url, STYLESHEET_TIMEOUT_MS),
    (faces) => (faces ? STYLESHEET_TTL_MS : FAILURE_TTL_MS),
  )
}

/** A Google file's size in bytes, from a HEAD; null when it could not be read. */
function fileSize(path: string): Promise<number | null> {
  return fileSizes.readThrough(
    path,
    () =>
      boundedAwait(
        (signal) =>
          fetch(googleFontFileUrl(path), { method: 'HEAD', signal, cache: 'force-cache' })
            .then((response) => {
              const length = Number(response.headers.get('content-length'))
              return response.ok && length > 0 ? length : null
            })
            .catch(() => null),
        SIZE_TIMEOUT_MS,
        null,
        'self-hosted-fonts.size',
      ),
    (size) => (size ? STYLESHEET_TTL_MS : FAILURE_TTL_MS),
  )
}

/** The Latin, upright file of a weight among some faces, if there is one. */
function latinFileOf(faces: readonly GoogleFontFace[], weight: number): string | undefined {
  return faces.find((face) => {
    if (face.style !== 'normal' || (face.subset && face.subset !== 'latin')) return false
    const [low, high = low] = face.weight.split(' ').map(Number)
    return weight >= low && weight <= high
  })?.path
}

type Face = { weight: number; style: 'normal' | 'italic' }

/**
 * Each face from its own stylesheet, so a weight Google refuses costs that
 * face rather than the family. One weight per request is also what makes
 * Google answer a variable family with a static instance of that weight.
 */
async function facesOneByOne(family: string, faces: readonly Face[]): Promise<GoogleFontFace[] | null> {
  const sheets = await Promise.all(
    faces.map((face) => {
      const url = googleFontSheetUrl(family, [face])
      return url ? facesFor(url) : Promise.resolve(null)
    }),
  )
  const found = sheets.flatMap((sheet) => sheet ?? [])
  return found.length ? found : null
}

/**
 * How one Google family is delivered: as a file per weight, or as the
 * family's variable file holding every weight, whichever is smaller for the
 * weights the page's text styles draw with (AGL-3656).
 *
 * A theme that sets body text and headlines in two weights of Open Sans pays
 * 27 KB for two static Latin files rather than 43 KB for the variable one;
 * aglyn.com, which draws Roboto Flex at seven weights, pays 34 KB for the
 * variable file rather than seven statics. The sizes are the files' own,
 * read once per process with a HEAD; a size that cannot be read leaves the
 * statics, which put the smallest file on the first screen.
 *
 * A family that is not variable, or one the catalog does not know, is asked
 * for a face at a time.
 */
function deliveryFor(
  need: ThemeFontNeed,
  facts: ThemeFontFacts | undefined,
): Promise<GoogleFontFace[] | null> {
  const weights = offeredWeights(need.weights, facts?.weights)
  // An italic is asked for only of a family the catalog says has one: a
  // request for one it lacks is refused, and a slanted upright is what the
  // browser would draw anyway.
  const italics = facts?.italics?.length ? offeredWeights(need.italics, facts.italics) : []
  const wanted: Face[] = [
    ...weights.map((weight) => ({ weight, style: 'normal' as const })),
    ...italics.map((weight) => ({ weight, style: 'italic' as const })),
  ]
  const key = `${need.family.toLowerCase()}|${wanted.map((face) => `${face.style[0]}${face.weight}`).join(',')}`
  return deliveries
    .readThrough(
      key,
      async (): Promise<Delivery> => {
        if (!facts?.variableWeights) {
          const faces = await facesOneByOne(need.family, wanted)
          return { faces, decided: !!faces }
        }
        const combinedUrl = googleFontSheetUrl(need.family, wanted)
        const [statics, combined] = await Promise.all([
          facesOneByOne(need.family, wanted),
          combinedUrl ? facesFor(combinedUrl) : Promise.resolve(null),
        ])
        if (!statics || !combined) return { faces: statics ?? combined, decided: false }
        const drawn = offeredWeights(need.textWeights.length ? need.textWeights : weights, facts.weights)
        const staticPaths = [...new Set(drawn.map((weight) => latinFileOf(statics, weight)))]
        const combinedPath = latinFileOf(combined, drawn[0] ?? 400)
        if (!combinedPath || staticPaths.some((path) => !path)) return { faces: statics, decided: false }
        const [combinedSize, ...staticSizes] = await Promise.all(
          [combinedPath, ...(staticPaths as string[])].map(fileSize),
        )
        if (!combinedSize || staticSizes.some((size) => !size)) return { faces: statics, decided: false }
        const staticTotal = (staticSizes as number[]).reduce((sum, size) => sum + size, 0)
        return { faces: combinedSize < staticTotal ? combined : statics, decided: true }
      },
      // A choice made without every sheet and size is the statics by default,
      // so it is kept only as long as a failure: the next render after that
      // asks again rather than serving the default for a day.
      (result) => (result.decided ? STYLESHEET_TTL_MS : FAILURE_TTL_MS),
    )
    .then((result) => result.faces)
}

/** The category a stack's generic keyword names, for a font with none recorded. */
function categoryFromStack(stack: unknown): HostThemeFontCategory {
  if (typeof stack !== 'string') return 'sans-serif'
  if (/\bmonospace\b/i.test(stack)) return 'monospace'
  if (/(^|,)\s*serif\b/i.test(stack)) return 'serif'
  return 'sans-serif'
}

/** What a page inlines in its head for its theme's fonts. */
export interface SelfHostedThemeFonts {
  /**
   * The `@font-face` rules, every `src` on the site's own origin, and each
   * family's metric-matched fallback.
   */
  css: string
  /** The one or two files the first screen paints with, to preload. */
  preloads: string[]
}

export interface SelfHostedThemeFontsOptions {
  /** The site rendering, which an uploaded font's media URL is qualified with. */
  hostId?: string | null
  /**
   * The typography the site's theme is layered onto
   * (`siteBaseOptions(...).typography`): a text style the theme leaves alone
   * draws with the base's weight and family.
   */
  baseTypography?: Record<string, unknown>
  /**
   * Fonts the base theme draws with that the site's theme does not list —
   * the platform brand's face on the operator's own hosts.
   */
  baseFonts?: readonly HostThemeFont[]
}

/**
 * The theme's web fonts as rules to inline and files to preload, or null when
 * the theme loads none.
 *
 * Every face is on the site's own origin: a Google face through
 * {@link serveSelfHostedFont}, an uploaded one through the media route. When
 * Google cannot be read the family is left out rather than linked from
 * Google, and its metric-matched fallback still draws the text in the font's
 * box; the page asks again on its next render.
 */
export async function selfHostedThemeFonts(
  theme: Pick<HostTheme, 'fonts' | 'typography'> | undefined,
  options: SelfHostedThemeFontsOptions = {},
): Promise<SelfHostedThemeFonts | null> {
  const fonts = [...(theme?.fonts ?? []), ...(options.baseFonts ?? [])]
  const needs = themeFontNeeds(theme, options.baseTypography, options.baseFonts)
  if (!needs.length) return null
  const stack =
    theme?.typography?.fontFamily ?? (options.baseTypography?.['fontFamily'] as string | undefined)

  const families = await Promise.all(
    needs.map(async (need) => {
      const font = fonts.find((entry) => entry.family.trim().toLowerCase() === need.family.toLowerCase())
      if (!font) return { faces: [] as SiteFontFace[], fallback: '' }
      if (font.source === 'custom') {
        const faces = (font.faces ?? []).flatMap((face): SiteFontFace[] => {
          const url = resolveMediaSrc(face.src, { hostId: options.hostId, version: face.version })
          if (!url || (face.style !== 'normal' && face.style !== 'italic')) return []
          return [
            {
              family: font.family.trim(),
              style: face.style,
              weight: String(Math.round(Number(face.weight) || 400)),
              url,
              ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {}),
            },
          ]
        })
        return {
          faces,
          fallback: faces.length
            ? metricFallbackFontFaceCss(font.family, font.metrics, font.category ?? categoryFromStack(stack))
            : '',
        }
      }
      const facts = await themeFontFacts(need.family)
      const google = (await deliveryFor(need, facts)) ?? []
      const metrics: HostThemeFontMetrics | undefined = font.metrics ?? facts?.metrics
      return {
        faces: google.map(siteFontFaceFromGoogle),
        fallback: metricFallbackFontFaceCss(
          font.family,
          metrics,
          font.category ?? facts?.category ?? categoryFromStack(stack),
        ),
      }
    }),
  )

  const faces = mergeSharedFiles(families.flatMap((family) => family.faces))
  const css = siteFontFaceCss(faces) + families.map((family) => family.fallback).join('')
  if (!css) return null
  return {
    css,
    preloads: siteFontPreloads(
      { ...theme, fonts },
      faces,
      options.baseTypography,
    ),
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
