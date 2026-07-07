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
  kind: 'page' | 'entry'
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

  return results.slice(0, 50)
}

export default searchContent
