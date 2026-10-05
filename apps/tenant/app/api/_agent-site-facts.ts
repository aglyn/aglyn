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
  curateLlmsTxtPages,
  hostCollectionKind,
  statusPageScreenIds,
  screenRoutePathToUrl,
  type AglynHost,
  type LlmsTxtScreenRecord,
} from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  tenantDataTag,
  withRenderCache,
} from '@aglyn/tenant-data-admin/render-cache'
import { getTemplateScreenRouting } from '@aglyn/tenant-runtime/template-screens'
import {
  listPluginSitemapReaders,
  pluginSitemapReader,
} from '@aglyn/aglyn/plugin-manager/plugin-sitemap-readers'

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
  /**
   * Public content collections, list-slug first — only those with a published
   * entry, since one with none has no listing or feed yet (AGL-3101).
   */
  collections: Array<{ slug: string; name?: string; entryCount?: number }>
  /**
   * Pages a plugin serves one per record, grouped by base (AGL-3475) — read
   * from the same readers that list them in the sitemap, so the two files
   * agree about which exist.
   */
  pageGroups: Array<{ name: string; base: string; count: number; hasListing: boolean }>
  /**
   * The pages the `## Pages` list names, in site order — home, the top-level
   * pages as the screens list arranges them, then their children — with
   * every `noindex` page left out (AGL-3576). See `curateLlmsTxtPages`.
   */
  pages: Array<{ path: string; title?: string }>
  /** Whether the site serves `/search`. */
  hasSearch: boolean
}

/** How many collections a site can advertise; the sitemap's own scan limit. */
const COLLECTION_SCAN_LIMIT = 50

/**
 * Screen documents read per sweep — the sitemap's own limit for the same
 * collection, so the two files judge the same set.
 */
const SCREEN_SCAN_LIMIT = 1000

/** Cache window, matching the sitemap and robots routes. */
const FACTS_TTL_SECONDS = 300

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
      /*
        The screen documents behind the page list (AGL-3576): which routed
        screens are pages an agent may read — not a group, not `noindex` — and
        how the author arranged them. The projection is exactly the fields
        `curateLlmsTxtPages` reads. Started here and collected after the
        collections sweep, so the two reads overlap rather than queue.

        FAILS OPEN to `undefined`, which keeps every routed screen rather than
        none — the sitemap's choice for the same read, and for the same
        reason: a page's own `noindex` still holds, while a list that vanished
        would teach an agent the site has no pages.
      */
      const screensPromise: Promise<
        Record<string, LlmsTxtScreenRecord> | undefined
      > = hostRef
        .collection('screens')
        .select('displayName', 'visibility', 'order', 'kind')
        .limit(SCREEN_SCAN_LIMIT)
        .get()
        .then((snapshot) => {
          const screens: Record<string, LlmsTxtScreenRecord> = {}
          for (const docSnapshot of snapshot.docs) {
            screens[docSnapshot.id] = docSnapshot.data() as LlmsTxtScreenRecord
          }
          return screens
        })
        .catch((error: unknown) => {
          console.error('llms.txt: the screens read failed', error)
          return undefined
        })
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
        collections = counted.filter(
          // A collection with nothing published is not public yet
          // (AGL-3101): its listing and its feed 404 until the first entry
          // goes live, so naming it would hand an agent two dead links. Only
          // a count of ZERO drops it — a failed count leaves `entryCount`
          // unset and keeps the link, as above.
          (entry): entry is Collection =>
            entry != null && entry.entryCount !== 0,
        )
      } catch {
        collections = []
      }
      // Record pages (AGL-3475), by the readers that list them in the
      // sitemap. One that fails costs the file its groups, not the file.
      const routedPaths = new Set(
        Object.entries(host.screens ?? {})
          .filter(([screenId]) => !templateScreenIds.has(screenId))
          .map(([, path]) => screenRoutePathToUrl(path)),
      )
      const pageGroups: AgentSiteFacts['pageGroups'] = []
      for (const declared of listPluginSitemapReaders()) {
        try {
          const reader = await pluginSitemapReader(declared)
          for (const group of (await reader.listings?.({ hostId: host.$id })) ?? []) {
            if (!group.base || !(group.count > 0)) continue
            pageGroups.push({
              name: group.name,
              base: group.base,
              count: group.count,
              hasListing: routedPaths.has(`/${group.base}`),
            })
          }
        } catch (error) {
          console.error('llms.txt: a sitemap reader failed', declared.section, error)
        }
      }
      /*
        `/search` exists on every site the router serves it for, which is every
        site — the results screen is composed rather than authored. Stated as a
        field anyway so a future per-site switch has one place to turn it off,
        and so neither file has to assume.
      */
      /*
        Not pages, so never listed: a template renders nowhere at its own slug,
        a list route is a collection's listing rather than a screen, and a
        status screen is a status. The first two come from the routing read
        above; the third from the SHARED predicate the sitemap applies, so the
        two files cannot disagree about which addresses exist.
      */
      const excluded = new Set<string>([
        ...templateScreenIds,
        ...Object.keys(listRoutes),
        ...statusPageScreenIds(host as never),
      ])
      return {
        collections,
        pageGroups,
        pages: curateLlmsTxtPages({
          routing: host.screens,
          screens: await screensPromise,
          excluded,
        }),
        hasSearch: true,
      }
    },
  })
}
