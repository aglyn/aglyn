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
import { metricFallbackFamily, stackFamilies } from './font-stack'

export { metricFallbackFamily, themeWebFontFamilies, withMetricFallbacks } from './font-stack'

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
 * so the route can never be used to fetch an arbitrary URL. A file name runs
 * to 400 characters: a variable family with many axes (Roboto Flex) is named
 * by an id of about 250, which a 200 cap refused, dropping every face of the
 * family (AGL-3656).
 */
const FONT_FILE_PATH = /^[a-z0-9]+\/v\d{1,4}\/[A-Za-z0-9_-]{1,400}\.woff2$/

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
function weightDistance(face: { weight: string }, wanted: number): number {
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

/* ------------------------------------------------------------------------ *
 * The loader (AGL-3656): faces per weight, metric-matched fallbacks, and the
 * site's own uploaded fonts.
 * ------------------------------------------------------------------------ */

/**
 * One face a page declares, wherever its file lives: a Google face rewritten
 * onto {@link SELF_HOSTED_FONT_ROUTE}, or a site's own upload on its media
 * route. Both are on the site's own origin.
 */
export interface SiteFontFace {
  family: string
  style: 'normal' | 'italic'
  /** A weight (`400`) or, for a variable file, a range (`300 900`). */
  weight: string
  /** Site-relative URL of the WOFF2 file. */
  url: string
  /** Google's subset name (`latin`, …); absent for a file with no split. */
  subset?: string
  unicodeRange?: string
}

/** A Google face as a {@link SiteFontFace} on the site's own route. */
export function siteFontFaceFromGoogle(face: GoogleFontFace): SiteFontFace {
  return {
    family: face.family,
    style: face.style,
    weight: face.weight,
    url: selfHostedFontUrl(face.path),
    ...(face.subset ? { subset: face.subset } : {}),
    ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {}),
  }
}

/**
 * The faces with every set of rules that share one file folded into one rule
 * over the weights it covers.
 *
 * Google answers a request for several weights of a variable family with the
 * SAME file once per weight, each rule naming one weight. A browser treats
 * those as separate faces: it matches 500 to nothing between the 400 and 600
 * rules a theme listed and renders it as 400, though the file holds every
 * weight in between. One rule declaring the range (`400 700`) is what the
 * file is.
 */
export function mergeSharedFiles<T extends { url: string; weight: string; family: string; style: string; unicodeRange?: string }>(
  faces: readonly T[],
): T[] {
  const groups = new Map<string, T[]>()
  for (const face of faces) {
    const key = [face.family.toLowerCase(), face.style, face.url, face.unicodeRange ?? ''].join('|')
    const group = groups.get(key)
    if (group) group.push(face)
    else groups.set(key, [face])
  }
  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0]
    const bounds = group.flatMap((face) => face.weight.split(' ').map(Number))
    const low = Math.min(...bounds)
    const high = Math.max(...bounds)
    return { ...group[0], weight: low === high ? String(low) : `${low} ${high}` }
  })
}

/** The rules for a page's faces, every one `font-display: swap`. */
export function siteFontFaceCss(faces: readonly SiteFontFace[]): string {
  return faces
    .filter((face) => isSiteFontUrl(face.url))
    .map((face) =>
      [
        '@font-face{',
        `font-family:${cssFamily(face.family)};`,
        `font-style:${face.style};`,
        `font-weight:${/^\d{1,4}( \d{1,4})?$/.test(face.weight) ? face.weight : '400'};`,
        'font-display:swap;',
        `src:url(${face.url}) format('woff2');`,
        face.unicodeRange && /^[U+0-9A-Fa-f?,\s-]{1,4000}$/.test(face.unicodeRange)
          ? `unicode-range:${face.unicodeRange};`
          : '',
        '}',
      ].join(''),
    )
    .join('')
}

/**
 * Whether a URL is one a rule may name: site-relative, on the font route or
 * the media route, with nothing that could close the `url()` it is written
 * into. A face whose URL fails is dropped rather than escaped.
 */
export function isSiteFontUrl(url: string): boolean {
  return /^\/api\/(fonts|media\/cdn)\/[A-Za-z0-9_\-./:%]{1,600}(\?v=[A-Za-z0-9_.-]{1,128})?$/.test(url)
}

