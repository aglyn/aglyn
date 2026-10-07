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

import { expandCatalogRow, type GoogleFontFamily } from '../catalog/google-fonts-catalog'
import {
  choiceStylesLabel,
  defaultFontChoice,
  nearestWeights,
  searchFontFamilies,
  weightLabel,
} from './font-choice'
import { CURATED_FONT_PAIRS, suggestFontPairings } from './font-pairings'
import { previewFileUrls, previewLetters, previewSheetUrl } from './font-preview'
import { siteSampleFrom } from './site-sample'

const family = (f: string, c: GoogleFontFamily['category'], p: number, w = [400, 700], i: number[] = []) =>
  expandCatalogRow({ f, c, w, i, s: ['latin'], p })

const CATALOG: GoogleFontFamily[] = [
  family('Roboto', 'sans-serif', 1, [100, 400, 700, 900], [400]),
  family('Open Sans', 'sans-serif', 2, [300, 400, 700]),
  family('Inter', 'sans-serif', 4, [100, 400, 700, 900], [400]),
  family('Playfair Display', 'serif', 16, [400, 700, 900]),
  family('Lora', 'serif', 28, [400, 700], [400, 700]),
  family('Abril Fatface', 'display', 149, [400]),
  family('Pacifico', 'handwriting', 114, [400]),
  family('Space Mono', 'monospace', 133, [400, 700]),
]

describe('the picker’s choices (AGL-3656)', () => {
  it('starts body text at regular and bold with a true italic, headings at bold', () => {
    expect(defaultFontChoice(CATALOG[2], 'body')).toEqual({
      family: 'Inter',
      category: 'sans-serif',
      weights: [400, 700],
      italics: [400],
      source: 'google',
    })
    expect(defaultFontChoice(CATALOG[3], 'heading')).toEqual({
      family: 'Playfair Display',
      category: 'serif',
      weights: [700],
      source: 'google',
    })
    // A family with one weight is chosen at that weight.
    expect(defaultFontChoice(CATALOG[5], 'heading').weights).toEqual([400])
  })

  it('maps weights to the nearest the family has, and names them', () => {
    expect(nearestWeights([400, 700], [300, 500, 800])).toEqual([300, 800])
    expect(weightLabel(700)).toBe('Bold 700')
    expect(weightLabel(450)).toBe('450')
    expect(choiceStylesLabel({ family: 'Lora', category: 'serif', weights: [400, 700], italics: [400], source: 'google' })).toBe(
      'Regular 400, Bold 700 + italic',
    )
  })

  it('searches by name, names that start with the words first, within a category', () => {
    expect(searchFontFamilies(CATALOG, '', '').map((entry) => entry.family)).toHaveLength(CATALOG.length)
    expect(searchFontFamilies(CATALOG, 'o', 'serif').map((entry) => entry.family)).toEqual(['Lora'])
    expect(searchFontFamilies(CATALOG, 'SANS', '').map((entry) => entry.family)).toEqual(['Open Sans'])
    expect(searchFontFamilies(CATALOG, 'r', 'sans-serif').map((entry) => entry.family)).toEqual(['Roboto', 'Inter'])
  })
})

describe('pairings (AGL-3656)', () => {
  it('offers the classic pairings first, then contrasting categories, most used first', () => {
    const forInter = suggestFontPairings(CATALOG[2], 'heading', CATALOG)
    expect(forInter[0]).toEqual({ family: CATALOG[3], reason: 'Serif headings over sans-serif text' })
    expect(forInter.map((entry) => entry.family.family)).toEqual(['Playfair Display', 'Lora', 'Abril Fatface'])
    const forPlayfair = suggestFontPairings(CATALOG[3], 'body', CATALOG)
    // Body text is a family made for reading, never a display face.
    expect(forPlayfair.map((entry) => entry.family.family)).toEqual(['Roboto', 'Open Sans'])
    expect(forPlayfair.every((entry) => entry.family.family !== 'Playfair Display')).toBe(true)
  })

  it('names a classic pairing as one', () => {
    const lato = family('Lato', 'sans-serif', 7, [400, 700])
    const [first] = suggestFontPairings(lato, 'heading', [...CATALOG, lato])
    expect(first).toEqual({ family: CATALOG[3], reason: 'A classic pairing' })
    expect(CURATED_FONT_PAIRS.some(([heading, body]) => heading === 'Playfair Display' && body === 'Lato')).toBe(true)
  })
})

describe('previews (AGL-3656)', () => {
  it('asks Google for the letters the preview draws, and reads the file back', () => {
    expect(previewLetters('Studio  Site')).toBe('Studio e')
    expect(previewSheetUrl('Playfair Display', 700, 'normal', 'Ab')).toBe(
      'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&text=Ab&display=swap',
    )
    expect(previewSheetUrl('Lora', 400, 'italic', 'é')).toContain(':ital,wght@1,400&text=%C3%A9')
    expect(
      previewFileUrls("@font-face { src: url(https://fonts.gstatic.com/l/font?kit=abc&skey=1) format('woff2'); }"),
    ).toEqual(['https://fonts.gstatic.com/l/font?kit=abc&skey=1'])
    expect(previewFileUrls("src: url(https://evil.example/x.woff2)")).toEqual([])
  })

  it('draws in the site’s own words where it has them', () => {
    expect(siteSampleFrom({ displayName: 'Studio Site', seo: { title: 'Portraits in Austin', description: 'We shoot.' } })).toEqual({
      title: 'Studio Site',
      heading: 'Portraits in Austin',
      paragraph: 'We shoot.',
    })
    expect(siteSampleFrom({ name: 'Corner Cafe' }).heading).toBe('Welcome to Corner Cafe')
    expect(siteSampleFrom(undefined).title).toBe('Your site')
  })
})
