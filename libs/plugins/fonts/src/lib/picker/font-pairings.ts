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
import type { GoogleFontFamily } from '../catalog/google-fonts-catalog'

/**
 * Heading and body fonts that read well together (AGL-3656), for the font
 * picker's "Pairs well with". A short list of well-known pairings first, then
 * the most used families of a contrasting category.
 */

/** Well-known pairings, as `[heading, body]`. */
export const CURATED_FONT_PAIRS: ReadonlyArray<readonly [heading: string, body: string]> = [
  ['Playfair Display', 'Source Sans 3'],
  ['Playfair Display', 'Lato'],
  ['Montserrat', 'Merriweather'],
  ['Oswald', 'Open Sans'],
  ['Raleway', 'Lora'],
  ['Merriweather', 'Open Sans'],
  ['Roboto Slab', 'Roboto'],
  ['Libre Baskerville', 'Source Sans 3'],
  ['Bebas Neue', 'Montserrat'],
  ['DM Serif Display', 'DM Sans'],
  ['Fraunces', 'Inter'],
  ['Space Grotesk', 'Inter'],
  ['Archivo Black', 'Roboto'],
  ['Abril Fatface', 'Lato'],
  ['Cormorant Garamond', 'Proza Libre'],
  ['Josefin Sans', 'Merriweather'],
  ['Poppins', 'Lora'],
  ['Work Sans', 'Bitter'],
  ['EB Garamond', 'Lato'],
  ['Pacifico', 'Open Sans'],
  ['Cinzel', 'Fira Sans'],
  ['Syne', 'Manrope'],
  ['IBM Plex Serif', 'IBM Plex Sans'],
  ['Zilla Slab', 'Karla'],
]

/** What a suggestion is, and why it is offered. */
export interface FontPairing {
  family: GoogleFontFamily
  reason: string
}

const LABELS: Record<HostThemeFontCategory, string> = {
  'sans-serif': 'sans-serif',
  serif: 'serif',
  display: 'display',
  handwriting: 'handwriting',
  monospace: 'monospace',
}

/** The categories that set off a font of `category` in the other role. */
function contrasting(category: HostThemeFontCategory, role: 'heading' | 'body'): HostThemeFontCategory[] {
  if (role === 'heading') {
    // Headings for this body text.
    if (category === 'serif') return ['sans-serif', 'display']
    if (category === 'monospace') return ['sans-serif', 'serif']
    return ['serif', 'display']
  }
  // Body text for these headings: always a family made for reading.
  if (category === 'serif') return ['sans-serif']
  if (category === 'sans-serif') return ['serif', 'sans-serif']
  return ['sans-serif', 'serif']
}

/** Whether a family can carry the role: body text needs a regular and a bold. */
function fitsRole(family: GoogleFontFamily, role: 'heading' | 'body'): boolean {
  if (!family.subsets.includes('latin')) return false
  if (role === 'body') {
    return (
      (family.category === 'sans-serif' || family.category === 'serif') &&
      family.weights.includes(400) &&
      family.weights.some((weight) => weight >= 600)
    )
  }
  return family.weights.some((weight) => weight >= 600) || family.category === 'display' || family.weights.length === 1
}

/**
 * Up to `limit` families to set in `role` beside `family`: heading fonts for
 * a body font, or body fonts for a heading font. The catalog is the whole
 * list, most used first, as `loadGoogleFontsCatalog` answers it.
 */
export function suggestFontPairings(
  family: GoogleFontFamily,
  role: 'heading' | 'body',
  catalog: readonly GoogleFontFamily[],
  limit = 4,
): FontPairing[] {
  const byName = new Map(catalog.map((entry) => [entry.family.toLowerCase(), entry]))
  const name = family.family.toLowerCase()
  const picked: FontPairing[] = []
  const seen = new Set([name])
  const add = (entry: GoogleFontFamily | undefined, reason: string) => {
    if (!entry || seen.has(entry.family.toLowerCase()) || picked.length >= limit) return
    seen.add(entry.family.toLowerCase())
    picked.push({ family: entry, reason })
  }
  for (const [heading, body] of CURATED_FONT_PAIRS) {
    if (role === 'heading' && body.toLowerCase() === name) add(byName.get(heading.toLowerCase()), 'A classic pairing')
    if (role === 'body' && heading.toLowerCase() === name) add(byName.get(body.toLowerCase()), 'A classic pairing')
  }
  const categories = contrasting(family.category, role)
  for (const category of categories) {
    const reason =
      role === 'heading'
        ? `${capitalize(LABELS[category])} headings over ${LABELS[family.category]} text`
        : `${capitalize(LABELS[category])} text under ${LABELS[family.category]} headings`
    // Two from each contrasting category, the most used first.
    let taken = 0
    for (const entry of catalog) {
      if (taken >= 2 || picked.length >= limit) break
      if (entry.category !== category || !fitsRole(entry, role) || seen.has(entry.family.toLowerCase())) continue
      add(entry, reason)
      taken += 1
    }
  }
  return picked
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