/** A local face a fallback is drawn from, measured the way a theme font is. */
interface LocalFallbackFace {
  /** `local()` names, in order. */
  local: string[]
  metrics: HostThemeFontMetrics
}

/**
 * The local faces fallbacks are drawn from, by category. Their metrics are
 * read from the faces themselves with the fonts plugin's reader and its
 * frequency-weighted average width (Arial 2048/1854/-434/67/901), so the ratio
 * to a web font measured the same way is what a line of text changes by.
 * Arial and Times New Roman ship with Windows and macOS; where neither is
 * installed the `local()` source fails and the stack moves on unadjusted.
 */
const LOCAL_FALLBACKS: Record<'sans-serif' | 'serif' | 'monospace', LocalFallbackFace> = {
  'sans-serif': {
    local: ['Arial', 'ArialMT'],
    metrics: { unitsPerEm: 2048, ascent: 1854, descent: -434, lineGap: 67, xWidthAvg: 901 },
  },
  serif: {
    local: ['Times New Roman', 'TimesNewRomanPSMT'],
    metrics: { unitsPerEm: 2048, ascent: 1825, descent: -443, lineGap: 87, xWidthAvg: 817 },
  },
  monospace: {
    local: ['Courier New', 'CourierNewPSMT'],
    metrics: { unitsPerEm: 2048, ascent: 1705, descent: -615, lineGap: 0, xWidthAvg: 1229 },
  },
}

function localFallbackFor(category: HostThemeFontCategory | undefined): LocalFallbackFace {
  if (category === 'serif') return LOCAL_FALLBACKS.serif
  if (category === 'monospace') return LOCAL_FALLBACKS.monospace
  return LOCAL_FALLBACKS['sans-serif']
}

function percent(value: number): string {
  return `${(Math.round(value * 10000) / 100).toString()}%`
}

/** Whether metrics are numbers a rule can be written from. */
function usableMetrics(metrics: HostThemeFontMetrics | undefined): metrics is HostThemeFontMetrics {
  return (
    !!metrics &&
    [metrics.unitsPerEm, metrics.ascent, metrics.descent, metrics.lineGap, metrics.xWidthAvg].every(
      (value) => typeof value === 'number' && Number.isFinite(value),
    ) &&
    metrics.unitsPerEm > 0 &&
    metrics.xWidthAvg > 0 &&
    metrics.ascent > 0
  )
}

/**
 * The `@font-face` rule for a family's metric-matched fallback: the local face
 * of its category, scaled so its average character is as wide as the web
 * font's (`size-adjust`) and given the web font's ascent, descent and line gap
 * at that scale. Text set in it occupies the box the web font will, so the
 * swap moves nothing — the CLS a `font-display: swap` page otherwise pays.
 *
 * The overrides are divided by the size adjustment because the browser
 * applies them to the ADJUSTED size: an ascent of 0.97em on a face scaled to
 * 1.07 has to be written as 0.97/1.07 to land at 0.97em.
 *
 * Empty for metrics that are missing or not numbers.
 */
export function metricFallbackFontFaceCss(
  family: string,
  metrics: HostThemeFontMetrics | undefined,
  category?: HostThemeFontCategory,
): string {
  if (!usableMetrics(metrics)) return ''
  const local = localFallbackFor(category)
  const sizeAdjust =
    metrics.xWidthAvg / metrics.unitsPerEm / (local.metrics.xWidthAvg / local.metrics.unitsPerEm)
  if (!Number.isFinite(sizeAdjust) || sizeAdjust <= 0) return ''
  const over = (value: number) => percent(Math.abs(value) / metrics.unitsPerEm / sizeAdjust)
  return [
    '@font-face{',
    `font-family:${cssFamily(metricFallbackFamily(family))};`,
    `src:${local.local.map((name) => `local(${cssFamily(name)})`).join(',')};`,
    `size-adjust:${percent(sizeAdjust)};`,
    `ascent-override:${over(metrics.ascent)};`,
    `descent-override:${over(metrics.descent)};`,
    `line-gap-override:${over(metrics.lineGap)};`,
    '}',
  ].join('')
}

