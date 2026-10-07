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

// The theme font shapes a page loads its fonts by (AGL-3656).

/** A font's generic family; picks the local face its fallback is drawn from. */
export type HostThemeFontCategory =
  | 'sans-serif'
  | 'serif'
  | 'monospace'
  | 'display'
  | 'handwriting'

/** Font-unit metrics read from the file; a page sizes its fallback to them. */
export interface HostThemeFontMetrics {
  unitsPerEm: number
  ascent: number
  /** Negative. */
  descent: number
  lineGap: number
  /** Advance width averaged over English text by letter frequency. */
  xWidthAvg: number
}

/** One uploaded face of a `custom` font: a WOFF2 in the media library. */
export interface HostThemeFontFace {
  weight: number
  style: 'normal' | 'italic'
  /** A `media:` reference. */
  src: string
  /** Content hash; versions the URL. */
  version?: string
  unicodeRange?: string
}
