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

import * as Aglyn from '@aglyn/aglyn'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

export interface SearchResult {
  title: string
  url: string
  snippet: string
  kind: 'page' | 'entry' | 'data'
}

const matches = (haystack: string | undefined, needle: string) =>
  Boolean(haystack && haystack.toLowerCase().includes(needle))

/**
 * Site search v1 (AGL-88): case-insensitive substring match over the host's
 * published screens (name/description/SEO via the routing map) and
 * published collection entries (title/excerpt/body). Deliberately no
 * external search infrastructure; result set is small and cache-friendly.
 */
export async function searchContent(options: {
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
  const routing = host.screens ?? {}
  const screenSnapshots = await Promise.all(
    Object.keys(routing)
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
    const slug = collectionDoc.get('slug')
    const entries = await collectionDoc.ref
      .collection('entries')
      .where('status', '==', 'published')
      .limit(100)
      .get()
    for (const entryDoc of entries.docs) {
      const entry = entryDoc.data() as any
      if (
        [entry.title, entry.excerpt, entry.body].some((value) =>
          matches(value, needle),
        )
      ) {
        results.push({
          title: entry.title ?? entryDoc.id,
          url: `/${slug}/${entry.slug ?? entryDoc.id}`,
          snippet: entry.excerpt || String(entry.body ?? '').slice(0, 160),
          kind: 'entry',
        })
      }
    }
  }

  // Dataset records (AGL-168): a match links to the first published
  // screen that repeats over the dataset — records only surface through
  // repeatables, so an un-navigable match would be noise. Version reads
  // happen lazily and only when a dataset actually matched.
  const datasets = await hostRef.collection('datasets').limit(20).get()
  let screenVersionCache: Map<string, any> | null = null
  const loadVersions = async () => {
    if (screenVersionCache) return screenVersionCache
    screenVersionCache = new Map()
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
      if (version?.exists) screenVersionCache.set(snapshot.id, version.data())
    }
    return screenVersionCache
  }
  for (const datasetDoc of datasets.docs) {
    if (datasetDoc.get('deletedAt')) continue
    const datasetName = String(datasetDoc.get('name') ?? '')
    const records = await datasetDoc.ref
      .collection('records')
      .limit(200)
      .get()
    const matching = records.docs.filter((record) =>
      Object.values((record.get('values') ?? {}) as Record<string, string>)
        .some((value) => matches(String(value), needle)),
    )
    if (!matching.length) continue
    const versions = await loadVersions()
    let targetPath: string | undefined
    for (const [screenId, version] of versions) {
      const nodes = (version?.nodes ?? {}) as Record<string, any>
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
