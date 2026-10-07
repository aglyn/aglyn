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

// The two converters ship no declarations; an ambient file declares them, and
// it has to be named from here so every project compiling this file sees it.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./font-vendor.d.ts" />

import type { HostThemeFontCategory } from '@aglyn/shared-data-types'
import { createHash } from 'crypto'
import { fontContainer, FontFileError, readFontFile, type FontFileFacts } from '../font-file/read-font-file'
import {
  FONT_STORED_MAX_BYTES,
  FONT_UPLOAD_MAX_BYTES,
  type PreparedFontFace,
} from './constants'
import { describeFontLicense } from './license'
import { describeScripts, planFontSubset } from './unicode-ranges'

/**
 * SERVER: one uploaded font file, checked and made ready for the web
 * (AGL-3656).
 *
 * 1. Size, container and collection checks, before anything is decoded.
 * 2. WOFF and WOFF2 are unwrapped to the font inside them, because the
 *    license bits and metrics are read from the SFNT tables.
 * 3. The embedding license (OS/2 `fsType`) decides: restricted and
 *    bitmap-only are refused; preview-and-print is allowed with a warning.
 * 4. The face is converted to WOFF2 and subset to the scripts it covers
 *    (`planFontSubset`), unless its license forbids subsetting, in which case
 *    it is converted only.
 *
 * A VARIABLE font keeps its axes. One file then draws every weight the theme
 * and the page content ask for, now and after the theme changes, where
 * pinning it to today's weights would need a reinstall whenever a text style
 * moved to a weight the pinned file lacks, and would synthesize that weight
 * until then. The face records the weight axis's range, which the published
 * page declares as the face's `font-weight` range.
 *
 * Nothing is stored here: the WOFF2 goes back to the console, which puts it
 * in the site's media library through the library's own upload or replace
 * route, so the quota, the metadata mirror, the counters and quarantine are
 * the library's and there is one copy of the file.
 */

/** A refusal, with the status the route answers it with. */
export class FontPrepareError extends Error {
  readonly status: number
  readonly code: string
  constructor(message: string, status: number, code: string) {
    super(message)
    this.name = 'FontPrepareError'
    this.status = status
    this.code = code
  }
}

/** A guess at a family's generic category from its name; the person can change it. */
export function guessFontCategory(name: string): HostThemeFontCategory {
  if (/mono|code|courier|console|typewriter/i.test(name)) return 'monospace'
  if (/script|hand|brush|marker|signature|calligraph/i.test(name)) return 'handwriting'
  if (/sans/i.test(name)) return 'sans-serif'
  if (/serif|slab|roman|garamond|baskerville|bodoni|caslon|times|georgia|didot|playfair|merriweather/i.test(name)) {
    return 'serif'
  }
  if (/display|poster|headline|blackletter|decorative/i.test(name)) return 'display'
  return 'sans-serif'
}

/** The media library's content hash: the first 16 hex characters of SHA-256. */
export function mediaContentHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16)
}

