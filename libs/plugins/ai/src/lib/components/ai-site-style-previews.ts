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
import {
  SITE_STYLE_PREVIEW_SIZE,
  SITE_STYLES,
  siteStyleOf,
} from '@aglyn/aglyn/app-utils/site-styles'
import { AI_SITE_KINDS } from '../model/ai-site-kinds'

/**
 * The picture on each style card (AGL-3898): an example home page of that
 * kind of site, in its own shape — a café's menu, a store's products, a
 * photographer's gallery, a band's tour dates — drawn in the kind's look by
 * `libs/plugins/ai/scripts/render-site-style-previews.mts` from the stand-in
 * pages in `site-style-previews.json`, with the real compiler and node
 * renderer, the starter photos and the previews' own credited photos
 * (`scripts/style-preview-photos/`). Each opens on its kind's signature hero
 * (`aiLayoutKindSignature`, AGL-3985) with a photo of its own kind of
 * business.
 *
 * The pictures are the console's (`apps/console/public/_static/starter/styles/`,
 * AGL-4049): the starter site's style choice draws the same ones without this
 * plugin, so they are served from one place and named by core's
 * `SITE_STYLES`. Each is 800 × 800; regenerate them all with that script when
 * a kind's look or layout changes.
 */

/** What each picture shows, as its alt text: the example page and what leads it. */
export const AI_SITE_STYLE_PREVIEW_ALTS: Readonly<Record<string, string>> = Object.fromEntries(
  SITE_STYLES.map((style) => [style.id, style.alt]),
)

/** The width and height every preview is drawn at. */
export const AI_SITE_STYLE_PREVIEW_SIZE = SITE_STYLE_PREVIEW_SIZE

/** The style card picture for a kind of site, by its `AI_SITE_KINDS` id; `null` for a kind with none. */
export function aiSiteStylePreview(kindId: string): OptionCardImage | null {
  const style = siteStyleOf(kindId)
  const kind = AI_SITE_KINDS.find((entry) => entry.id === kindId)
  if (!style || !kind) return null
  return {
    src: style.preview,
    alt: style.alt || `An example home page in the ${kind.label} style`,
    ...SITE_STYLE_PREVIEW_SIZE,
  }
}
