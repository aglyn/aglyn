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
 * Fail-open to `{}` — an enricher slice is behavior on top of a page, and no
 * failure here may cost a visitor the content they just unlocked.
 */
export async function enrichGatedScreenPage(options: {
  hostId: string
  screenId: string
  screen: any
  nodes: any
}): Promise<Record<string, unknown>> {
  const { hostId, screenId, screen, nodes } = options
  try {
    const [host, orgRes] = await Promise.all([
      getHostDocAdmin(hostId),
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
    return enriched.props
  } catch (error) {
    console.error('gated page enrichment failed', error)
    return {}
  }
}

export default enrichGatedScreenPage
