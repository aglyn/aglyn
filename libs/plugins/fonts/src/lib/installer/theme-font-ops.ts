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

import type { HostTheme, HostThemeFontCategory } from '@aglyn/shared-data-types'
import { parseMediaRef } from '@aglyn/aglyn/app-utils/media-ref'
import type { PreparedFontFace } from './constants'
import {
  customFontFamilies,
  faceWeightLabel,
  fontFaceSrc,
  fontRolesOf,
  installCustomFontFace,
  planFontUpload,
  removeCustomFontFace,
  removeCustomFontFamily,
  setCustomFontCategory,
  setCustomFontRole,
  type FontRole,
  type FontUploadPlan,
} from './theme-fonts'

/**
 * What the fonts door `POST /api/fonts/theme` (AGL-3668) does for an app that
 * never holds a theme draft. The console's installer edits the theme in the
 * browser (`theme-fonts.ts`); an app sends one named operation and the server
 * runs the same pure functions against the site's resolved theme, so a font is
 * installed, role'd and removed the same way from every client.
 */

export const FONT_CATEGORIES: readonly HostThemeFontCategory[] = [
  'sans-serif',
  'serif',
  'monospace',
  'display',
  'handwriting',
]

/** The facts of a prepared face a theme records (the rest of `PreparedFontFace` is for the person installing it). */
export type InstallableFace = Pick<
  PreparedFontFace,
  'family' | 'weight' | 'weightMax' | 'style' | 'category' | 'metrics' | 'unicodeRange'
>

type FaceSlot = Pick<PreparedFontFace, 'weight' | 'weightMax' | 'style'>

export type FontOp =
  | { op: 'list' }
  | { op: 'plan'; face: InstallableFace }
  | { op: 'install'; face: InstallableFace; mediaId: string; version: string }
  | { op: 'remove-face'; family: string; face: FaceSlot }
  | { op: 'remove-family'; family: string }
  | { op: 'role'; family: string; role: FontRole }
  | { op: 'category'; family: string; category: HostThemeFontCategory }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max ? value : undefined

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const FAMILY_MAX = 128
const MEDIA_ID = /^[A-Za-z0-9_-]{1,128}$/
const VERSION = /^[A-Za-z0-9_-]{1,64}$/

function readSlot(raw: unknown): FaceSlot | undefined {
  if (!isRecord(raw)) return undefined
  const weight = finite(raw['weight'])
  const weightMax = raw['weightMax'] === undefined ? undefined : finite(raw['weightMax'])
  const style = raw['style']
  if (weight === undefined || weight < 1 || weight > 1000) return undefined
  if (raw['weightMax'] !== undefined && (weightMax === undefined || weightMax < weight || weightMax > 1000)) return undefined
  if (style !== 'normal' && style !== 'italic') return undefined
  return { weight, ...(weightMax !== undefined ? { weightMax } : {}), style }
}

function readFace(raw: unknown): InstallableFace | undefined {
  if (!isRecord(raw)) return undefined
  const slot = readSlot(raw)
  const family = text(raw['family'], FAMILY_MAX)
  const category = FONT_CATEGORIES.find((entry) => entry === raw['category'])
  const metrics = raw['metrics']
  if (!slot || !family || !category || !isRecord(metrics)) return undefined
  const unitsPerEm = finite(metrics['unitsPerEm'])
  const ascent = finite(metrics['ascent'])
  const descent = finite(metrics['descent'])
  const lineGap = finite(metrics['lineGap'])
  const xWidthAvg = finite(metrics['xWidthAvg'])
  if (
    unitsPerEm === undefined ||
    unitsPerEm <= 0 ||
    ascent === undefined ||
    descent === undefined ||
    lineGap === undefined ||
    xWidthAvg === undefined
  ) {
    return undefined
  }
  const unicodeRange = raw['unicodeRange'] === undefined ? undefined : text(raw['unicodeRange'], 4000)
  if (raw['unicodeRange'] !== undefined && unicodeRange === undefined) return undefined
  return {
    ...slot,
    family,
    category,
    metrics: { unitsPerEm, ascent, descent, lineGap, xWidthAvg },
    ...(unicodeRange ? { unicodeRange } : {}),
  }
}

