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

import { resolveSiteTimeZone } from '@aglyn/aglyn/app-utils/collection-entry-date'
import { hostPublicOrigin } from '@aglyn/aglyn/app-utils/host-naming'
import { resolvePluginSiteOffer } from '@aglyn/aglyn/plugin-manager/plugin-site-offers'
import {
  checkEntitlement,
  resolveHostEnabledPlugins,
  resolveSocialImage,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import {
  filterEnabledPluginsByReleaseFlags,
  isServerReleaseFlagOnForLoadedOrg,
} from '@aglyn/tenant-data-admin/server/release-flags'
import {
  zonedDateTime,
  zonedWallTimeToInstant,
} from '@aglyn/shared-util-timestamp/zoned-time'
import { BUNDLE_ID } from '../constants/bundle-common'
import {
  buildIcsCalendar,
  occurrenceMatches,
  type CalendarOccurrence,
  type CalendarRangeResponse,
  type CalendarTicket,
  type IcsEvent,
} from '../model/event-calendar-feed'
import {
  EVENT_CATEGORIES_COLLECTION,
  EVENT_CATEGORY_MAX,
  eventCategoryIdsOf,
  eventCategoryOf,
  eventTicketDefaultLabel,
  eventTicketOf,
  sortEventCategories,
  type EventCategory,
} from '../model/event-categories'
import {
  eventRecurrenceOf,
  eventRecurrenceText,
  expandEventOccurrences,
  isEventDayKey,
} from '../model/event-recurrence'

/**
 * THE CALENDAR'S SERVER DOORS (AGL-4252): a date range of occurrences, one
 * event's details, and the subscribable `.ics` feed.
 *
 * Each answers only for a site whose workspace holds the `eventCalendar`
 * add-on AND has `release_events_calendar_v2` on; otherwise the range
 * answers `enabled: false` and the feed 404s, so an element placed before
 * the flag is on draws nothing. Only published, undeleted events leave.
 */

/** The flag the v2 doors answer behind. */
export const EVENTS_CALENDAR_V2_FLAG = 'release_events_calendar_v2' as const

/** The longest range one read may ask for: a little over a year. */
export const CALENDAR_RANGE_MAX_DAYS = 400
/** Event documents one range read reaches (two queries, merged). */
export const CALENDAR_EVENT_READ_LIMIT = 300
/** Occurrences one range answers. */
export const CALENDAR_OCCURRENCE_LIMIT = 1000
/** Ticket offers resolved per answer (one per event, reused for its dates). */
const OFFER_RESOLVE_LIMIT = 40

const DAY_MS = 24 * 60 * 60 * 1000

const isDocumentId = (value: string) =>
  Boolean(value) &&
  value.length <= 200 &&
  !value.includes('/') &&
  !/^__.*__$/.test(value)

type Data = Record<string, unknown>

/** What the doors know about one site before reading its events. */
export interface CalendarSite {
  hostId: string
  host: Data
  enabled: boolean
  timeZone: string
  enabledPlugins: string[]
}

/** The site, its zone, and whether the v2 calendar is on for it; `null` for no such site. */
export async function readCalendarSite(
  hostId: string,
): Promise<CalendarSite | null> {
  if (!isDocumentId(hostId)) return null
  const snapshot = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .get()
  if (!snapshot.exists) return null
  const host = (snapshot.data() ?? {}) as Data
  const owner = await getOrgForHost(hostId)
  const org = (owner?.org ?? null) as Data | null
  const entitled = checkEntitlement(org as never, 'eventCalendar')
  const released = entitled
    ? await isServerReleaseFlagOnForLoadedOrg(
        EVENTS_CALENDAR_V2_FLAG,
        owner?.orgId ?? null,
        org,
      )
    : false
  const enabledPlugins = released
    ? await filterEnabledPluginsByReleaseFlags(
        resolveHostEnabledPlugins(
          org as never,
          { $id: hostId, ...host } as never,
        ),
        { orgId: owner?.orgId ?? null },
      )
    : []
  return {
    hostId,
    host,
    enabled: released && enabledPlugins.includes(BUNDLE_ID),
    timeZone: resolveSiteTimeZone(org as never, host as never),
    enabledPlugins,
  }
}

/** The site's categories in chip order. */
export async function readEventCategories(
  hostId: string,
): Promise<EventCategory[]> {
  const snapshot = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection(EVENT_CATEGORIES_COLLECTION)
    .limit(EVENT_CATEGORY_MAX + 10)
    .get()
  const categories: EventCategory[] = []
  for (const doc of snapshot.docs) {
    const category = eventCategoryOf(doc.id, doc.data() as Data)
    if (category) categories.push(category)
  }
  return sortEventCategories(categories)
}

/** Whether a stored event is one a visitor may see. */
function isPublished(data: Data): boolean {
  return data['status'] === 'published' && !data['deletedAt']
}

/**
 * Published events that may have a date in `[fromMs, toMs)`: those whose
 * series is still running at `fromMs` (`seriesEndsAtMs`, written by every v2
 * save) and, for events saved before it existed, those starting in the range.
 */
export async function readRangeEvents(
  hostId: string,
  fromMs: number,
  toMs: number,
): Promise<Array<{ id: string; data: Data }>> {
  const events = firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection('events')
  const published = events.where('status', '==', 'published')
  const [running, starting] = await Promise.all([
    published
      .where('seriesEndsAtMs', '>=', fromMs)
      .orderBy('seriesEndsAtMs', 'asc')
      .limit(CALENDAR_EVENT_READ_LIMIT)
      .get(),
    published
      .where('startsAtMs', '>=', fromMs - DAY_MS)
      .where('startsAtMs', '<', toMs)
      .orderBy('startsAtMs', 'asc')
      .limit(CALENDAR_EVENT_READ_LIMIT)
      .get(),
  ])
  const byId = new Map<string, Data>()
  for (const doc of [...running.docs, ...starting.docs]) {
    const data = doc.data() as Data
    if (
      !byId.has(doc.id) &&
      isPublished(data) &&
      Number(data['startsAtMs']) < toMs
    ) {
      byId.set(doc.id, data)
    }
  }
  return [...byId].map(([id, data]) => ({ id, data }))
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null

/** An absolute cover, resolved against the site the way the Event List's door does. */
function coverOf(site: CalendarSite, data: Data): string | null {
  return (
    resolveSocialImage({
      sources: [{ image: data['coverImage'] as string }],
      host: {
        $id: site.hostId,
        cname: (site.host['cname'] as string) ?? null,
        subdomain: (site.host['subdomain'] as string) ?? null,
      },
    })?.url ?? null
  )
}

/** The ticket button for an event's date, from the plugin that sells or books it. */
async function ticketFor(
  site: CalendarSite,
  data: Data,
  dayKey: string,
): Promise<CalendarTicket | null> {
  const ticket = eventTicketOf(data['ticket'])
  if (!ticket) return null
  const offer = await resolvePluginSiteOffer(
    ticket.kind,
    { hostId: site.hostId, id: ticket.id, dayKey },
    site.enabledPlugins,
  )
  if (!offer) return null
  return {
    label: ticket.label ?? eventTicketDefaultLabel(ticket.kind),
    ...(offer.caption ? { caption: offer.caption } : {}),
    action: offer.action as CalendarTicket['action'],
  }
}

/** Every occurrence of `events` in the range, earliest first, tickets resolved. */
export async function occurrencesOf(
  site: CalendarSite,
  events: ReadonlyArray<{ id: string; data: Data }>,
  range: { fromMs: number; toMs: number },
  options: {
    limit?: number
    categoryIds?: readonly string[]
    query?: string
    categories?: readonly EventCategory[]
    /** False leaves tickets unresolved (search, which shows none). */
    tickets?: boolean
  } = {},
): Promise<CalendarOccurrence[]> {
  const limit = options.limit ?? CALENDAR_OCCURRENCE_LIMIT
  const wanted = options.categoryIds?.length
    ? new Set(options.categoryIds)
    : null
  const out: CalendarOccurrence[] = []
  for (const { id, data } of events) {
    const categoryIds = eventCategoryIdsOf(data['categoryIds'])
    if (wanted && !categoryIds.some((categoryId) => wanted.has(categoryId)))
      continue
    const timeZone = text(data['timeZone']) ?? site.timeZone
    const startsAtMs = Number(data['startsAtMs'] ?? 0)
    const dates = expandEventOccurrences(
      {
        startsAtMs,
        endsAtMs: Number(data['endsAtMs'] ?? 0),
        timeZone,
        recurrence: data['recurrence'],
      },
      { ...range, limit },
    )
    if (!dates.length) continue
    const base = {
      eventId: id,
      title: String(data['title'] ?? ''),
      timeZone,
      location: text(data['location']),
      organizer: text(data['organizer']),
      description: text(data['description']),
      coverImage: coverOf(site, data),
      coverImageAlt: text(data['coverImageAlt']),
      categoryIds,
      repeatText: eventRecurrenceOf(data['recurrence'])
        ? eventRecurrenceText(
            data['recurrence'],
            startsAtMs > 0
              ? zonedDateTime(startsAtMs, timeZone).weekday
              : undefined,
          )
        : '',
    }
    if (
      options.query &&
      !occurrenceMatches(base, options.query, options.categories)
    )
      continue
    for (const date of dates) {
      out.push({ id: `${id}:${date.dayKey}`, ...base, ...date, ticket: null })
    }
  }
  out.sort(
    (a, b) => a.startsAtMs - b.startsAtMs || a.title.localeCompare(b.title),
  )
  const visible = out.slice(0, limit)
  // Tickets per event and day: a product that takes a use day posts that
  // day, so each date has its own action. Bounded, earliest dates first.
  let resolved = 0
  for (const occurrence of options.tickets === false ? [] : visible) {
    const data = events.find((event) => event.id === occurrence.eventId)?.data
    if (!data || !data['ticket']) continue
    if (resolved >= OFFER_RESOLVE_LIMIT) break
    resolved += 1
    occurrence.ticket = await ticketFor(site, data, occurrence.dayKey)
  }
  return visible
}

/** A range bound as given: epoch ms, or a `YYYY-MM-DD` day on the site's clock. */
export function rangeBound(value: unknown, timeZone: string): number | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string' || !raw.trim()) return null
  if (isEventDayKey(raw)) {
    const [year, month, day] = raw.split('-').map(Number)
    return zonedWallTimeToInstant({ year, month, day }, timeZone)
  }
  const ms = Number(raw)
  return Number.isFinite(ms) && ms > 0 ? ms : null
}

function listParam(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.join(',')
    : typeof value === 'string'
      ? value
      : ''
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 20)
}

