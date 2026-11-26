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
import { getOrgForHost, getPluginConfig } from '@aglyn/tenant-data-admin'
import type { CalendarOccurrence } from '../model/event-calendar-feed'
import { eventHref } from '../plugin-config'
import {
  occurrencesOf,
  readCalendarSite,
  readEventCategories,
  readRangeEvents,
} from './event-calendar.server'

/**
 * THE SITE'S EVENTS IN ITS OWN SEARCH (AGL-4252): core's `core.site-search`
 * contract, answered with each published event's next date over the coming
 * half year, linked to the event on the site's Calendar (or Event details)
 * page. Only where the calendar v2 is on for the site's workspace.
 */

/** How far ahead an event's next date is looked for. */
const SEARCH_HORIZON_DAYS = 183
const DAY_MS = 24 * 60 * 60 * 1000
const SNIPPET_LENGTH = 160

/** An occurrence as one search result. Pure. */
export function eventSiteSearchItem(
  occurrence: CalendarOccurrence,
  categoryNames: readonly string[],
  href: string,
): PluginSiteSearchItem {
  const when = new Date(occurrence.startsAtMs).toLocaleString('en-US', {
    timeZone: occurrence.timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  return {
    title: occurrence.title,
    terms: [
      occurrence.description ?? '',
      occurrence.location ?? '',
      occurrence.organizer ?? '',
      ...categoryNames,
    ].filter(Boolean),
    url: href,
    snippet: (occurrence.description ?? '')
      .replace(/\s+/g, ' ')
      .slice(0, SNIPPET_LENGTH),
    ...(occurrence.coverImage ? { imageUrl: occurrence.coverImage } : {}),
    caption: occurrence.repeatText
      ? `${when} · ${occurrence.repeatText}`
      : when,
  }
}

export const eventsSiteSearch: PluginSiteSearchSource = {
  key: 'events',
  label: 'Events',
  async items({ hostId, limit }) {
    const site = await readCalendarSite(hostId)
    if (!site?.enabled) return []
    const nowMs = Date.now()
    const range = { fromMs: nowMs, toMs: nowMs + SEARCH_HORIZON_DAYS * DAY_MS }
    const owner = await getOrgForHost(hostId)
    const [categories, events, config] = await Promise.all([
      readEventCategories(hostId),
      readRangeEvents(hostId, range.fromMs, range.toMs),
      getPluginConfig(owner?.orgId, 'events-calendar', { hostId }).catch(
        () => ({}) as Record<string, unknown>,
      ),
    ])
    const occurrences = await occurrencesOf(site, events, range, {
      limit: 1000,
      tickets: false,
    })
    const seen = new Set<string>()
    const items: PluginSiteSearchItem[] = []
    for (const occurrence of occurrences) {
      if (seen.has(occurrence.eventId)) continue
      seen.add(occurrence.eventId)
      const names = categories
        .filter((category) => occurrence.categoryIds.includes(category.$id))
        .map((category) => category.name)
      items.push(
        eventSiteSearchItem(
          occurrence,
          names,
          eventHref(
            config as Record<string, unknown>,
            occurrence.eventId,
            occurrence.dayKey,
          ),
        ),
      )
      if (items.length >= limit) break
    }
    return items
  },
}