/** The request body as an operation, or the words that say what is wrong with it. */
export function readFontOp(body: unknown): FontOp | string {
  if (!isRecord(body)) return 'Send a JSON body.'
  const family = () => text(body['family'], FAMILY_MAX)
  switch (body['op']) {
    case 'list':
      return { op: 'list' }
    case 'plan': {
      const face = readFace(body['face'])
      return face ? { op: 'plan', face } : 'That font file’s facts could not be read.'
    }
    case 'install': {
      const face = readFace(body['face'])
      const mediaId = typeof body['mediaId'] === 'string' && MEDIA_ID.test(body['mediaId']) ? body['mediaId'] : undefined
      const version = typeof body['version'] === 'string' && VERSION.test(body['version']) ? body['version'] : undefined
      if (!face) return 'That font file’s facts could not be read.'
      if (!mediaId) return 'Name the media library file the font was stored in.'
      if (!version) return 'The stored font has no version.'
      return { op: 'install', face, mediaId, version }
    }
    case 'remove-face': {
      const slot = readSlot(body['face'])
      const name = family()
      return name && slot ? { op: 'remove-face', family: name, face: slot } : 'Name the font and the face to remove.'
    }
    case 'remove-family': {
      const name = family()
      return name ? { op: 'remove-family', family: name } : 'Name the font to remove.'
    }
    case 'role': {
      const name = family()
      const role = body['role'] === 'body' || body['role'] === 'headings' ? body['role'] : undefined
      return name && role ? { op: 'role', family: name, role } : 'Name the font and say body or headings.'
    }
    case 'category': {
      const name = family()
      const category = FONT_CATEGORIES.find((entry) => entry === body['category'])
      return name && category ? { op: 'category', family: name, category } : 'Name the font and its category.'
    }
    default:
      return 'Unknown font operation.'
  }
}

/** The theme after an operation that changes it; the others answer it as it is. */
export function applyFontOp(theme: HostTheme, op: FontOp, hostId: string): HostTheme {
  switch (op.op) {
    case 'install': {
      const src = fontFaceSrc(hostId, op.mediaId)
      if (!src) return theme
      return installCustomFontFace(theme, op.face, { src, version: op.version })
    }
    case 'remove-face':
      return removeCustomFontFace(theme, op.family, op.face)
    case 'remove-family':
      return removeCustomFontFamily(theme, op.family)
    case 'role':
      return setCustomFontRole(theme, op.family, op.role)
    case 'category':
      return setCustomFontCategory(theme, op.family, op.category)
    default:
      return theme
  }
}

/** Whether an operation writes the theme. */
export const fontOpWrites = (op: FontOp): boolean => op.op !== 'list' && op.op !== 'plan'

/** Where a prepared face goes in the site's media library (`planFontUpload`). */
export function planOf(theme: HostTheme | undefined, op: Extract<FontOp, { op: 'plan' }>, hostId: string): FontUploadPlan {
  return planFontUpload(theme, op.face, hostId)
}

/** One installed family, as the app lists it. */
export interface InstalledFontSummary {
  family: string
  category?: HostThemeFontCategory
  roles: FontRole[]
  faces: Array<{ weight: number; weightMax?: number; style: 'normal' | 'italic'; label: string; mediaId?: string }>
}

export function listInstalledFonts(theme: HostTheme | undefined, hostId: string): InstalledFontSummary[] {
  return customFontFamilies(theme).map((font) => ({
    family: font.family,
    ...(font.category ? { category: font.category } : {}),
    roles: fontRolesOf(theme, font.family),
    faces: (font.faces ?? []).map((face) => {
      const ref = parseMediaRef(face.src)
      return {
        weight: face.weight,
        ...(face.weightMax ? { weightMax: face.weightMax } : {}),
        style: face.style,
        label: faceWeightLabel(face) + (face.style === 'italic' ? ' italic' : ''),
        ...(ref && ref.scope === hostId ? { mediaId: ref.mediaId } : {}),
      }
    }),
  }))
}
