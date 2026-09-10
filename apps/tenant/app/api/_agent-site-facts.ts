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

import {
  hostCollectionKind,
  statusPageScreenIds,
  screenRoutePathToUrl,
  type AglynHost,
} from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  tenantDataTag,
  withRenderCache,
} from '@aglyn/tenant-data-admin/render-cache'
import { getTemplateScreenRouting } from '@aglyn/tenant-runtime/template-screens'

/**
 * The facts `/llms.txt` and `/openapi.json` are both built from (AGL-2716).
 *
 * One reader for two files, because the two describe the same site and a site
 * that advertises a collection in one and omits it from the other has told an
 * agent something false in whichever it reads second. It is also one cache
 * entry rather than two: both routes are crawler-facing and both were
 * otherwise going to sweep the same collections list.
 *
 * A leading `_` on the filename keeps it out of the route tree — App Router
 * treats a `route.ts` as an endpoint and everything else as a module, but the
 * underscore says so at a glance.
 */
export interface AgentSiteFacts {
  /** Public content collections, list-slug first. */
  collections: Array<{ slug: string; name?: string; entryCount?: number }>
  /** Top-level pages worth naming in a curated list. */
  pages: Array<{ path: string; title?: string }>
  /** Whether the site serves `/search`. */
  hasSearch: boolean
}

/** How many collections a site can advertise; the sitemap's own scan limit. */
const COLLECTION_SCAN_LIMIT = 50

/**
 * How many pages the curated list names.
 *
 * `/llms.txt` is a guide, not an inventory — the sitemap index is the
 * inventory, and this file links to it. Twenty-five is enough to carry a
 * normal site's whole navigation and short enough that a large site's file
 * stays readable in an agent's context window.
 */
const PAGE_LIST_LIMIT = 25

/** Cache window, matching the sitemap and robots routes. */
const FACTS_TTL_SECONDS = 300

/**
 * The pages a curated list should name.
 *
 * Top level only — depth is what the sitemap is for, and a nested page is
 * reachable from its parent. Gated and non-page screens are excluded through
 * the SHARED predicate the sitemap uses, so the two files cannot come to
 * disagree about which addresses exist.
 */
function curatedPages(
  host: AglynHost,
  unrouted: ReadonlySet<string>,
): AgentSiteFacts['pages'] {
  const excluded = statusPageScreenIds(host as never)
  const pages: AgentSiteFacts['pages'] = []
  for (const [screenId, path] of Object.entries(host.screens ?? {})) {
    if (excluded.has(screenId) || unrouted.has(screenId)) continue
    const url = screenRoutePathToUrl(path)
    // `/a/b` has one slash after the leading one; a top-level page has none.
    if (url.replace(/^\//, '').includes('/')) continue
    pages.push({ path: url })
  }
  return pages
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .slice(0, PAGE_LIST_LIMIT)
}

/**
 * Read the site facts, cached under the same tag every publish busts.
 *
 * FAILS OPEN, one read at a time: a collections sweep that throws yields no
 * collections rather than no file. A site whose `/llms.txt` disappears because
 * Firestore blinked is worse than one whose `/llms.txt` is briefly thinner —
 * the first teaches an agent the site has no guidance, and agents cache that.
 */
export async function readAgentSiteFacts(host: AglynHost): Promise<AgentSiteFacts> {
  return withRenderCache({
    key: ['agent-site-facts', host.$id],
    revalidate: FACTS_TTL_SECONDS,
    tags: [tenantDataTag(host.$id)],
    read: async (): Promise<AgentSiteFacts> => {
      const hostRef = firebaseAdmin.app().firestore().collection('hosts').doc(host.$id)
      let collections: AgentSiteFacts['collections']
      let listRoutes: Record<string, string> = {}
      let templateScreenIds: ReadonlySet<string> = new Set()
      try {
        const routing = await getTemplateScreenRouting({ hostId: host.$id })
        listRoutes = routing.listRoutes
        templateScreenIds = new Set(routing.templateScreenIds)
      } catch {
        // The curated page list keeps every screen rather than none. A
        // template screen slipping into it costs one dead link; dropping the
        // list costs the file its point.
      }
      try {
        const docs = await hostRef
          .collection('collections')
          .select('slug', 'displayName', 'kind')
          .limit(COLLECTION_SCAN_LIMIT)
          .get()
        const content = docs.docs.filter(
          // Commerce's product collections are not content: they have no
          // entries and serve under `/collections/{slug}` (AGL-954), so a feed
          // link for one would 404.
          (docSnapshot) => hostCollectionKind(docSnapshot.data()) === 'content',
        )
        type Collection = AgentSiteFacts['collections'][number]
        const counted = await Promise.all(
          content.map(async (docSnapshot): Promise<Collection | null> => {
            const slug = String(docSnapshot.get('slug') ?? '')
            const name = String(docSnapshot.get('displayName') ?? '') || undefined
            if (!slug) return null
            try {
              /*
                A `count()` aggregation rather than a sweep: the number of
                entries is a fact about the collection, and reading every
                document to learn it would make a crawler-facing file cost a
                full content sweep per cache miss.
              */
              const total = await docSnapshot.ref
                .collection('entries')
                .where('status', '==', 'published')
                .count()
                .get()
              return { slug, name, entryCount: total.data().count }
            } catch {
              // A count is a nicety; the link is the point.
              return { slug, name }
            }
          }),
        )
        collections = counted.filter((entry): entry is Collection => entry != null)
      } catch {
        collections = []
      }
      /*
        `/search` exists on every site the router serves it for, which is every
        site — the results screen is composed rather than authored. Stated as a
        field anyway so a future per-site switch has one place to turn it off,
        and so neither file has to assume.
      */
      return {
        collections,
        pages: curatedPages(host, new Set([
          ...templateScreenIds,
          ...Object.keys(listRoutes),
        ])),
        hasSearch: true,
      }
    },
  })
}
