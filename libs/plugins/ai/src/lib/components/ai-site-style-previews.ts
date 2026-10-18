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

import type { OptionCardImage } from '@aglyn/shared-ui-jsx/components/option-card-grid.component'
import { AI_SITE_KINDS } from '../model/ai-site-kinds'
import businessPreview from '../assets/site-styles/business.webp'
import tradesPreview from '../assets/site-styles/trades.webp'
import professionalPreview from '../assets/site-styles/professional.webp'
import wellnessPreview from '../assets/site-styles/wellness.webp'
import restaurantPreview from '../assets/site-styles/restaurant.webp'
import storePreview from '../assets/site-styles/store.webp'
import portfolioPreview from '../assets/site-styles/portfolio.webp'
import studioPreview from '../assets/site-styles/studio.webp'
import photographyPreview from '../assets/site-styles/photography.webp'
import blogPreview from '../assets/site-styles/blog.webp'
import eventsPreview from '../assets/site-styles/events.webp'
import fitnessPreview from '../assets/site-styles/fitness.webp'
import yogaPreview from '../assets/site-styles/yoga.webp'
import beautyPreview from '../assets/site-styles/beauty.webp'
import realestatePreview from '../assets/site-styles/realestate.webp'
import educationPreview from '../assets/site-styles/education.webp'
import nonprofitPreview from '../assets/site-styles/nonprofit.webp'
import musicPreview from '../assets/site-styles/music.webp'
import personalPreview from '../assets/site-styles/personal.webp'
import landingPreview from '../assets/site-styles/landing.webp'
import comingSoonPreview from '../assets/site-styles/coming-soon.webp'

/**
 * The picture on each style card of the guided start (AGL-3898): an example
 * home page of that kind of site, in its own shape — a café's menu, a
 * store's products, a photographer's gallery, a band's tour dates — drawn in
 * the kind's look by `libs/plugins/ai/scripts/render-site-style-previews.mts`
 * from the stand-in pages in `site-style-previews.json`, with the real
 * compiler and node renderer and the starter photos. Each is 800 × 800;
 * regenerate them all with that script when a kind's look changes.
 */
const PREVIEWS: Readonly<Record<string, unknown>> = {
  business: businessPreview,
  trades: tradesPreview,
  professional: professionalPreview,
  wellness: wellnessPreview,
  restaurant: restaurantPreview,
  store: storePreview,
  portfolio: portfolioPreview,
  studio: studioPreview,
  photography: photographyPreview,
  blog: blogPreview,
  events: eventsPreview,
  fitness: fitnessPreview,
  yoga: yogaPreview,
  beauty: beautyPreview,
  realestate: realestatePreview,
  education: educationPreview,
  nonprofit: nonprofitPreview,
  music: musicPreview,
  personal: personalPreview,
  landing: landingPreview,
  'coming-soon': comingSoonPreview,
}

/** What each picture shows, as its alt text: the example page and what leads it. */
export const AI_SITE_STYLE_PREVIEW_ALTS: Readonly<Record<string, string>> = {
  business: "A cleaning company's home page: its heading beside a photo of a tidy desk, then its services",
  trades: "A roofer's home page: a bold heading on a dark band, then roofing services as cards",
  professional: "A consulting firm's home page: its heading beside a photo of a team at a planning board",
  wellness: "A therapy practice's home page: its heading over a plant-filled room, then a list of sessions",
  restaurant: "A café's home page: its heading over a photo of the owner at the counter, then menu highlights",
  store: "A handmade goods shop's home page: its heading beside a photo of a workbench, then featured products",
  portfolio: "A prop stylist's home page: a large heading over a grid of three styled sets",
  studio: "A design studio's home page: a large heading on a dark band, then its selected work",
  photography: "A photographer's home page: its heading on black over a gallery of three photos",
  blog: "A food journal's home page: its heading on a dark band, then a list of the latest posts",
  events: "A festival's home page: its heading beside the three days' program on a colored band",
  fitness: "A gym's home page: a bold heading on a dark band, then this week's class times",
  yoga: "A yoga studio's home page: its heading beside this week's class schedule",
  beauty: "A hair salon's home page: its heading beside a photo of roses and jars at a styling station",
  realestate: "A real estate agent's home page: its heading over three listings with photos",
  education: "A tutoring center's home page: its heading over a photo of a tutor at the board, then its courses",
  nonprofit: "A food bank's home page: its heading on a dark band, then the ways to help",
  music: "A band's home page: its name on a dark band, then its tour dates",
  personal: "A product manager's personal page: her introduction beside a photo of her with a teammate",
  landing: "A budgeting app's landing page: its pitch and sign-up button on a dark band, then its benefits",
  'coming-soon': "A café's coming soon page: its heading and notify button over a photo of the café shelves",
}

/** The width and height every preview is drawn at. */
export const AI_SITE_STYLE_PREVIEW_SIZE = { width: 800, height: 800 } as const

/** A bundler hands an imported picture over as its URL, or as an object carrying it. */
function urlOf(imported: unknown): string | null {
  if (typeof imported === 'string') return imported
  if (imported && typeof imported === 'object' && typeof (imported as { src?: unknown }).src === 'string') {
    return (imported as { src: string }).src
  }
  return null
}

/** The style card picture for a kind of site, by its `AI_SITE_KINDS` id; `null` for a kind with none. */
export function aiSiteStylePreview(kindId: string): OptionCardImage | null {
  const src = urlOf(PREVIEWS[kindId])
  const kind = AI_SITE_KINDS.find((entry) => entry.id === kindId)
  if (!src || !kind) return null
  return {
    src,
    alt: AI_SITE_STYLE_PREVIEW_ALTS[kindId] ?? `An example home page in the ${kind.label} style`,
    ...AI_SITE_STYLE_PREVIEW_SIZE,
  }
}