/**
 * `GET /api/events/occurrences?hostId&from&to[&category=a,b][&q=]`: the
 * calendar's dates. `from`/`to` are days (`YYYY-MM-DD`, the site's clock) or
 * epoch ms; absent, the next 31 days.
 */
export const eventsOccurrencesHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  const hostId = String(req.query['hostId'] ?? '')
  if (!isDocumentId(hostId))
    return res.status(400).json({ error: 'Missing hostId' })
  try {
    const site = await readCalendarSite(hostId)
    if (!site) return res.status(404).json({ error: 'Unknown site' })
    if (!site.enabled) {
      const off: CalendarRangeResponse = {
        enabled: false,
        timeZone: site.timeZone,
        categories: [],
        occurrences: [],
      }
      return res.status(200).json(off)
    }
    const nowMs = Date.now()
    const fromMs = rangeBound(req.query['from'], site.timeZone) ?? nowMs
    let toMs =
      rangeBound(req.query['to'], site.timeZone) ?? fromMs + 31 * DAY_MS
    if (toMs <= fromMs)
      return res.status(400).json({ error: 'The range ends before it starts.' })
    toMs = Math.min(toMs, fromMs + CALENDAR_RANGE_MAX_DAYS * DAY_MS)
    const query = String(req.query['q'] ?? '')
      .trim()
      .slice(0, 100)
    const [categories, events] = await Promise.all([
      readEventCategories(hostId),
      readRangeEvents(hostId, fromMs, toMs),
    ])
    const occurrences = await occurrencesOf(
      site,
      events,
      { fromMs, toMs },
      {
        categoryIds: listParam(req.query['category']),
        query,
        categories,
      },
    )
    const body: CalendarRangeResponse = {
      enabled: true,
      timeZone: site.timeZone,
      categories,
      occurrences,
    }
    res.setHeader('Cache-Control', 'public, s-maxage=60')
    return res.status(200).json(body)
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'The calendar could not be read' })
  }
}

