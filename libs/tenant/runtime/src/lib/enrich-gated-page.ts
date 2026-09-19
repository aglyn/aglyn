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

import * as Aglyn from '@aglyn/aglyn/server'
import { getHostDocAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { resolveEntryLinkRoutes } from './entry-link-routes'
import { getTemplateScreenRouting } from './template-screens'

/**
 * Where the entries a gated tree links to are served (AGL-3118), or
 * `undefined` when it names none that are live.
 *
 * The page's routing map was built before the gate opened, from a tree it
 * did not have, so it holds no entry a gated page links to; these travel
 * with the nodes for the reason the enricher slice does. A tree that names
 * no entry costs no read.
 *
 * Never rejects, so the caller can start it early and abandon it on a
 * failure of its own.
 */
async function gatedEntryLinkRoutes(
  hostId: string,
  nodes: unknown,
): Promise<Record<string, string> | undefined> {
  try {
    const refs = Aglyn.collectEntryLinkRefs({
      nodes: [nodes as Record<string, unknown> | null],
    })
    if (!refs.length) return undefined
    const routing = await getTemplateScreenRouting({ hostId })
    const routes = await resolveEntryLinkRoutes({
      hostId,
      refs,
      collectionSlugs: routing.collectionListings,
    })
    return Object.keys(routes).length ? routes : undefined
  } catch (error) {
    console.error('gated page entry links failed', error)
    return undefined
  }
}

/**
 * The enricher slice for a screen whose nodes are withheld from the page and
 * fetched after a gate opens (AGL-2510) — a password-protected screen
 * (AGL-87) and a members-only one (AGL-109).
 *
 * ## Why these two need their own call
 *
 * Every other rendered page gets its enricher props from the loader, but
 * these two deliberately ship `nodes: null`: embedding a gated tree in static
 * HTML would publish the very content the gate exists to withhold. So the
 * page arrives with the built-in prompt and no site chrome at all, and the
 * composed tree — the site's shared layout, nav and footer included — is
 * swapped in by the client once the visitor gets past the gate. A nav menu
 * built from primitives opens through `clientAutomations`, which is enricher
 * output, so without this the unlocked page renders the site's nav and none
 * of its behavior.
 *
 * Delivering it WITH the nodes is what keeps the gate honest. The slice is
 * derived from the withheld tree and describes its structure; shipping it in
 * the public HTML alongside `nodes: null` would leak an outline of the page
 * to anyone who never answers the prompt.
 *
 * ## The path
 *
 * Taken from the host's own routing map rather than from the caller, because
 * both callers are POST endpoints a visitor controls: a supplied path would
 * let anyone pick which overlays and path-scoped automations a gated page
 * runs. A screen missing from the map (never routed) gets the site root,
 * which is what an unrouted screen's own address would be.
 *
 * ## The entry links
 *
 * `entryRoutes` rides along when the tree links to a live content entry
 * (AGL-3118), and the client adds those keys to the page's routing map — see
 * {@link gatedEntryLinkRoutes}.
 *
 * Fail-open to `{}` — an enricher slice is behavior on top of a page, and no
 * failure here may cost a visitor the content they just unlocked.
 */
export async function enrichGatedScreenPage(options: {
  hostId: string
  screenId: string
  screen: any
  nodes: any
  /**
   * The site document, when the caller already read it to compose `nodes`
   * (AGL-2883). Read here when absent.
   */
  host?: Record<string, unknown> | null
}): Promise<Record<string, unknown>> {
  const { hostId, screenId, screen, nodes } = options
  try {
    // Started first: its reads share nothing with the enrichers'.
    const entryRoutesPromise = gatedEntryLinkRoutes(hostId, nodes)
    const [host, orgRes] = await Promise.all([
      options.host !== undefined ? options.host : getHostDocAdmin(hostId),
      getOrgForHost(hostId),
    ])
    const routing = ((host as { screens?: Record<string, string> })?.screens ??
      {}) as Record<string, string>
    const path = routing[screenId] || Aglyn.SCREEN_ROOT_PATH
    const enriched = await Aglyn.runSitePageEnrichers({
      hostId,
      host,
      org: orgRes?.org,
      path,
      slugSegments: path.split('/').filter(Boolean),
      screenId,
      screen,
      nodes,
    })
    const entryRoutes = await entryRoutesPromise
    return entryRoutes ? { ...enriched.props, entryRoutes } : enriched.props
  } catch (error) {
    console.error('gated page enrichment failed', error)
    return {}
  }
}

export default enrichGatedScreenPage
