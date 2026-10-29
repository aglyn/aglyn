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

import type {
  SiteStarterChoice,
  SiteStarterFacets,
  SiteStarterPayload,
} from '../app-utils/site-starter'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginService,
} from './plugin-services'

/**
 * Where site starters come from, as the console's SERVER reads them
 * (AGL-4049).
 *
 * "Create site" offers a starter for every site, chosen before the site
 * exists, and the site is created from the one picked. The starters are
 * listings a plugin keeps — searched, priced and bought there — so the core
 * names the two questions the create path asks and one plugin answers them:
 * which starters match a search, and what a picked one creates. With none
 * registered there are no starters to offer, and the create path keeps its
 * own default site.
 */

/** One starter as a search lists it. */
export interface SiteStarterSummary {
  listingId: string
  displayName: string
  description: string
  /** Who made it, as the search shows them. */
  authorName: string
  /** Published by the platform itself; listed first. */
  official: boolean
  /** The price in US dollars; 0 for free. */
  priceUsd: number
  previewImageUrl: string | null
  facets: SiteStarterFacets
  /**
   * What kind of site it is, in words a card shows ("Restaurant & café"), or
   * `null` where it names none. Optional: a source with no such words still
   * satisfies the seam, and `facets.kind` stays the id a search filters on.
   */
  category?: string | null
  /**
   * The asking workspace may create from it without paying (AGL-4049):
   * bought already, or its own. Read for the person who asked, so it is set
   * only by an answer that knows who that is, and absent where it does not
   * say; a free starter needs no purchase either way.
   */
  owned?: boolean
}

/** Who is asking: the workspace the site will belong to, and the person. */
export interface SiteStarterViewer {
  orgId: string | null
  uid: string
}

export interface PluginSiteStarterSource {
  /** The starters matching a search, best first, at most `limit` of them. */
  search(
    input: { word: string; filter: Partial<SiteStarterFacets>; limit: number },
    viewer: SiteStarterViewer,
  ): Promise<SiteStarterSummary[]>
  /**
   * What a picked starter creates, or why this viewer cannot have it: 402
   * while a priced starter is unpaid (with its price), 403 when the viewer may
   * not install it, 404 when it is gone.
   */
  resolve(
    choice: SiteStarterChoice,
    viewer: SiteStarterViewer,
  ): Promise<SiteStarterPayload | { error: string; status: 402 | 403 | 404; priceUsd?: number }>
  /**
   * Records that a site was created from a starter; best-effort, never throws.
   * Optional, so a source that does not count installs still satisfies the seam.
   */
  installed?(choice: SiteStarterChoice, viewer: SiteStarterViewer, site: { hostId: string }): Promise<void>
  /**
   * One starter as a search would list it for this viewer, or `null` when it
   * is not one they may see (AGL-4049): what the create path records a site
   * was started from, and the name it files the starter's theme under, and
   * what "Choose your starter" shows for a pick it restores. Best-effort.
   * Optional, so a source that cannot describe a single listing still
   * satisfies the seam; read it through {@link describeSiteStarter}.
   */
  describe?(choice: SiteStarterChoice, viewer: SiteStarterViewer): Promise<SiteStarterSummary | null>
}

export const PLUGIN_SITE_STARTERS = definePluginServiceContract<PluginSiteStarterSource>(
  'core.site-starters',
  { multiple: false },
)

/** Registers the plugin that serves site starters. One per deployment; a second is refused. */
export function registerPluginSiteStarterSource(
  impl: PluginSiteStarterSource,
  options: { pluginId: string },
): void {
  registerPluginService(PLUGIN_SITE_STARTERS, impl, { pluginId: options.pluginId })
}

/** The registered starter source, or `null` when no plugin serves starters. */
export function resolveSiteStarterSource(): PluginSiteStarterSource | null {
  return resolvePluginService(PLUGIN_SITE_STARTERS) ?? null
}

/**
 * A starter as the source describes it, or `null` when the source cannot say
 * (AGL-4049): no `describe`, a listing the viewer may not see, or a source
 * that failed. Never throws, because nothing it answers is required: the
 * create path falls back to the payload's own facts, and the picker to the
 * search.
 */
export async function describeSiteStarter(
  source: PluginSiteStarterSource | null,
  choice: SiteStarterChoice,
  viewer: SiteStarterViewer,
): Promise<SiteStarterSummary | null> {
  if (!source?.describe || !choice?.listingId) return null
  try {
    const summary = await source.describe(choice, viewer)
    return summary && typeof summary === 'object' && summary.listingId === choice.listingId ? summary : null
  } catch (error) {
    console.error('[site-starters] describe failed', { listingId: choice.listingId, error })
    return null
  }
}
