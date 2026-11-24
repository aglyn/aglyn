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
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
// By path, never through a barrel: only a server composition asks it.
import {
  readRepeatRows,
  type RepeatRowsAnswer,
} from '@aglyn/aglyn/plugin-manager/repeat-rows'
import {
  listPluginSiteSearchSources,
  type RegisteredPluginSiteSearchSource,
} from '@aglyn/aglyn/plugin-manager/plugin-site-search'
import {
  PUBLISHED_SITE_DATA_TTL_SECONDS,
  tenantDataTag,
  withRenderCache,
} from '@aglyn/tenant-data-admin/render-cache'
import getScreenVersion from '@aglyn/tenant-runtime/get-screen-version'
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
 * Rows one repeat may contribute to a single result page.
 *
 * Every row a page shows is searched — the repeat's own bound
 * (`REPEAT_MAX_RECORDS`) is what the page renders, so it is what a visitor
 * could have seen there — but a list of a hundred hits on one page is one
 * answer repeated, not a hundred.
 */
const RESULTS_PER_REPEAT = 5

/**
 * Candidates one plugin source (a store's products) is asked for, and the
 * results it may add. The candidates bound the reads; the results keep one
 * busy catalog from pushing every page off the list.
 */
const PLUGIN_CANDIDATE_LIMIT = 300
const RESULTS_PER_PLUGIN_SOURCE = 24

/** Every result the page lists. */
const RESULTS_LIMIT = 50

/**
 * Site search (AGL-88), cached per query (AGL-1525).
 *
 * The uncached read below costs on the order of forty Firestore round trips
 * — a screen doc per published route, then entries per collection, then
 * the rows its pages repeat over. That was tolerable when nothing linked here; the
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
  /** The site's zone (AGL-3237); UTC when a site has not named one. */
  timeZone?: string
  /**
   * The plugins on for this site, as its pages load them. A plugin's own
   * results (a store's products) are searched only when it is on; absent,
   * none are.
   */
  enabledPlugins?: readonly string[]
}): Promise<SearchResult[]> {
  const needle = options.query.trim().toLowerCase()
  if (!needle || needle.length > 100) return []
  const sources = await listPluginSiteSearchSources(
    options.enabledPlugins ?? [],
  ).catch((error) => {
    console.error(error)
    return [] as RegisteredPluginSiteSearchSource[]
  })
  const read = () => readSearchContent({ ...options, sources })
  try {
    return await withRenderCache({
      // The zone is part of the KEY (AGL-3237): it decides the dates in the
      // rows below, so a cache entry written under one must not be served
      // under another. So are the plugin sources in force: a site that turns
      // its store on or off must not be answered from the other state. A site
      // with none keeps the key it always had.
      key: [
        'tenant-site-search',
        options.host.$id,
        needle,
        options.timeZone ?? 'UTC',
        ...(sources.length
          ? [`sources:${sources.map(({ source }) => source.key).join(',')}`]
          : []),
      ],
      revalidate: SEARCH_TTL_SECONDS,
      tags: [tenantDataTag(options.host.$id)],
      read,
    })
  } catch (error) {
    // Fail OPEN, the same shape `getPublishedCollectionSource` uses: a cache
    // fault must degrade search to "slower", never to "broken".
    console.error(error)
    return read()
  }
}

/**
 * Pages, entries and rows, with what each plugin source adds around them.
 *
 * A plugin result whose TITLE the fuzzy matcher found (a product by its
 * name) leads the list: a visitor who typed a product's name is looking for
 * the product, not for the page that mentions it. One found only by a
 * substring of its other words (a description, a SKU, a tag) follows
 * everything else.
 */
async function readSearchContent(options: {
  host: Aglyn.AglynHost
  query: string
  timeZone?: string
  sources: readonly RegisteredPluginSiteSearchSource[]
}): Promise<SearchResult[]> {
  const needle = options.query.trim().toLowerCase()
  if (!needle || needle.length > 100) return []
  const [platform, plugins] = await Promise.all([
    readPlatformResults(options),
    readPluginResults(options.host.$id, needle, options.sources),
  ])
  return [...plugins.byTitle, ...platform, ...plugins.byTerms].slice(
    0,
    RESULTS_LIMIT,
  )
}

/**
 * What the plugin sources offer for this query, matched here rather than by
 * the source, with the matcher a collection entry's title goes through: so a
 * typo the entries forgive ("hodie") is forgiven on a product too.
 *
 * A source that fails costs the page its group, never the page.
 */
