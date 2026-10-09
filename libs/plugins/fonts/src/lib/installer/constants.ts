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

import type { HostThemeFontCategory } from '@aglyn/shared-data-types'
import type { FontEmbedding } from '../font-file/read-font-file'

/**
 * What the font installer and its route agree on (AGL-3656). Client-safe:
 * nothing here reads a file or loads a dependency.
 */

/** The console route that checks, converts and subsets one font file. */
export const FONTS_PREPARE_ROUTE = 'fonts/prepare'

/** The console route that installs, lists and removes a site's own fonts for an app (AGL-3668). */
export const FONTS_THEME_ROUTE = 'fonts/theme'

/**
 * The largest font file the route takes. The bytes travel as the request
 * body, and the platform refuses a body over 4.5 MB before any handler runs,
 * so the ceiling sits under it with room for the headers.
 */
export const FONT_UPLOAD_MAX_BYTES = 4 * 1024 * 1024

/**
 * The largest WOFF2 the installer stores. The file goes into the media
 * library through its direct upload route, which carries it as base64 inside
 * a JSON body under the same platform cap; 3 MB of file is what fits. A web
 * font this large after subsetting is a CJK face, which a page should not
 * make every visitor download anyway.
 */
export const FONT_STORED_MAX_BYTES = 3 * 1024 * 1024

/** The extensions the chooser offers. */
export const FONT_UPLOAD_EXTENSIONS = ['.woff2', '.woff', '.ttf', '.otf'] as const

/** The `accept` for the installer's file input. */
export const FONT_UPLOAD_ACCEPT = [
  ...FONT_UPLOAD_EXTENSIONS,
  'font/woff2',
  'font/woff',
  'font/ttf',
  'font/otf',
  'application/font-woff',
  'application/x-font-ttf',
  'application/x-font-otf',
].join(',')

/** The content type every installed face is stored and served as. */
export const FONT_STORED_CONTENT_TYPE = 'font/woff2'

/** One face, read from the file and made ready to store. */
export interface PreparedFontFace {
  /** The typographic family the file names, e.g. "Inter". */
  family: string
  /** The style name the file gives itself, e.g. "Bold Italic". */
  subfamily: string
  fullName?: string
  /** `usWeightClass`; for a variable file, the bottom of its weight axis. */
  weight: number
  /** For a variable file with a weight axis, the top of it. */
  weightMax?: number
  style: 'normal' | 'italic'
  /** A guess from the family's name; the person installing it can change it. */
  category: HostThemeFontCategory
  metrics: { unitsPerEm: number; ascent: number; descent: number; lineGap: number; xWidthAvg: number }
  axes: Array<{ tag: string; min: number; default: number; max: number }>
  license: {
    embedding: FontEmbedding
    fsType: number
    noSubsetting: boolean
  }
  /** The scripts the stored file keeps; empty when it was not subset. */
  scripts: string[]
  /** The stored file's `unicode-range`; absent when it was not subset. */
  unicodeRange?: string
  /** What the person uploaded, and what is stored. */
  bytesIn: number
  bytesOut: number
  sourceFormat: 'truetype' | 'opentype' | 'woff' | 'woff2'
  /**
   * The stored file's content hash, computed the way the media library
   * computes it (the first 16 hex characters of its SHA-256), so the version
   * a theme records is the one the library's CDN serves the file under.
   */
  contentHash: string
  /** The file name the stored WOFF2 gets in the media library. */
  fileName: string
  /** Things the person should know that do not stop the install. */
  warnings: string[]
}

/** What the route answers: the facts, and the WOFF2 as base64. */
export interface PrepareFontResponse {
  face: PreparedFontFace
  woff2: string
}
