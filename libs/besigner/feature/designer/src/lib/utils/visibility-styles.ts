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

import {
  VISIBILITY_BAND_MEDIA,
  VISIBILITY_BANDS,
  type VisibilityBand,
} from '@aglyn/aglyn'

/**
 * Responsive visibility control model (AGL-562): "hide on mobile /
 * tablet / desktop" toggles that write `display: none` under
 * range-scoped media keys in the node's sx. Range queries (rather than
 * MUI's mobile-first responsive objects) mean hiding one band never
 * needs a restore `display` value on the others, so an element's
 * natural display — flex for stacks, block for boxes — is untouched
 * where it stays visible. The keys are shared with the plugins-mui
 * Mobile Nav preset via `@aglyn/aglyn`.
 */

export { VISIBILITY_BAND_MEDIA, VISIBILITY_BANDS }
export type { VisibilityBand }

export const VISIBILITY_BAND_LABELS: Record<VisibilityBand, string> = {
  mobile: 'Hide on mobile (under 600px)',
  tablet: 'Hide on tablet (600–899px)',
  desktop: 'Hide on desktop (900px and up)',
}

/** Bands the sx currently hides (band media key with display: none). */
export function readHiddenBands(
  sx: Record<string, any> | undefined,
): VisibilityBand[] {
  return VISIBILITY_BANDS.filter(
    (band) => sx?.[VISIBILITY_BAND_MEDIA[band]]?.['display'] === 'none',
  )
}

/**
 * Returns a new sx with the band hidden or shown. Other declarations an
 * author placed under the same media key (via the custom-CSS JSON tab)
 * are preserved; the media key itself is dropped once it holds nothing.
 */
export function writeHiddenBand(
  sx: Record<string, any> | undefined,
  band: VisibilityBand,
  hidden: boolean,
): Record<string, any> {
  const key = VISIBILITY_BAND_MEDIA[band]
  const next: Record<string, any> = { ...sx }
  const slice: Record<string, any> =
    typeof next[key] === 'object' && next[key] !== null ? { ...next[key] } : {}
  if (hidden) slice['display'] = 'none'
  else delete slice['display']
  if (Object.keys(slice).length === 0) delete next[key]
  else next[key] = slice
  return next
}