async function readPluginResults(
  hostId: string,
  needle: string,
  sources: readonly RegisteredPluginSiteSearchSource[],
): Promise<{ byTitle: SearchResult[]; byTerms: SearchResult[] }> {
  const byTitle: SearchResult[] = []
  const byTerms: SearchResult[] = []
  const answers = await Promise.all(
    sources.map(({ source }) =>
      source
        .items({ hostId, query: needle, limit: PLUGIN_CANDIDATE_LIMIT })
        .catch((error) => {
          console.error(error)
          return []
        }),
    ),
  )
  sources.forEach(({ source }, index) => {
    const items = answers[index] ?? []
    const fuzzy = new Fuse(
      items.map((item) => ({ title: String(item.title ?? ''), excerpt: '' })),
      { ...Aglyn.COLLECTION_SEARCH_FUSE_OPTIONS },
    )
    // Fuse answers best first, so the closest name leads the group.
    const titleHits = fuzzy.search(needle).map((result) => result.refIndex)
    const titled = new Set(titleHits)
    const termHits = items.flatMap((item, position) =>
      !titled.has(position) &&
      (item.terms ?? []).some((term) => matches(term, needle))
        ? [position]
        : [],
    )
    const group = { key: source.key, label: source.label }
    const toResult = (position: number): SearchResult => {
      const item = items[position]
      return {
        title: item.title,
        url: item.url,
        snippet: item.snippet ?? '',
        kind: 'product',
        group,
        ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
        ...(item.caption ? { caption: item.caption } : {}),
      }
    }
    const taken = [...titleHits, ...termHits].slice(
      0,
      RESULTS_PER_PLUGIN_SOURCE,
    )
    for (const position of taken) {
      ;(titled.has(position) ? byTitle : byTerms).push(toResult(position))
    }
  })
  return { byTitle, byTerms }
}

/**
 * Site search v1 (AGL-88): the host's published screens (name/description/
 * SEO via the routing map), published collection entries — through the
 * product's shared fuzzy matcher on title/excerpt (AGL-1525) and a substring
 * test on the body — and the rows those screens repeat over. Deliberately no
 * external search infrastructure; result set is small and cache-friendly.
 */
async function readPlatformResults(options: {
  host: Aglyn.AglynHost
  query: string
  /** The site's zone (AGL-3237); UTC when a site has not named one. */
  timeZone?: string
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
          ? {
              date: Aglyn.formatCollectionEntryDate(
                entry.publishedAt,
                undefined,
                undefined,
                options.timeZone,
              ),
            }
          : {}),
      })
    }
  }

  // Repeated rows (AGL-168): a row is found on the published screen that
  // repeats over it, and a match links there — a row only ever reaches a
  // visitor through a repeat, so a match with no page to show it is noise.
  //
  // Where the rows live is not this route's to know. A repeat names a key
  // (`repeatKey`: a dataset's, or a plugin connection's record, AGL-4212),
  // and the plugin that keeps rows answers for it
  // through the platform's repeat-rows contract — the same reader, scoped to
  // this site (AGL-1039), that renders the page. So search finds exactly the
  // rows the page shows, in the order it shows them, and a row this site may
  // not see is never read, let alone surfaced.
  //
  // Each screen's published tree is read through the render's own cached
  // version read, so a site whose pages have been served is walked without a
  // Firestore read, and at most 30 screens are walked at all.
  //
  // Decoded node maps, not raw version data (AGL-1396). `nodes` is stored in
  // TWO live forms — a plain map and msgpack bytes, the besigner writing the
  // compressed one — and bytes that reach this point undecoded would yield
  // byte NUMBERS to `Object.values`, none of which has `props.repeatDataset`:
  // every besigner-saved screen would look like it repeated over nothing.
  const walked = await Promise.all(
    screenSnapshots.slice(0, 30).map(async (snapshot) => {
      if (!snapshot?.exists) return null
      const path = routing[snapshot.id]
      const versionId = (snapshot.data() as any)?.versionId
      if (path == null || !versionId) return null
      const { version } = await getScreenVersion({
        hostId: host.$id,
        screenId: snapshot.id,
        versionId: String(versionId),
      })
      const keys = Aglyn.repeatKeys(
        Aglyn.decodeStoredNodes(version?.nodes) ?? {},
      )
      return keys.length ? { path, keys } : null
    }),
  )
  const repeats = walked.filter(
    (repeat): repeat is { path: string; keys: string[] } => repeat !== null,
  )
  if (!repeats.length) return results

  // One question for every key the site repeats over. A reader may cache its
  // answer on the site and the key set, and that is the same for every query
  // typed on this site, so the rows need not be read again for each distinct
  // search.
  let rows: RepeatRowsAnswer
  try {
    rows = await readRepeatRows({
      hostId: host.$id,
      keys: repeats.flatMap((repeat) => repeat.keys),
    })
  } catch (error) {
    // A reader that is declared and missing makes a page refuse to render;
    // search is not where that is loud. Pages and entries still answer.
    console.error(error)
    return results
  }

  // The first screen to repeat a key is the one its rows link to, and a row
  // is one result however many keys reach it — a page may name a set by its
  // id and another page by its name.
  const searched = new Set<string>()
  const found = new Set<string>()
  for (const { path, keys } of repeats) {
    for (const key of keys) {
      if (searched.has(key)) continue
      searched.add(key)
      let taken = 0
      for (const row of rows[key]?.records ?? []) {
        if (taken >= RESULTS_PER_REPEAT) break
        const rowId = typeof row['$id'] === 'string' ? row['$id'] : ''
        if (rowId && found.has(rowId)) continue
        const values = Object.entries(row)
          .filter(([field]) => !field.startsWith('$'))
          .map(([, value]) => String(value ?? ''))
        const hit = values.find((value) => matches(value, needle))
        if (hit === undefined) continue
        if (rowId) found.add(rowId)
        taken += 1
        results.push({
          title: hit,
          url: Aglyn.screenRoutePathToUrl(path),
          snippet: values.join(' · ').slice(0, 160),
          kind: 'data',
        })
      }
    }
  }

  return results
}

export default searchContent
