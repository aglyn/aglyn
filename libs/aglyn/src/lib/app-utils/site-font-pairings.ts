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
 * The font pairings a site's look is chosen from (AGL-4049): a heading family
 * over a body family, each with the weights it loads.
 *
 * The platform's, not one plugin's: the AI site start picks among them for a
 * business's own look, and a site starter names the one it was designed in
 * (`site-starter.ts`), so a starter and a generated site speak one list.
 * Moved here from the AI plugin's `ai-site-kinds.ts`, which re-exports it
 * under its old names.
 *
 * Pure data, safe for any surface to import.
 */

/** A font pairing a look may choose: a heading family over a body family. */
export interface SiteFontPairing {
  id: string
  /** What the pairing reads like, as the model is told. */
  feel: string
  heading: { family: string; category: 'sans-serif' | 'serif'; weight: number; sub: number }
  body: { family: string; category: 'sans-serif' | 'serif'; weights: number[] }
  /** Letter spacing the headings carry, in em. */
  tracking?: number
  /** Headings set in capitals: a condensed display face. */
  caps?: boolean
}

/**
 * The pairings, every family from the Google Fonts catalog the fonts plugin
 * serves (`google-fonts.catalog.json`) and every weight one that family
 * has — the AI plugin's `ai-site-look.spec.ts` holds both. The tenant loads
 * them the way it loads the starter theme's family, so nothing here adds a
 * font host.
 */
