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
 * Roboto Flex, the brand face, served from the app's own origin (AGL-3655).
 *
 * The brand stack names `"Roboto Flex"` first, and for a long time nothing
 * declared it: only a machine with the family installed saw it. These are
 * the `@font-face` rules that make the name resolve everywhere, built from
 * one description so the rules, the preload and the files cannot disagree.
 *
 * The files are cut from the official OFL variable TTF (google/fonts
 * `ofl/robotoflex`, v3.200), the same file the native apps bundle:
 *
 *  - Only the `wght` axis is kept, at its full 100–1000 range, because the
 *    weight ramp is the only axis anything here asks for. `opsz`, `wdth`,
 *    `slnt` and `GRAD` are pinned at their defaults (14 / 100 / 0 / 0) and
 *    the parametric axes dropped. Keeping `opsz` as well cost 2.5× the
 *    bytes (84 KB against 33 KB for Latin) for automatic optical sizing on
 *    headings.
 *  - Split by `unicode-range` on Google's own subset boundaries, so a page
 *    in English downloads only the Latin file, and only the Latin file is
 *    preloaded.
 *
 * To recut them from the TTF (fontTools: `pip install fonttools brotli`):
 *
 * ```sh
 * python3 -m fontTools.varLib.instancer RobotoFlex[…].ttf \
 *   opsz=14 GRAD=0 wdth=100 slnt=0 XOPQ=drop YOPQ=drop XTRA=drop \
 *   YTUC=drop YTLC=drop YTAS=drop YTDE=drop YTFI=drop -o wght.ttf
 * python3 -m fontTools.subset wght.ttf --unicodes="<range>" \
 *   --flavor=woff2 --layout-features='*' --no-hinting --desubroutinize \
 *   --output-file=roboto-flex-v3200-<subset>.woff2
 * ```
 *
 * Pure: no React, no DOM. A published site that wants the face (AGL-3656)
 * builds the same rules against its own base URL.
 *
 * Deep-import only (`@aglyn/shared-ui-theme/util/roboto-flex`), and kept out
 * of the barrel: a published page has no use for these rules, and the
 * barrel is in its module graph.
 */

import { FontFamily, ROBOTO_FLEX_FALLBACK } from '../constants'

/** The family the brand stack names. Quoted, as it appears in the stack. */
export const ROBOTO_FLEX_FAMILY: string = FontFamily.ROBOTO_FLEX

/**
 * A metric-matched local face that stands in while Roboto Flex loads.
 *
 * Arial, scaled and re-spaced so a line set in it occupies the space the
 * same line takes in Roboto Flex: when the web font swaps in, nothing
 * reflows. It must sit DIRECTLY after {@link ROBOTO_FLEX_FAMILY} in a stack
 * to do that, ahead of the system faces.
 */
export const ROBOTO_FLEX_FALLBACK_FAMILY = ROBOTO_FLEX_FALLBACK

/** Where the files are served from on the console's origin. */
export const ROBOTO_FLEX_BASE_PATH = '/_static/fonts/roboto-flex'

export interface RobotoFlexFace {
  subset: 'latin' | 'latin-ext'
  file: string
  unicodeRange: string
  /** The one face a page preloads. */
  preload: boolean
}

/** The cut files, one per `unicode-range` subset. */
export const ROBOTO_FLEX_FACES: readonly RobotoFlexFace[] = [
  {
    subset: 'latin-ext',
    file: 'roboto-flex-v3200-latin-ext.woff2',
    unicodeRange:
      'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, ' +
      'U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, ' +
      'U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
    preload: false,
  },
  {
    subset: 'latin',
    file: 'roboto-flex-v3200-latin.woff2',
    unicodeRange:
      'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, ' +
      'U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, ' +
      'U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    preload: true,
  },
]

/**
 * The fallback's overrides, measured rather than guessed.
 *
 * `size-adjust` is the ratio of the two faces' mean advance width over an
 * English sample (Roboto Flex wght 400: 0.4384 em, Arial: 0.4418 em). The
 * vertical overrides are Roboto Flex's own `hhea` metrics (ascender 1900,
 * descender −500, line gap 0, on 2048 units) divided by that ratio, since
 * `size-adjust` scales them too.
 */
export const ROBOTO_FLEX_FALLBACK_METRICS = {
  local: 'Arial',
  sizeAdjust: '99.23%',
  ascentOverride: '93.49%',
  descentOverride: '24.60%',
  lineGapOverride: '0%',
} as const

/** The URL a face's file is served from below `basePath`. */
export function robotoFlexFontUrl(
  face: Pick<RobotoFlexFace, 'file'>,
  basePath: string = ROBOTO_FLEX_BASE_PATH,
): string {
  return `${basePath.replace(/\/+$/, '')}/${face.file}`
}

/** The URLs a page should preload: the Latin file and nothing else. */
export function robotoFlexPreloadUrls(
  basePath: string = ROBOTO_FLEX_BASE_PATH,
): string[] {
  return ROBOTO_FLEX_FACES.filter((face) => face.preload).map((face) =>
    robotoFlexFontUrl(face, basePath),
  )
}

/**
 * The `@font-face` rules: one per subset, plus the metric-matched fallback.
 *
 * `font-display: swap` so text paints at once in the fallback, which the
 * overrides make the same size, and the brand face replaces it in place.
 */
export function robotoFlexFontFaceCss(
  basePath: string = ROBOTO_FLEX_BASE_PATH,
): string {
  const faces = ROBOTO_FLEX_FACES.map(
    (face) =>
      `@font-face{font-family:${ROBOTO_FLEX_FAMILY};font-style:normal;` +
      `font-weight:100 1000;font-display:swap;` +
      `src:url(${robotoFlexFontUrl(face, basePath)}) format('woff2');` +
      `unicode-range:${face.unicodeRange}}`,
  )
  const m = ROBOTO_FLEX_FALLBACK_METRICS
  const fallback =
    `@font-face{font-family:${ROBOTO_FLEX_FALLBACK_FAMILY};` +
    `src:local('${m.local}');size-adjust:${m.sizeAdjust};` +
    `ascent-override:${m.ascentOverride};descent-override:${m.descentOverride};` +
    `line-gap-override:${m.lineGapOverride}}`
  return [...faces, fallback].join('\n')
}
