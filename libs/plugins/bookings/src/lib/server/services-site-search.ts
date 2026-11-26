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

import { checkEntitlement } from '@aglyn/aglyn/server'
import type {
  PluginSiteOffer,
  PluginSiteOfferSource,
} from '@aglyn/aglyn/plugin-manager/plugin-site-offers'
import type {
  PluginSiteSearchItem,
  PluginSiteSearchSource,
} from '@aglyn/aglyn/plugin-manager/plugin-site-search'
import {
  firebaseAdmin,
  getOrgForHost,
  getPluginConfig,
} from '@aglyn/tenant-data-admin'
import { isServerReleaseFlagOnForLoadedOrg } from '@aglyn/tenant-data-admin/server/release-flags'
import { bookingPriceText } from '../model/booking-price'
import { BOOKING_SERVICE_PARAM } from '../model/booking-record'
import {
  BOOKING_PATH_DEFAULT,
  bookingServiceIsOffered,
  normalizeBookingPath,
} from '../model/bookings'

/**
 * A SITE'S BOOKING SERVICES, AS SEARCH AND OTHER PLUGINS' BUTTONS SEE THEM
 * (AGL-4252).
 *
 * - `core.site-search`: each offered service (not a draft, not deleted) as a
 *   result linked to the booking page (the plugin's `bookingPath` setting)
 *   opened on that service, behind `release_events_calendar_v2`, which
 *   carries the new search sources.
 * - `core.site-offers` for the `service` kind: an events calendar's "Book"
 *   button opens the same link.
 *
 * Both answer only where the workspace's plan includes Bookings.
 */

/** Services one search reads; a site's whole list, for most. */
const SCAN_LIMIT = 200
const SNIPPET_LENGTH = 160
const SEARCH_SOURCES_FLAG = 'release_events_calendar_v2' as const

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

/** The booking page opened on one service, site-relative. */
export function serviceBookingHref(
  bookingPath: unknown,
  serviceId: string,
): string {
  const query = new URLSearchParams({ [BOOKING_SERVICE_PARAM]: serviceId })
  return `${normalizeBookingPath(bookingPath ?? BOOKING_PATH_DEFAULT)}?${query.toString()}`
}

/** One offered service as a search result, or `null`. Pure. */
export function serviceSiteSearchItem(
  serviceId: string,
  data: Record<string, any>,
  bookingPath: unknown,
): PluginSiteSearchItem | null {
  if (!bookingServiceIsOffered(data)) return null
  const title = str(data['name']).trim()
  if (!title) return null
  const description = str(data['description']).replace(/\s+/g, ' ').trim()
  const minutes = Number(data['durationMinutes'])
  const price = bookingPriceText(data as never)
  return {
    title,
    terms: [description].filter(Boolean),
    url: serviceBookingHref(bookingPath, serviceId),
    snippet: description.slice(0, SNIPPET_LENGTH),
    caption: [
      Number.isFinite(minutes) && minutes > 0 ? `${minutes} min` : '',
      price,
    ]
      .filter(Boolean)
      .join(' · '),
  }
}

async function siteOwner(hostId: string) {
  const owner = await getOrgForHost(hostId)
  const org = (owner?.org ?? null) as Record<string, unknown> | null
  return {
    orgId: owner?.orgId ?? null,
    org,
    entitled: checkEntitlement(org as never, 'bookings'),
  }
}

const isDocumentId = (value: string) =>
  Boolean(value) && value.length <= 200 && !value.includes('/')

async function bookingPathFor(
  orgId: string | null,
  hostId: string,
): Promise<unknown> {
  const config = await getPluginConfig(orgId ?? undefined, 'bookings', {
    hostId,
  }).catch(() => ({}) as Record<string, unknown>)
  return (config as Record<string, unknown>)['bookingPath']
}

export const bookingsServicesSiteSearch: PluginSiteSearchSource = {
  key: 'services',
  label: 'Services',
  async items({ hostId, limit }) {
    if (!isDocumentId(hostId)) return []
    const owner = await siteOwner(hostId)
    if (!owner.entitled) return []
    if (
      !(await isServerReleaseFlagOnForLoadedOrg(
        SEARCH_SOURCES_FLAG,
        owner.orgId,
        owner.org,
      ))
    ) {
      return []
    }
    const [snapshot, bookingPath] = await Promise.all([
      firebaseAdmin
        .app()
        .firestore()
        .collection('hosts')
        .doc(hostId)
        .collection('services')
        .limit(SCAN_LIMIT)
        .get(),
      bookingPathFor(owner.orgId, hostId),
    ])
    const items: PluginSiteSearchItem[] = []
    for (const doc of snapshot.docs) {
      const item = serviceSiteSearchItem(
        doc.id,
        doc.data() as Record<string, any>,
        bookingPath,
      )
      if (item) items.push(item)
      if (items.length >= limit) break
    }
    return items
  },
}

export const bookingsServiceSiteOffer: PluginSiteOfferSource = {
  async resolve({ hostId, id }): Promise<PluginSiteOffer | null> {
    if (!isDocumentId(hostId) || !isDocumentId(id)) return null
    const owner = await siteOwner(hostId)
    if (!owner.entitled) return null
    const [snapshot, bookingPath] = await Promise.all([
      firebaseAdmin
        .app()
        .firestore()
        .collection('hosts')
        .doc(hostId)
        .collection('services')
        .doc(id)
        .get(),
      bookingPathFor(owner.orgId, hostId),
    ])
    const data = snapshot.data() as Record<string, any> | undefined
    if (!data || !bookingServiceIsOffered(data)) return null
    return {
      title: str(data['name']) || 'Booking',
      caption: bookingPriceText(data as never),
      action: { kind: 'link', href: serviceBookingHref(bookingPath, id) },
    }
  },
}