/** A file name a library can show and a URL never carries: `Inter-700-italic.woff2`. */
export function storedFontFileName(face: Pick<PreparedFontFace, 'family' | 'weight' | 'weightMax' | 'style'>): string {
  const family = face.family.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'font'
  const weight = face.weightMax && face.weightMax > face.weight ? `${face.weight}-${face.weightMax}` : String(face.weight)
  return `${family}-${weight}${face.style === 'italic' ? '-italic' : ''}.woff2`
}

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`

export interface PrepareFontResult {
  face: PreparedFontFace
  woff2: Uint8Array
}

/**
 * Checks, unwraps, converts and subsets one font file. Throws
 * {@link FontPrepareError} with the sentence a person reads.
 */
export async function prepareFontFile(input: Uint8Array): Promise<PrepareFontResult> {
  if (!input.length) throw new FontPrepareError('The file is empty.', 400, 'empty')
  if (input.length > FONT_UPLOAD_MAX_BYTES) {
    throw new FontPrepareError(
      `The file is ${kb(input.length)}; a font file can be up to ${kb(FONT_UPLOAD_MAX_BYTES)}.`,
      413,
      'too-large',
    )
  }
  const container = fontContainer(input)
  if (container === 'collection') {
    throw new FontPrepareError(
      'This is a font collection (.ttc), which holds several fonts. Export the one you want as a .ttf or .otf and upload that.',
      415,
      'collection',
    )
  }
  if (container === 'unknown') {
    throw new FontPrepareError('This file is not a font. Upload a .woff2, .woff, .ttf or .otf file.', 415, 'not-a-font')
  }

  const fontverter = await import('fontverter')
  let sfnt: Buffer
  try {
    sfnt =
      container === 'woff' || container === 'woff2'
        ? await fontverter.convert(Buffer.from(input), 'truetype')
        : Buffer.from(input)
  } catch {
    throw new FontPrepareError(`This ${container.toUpperCase()} file could not be opened. It may be damaged.`, 422, 'unreadable')
  }

  let facts: FontFileFacts
  try {
    facts = readFontFile(sfnt)
  } catch (error) {
    if (error instanceof FontFileError) {
      const status = error.code === 'collection' || error.code === 'not-a-font' ? 415 : 422
      throw new FontPrepareError(
        error.code === 'truncated' || error.code === 'missing-table'
          ? 'This font file is damaged or incomplete, so it cannot be read.'
          : error.message,
        status,
        error.code,
      )
    }
    throw error
  }

  const { embedding } = facts
  if (!embedding.allowed) {
    throw new FontPrepareError(describeFontLicense(embedding.embedding).detail, 422, `license-${embedding.embedding}`)
  }

  const warnings: string[] = []
  if (embedding.embedding === 'preview-print') warnings.push(describeFontLicense('preview-print').detail)

  const plan = embedding.noSubsetting ? null : planFontSubset(facts.hasCodePoint)
  let woff2: Buffer
  try {
    if (plan && plan.scripts.length) {
      const { default: subsetFont } = (await import('subset-font')) as unknown as {
        default: typeof import('subset-font')
      }
      woff2 = await subsetFont(sfnt, plan.text, { targetFormat: 'woff2' })
    } else {
      woff2 = await fontverter.convert(sfnt, 'woff2')
    }
  } catch {
    throw new FontPrepareError('This font could not be converted for the web. It may be damaged.', 422, 'convert-failed')
  }
  if (embedding.noSubsetting) {
    warnings.push("The font's license asks for it to be embedded whole, so it was converted but not trimmed to your scripts.")
  } else if (plan && !plan.scripts.length) {
    warnings.push(
      'The font covers none of Latin, Cyrillic, Greek or Vietnamese, so it was converted whole rather than trimmed.',
    )
  }
  if (woff2.length > FONT_STORED_MAX_BYTES) {
    throw new FontPrepareError(
      `Even converted for the web this font is ${kb(woff2.length)}, more than the ${kb(FONT_STORED_MAX_BYTES)} a site font can be.`,
      413,
      'too-large-converted',
    )
  }

  const wght = facts.axes.find((axis) => axis.tag === 'wght')
  const weight = wght ? Math.max(1, Math.round(wght.min)) : facts.weight
  const weightMax = wght && Math.round(wght.max) > weight ? Math.min(1000, Math.round(wght.max)) : undefined
  const bytes = new Uint8Array(woff2.buffer, woff2.byteOffset, woff2.byteLength)
  const face: PreparedFontFace = {
    family: facts.family.trim(),
    subfamily: facts.subfamily,
    ...(facts.fullName ? { fullName: facts.fullName } : {}),
    weight,
    ...(weightMax ? { weightMax } : {}),
    style: facts.style,
    category: guessFontCategory(`${facts.family} ${facts.fullName ?? ''}`),
    metrics: facts.metrics,
    axes: facts.axes,
    license: {
      embedding: embedding.embedding,
      fsType: embedding.fsType,
      noSubsetting: embedding.noSubsetting,
    },
    scripts: plan?.scripts ?? [],
    ...(plan && plan.scripts.length ? { unicodeRange: plan.unicodeRange } : {}),
    bytesIn: input.length,
    bytesOut: bytes.length,
    sourceFormat: container,
    contentHash: mediaContentHash(bytes),
    fileName: '',
    warnings,
  }
  face.fileName = storedFontFileName(face)
  return { face, woff2: bytes }
}

/** One line for a log or a test: what was kept. */
export function describePreparedFace(face: PreparedFontFace): string {
  return `${face.family} ${face.subfamily}: ${describeScripts(face.scripts as never) || 'whole font'}, ${kb(face.bytesIn)} → ${kb(face.bytesOut)}`
}
