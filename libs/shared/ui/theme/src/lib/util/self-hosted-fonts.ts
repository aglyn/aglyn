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

/**
 * A theme's Google fonts, served from the site's own origin (AGL-3485).
 *
 * A published page loaded its theme font as a `<link rel="stylesheet">` to
 * `fonts.googleapis.com`: a render-blocking request to a third origin, then a
 * second connection to `fonts.gstatic.com` for the files it names — about
 * 800 ms before first paint on the page Lighthouse measured. Nothing about a
 * theme font needs either round trip at view time. The stylesheet is a short
 * list of `@font-face` rules that changes only when the theme does, and the
 * files are versioned in their own paths (`/s/inter/v18/…woff2`), so neither
 * changes under a URL.
 *
 * So the server fetches the stylesheet once, keeps the rules, and inlines them
 * in the page with each `src` pointing at {@link SELF_HOSTED_FONT_ROUTE} on the
 * site's own origin, which serves the file with a year-long `immutable`
 * policy. The one or two faces the first screen paints with are preloaded.
 * Nothing on the page asks Google for anything, which also means a visitor's
 * address is no longer handed to Google by every page view.
 *
 * This module is the pure half: reading Google's stylesheet, writing the
 * rules back, and choosing the faces to preload. The fetching and the file
 * route live with the tenant (`libs/tenant/runtime/.../self-hosted-fonts.ts`).
 *
 * The rules are REBUILT from validated fields rather than echoed, so the
 * inlined CSS can only ever contain a family name the theme chose, a style, a
 * weight, a unicode range and a path on our own route.
 */

/** Where a site serves its theme's font files from. */
export const SELF_HOSTED_FONT_ROUTE = '/api/fonts'

/** The origin Google serves font files from. */
export const GOOGLE_FONT_FILE_ORIGIN = 'https://fonts.gstatic.com'

/**
 * A font file's path on {@link GOOGLE_FONT_FILE_ORIGIN} below `/s/`, as the
 * route accepts it: `{family}/v{n}/{file}.woff2`. Anything else is refused,
 * so the route can never be used to fetch an arbitrary URL.
 */
const FONT_FILE_PATH = /^[a-z0-9]+\/v\d{1,4}\/[A-Za-z0-9_-]{1,200}\.woff2$/

/** One `@font-face` rule from Google's stylesheet. */
export interface GoogleFontFace {
  family: string
  style: 'normal' | 'italic'
  /** A weight (`400`) or, for a variable font, a range (`100 900`). */
  weight: string
  /** Google's subset comment above the rule (`latin`, `latin-ext`, …). */
  subset?: string
  /** The file's path below `/s/` on Google's origin. */
  path: string
  unicodeRange?: string
}

/** Whether a path is one {@link SELF_HOSTED_FONT_ROUTE} will serve. */
export function isSelfHostedFontPath(path: string): boolean {
  return FONT_FILE_PATH.test(path)
}

/** The site-relative URL a face's file is served from. */
export function selfHostedFontUrl(path: string): string {
  return `${SELF_HOSTED_FONT_ROUTE}/${path}`
}

/** Google's own URL for a self-hosted path. */
export function googleFontFileUrl(path: string): string {
  return `${GOOGLE_FONT_FILE_ORIGIN}/s/${path}`
}

const FACE_BLOCK = /(?:\/\*\s*([a-z0-9-]+)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g
const FAMILY = /font-family:\s*'([^']{1,80})'/
const STYLE = /font-style:\s*(normal|italic)/
const WEIGHT = /font-weight:\s*(\d{3}(?:\s+\d{3})?)/
const SRC = /src:\s*url\((https:\/\/fonts\.gstatic\.com\/s\/[^)\s]+)\)\s*format\('woff2'\)/
const RANGE = /unicode-range:\s*([U+0-9A-Fa-f?,\s-]{1,4000});/

/**
 * Reads the `@font-face` rules out of a Google Fonts CSS2 stylesheet fetched
 * with a browser that accepts WOFF2. A rule that is not exactly the shape
 * Google writes — a missing field, a file off Google's origin, a path the
 * route would refuse — is dropped, never repaired.
 */
