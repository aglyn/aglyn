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
import { Fuse } from '@aglyn/shared-util-vendor/fuse'
import {
  orgDataQueryForHost, firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  PUBLISHED_SITE_DATA_TTL_SECONDS,
  tenantDataTag,
  withRenderCache,
} from '@aglyn/tenant-data-admin/render-cache'
import getTemplateScreenIds from '@aglyn/tenant-runtime/template-screens'

// The result shape and the tab arithmetic live in `search-facets.ts`, which
// imports nothing that reaches Firestore — the `'use client'` results page
// needs `SEARCH_FACET_ALL` as a VALUE, and a value import from THIS module
// drags the Admin SDK into the browser bundle (AGL-1525). Re-exported here
// so every existing importer keeps working.
export type {
  SearchFacet,
  SearchResult,
} from './search-facets'
export {
  filterSearchResults,
  SEARCH_FACET_ALL,
  SEARCH_FACET_PAGES,
  searchResultFacets,
} from './search-facets'

import type { SearchResult } from './search-facets'

const matches = (haystack: string | undefined, needle: string) =>
  Boolean(haystack && haystack.toLowerCase().includes(needle))

/** How long one query's answer stays warm (AGL-1525). */
const SEARCH_TTL_SECONDS = PUBLISHED_SITE_DATA_TTL_SECONDS

/**
 * Site search (AGL-88), cached per query (AGL-1525).
 *
 * The uncached read below costs on the order of forty Firestore round trips
 * — a screen doc per published route, then entries per collection, then
 * dataset records. That was tolerable when nothing linked here; the
 * Collection Entries suggestion panel now does, from every collection
 * listing on the site, so the same handful of queries arrive over and over.
 *
 * Cached on the QUERY, not merely on the host: the read is a function of
 * both, and a host-keyed cache would answer every search with the first
 * one's results. Tagged with the host's data tag, so publishing an entry
 * busts the answers that entry belongs in rather than leaving them stale
 * for the TTL.
 *
 * This is the ISR side of the constraint on AGL-1525. The keystroke side is
 * the panel itself, which searches a server-stamped index already sitting in
 * the ISR page and never issues a query at all.
 */
export async function searchContent(options: {
  host: Aglyn.AglynHost
  query: string
}): Promise<SearchResult[]> {
  const needle = options.query.trim().toLowerCase()
  if (!needle || needle.length > 100) return []
  try {
    return await withRenderCache({
      key: ['tenant-site-search', options.host.$id, needle],
      revalidate: SEARCH_TTL_SECONDS,
      tags: [tenantDataTag(options.host.$id)],
      read: () => readSearchContent(options),
    })
  } catch (error) {
    // Fail OPEN, the same shape `getPublishedCollectionSource` uses: a cache
    // fault must degrade search to "slower", never to "broken".
    console.error(error)
    return readSearchContent(options)
  }
}

/**
 * Site search v1 (AGL-88): the host's published screens (name/description/
 * SEO via the routing map) and published collection entries — the latter
 * through the product's shared fuzzy matcher on title/excerpt (AGL-1525)
 * and a substring test on the body. Deliberately no external search
 * infrastructure; result set is small and cache-friendly.
 */
