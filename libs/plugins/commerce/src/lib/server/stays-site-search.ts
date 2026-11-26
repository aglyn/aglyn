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
  PluginSiteSearchItem,
  PluginSiteSearchSource,
} from '@aglyn/aglyn/plugin-manager/plugin-site-search'
import { getOrgForHost } from '@aglyn/tenant-data-admin'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { isServerReleaseFlagOnForLoadedOrg } from '@aglyn/tenant-data-admin/server/release-flags'

/**
 * THE SITE'S STAYS IN ITS OWN SEARCH (AGL-4252): cabins, RV hookups and
 * tent sites (`hosts/{hostId}/resources`) as `core.site-search` candidates,
 * each linked to the page the owner named for it (`pagePath`, the page that
 * holds its booking widget). A resource with no page has nowhere to link and
 * is left out. Behind `release_events_calendar_v2`, which carries the new
 * search sources.
 */

/** Resources one search reads; a site's whole set, for any park. */
const SCAN_LIMIT = 200
const SNIPPET_LENGTH = 160

/** The flag the new search sources answer behind. */
const SEARCH_SOURCES_FLAG = 'release_events_calendar_v2' as const

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

/** Whether a stored page path is one of the site's own. */
function sitePath(value: unknown): string | null {
  const text = str(value).trim()
  return text.startsWith('/') && !text.startsWith('//') && text.length <= 300
    ? text
    : null
}

/** One resource as a search result, or `null` when it has no page. Pure. */
export function staySiteSearchItem(
  data: Record<string, any>,
): PluginSiteSearchItem | null {
  if (data['deletedAt']) return null
  const url = sitePath(data['pagePath'])
  const title = str(data['name']).trim()
  if (!url || !title) return null
  const description = str(data['description']).replace(/\s+/g, ' ').trim()
  const rate = Number(data['nightlyRateUsd'])
  const amenities = Array.isArray(data['amenities'])
    ? data['amenities'].map(str).filter(Boolean)
    : []
  const photo = Array.isArray(data['photoUrls'])
    ? str(data['photoUrls'][0])
    : ''
  return {
    title,
    terms: [description, ...amenities].filter(Boolean),
    url,
    snippet: description.slice(0, SNIPPET_LENGTH),
    ...(photo.startsWith('https://') || photo.startsWith('/')
      ? { imageUrl: photo }
      : {}),
    ...(Number.isFinite(rate) && rate > 0
      ? { caption: `From $${rate} a night` }
      : {}),
  }
}

export const commerceStaysSiteSearch: PluginSiteSearchSource = {
  key: 'stays',
  label: 'Stays',
  async items({ hostId, limit }) {
    if (!hostId || hostId.includes('/') || hostId.length > 200) return []
    const owner = await getOrgForHost(hostId)
    const on = await isServerReleaseFlagOnForLoadedOrg(
      SEARCH_SOURCES_FLAG,
      owner?.orgId ?? null,
      (owner?.org ?? null) as Record<string, unknown> | null,
    )
    if (!on) return []
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .collection('resources')
      .limit(SCAN_LIMIT)
      .get()
    const items: PluginSiteSearchItem[] = []
    for (const doc of snapshot.docs) {
      const item = staySiteSearchItem(doc.data() as Record<string, any>)
      if (item) items.push(item)
      if (items.length >= limit) break
    }
    return items
  },
}