/** What one family of a theme needs loaded: the weights, and which as italics. */
export interface ThemeFontNeed {
  family: string
  /** Upright weights the theme's text styles and named weights draw with. */
  weights: number[]
  /** The subset of `weights` text styles alone use, which a delivery choice is measured on. */
  textWeights: number[]
  italics: number[]
}

const NAMED_WEIGHTS: Record<string, number> = { normal: 400, bold: 700, lighter: 300, bolder: 700 }

function numericWeight(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value !== 'string') return undefined
  if (/^\d{3,4}$/.test(value.trim())) return Number(value.trim())
  return NAMED_WEIGHTS[value.trim().toLowerCase()]
}

/** MUI's four named weights, before a theme adds its own. */
const MUI_WEIGHT_TOKENS: Record<string, number> = {
  fontWeightLight: 300,
  fontWeightRegular: 400,
  fontWeightMedium: 500,
  fontWeightBold: 700,
}

/**
 * The faces each of a theme's web font families is drawn with (AGL-3656).
 *
 * A theme lists weights for its font (`fonts[].weights`), but the page draws
 * with whatever its text styles say: the platform's ramp sets `h1` in 900 and
 * `h2` in 800, so a theme that loaded Inter at 400, 500 and 700 drew its
 * headlines in a synthesized or substituted weight. The weights here are the
 * union of the listed ones, every text style's weight whose family resolves to
 * this one, and the theme's named weights (`fontWeightLight` … `Black`), which
 * the weight picker offers content.
 *
 * `baseTypography` is the typography the site's theme is layered onto
 * (`siteBaseOptions(...).typography`): a text style the theme leaves alone
 * keeps the base's weight and family.
 *
 * One italic is loaded per family, at the body text's weight, so emphasis in
 * running text is a real italic rather than a slanted upright; a theme can
 * list more under `italics`.
 */
export function themeFontNeeds(
  theme: Pick<HostTheme, 'fonts' | 'typography'> | undefined,
  baseTypography: Record<string, unknown> | undefined,
  extraFonts: readonly HostThemeFont[] = [],
): ThemeFontNeed[] {
  const fonts = [...(theme?.fonts ?? []), ...extraFonts].filter(
    (font) => font.family && (font.source ?? 'google') !== 'system',
  )
  if (!fonts.length) return []
  const base = baseTypography ?? {}
  const variants = (theme?.typography?.variants ?? {}) as Record<string, Record<string, unknown> | undefined>
  const baseStack =
    (typeof theme?.typography?.fontFamily === 'string' && theme.typography.fontFamily) ||
    (typeof base['fontFamily'] === 'string' ? (base['fontFamily'] as string) : '')
  const needs = new Map<string, { family: string; weights: Set<number>; text: Set<number>; italics: Set<number> }>()
  for (const font of fonts) {
    const key = font.family.trim().toLowerCase()
    const need = needs.get(key) ?? { family: font.family.trim(), weights: new Set(), text: new Set(), italics: new Set() }
    for (const weight of font.weights ?? []) if (numericWeight(weight)) need.weights.add(numericWeight(weight) as number)
    for (const weight of font.italics ?? []) if (numericWeight(weight)) need.italics.add(numericWeight(weight) as number)
    needs.set(key, need)
  }
  const needFor = (stack: unknown) => {
    const first = typeof stack === 'string' ? stackFamilies(stack)[0] : undefined
    return first ? needs.get(first.toLowerCase()) : undefined
  }

  const variantKeys = new Set<string>([
    ...Object.keys(variants),
    ...Object.keys(base).filter((key) => {
      const value = base[key]
      return !!value && typeof value === 'object' && !Array.isArray(value)
    }),
  ])
  for (const key of variantKeys) {
    const own = variants[key] ?? {}
    const inherited = (base[key] as Record<string, unknown> | undefined) ?? {}
    const need = needFor(own['fontFamily'] ?? inherited['fontFamily'] ?? baseStack)
    if (!need) continue
    const weight = numericWeight(own['fontWeight'] ?? inherited['fontWeight']) ?? 400
    need.weights.add(weight)
    need.text.add(weight)
  }

  const bodyNeed = needFor(baseStack)
  if (bodyNeed) {
    const tokens: Record<string, unknown> = { ...MUI_WEIGHT_TOKENS }
    for (const [key, value] of Object.entries(base)) if (/^fontWeight[A-Z]/.test(key)) tokens[key] = value
    for (const [key, value] of Object.entries(tokens)) {
      const weight = numericWeight(value)
      if (!weight) continue
      bodyNeed.weights.add(weight)
      if (key !== 'fontWeightLight' && MUI_WEIGHT_TOKENS[key]) bodyNeed.text.add(weight)
    }
    const body = variants['body1'] ?? {}
    const bodyWeight =
      numericWeight(body['fontWeight'] ?? (base['body1'] as Record<string, unknown> | undefined)?.['fontWeight']) ?? 400
    bodyNeed.italics.add(bodyWeight)
  }

  return [...needs.values()].map((need) => ({
    family: need.family,
    weights: [...need.weights].sort((a, b) => a - b),
    textWeights: [...need.text].sort((a, b) => a - b),
    italics: [...need.italics].sort((a, b) => a - b),
  }))
}