/**
 * `GET /api/events/event?hostId&id[&on=YYYY-MM-DD]`: one published event for
 * the Event details element, at the date asked for (else its next one), and
 * its next few dates.
 */
export const eventsEventHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  const hostId = String(req.query['hostId'] ?? '')
  const eventId = String(req.query['id'] ?? '')
  if (!isDocumentId(hostId) || !isDocumentId(eventId)) {
    return res.status(400).json({ error: 'Missing hostId or id' })
  }
  try {
    const site = await readCalendarSite(hostId)
    if (!site) return res.status(404).json({ error: 'Unknown site' })
    if (!site.enabled) return res.status(200).json({ enabled: false })
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .collection('events')
      .doc(eventId)
      .get()
    const data = (snapshot.data() ?? null) as Data | null
    if (!data || !isPublished(data))
      return res.status(404).json({ error: 'Unknown event' })
    const on = String(req.query['on'] ?? '')
    const timeZone = text(data['timeZone']) ?? site.timeZone
    const fromMs = isEventDayKey(on)
      ? (rangeBound(on, timeZone) as number)
      : Math.min(Date.now(), Number(data['startsAtMs'] ?? 0) || Date.now())
    const [categories, dates] = await Promise.all([
      readEventCategories(hostId),
      occurrencesOf(
        site,
        [{ id: eventId, data }],
        { fromMs, toMs: fromMs + CALENDAR_RANGE_MAX_DAYS * DAY_MS },
        { limit: 6 },
      ),
    ])
    // A one-off whose date passed still has a page: its own date.
    const occurrences = dates.length
      ? dates
      : await occurrencesOf(
          site,
          [{ id: eventId, data }],
          { fromMs: 0, toMs: Number.MAX_SAFE_INTEGER },
          { limit: 1 },
        )
    res.setHeader('Cache-Control', 'public, s-maxage=60')
    return res.status(200).json({
      enabled: true,
      timeZone: site.timeZone,
      categories: categories.filter((category) =>
        eventCategoryIdsOf(data['categoryIds']).includes(category.$id),
      ),
      occurrences,
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'The event could not be read' })
  }
}

