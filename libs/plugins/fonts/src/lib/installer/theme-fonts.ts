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
  HostThemeFontFace,
  HostThemeTypographyVariantKey,
} from '@aglyn/shared-data-types'
import { formatMediaRef, parseMediaRef } from '@aglyn/aglyn/app-utils/media-ref'
import type { PreparedFontFace } from './constants'

/**
 * How an installed font lives in a theme (AGL-3656): one `fonts[]` entry per
 * family with `source: 'custom'`, the metrics its fallback is sized to, and
 * one face per uploaded file, each a media reference into the site's own
 * library with the file's content hash as its version.
 *
 * Pure functions of the theme, so the installer's card, its tests and anything
 * else that edits a theme write a family the same way.
 */

const sameFamily = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The theme's uploaded families. */
export function customFontFamilies(theme: HostTheme | undefined): HostThemeFont[] {
  return (theme?.fonts ?? []).filter((font) => font.source === 'custom' && font.family)
}

/** Whether a face is a variable file covering a weight range. */
export function isVariableFace(face: Pick<HostThemeFontFace, 'weight' | 'weightMax'>): boolean {
  return typeof face.weightMax === 'number' && face.weightMax > face.weight
}

/**
 * Whether two faces are the same slot of a family: the same style, and the
 * same weight, or both variable (one variable file per style draws every
 * weight, so a second one replaces the first).
 */
export function isSameFaceSlot(
  a: Pick<HostThemeFontFace, 'weight' | 'weightMax' | 'style'>,
  b: Pick<HostThemeFontFace, 'weight' | 'weightMax' | 'style'>,
): boolean {
  if (a.style !== b.style) return false
  if (isVariableFace(a) || isVariableFace(b)) return isVariableFace(a) && isVariableFace(b)
  return Math.round(a.weight) === Math.round(b.weight)
}

/** The face a theme already holds for this family, weight and style. */
export function findCustomFace(
  theme: HostTheme | undefined,
  face: Pick<PreparedFontFace, 'family' | 'weight' | 'weightMax' | 'style'>,
): HostThemeFontFace | undefined {
  const font = customFontFamilies(theme).find((entry) => sameFamily(entry.family, face.family))
  return font?.faces?.find((existing) => isSameFaceSlot(existing, face))
}

/**
 * Where a prepared face goes in the media library: REPLACE the file a face
 * for the same family, weight and style already points at, so the library
 * keeps one copy and every reference to it serves the new bytes, or UPLOAD a
 * new file when there is none.
 */
export type FontUploadPlan = { mode: 'replace'; mediaId: string; scope: string } | { mode: 'upload' }

export function planFontUpload(
  theme: HostTheme | undefined,
  face: Pick<PreparedFontFace, 'family' | 'weight' | 'weightMax' | 'style'>,
  hostId: string,
): FontUploadPlan {
  const existing = findCustomFace(theme, face)
  const ref = existing ? parseMediaRef(existing.src) : null
  // Only a file in THIS site's library is replaced; a reference into another
  // library (a theme copied from elsewhere) gets a file of its own.
  if (ref && ref.scope === hostId) return { mode: 'replace', mediaId: ref.mediaId, scope: ref.scope }
  return { mode: 'upload' }
}

/** The media reference a stored face is written with. */
export function fontFaceSrc(hostId: string, mediaId: string): string | undefined {
  return formatMediaRef(hostId, mediaId)
}

/**
 * The theme with a stored face installed: the family added, or the face
 * merged into it (replacing the face in the same slot), and the family's
 * metrics and category taken from the newest file.
 */
export function installCustomFontFace(
  theme: HostTheme,
  face: PreparedFontFace,
  stored: { src: string; version: string },
  options: { category?: HostThemeFontCategory } = {},
): HostTheme {
  const fonts = [...(theme.fonts ?? [])]
  const index = fonts.findIndex((entry) => entry.source === 'custom' && sameFamily(entry.family, face.family))
  const nextFace: HostThemeFontFace = {
    weight: face.weight,
    ...(face.weightMax && face.weightMax > face.weight ? { weightMax: face.weightMax } : {}),
    style: face.style,
    src: stored.src,
    version: stored.version,
    ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {}),
  }
  const current = index >= 0 ? fonts[index] : undefined
  const faces = [...(current?.faces ?? []).filter((existing) => !isSameFaceSlot(existing, nextFace)), nextFace].sort(
    (a, b) => a.weight - b.weight || (a.style === b.style ? 0 : a.style === 'normal' ? -1 : 1),
  )
  const font: HostThemeFont = {
    ...(current ?? {}),
    family: current?.family ?? face.family,
    source: 'custom',
    category: options.category ?? current?.category ?? face.category,
    metrics: face.metrics,
    faces,
  }
  if (index >= 0) fonts[index] = font
  else fonts.push(font)
  return { ...theme, fonts }
}