/**
 * The weights to load from what a family offers: each wanted weight as the
 * nearest one offered, without repeats. Unknown availability keeps the
 * wanted weights as they are.
 */
export function offeredWeights(wanted: readonly number[], offered: readonly number[] | undefined): number[] {
  if (!offered?.length) return [...new Set(wanted)].sort((a, b) => a - b)
  const picked = wanted.map((weight) =>
    offered.reduce((best, candidate) =>
      Math.abs(candidate - weight) < Math.abs(best - weight) ? candidate : best,
    ),
  )
  return [...new Set(picked)].sort((a, b) => a - b)
}

/**
 * Google's CSS2 URL for some faces of one family: `ital,wght` tuples, sorted
 * as the API requires. One weight asks for a static instance, which for a
 * variable family is a file holding that weight alone — Inter's Latin 400 is
 * 24 KB that way and 48 KB as the variable file.
 */
export function googleFontSheetUrl(
  family: string,
  faces: ReadonlyArray<{ weight: number; style: 'normal' | 'italic' }>,
): string | undefined {
  const name = family.trim()
  if (!name || !/^[A-Za-z0-9 ]{1,80}$/.test(name) || !faces.length) return undefined
  const tuples = [...new Set(faces.map((face) => `${face.style === 'italic' ? 1 : 0},${face.weight}`))].sort(
    (a, b) => {
      const [ai, aw] = a.split(',').map(Number)
      const [bi, bw] = b.split(',').map(Number)
      return ai - bi || aw - bw
    },
  )
  const axis = tuples.some((tuple) => tuple.startsWith('1,'))
    ? `ital,wght@${tuples.join(';')}`
    : `wght@${tuples.map((tuple) => tuple.slice(2)).join(';')}`
  return `https://fonts.googleapis.com/css2?family=${name.replace(/ /g, '+')}:${axis}&display=swap`
}

/**
 * The files the first screen paints with, to preload: the body text's face
 * and the headline's, Latin and upright, from whatever faces the page
 * declares. A file covering both is preloaded once.
 */
export function siteFontPreloads(
  theme: Pick<HostTheme, 'fonts' | 'typography'> | undefined,
  faces: readonly SiteFontFace[],
  baseTypography?: Record<string, unknown>,
): string[] {
  const typography = theme?.typography
  const variants = typography?.variants
  const base = baseTypography ?? {}
  const baseH1 = (base['h1'] as Record<string, unknown> | undefined) ?? {}
  const baseBody = (base['body1'] as Record<string, unknown> | undefined) ?? {}
  const fallback = theme?.fonts?.find((font) => (font.source ?? 'google') !== 'system')?.family
  const bodyFamily =
    firstFamily(typography?.fontFamily) ?? firstFamily(base['fontFamily']) ?? fallback
  const pick = (family: string | undefined, weight: number) => {
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
  const body = pick(bodyFamily, numericWeight(variants?.body1?.fontWeight ?? baseBody['fontWeight']) ?? 400)
  const heading = pick(
    firstFamily(variants?.h1?.fontFamily) ?? firstFamily(baseH1['fontFamily']) ?? bodyFamily,
    numericWeight(variants?.h1?.fontWeight ?? baseH1['fontWeight']) ?? 700,
  )
  return [...new Set([body, heading].filter((face): face is SiteFontFace => !!face).map((face) => face.url))]
}