export function parseGoogleFontFaces(css: string): GoogleFontFace[] {
  const faces: GoogleFontFace[] = []
  for (const match of css.matchAll(FACE_BLOCK)) {
    const [, subset, body] = match
    const family = FAMILY.exec(body)?.[1]
    const style = STYLE.exec(body)?.[1] as GoogleFontFace['style'] | undefined
    const weight = WEIGHT.exec(body)?.[1]
    const url = SRC.exec(body)?.[1]
    if (!family || !style || !weight || !url) continue
    const path = url.slice(`${GOOGLE_FONT_FILE_ORIGIN}/s/`.length)
    if (!isSelfHostedFontPath(path)) continue
    const unicodeRange = RANGE.exec(body)?.[1]?.trim()
    faces.push({
      family,
      style,
      weight: weight.replace(/\s+/g, ' '),
      ...(subset ? { subset } : {}),
      path,
      ...(unicodeRange ? { unicodeRange } : {}),
    })
  }
  return faces
}

/** A family name as it may appear quoted in CSS. */
function cssFamily(family: string): string {
  return `'${family.replace(/['\\\n\r]/g, '')}'`
}

/**
 * The faces as `@font-face` rules on the site's own route, every one
 * `font-display: swap` so text paints in the fallback while a file loads.
 *
 * Every subset Google declared is kept, each with its `unicode-range`: a
 * browser downloads a subset only when the page uses a character in it, so
 * the Cyrillic file costs an English page nothing, and a Polish or Greek page
 * keeps its typeface. Only the Latin faces are preloaded.
 */
export function selfHostedFontFaceCss(faces: readonly GoogleFontFace[]): string {
  return faces
    .map((face) =>
      [
        '@font-face{',
        `font-family:${cssFamily(face.family)};`,
        `font-style:${face.style};`,
        `font-weight:${face.weight};`,
        'font-display:swap;',
        `src:url(${selfHostedFontUrl(face.path)}) format('woff2');`,
        face.unicodeRange ? `unicode-range:${face.unicodeRange};` : '',
        '}',
      ].join(''),
    )
    .join('')
}

/** The first family named in a CSS `font-family` stack. */
function firstFamily(stack: unknown): string | undefined {
  if (typeof stack !== 'string') return undefined
  const first = stack.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '')
  return first || undefined
}

/** How far a face is from a wanted weight; 0 when its range covers it. */
function weightDistance(face: GoogleFontFace, wanted: number): number {
  const [low, high = low] = face.weight.split(' ').map(Number)
  if (wanted >= low && wanted <= high) return 0
  return Math.min(Math.abs(wanted - low), Math.abs(wanted - high))
}

/** The Latin, upright face of `family` closest to `weight`. */
function latinFace(
  faces: readonly GoogleFontFace[],
  family: string | undefined,
  weight: number,
): GoogleFontFace | undefined {
  if (!family) return undefined
  const wanted = family.toLowerCase()
  const candidates = faces.filter(
    (face) =>
      face.family.toLowerCase() === wanted &&
      face.style === 'normal' &&
      (face.subset === undefined || face.subset === 'latin'),
  )
  return candidates.sort(
    (a, b) => weightDistance(a, weight) - weightDistance(b, weight),
  )[0]
}

/**
 * The paths of the one or two faces the first screen paints with: the body
 * text's face, and the headline's when it is a different file. Those are the
 * fonts the largest text on the page — usually the LCP element — waits for,
 * so they are worth starting with the document; every other face is fetched
 * when the page first uses it.
 *
 * The body face is the theme's `fontFamily` (else the first Google font it
 * loads) at `body1`'s weight, 400 by default; the headline face is `h1`'s
 * family and weight, 700 by default. A variable font serves every weight
 * from one file, which is then preloaded once.
 */
export function selfHostedFontPreloads(
  theme: Pick<HostTheme, 'fonts' | 'typography'> | undefined,
  faces: readonly GoogleFontFace[],
): string[] {
  const typography = theme?.typography
  const variants = typography?.variants
  const fallback = theme?.fonts?.find(
    (font) => (font.source ?? 'google') === 'google',
  )?.family
  const bodyFamily = firstFamily(typography?.fontFamily) ?? fallback
  const body = latinFace(faces, bodyFamily, variants?.body1?.fontWeight ?? 400)
  const heading = latinFace(
    faces,
    firstFamily(variants?.h1?.fontFamily) ?? bodyFamily,
    variants?.h1?.fontWeight ?? 700,
  )
  const paths = [body, heading]
    .filter((face): face is GoogleFontFace => Boolean(face))
    .map((face) => selfHostedFontUrl(face.path))
  return [...new Set(paths)]
}