export const SITE_FONT_PAIRINGS: readonly SiteFontPairing[] = [
  { id: 'jakarta', feel: 'modern, friendly sans', heading: { family: 'Plus Jakarta Sans', category: 'sans-serif', weight: 800, sub: 700 }, body: { family: 'Plus Jakarta Sans', category: 'sans-serif', weights: [400, 500, 600, 700] }, tracking: -0.02 },
  { id: 'inter', feel: 'neutral, precise sans', heading: { family: 'Inter', category: 'sans-serif', weight: 700, sub: 600 }, body: { family: 'Inter', category: 'sans-serif', weights: [400, 500, 600, 700] }, tracking: -0.025 },
  { id: 'grotesk', feel: 'designer grotesk', heading: { family: 'Space Grotesk', category: 'sans-serif', weight: 600, sub: 600 }, body: { family: 'Inter', category: 'sans-serif', weights: [400, 500, 600, 700] }, tracking: -0.03 },
  { id: 'syne', feel: 'expressive, art-school display', heading: { family: 'Syne', category: 'sans-serif', weight: 700, sub: 600 }, body: { family: 'Inter', category: 'sans-serif', weights: [400, 500, 600, 700] }, tracking: -0.02 },
  { id: 'bricolage', feel: 'contemporary, characterful sans', heading: { family: 'Bricolage Grotesque', category: 'sans-serif', weight: 700, sub: 600 }, body: { family: 'DM Sans', category: 'sans-serif', weights: [400, 500, 600, 700] }, tracking: -0.025 },
  { id: 'editorial', feel: 'editorial serif over clean sans', heading: { family: 'Playfair Display', category: 'serif', weight: 700, sub: 600 }, body: { family: 'Source Sans 3', category: 'sans-serif', weights: [400, 500, 600, 700] }, tracking: -0.01 },
  { id: 'fraunces', feel: 'warm, soft serif', heading: { family: 'Fraunces', category: 'serif', weight: 600, sub: 600 }, body: { family: 'Inter', category: 'sans-serif', weights: [400, 500, 600, 700] }, tracking: -0.015 },
  { id: 'instrument', feel: 'elegant, light serif headlines', heading: { family: 'Instrument Serif', category: 'serif', weight: 400, sub: 400 }, body: { family: 'Inter', category: 'sans-serif', weights: [400, 500, 600, 700] }, tracking: -0.01 },
  { id: 'reading', feel: 'reading-first serif, serif body', heading: { family: 'Newsreader', category: 'serif', weight: 600, sub: 600 }, body: { family: 'Source Serif 4', category: 'serif', weights: [400, 600, 700] }, tracking: -0.01 },
  { id: 'garamond', feel: 'refined, classic serif', heading: { family: 'Cormorant Garamond', category: 'serif', weight: 600, sub: 600 }, body: { family: 'Montserrat', category: 'sans-serif', weights: [400, 500, 600, 700] } },
  { id: 'baskerville', feel: 'established, trustworthy serif', heading: { family: 'Libre Baskerville', category: 'serif', weight: 700, sub: 700 }, body: { family: 'Source Sans 3', category: 'sans-serif', weights: [400, 500, 600, 700] } },
  { id: 'merriweather', feel: 'sturdy, readable serif', heading: { family: 'Merriweather', category: 'serif', weight: 700, sub: 700 }, body: { family: 'Lato', category: 'sans-serif', weights: [400, 700] } },
  { id: 'lora', feel: 'gentle, calm serif', heading: { family: 'Lora', category: 'serif', weight: 600, sub: 600 }, body: { family: 'Open Sans', category: 'sans-serif', weights: [400, 500, 600, 700] } },
  { id: 'dmserif', feel: 'polished display serif', heading: { family: 'DM Serif Display', category: 'serif', weight: 400, sub: 400 }, body: { family: 'DM Sans', category: 'sans-serif', weights: [400, 500, 600, 700] } },
  { id: 'oswald', feel: 'bold, condensed, workmanlike', heading: { family: 'Oswald', category: 'sans-serif', weight: 600, sub: 500 }, body: { family: 'Roboto', category: 'sans-serif', weights: [400, 500, 700] }, caps: true, tracking: 0.01 },
  { id: 'archivo', feel: 'heavy, high-impact sans', heading: { family: 'Archivo Black', category: 'sans-serif', weight: 400, sub: 400 }, body: { family: 'Archivo', category: 'sans-serif', weights: [400, 500, 600, 700] }, tracking: -0.01 },
  { id: 'barlow', feel: 'athletic, condensed sans', heading: { family: 'Barlow Condensed', category: 'sans-serif', weight: 700, sub: 600 }, body: { family: 'Barlow', category: 'sans-serif', weights: [400, 500, 600, 700] }, caps: true, tracking: 0.01 },
  { id: 'anton', feel: 'loud poster display', heading: { family: 'Anton', category: 'sans-serif', weight: 400, sub: 400 }, body: { family: 'Inter', category: 'sans-serif', weights: [400, 500, 600, 700] }, caps: true, tracking: 0.01 },
  { id: 'nunito', feel: 'rounded, approachable sans', heading: { family: 'Nunito', category: 'sans-serif', weight: 800, sub: 700 }, body: { family: 'Nunito Sans', category: 'sans-serif', weights: [400, 600, 700] } },
  { id: 'quicksand', feel: 'soft, airy rounded sans', heading: { family: 'Quicksand', category: 'sans-serif', weight: 700, sub: 600 }, body: { family: 'Nunito Sans', category: 'sans-serif', weights: [400, 600, 700] } },
  { id: 'manrope', feel: 'crisp, confident sans', heading: { family: 'Manrope', category: 'sans-serif', weight: 800, sub: 700 }, body: { family: 'Manrope', category: 'sans-serif', weights: [400, 500, 600, 700] }, tracking: -0.02 },
  { id: 'outfit', feel: 'geometric, upbeat sans', heading: { family: 'Outfit', category: 'sans-serif', weight: 700, sub: 600 }, body: { family: 'Outfit', category: 'sans-serif', weights: [400, 500, 600, 700] }, tracking: -0.02 },
  { id: 'plex', feel: 'technical, engineered sans', heading: { family: 'IBM Plex Sans', category: 'sans-serif', weight: 600, sub: 600 }, body: { family: 'IBM Plex Sans', category: 'sans-serif', weights: [400, 500, 600, 700] }, tracking: -0.01 },

]

/** A pairing by id, or `null`. */
export function siteFontPairing(id: unknown): SiteFontPairing | null {
  if (typeof id !== 'string' || !id) return null
  return SITE_FONT_PAIRINGS.find((pairing) => pairing.id === id) ?? null
}