/** The site's public origin for a feed's links, or '' when it has none. */
function siteOrigin(host: Data): string {
  return (
    hostPublicOrigin({
      cname: (host['cname'] as string) ?? null,
      subdomain: (host['subdomain'] as string) ?? null,
    }) ?? ''
  )
}

/** Events the feed carries: published, ending within the last 90 days or later. */
const FEED_LOOKBACK_DAYS = 90
const FEED_EVENT_LIMIT = 300

/**
 * `GET /api/events/ics?hostId[&event=id][&on=YYYY-MM-DD][&category=a,b]`:
 * the site's calendar as iCalendar, to subscribe to (every published event,
 * series kept as rules) or, with `event`, one event to download.
 */
export const eventsIcsHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  const hostId = String(req.query['hostId'] ?? '')
  if (!isDocumentId(hostId))
    return res.status(400).json({ error: 'Missing hostId' })
  try {
    const site = await readCalendarSite(hostId)
    if (!site || !site.enabled)
      return res.status(404).json({ error: 'No calendar here' })
    const eventId = String(req.query['event'] ?? '')
    const on = String(req.query['on'] ?? '')
    const wanted = new Set(listParam(req.query['category']))
    const nowMs = Date.now()
    const eventsRef = firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .collection('events')
    let rows: Array<{ id: string; data: Data }>
    if (eventId) {
      if (!isDocumentId(eventId))
        return res.status(400).json({ error: 'Bad event' })
      const snapshot = await eventsRef.doc(eventId).get()
      const data = (snapshot.data() ?? null) as Data | null
      rows = data && isPublished(data) ? [{ id: eventId, data }] : []
      if (!rows.length) return res.status(404).json({ error: 'Unknown event' })
    } else {
      rows = await readRangeEvents(
        hostId,
        nowMs - FEED_LOOKBACK_DAYS * DAY_MS,
        Number.MAX_SAFE_INTEGER,
      )
      rows = rows.slice(0, FEED_EVENT_LIMIT)
    }
    if (wanted.size) {
      rows = rows.filter(({ data }) =>
        eventCategoryIdsOf(data['categoryIds']).some((id) => wanted.has(id)),
      )
    }
    const origin = siteOrigin(site.host)
    const events: IcsEvent[] = []
    for (const { id, data } of rows) {
      const timeZone = text(data['timeZone']) ?? site.timeZone
      const startsAtMs = Number(data['startsAtMs'] ?? 0)
      const endsAtMs = Number(data['endsAtMs'] ?? 0) || startsAtMs
      const rule = eventRecurrenceOf(data['recurrence'])
      const common = {
        title: String(data['title'] ?? ''),
        timeZone,
        description: text(data['description']),
        location: text(data['location']),
        updatedAtMs:
          (
            data['updatedAt'] as { toMillis?: () => number } | undefined
          )?.toMillis?.() ?? null,
      }
      if (eventId && rule && isEventDayKey(on)) {
        // One date of a series, as a single event.
        const date = expandEventOccurrences(
          { startsAtMs, endsAtMs, timeZone, recurrence: rule },
          {
            fromMs: rangeBound(on, timeZone) as number,
            toMs: (rangeBound(on, timeZone) as number) + DAY_MS,
            limit: 1,
          },
        )[0]
        if (!date) return res.status(404).json({ error: 'No such date' })
        events.push({
          ...common,
          uid: `${id}-${date.dayKey}@${hostId}.aglyn`,
          startsAtMs: date.startsAtMs,
          endsAtMs: date.endsAtMs,
        })
        continue
      }
      const skipped = (rule?.exceptDayKeys ?? []).map((dayKey) => {
        const [year, month, day] = dayKey.split('-').map(Number)
        const wall = zonedDateTime(startsAtMs, timeZone)
        return zonedWallTimeToInstant(
          { year, month, day, hour: wall.hour, minute: wall.minute },
          timeZone,
        )
      })
      events.push({
        ...common,
        uid: `${id}@${hostId}.aglyn`,
        startsAtMs,
        endsAtMs,
        recurrence: rule,
        exceptStartsAtMs: skipped,
        url: origin || null,
      })
    }
    const name =
      String(site.host['name'] ?? site.host['title'] ?? 'Events').trim() ||
      'Events'
    const body = buildIcsCalendar({
      name,
      timeZone: site.timeZone,
      events,
      nowMs,
    })
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
    if (eventId)
      res.setHeader('Content-Disposition', 'attachment; filename="event.ics"')
    res.setHeader('Cache-Control', 'public, s-maxage=300')
    return res.status(200).send(body)
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'The calendar could not be read' })
  }
}
