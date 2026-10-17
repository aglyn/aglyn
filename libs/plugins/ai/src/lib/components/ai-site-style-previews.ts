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
 * The picture on each style card of the guided start (AGL-3898): the starter
 * home page drawn in that kind's style, by
 * `libs/plugins/ai/scripts/render-site-style-previews.mts` — the theme the
 * look unit builds for the kind, rendered by the real node renderer. Each is
 * 800 × 500; regenerate them all with that script when a kind's look changes.
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

/** The width and height every preview is drawn at. */
export const AI_SITE_STYLE_PREVIEW_SIZE = { width: 800, height: 500 } as const

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
    alt: `The starter home page drawn in the ${kind.label} style`,
    ...AI_SITE_STYLE_PREVIEW_SIZE,
  }
}
