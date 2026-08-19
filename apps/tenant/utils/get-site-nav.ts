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

import type { AglynHost } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  tenantDataTag,
  withRenderCache,
} from '@aglyn/tenant-data-admin/render-cache'
import getTemplateScreenIds from '@aglyn/tenant-runtime/template-screens'
import {
  buildSiteNavLinks,
  type SiteNavLink,
  type SiteNavScreen,
} from './site-nav'

/**
 * The read behind {@link buildSiteNavLinks} (AGL-2187) — the site's public
 * top-level pages, resolved in `[host]/layout.tsx` so the error boundaries can
 * offer somewhere to go.
 *
 * ## Why it is cached, and why 5 minutes
 *
 * The layout runs on EVERY tenant render, and this is a collection sweep. Left
 * uncached it would add one read per screen document to every page of every
 * site — the exact read amplification AGL-1302 exists to undo, paid for a
 * feature only the 404 uses. `withRenderCache` collapses it to one sweep per
 * host per TTL no matter how many paths render, and carries
 * `tenantDataTag(hostId)`, so a publish busts it the moment `/api/revalidate`
 * fires and a renamed or newly published page shows up in the nav immediately.
 * The 300s TTL is the same backstop `/api/sitemap` uses for the same sweep.
 *
 * ## Why it can never throw
 *
 * This is called from a LAYOUT. A layout that throws takes down every page on
 * the site and lands the visitor in `app/error.tsx`, so a Firestore blip while
 * resolving a decoration for an error page would become the outage. Both the
 * read and the cache wrapper are caught, and every failure path degrades to an
 * empty nav — which renders as today's screen, one home button, rather than as
 * anything broken. A DEGRADED sweep is also never stored: a partial answer
 * served once is fine, replayed for five minutes it is a nav with pages
 * missing from it.
 */
const SITE_NAV_TTL_SECONDS = 300

/**
 * Screen documents read per sweep. Above this the nav is drawn from the first
 * N; the cap is not the `SITE_NAV_MAX_LINKS` cap because ordering has to be
 * decided over the whole set, and it is the read the limit is protecting.
 */
const SITE_NAV_SCREEN_SCAN_LIMIT = 200

interface SiteNavRead {
  links: SiteNavLink[]
  /** A source failed; serve what we have, but do not cache it. */
  degraded: boolean
}

export async function getSiteNav(
  host: AglynHost | null | undefined,
): Promise<SiteNavLink[]> {
  const hostId = host?.$id
  const routing = host?.screens
  // No routing map, no pages — the sweep could only ever return nothing, so
  // skip the read entirely rather than cache an empty answer per host.
  if (!hostId || !routing || Object.keys(routing).length === 0) return []

  try {
    const { links } = await withRenderCache<SiteNavRead>({
      key: ['tenant-site-nav', hostId],
      revalidate: SITE_NAV_TTL_SECONDS,
      tags: [tenantDataTag(hostId)],
      read: () => readSiteNav(hostId, routing),
      store: (value) => !value.degraded,
    })
    return links ?? []
  } catch (error) {
    console.error('site nav lookup failed:', error)
    return []
  }
}

async function readSiteNav(
  hostId: string,
  routing: Record<string, string>,
): Promise<SiteNavRead> {
  let degraded = false

  // Started before the screens read and awaited after it, so the two overlap
  // rather than costing two round trips. `getTemplateScreenIds` never rejects
  // (it fails open to an empty set), which is why this is safe to leave
  // floating until the await below.
  const templateScreenIdsPromise = getTemplateScreenIds({ hostId })

  let screens: SiteNavScreen[] = []
  try {
    // A projection over exactly the three fields the rule reads. The doc id it
    // also needs always travels with a snapshot, so it is not in the mask —
    // the same shape `/api/sitemap` uses for its `visibility` sweep.
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .collection('screens')
      .select('displayName', 'visibility', 'order')
      .limit(SITE_NAV_SCREEN_SCAN_LIMIT)
      .get()
    screens = snapshot.docs.map((doc) => {
      const data = (doc.data() ?? {}) as Omit<SiteNavScreen, 'id'>
      return {
        id: doc.id,
        displayName: data.displayName,
        visibility: data.visibility,
        order: data.order,
      }
    })
  } catch (error) {
    console.error('site nav screen sweep failed:', error)
    degraded = true
  }

  const templateScreenIds = await templateScreenIdsPromise

  return {
    links: buildSiteNavLinks({ routing, screens, templateScreenIds }),
    degraded,
  }
}

export default getSiteNav