/** The theme with one face of an installed family removed; the family goes with its last face. */
export function removeCustomFontFace(
  theme: HostTheme,
  family: string,
  face: Pick<HostThemeFontFace, 'weight' | 'weightMax' | 'style'>,
): HostTheme {
  const fonts = theme.fonts ?? []
  const font = fonts.find((entry) => entry.source === 'custom' && sameFamily(entry.family, family))
  if (!font) return theme
  const faces = (font.faces ?? []).filter((existing) => !isSameFaceSlot(existing, face))
  if (!faces.length) return removeCustomFontFamily(theme, family)
  return { ...theme, fonts: fonts.map((entry) => (entry === font ? { ...entry, faces } : entry)) }
}

/**
 * The theme with an installed family removed, and every text style that drew
 * with it put back on what it inherits. The files stay in the media library.
 */
export function removeCustomFontFamily(theme: HostTheme, family: string): HostTheme {
  const fonts = (theme.fonts ?? []).filter((entry) => !(entry.source === 'custom' && sameFamily(entry.family, family)))
  const next: HostTheme = { ...theme }
  if (fonts.length) next.fonts = fonts
  else delete next.fonts
  return clearFontRoles(next, family)
}

/** The CSS stack an installed family is named by: `"Inter", sans-serif`. */
export function customFontStack(family: string, category: HostThemeFontCategory | undefined): string {
  const generic = category === 'monospace' ? 'monospace' : category === 'serif' ? 'serif' : 'sans-serif'
  return `"${family.replace(/["\\]/g, '')}", ${generic}`
}

/** The text styles a heading font draws. */
export const HEADING_VARIANTS: readonly HostThemeTypographyVariantKey[] = [
  'displayXl',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
]

export type FontRole = 'body' | 'headings'

const firstFamily = (stack: unknown) =>
  typeof stack === 'string' ? stack.split(',')[0]?.trim().replace(/^["']|["']$/g, '') : undefined

/** The roles an installed family plays in a theme. */
export function fontRolesOf(theme: HostTheme | undefined, family: string): FontRole[] {
  const roles: FontRole[] = []
  const body = firstFamily(theme?.typography?.fontFamily)
  if (body && sameFamily(body, family)) roles.push('body')
  const variants = theme?.typography?.variants ?? {}
  if (HEADING_VARIANTS.some((key) => {
    const own = firstFamily(variants[key]?.fontFamily)
    return own ? sameFamily(own, family) : false
  })) {
    roles.push('headings')
  }
  return roles
}

/**
 * The theme with an installed family set as its body font (the stack every
 * text style inherits) or its headings font (`displayXl` and `h1`–`h6`).
 */
export function setCustomFontRole(theme: HostTheme, family: string, role: FontRole): HostTheme {
  const font = customFontFamilies(theme).find((entry) => sameFamily(entry.family, family))
  if (!font) return theme
  const stack = customFontStack(font.family, font.category)
  if (role === 'body') return { ...theme, typography: { ...theme.typography, fontFamily: stack } }
  const variants = { ...(theme.typography?.variants ?? {}) }
  for (const key of HEADING_VARIANTS) variants[key] = { ...variants[key], fontFamily: stack }
  return { ...theme, typography: { ...theme.typography, variants } }
}

/** The theme with no text style naming `family` first; each goes back to what it inherits. */
export function clearFontRoles(theme: HostTheme, family: string): HostTheme {
  const typography = theme.typography
  if (!typography) return theme
  const nextTypography = { ...typography }
  const body = firstFamily(typography.fontFamily)
  if (body && sameFamily(body, family)) delete nextTypography.fontFamily
  if (typography.variants) {
    const variants: NonNullable<typeof typography.variants> = {}
    for (const [key, variant] of Object.entries(typography.variants) as Array<
      [HostThemeTypographyVariantKey, NonNullable<typeof typography.variants>[HostThemeTypographyVariantKey]]
    >) {
      const own = firstFamily(variant?.fontFamily)
      if (variant && own && sameFamily(own, family)) {
        const rest = { ...variant }
        delete rest.fontFamily
        if (Object.keys(rest).length) variants[key] = rest
      } else if (variant) {
        variants[key] = variant
      }
    }
    if (Object.keys(variants).length) nextTypography.variants = variants
    else delete nextTypography.variants
  }
  const next: HostTheme = { ...theme }
  if (Object.keys(nextTypography).length) next.typography = nextTypography
  else delete next.typography
  return next
}

/** The weight a face is shown under: "400", or "100–900" for a variable file. */
export function faceWeightLabel(face: Pick<HostThemeFontFace, 'weight' | 'weightMax'>): string {
  return isVariableFace(face) ? `${face.weight}–${face.weightMax}` : String(face.weight)
}

/**
 * The theme with an installed family's category changed: the local face its
 * fallback is drawn from, and the generic keyword its stacks end on.
 */
export function setCustomFontCategory(theme: HostTheme, family: string, category: HostThemeFontCategory): HostTheme {
  const fonts = theme.fonts ?? []
  const font = fonts.find((entry) => entry.source === 'custom' && sameFamily(entry.family, family))
  if (!font) return theme
  let next: HostTheme = { ...theme, fonts: fonts.map((entry) => (entry === font ? { ...entry, category } : entry)) }
  for (const role of fontRolesOf(theme, family)) next = setCustomFontRole(next, family, role)
  return next
}