async function readSearchContent(options: {
  host: Aglyn.AglynHost
  query: string
}): Promise<SearchResult[]> {
  const { host, query } = options
  const needle = query.trim().toLowerCase()
  if (!needle || needle.length > 100) return []
  const firestore = firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(host.$id)
  const results: SearchResult[] = []

  // Published screens (routing map = exactly what's reachable).
  //
  // Minus the template screens (AGL-1267 for collection list/entry templates,
  // AGL-1270 for commerce's PDP and catalog-collection templates): the router
  // no longer serves those at their own slug, so a hit on one would be a search
  // result linking to a 404 — and its `displayName`/SEO ("Blog — Entry
  // Template", "Product Page Template") is exactly the sort of string a visitor
  // searching "blog" or a product name matches.
  const routing = host.screens ?? {}
  const templateScreenIds = await getTemplateScreenIds({
    hostId: host.$id,
  })
  const screenSnapshots = await Promise.all(
    Object.keys(routing)
      .filter((screenId) => !templateScreenIds.has(screenId))
      .slice(0, 100)
      .map((screenId) =>
        hostRef
          .collection('screens')
          .doc(screenId)
          .get()
          .catch(() => null),
      ),
  )
  for (const snapshot of screenSnapshots) {
    if (!snapshot?.exists) continue
    const screen = snapshot.data() as any
    const path = routing[snapshot.id]
    if (path == null) continue
    const haystacks = [
      screen.displayName,
      screen.description,
      screen.seo?.title,
      screen.seo?.description,
    ]
    if (haystacks.some((value) => matches(value, needle))) {
      results.push({
        title: screen.seo?.title || screen.displayName || snapshot.id,
        url: Aglyn.screenRoutePathToUrl(path),
        snippet:
          screen.seo?.description || screen.description || '',
        kind: 'page',
      })
    }
  }

  // Published collection entries.
  const collections = await hostRef.collection('collections').limit(20).get()
  for (const collectionDoc of collections.docs) {
    // Commerce's product collections share this path (AGL-954); they own no
    // entries, so reading them here is a wasted round trip per collection.
    if (Aglyn.hostCollectionKind(collectionDoc.data()) !== 'content') continue
    const slug = collectionDoc.get('slug')
    // The tab label on the results page (AGL-1525) — the collection's own
    // name, so the frame's "Press" is whatever the author actually called
    // the newsroom, not a slug this file guessed at.
    const collectionTitle =
      String(
        collectionDoc.get('displayName') ??
          collectionDoc.get('name') ??
          collectionDoc.get('title') ??
          '',
      ).trim() || String(slug ?? '')
    const entries = await collectionDoc.ref
      .collection('entries')
      .where('status', '==', 'published')
      .limit(100)
      .get()
    // Title and excerpt go through the SAME fuzzy matcher the Collection
    // Entries block uses (AGL-1525), because the block's suggestion panel
    // links HERE. Matched by substring alone, a typo the panel forgave
    // ("platfrom") answered "View all results" with an empty page — the one
    // query most likely to make that trip, failing at the end of it.
    //
    // `body` stays a substring test: it is the whole post, and fuzzing
    // kilobytes of prose is both slow and indiscriminate. The block never
    // indexed it either, so this is strictly the wider net of the two.
    const fuzzy = new Fuse(
      entries.docs.map((entryDoc) => ({
        title: String(entryDoc.get('title') ?? ''),
        excerpt: String(entryDoc.get('excerpt') ?? ''),
      })),
      { ...Aglyn.COLLECTION_SEARCH_FUSE_OPTIONS },
    )
    const fuzzyHits = new Set(
      fuzzy.search(needle).map((result) => result.refIndex),
    )
    for (const [position, entryDoc] of entries.docs.entries()) {
      const entry = entryDoc.data() as any
      if (!fuzzyHits.has(position) && !matches(entry.body, needle)) continue
      results.push({
        title: entry.title ?? entryDoc.id,
        url: `/${slug}/${entry.slug ?? entryDoc.id}`,
        snippet: entry.excerpt || String(entry.body ?? '').slice(0, 160),
        kind: 'entry',
        collection: { slug: String(slug ?? ''), title: collectionTitle },
        ...(entry.publishedAt?.seconds
          ? { date: Aglyn.formatCollectionEntryDate(entry.publishedAt) }
          : {}),
      })
    }
  }

  // Dataset records (AGL-168): a match links to the first published
  // screen that repeats over the dataset — records only surface through
  // repeatables, so an un-navigable match would be noise. Version reads
  // happen lazily and only when a dataset actually matched.
  // Scoped to this host (AGL-1039): site search surfaces record contents
  // publicly, so an unscoped read here leaks another client's rows into
  // search results without anyone binding a repeatable at all.
  const datasets = await (
    await orgDataQueryForHost(host.$id, 'datasets')
  ).query
    .limit(20)
    .get()
  // Decoded node maps, not raw version data (AGL-1396). `nodes` is stored in
  // TWO live forms — a plain map and msgpack bytes, the besigner writing the
  // compressed one — and the Admin SDK hands the compressed form back as a
  // Node `Buffer`. `Object.values` over a Buffer yields the byte NUMBERS, none
  // of which has `props.repeatDataset`, so every besigner-saved screen looked
  // like it repeated over nothing and its records never surfaced.
  //
  // The decode belongs HERE rather than at the loop below because this map is
  // memoised for the whole call: decoding at the consumer would fix the cold
  // read and go on serving the Buffer to every dataset after the first.
  let screenNodesCache: Map<string, Record<string, any>> | null = null
  const loadScreenNodes = async () => {
    if (screenNodesCache) return screenNodesCache
    screenNodesCache = new Map()
    for (const snapshot of screenSnapshots.slice(0, 30)) {
      if (!snapshot?.exists) continue
      const versionId = (snapshot.data() as any)?.versionId
      if (!versionId) continue
      const version = await hostRef
        .collection('screens')
        .doc(snapshot.id)
        .collection('versions')
        .doc(String(versionId))
        .get()
        .catch(() => null)
      if (!version?.exists) continue
      screenNodesCache.set(
        snapshot.id,
        Aglyn.decodeStoredNodes(version.get('nodes')) ?? {},
      )
    }
    return screenNodesCache
  }
  for (const datasetDoc of datasets.docs) {
    if (datasetDoc.get('deletedAt')) continue
    // Console-created datasets store the human name as `displayName`
    // (AGL-536); `name` covers pre-migration docs.
    const datasetName = String(
      datasetDoc.get('displayName') ?? datasetDoc.get('name') ?? '',
    )
    const records = await datasetDoc.ref
      .collection('records')
      .limit(200)
      .get()
    const matching = records.docs.filter((record) =>
      Object.values((record.get('values') ?? {}) as Record<string, string>)
        .some((value) => matches(String(value), needle)),
    )
    if (!matching.length) continue
    const screenNodes = await loadScreenNodes()
    let targetPath: string | undefined
    for (const [screenId, nodes] of screenNodes) {
      const repeats = Object.values(nodes).some((node) => {
        const key = node?.props?.repeatDataset
        return (
          key != null &&
          (String(key) === datasetDoc.id ||
            String(key).trim() === datasetName)
        )
      })
      if (repeats) {
        targetPath = routing[screenId]
        break
      }
    }
    if (targetPath == null) continue
    for (const record of matching.slice(0, 5)) {
      const values = (record.get('values') ?? {}) as Record<string, string>
      results.push({
        title:
          Object.values(values).find((value) =>
            matches(String(value), needle),
          ) ?? datasetName,
        url: Aglyn.screenRoutePathToUrl(targetPath),
        snippet: Object.values(values).join(' · ').slice(0, 160),
        kind: 'data',
      })
    }
  }

  return results.slice(0, 50)
}

export default searchContent
