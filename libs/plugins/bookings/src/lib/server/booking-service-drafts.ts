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

import { hostRoleCanWrite } from '@aglyn/aglyn/app-utils/organizations'
import { checkEntitlement, checkQuota } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  registerPluginResourceDraftWriter,
  type PluginDraftCheck,
  type PluginDraftContext,
  type PluginDraftRecord,
  type PluginDraftRefusal,
  type PluginDraftWrite,
  type PluginResourceDraftWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { isValidTimeZone } from '@aglyn/shared-util-timestamp/zoned-time'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { BUNDLE_ID } from '../constants/bundle-common'
import { BOOKING_FIELD_ASKS, type BookingFieldAsk } from '../model/booking-contact-fields'
import {
  BOOKING_PRICE_DISPLAYS,
  type BookingPriceDisplay,
  bookingPriceText,
} from '../model/booking-price'
import {
  BOOKING_MAX_DURATION_MINUTES,
  BOOKING_MIN_DURATION_MINUTES,
  type HostBookingService,
} from '../model/bookings'

/**
 * A BOOKING SERVICE ANOTHER PLUGIN ASKS FOR (AGL-3616).
 *
 * The draft writer this plugin registers for the `booking-service` resource
 * on the core's resource-drafts seam. A plugin that sets a site up from a
 * brief asks for the writer by name and gets this plugin's rules:
 *
 *  - THE DOCUMENT is a `hosts/{hostId}/services/{id}` service in the shape
 *    the console's service dialog saves, born `status: 'draft'`. A draft is
 *    offered nowhere — not in the Booking block's list, not by its slots, not
 *    by the booking route — until a person activates it on the Bookings page.
 *  - THE ROOM is the `servicesPerHost` allowance, counted the way the
 *    resources route counts it and inside the transaction that creates, so
 *    two writes at once cannot both take the last slot. Free includes none.
 *  - THE PLAN is the `bookings` feature, and THE ROLE is a member who may
 *    write the site's content — the resources route's two gates, refused in
 *    its words.
 *  - THE PRICE is a label (`contact`, `varies`, `estimate`) unless the
 *    content states a fixed price, so nothing the caller did not say is
 *    charged. No price stated and no label asked for is `contact`.
 *
 * Nothing is published or charged. The writer touches the one new document.
 */

type Firestore = FirebaseFirestore.Firestore

/** The resource name this writer is registered under. */
export const BOOKING_SERVICE_DRAFT_RESOURCE = 'booking-service'

/** The longest name the console's dialog keeps. */
export const BOOKING_SERVICE_NAME_MAX = 80
/** The longest description the console's dialog keeps. */
export const BOOKING_SERVICE_DESCRIPTION_MAX = 500
/** The most open intervals one weekday holds. */
export const BOOKING_SERVICE_WINDOWS_PER_DAY_MAX = 12
/** The highest fixed price a draft may state, in whole dollars. */
export const BOOKING_SERVICE_PRICE_MAX_USD = 100_000

/** The resources route's refusal for a member who may not write the site. */
export const BOOKING_SERVICE_ROLE_REFUSAL = 'Editing requires the editor role'
/** The resources route's refusal for a plan without the feature. */
export const BOOKING_SERVICE_PLAN_REFUSAL =
  'This feature is not included in your plan — see Billing'

/** The resources route's refusal at the plan's allowance. */
export function bookingServiceLimitRefusal(limit: number): string {
  return `Your plan includes ${limit} ${limit === 1 ? 'service' : 'services'} — ` +
    'upgrade in Billing for more'
}

/**
 * What a caller sends as `content`. `windows` is keyed by weekday
 * (0 = Sunday … 6 = Saturday), each a list of `{ start, end }` in minutes
 * since midnight in `timezone`. `priceUsd` is read only with
 * `priceDisplay: 'fixed'`, which needs it.
 */
export interface BookingServiceDraftContent {
  name: string
  durationMinutes: number
  description?: string
  windows: Partial<Record<number, Array<{ start: number; end: number }>>>
  timezone: string
  priceDisplay?: BookingPriceDisplay
  priceUsd?: number
  askPhone?: BookingFieldAsk
  askAddress?: BookingFieldAsk
  crmFollowUpTask?: boolean
  crmMeetingActivity?: boolean
}

/** The service document's editable fields, as the writer stores them. */
export type BookingServiceDraftFields = Required<
  Pick<HostBookingService, 'name' | 'durationMinutes' | 'windows' | 'timezone' | 'priceDisplay' | 'priceUsd' | 'askPhone' | 'askAddress' | 'crmFollowUpTask' | 'crmMeetingActivity'>
> &
  Pick<HostBookingService, 'description'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Text on one line: controls and runs of space folded to one space. */
function line(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\p{Cc}\s]+/gu, ' ').trim() : ''
}

/** The weekly windows, or what is wrong with them. */
function readWindows(
  value: unknown,
  problems: string[],
): BookingServiceDraftFields['windows'] {
  const windows: BookingServiceDraftFields['windows'] = {}
  if (!isRecord(value)) {
    problems.push('The service needs weekly hours: at least one open window on one weekday')
    return windows
  }
  for (const [key, raw] of Object.entries(value)) {
    const weekday = Number(key)
    if (!/^[0-6]$/.test(key) || !Number.isInteger(weekday)) {
      problems.push(`"${key}" is not a weekday: weekdays are 0 (Sunday) to 6 (Saturday)`)
      continue
    }
    if (!Array.isArray(raw)) {
      problems.push(`The hours for weekday ${key} are not a list of windows`)
      continue
    }
    if (!raw.length) continue
    if (raw.length > BOOKING_SERVICE_WINDOWS_PER_DAY_MAX) {
      problems.push(`Weekday ${key} has more than ${BOOKING_SERVICE_WINDOWS_PER_DAY_MAX} windows`)
      continue
    }
    const day: Array<{ start: number; end: number }> = []
    for (const window of raw) {
      const start = isRecord(window) ? window['start'] : undefined
      const end = isRecord(window) ? window['end'] : undefined
      if (
        typeof start !== 'number' ||
        typeof end !== 'number' ||
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        end > 24 * 60 ||
        end <= start
      ) {
        problems.push(
          `A window on weekday ${key} is not a start before its end, in whole minutes from 0 to 1440`,
        )
        continue
      }
      day.push({ start, end })
    }
    day.sort((a, b) => a.start - b.start)
    if (day.some((window, index) => index > 0 && window.start < day[index - 1].end)) {
      problems.push(`Two windows on weekday ${key} overlap`)
    }
    if (day.length) windows[weekday] = day
  }
  if (!Object.keys(windows).length && !problems.length) {
    problems.push('The service needs weekly hours: at least one open window on one weekday')
  }
  return windows
}

function readAsk(label: string, value: unknown, problems: string[]): BookingFieldAsk {
  if (value === undefined) return 'off'
  if ((BOOKING_FIELD_ASKS as readonly unknown[]).includes(value)) return value as BookingFieldAsk
  problems.push(`Asking for ${label} is off, optional or required`)
  return 'off'
}

function readSwitch(label: string, value: unknown, fallback: boolean, problems: string[]): boolean {
  if (value === undefined) return fallback
  if (typeof value === 'boolean') return value
  problems.push(`${label} is on or off`)
  return fallback
}

export type BookingServiceContentRead =
  | { ok: true; value: BookingServiceDraftFields }
  | { ok: false; problems: string[] }

/** The content as the writer stores it, or every problem that stops it. */
export function readBookingServiceContent(
  content: Readonly<Record<string, unknown>>,
): BookingServiceContentRead {
  const problems: string[] = []
  const name = line(content['name'])
  if (!name) problems.push('The service needs a name')
  else if (name.length > BOOKING_SERVICE_NAME_MAX) {
    problems.push(`The name is longer than ${BOOKING_SERVICE_NAME_MAX} characters`)
  }
  const duration = content['durationMinutes']
  if (
    typeof duration !== 'number' ||
    !Number.isInteger(duration) ||
    duration < BOOKING_MIN_DURATION_MINUTES ||
    duration > BOOKING_MAX_DURATION_MINUTES
  ) {
    problems.push(
      `The length is whole minutes from ${BOOKING_MIN_DURATION_MINUTES} to ${BOOKING_MAX_DURATION_MINUTES}`,
    )
  }
  const rawDescription = content['description']
  const description = typeof rawDescription === 'string' ? rawDescription.trim() : ''
  if (rawDescription !== undefined && typeof rawDescription !== 'string') {
    problems.push('The description is text')
  } else if (description.length > BOOKING_SERVICE_DESCRIPTION_MAX) {
    problems.push(`The description is longer than ${BOOKING_SERVICE_DESCRIPTION_MAX} characters`)
  }
  const timezone = line(content['timezone'])
  if (!isValidTimeZone(timezone)) {
    problems.push('The time zone is an IANA zone, such as America/Chicago')
  }
  const windows = readWindows(content['windows'], problems)

  // No price stated and no label asked for is "Contact for price": a draft
  // never charges what the caller did not say.
  const rawPrice = content['priceUsd']
  const askedDisplay = content['priceDisplay']
  let priceDisplay: BookingPriceDisplay = 'contact'
  let priceUsd = 0
  if (askedDisplay !== undefined) {
    if ((BOOKING_PRICE_DISPLAYS as readonly unknown[]).includes(askedDisplay)) {
      priceDisplay = askedDisplay as BookingPriceDisplay
    } else {
      problems.push('The price is stated as fixed, varies, estimate or contact')
    }
  } else if (rawPrice !== undefined) {
    priceDisplay = 'fixed'
  }
  if (priceDisplay === 'fixed') {
    if (
      typeof rawPrice !== 'number' ||
      !Number.isInteger(rawPrice) ||
      rawPrice < 0 ||
      rawPrice > BOOKING_SERVICE_PRICE_MAX_USD
    ) {
      problems.push(
        `A fixed price is whole dollars from 0 to ${BOOKING_SERVICE_PRICE_MAX_USD}; ` +
          'state it, or say the price varies, is a free estimate, or is on request',
      )
    } else {
      priceUsd = rawPrice
    }
  }
  const askPhone = readAsk('a phone number', content['askPhone'], problems)
  const askAddress = readAsk('an address', content['askAddress'], problems)
  // The model's defaults: a booking files a meeting, and owes no follow-up.
  const crmMeetingActivity = readSwitch('Filing a meeting', content['crmMeetingActivity'], true, problems)
  const crmFollowUpTask = readSwitch('A follow-up task', content['crmFollowUpTask'], false, problems)
  if (problems.length) return { ok: false, problems: [...new Set(problems)] }
  return {
    ok: true,
    value: {
      name,
      durationMinutes: duration as number,
      ...(description ? { description } : {}),
      windows,
      timezone,
      priceDisplay,
      priceUsd,
      askPhone,
      askAddress,
      crmMeetingActivity,
      crmFollowUpTask,
    },
  }
}

/** What a caller is told about a service, written or about to be. */
function factsOf(value: Pick<HostBookingService, 'durationMinutes' | 'priceUsd' | 'priceDisplay' | 'timezone' | 'windows'>) {
  return {
    status: 'draft',
    durationMinutes: value.durationMinutes,
    priceDisplay: value.priceDisplay ?? 'fixed',
    priceText: bookingPriceText(value),
    timezone: value.timezone ?? 'UTC',
    openWeekdays: Object.keys(value.windows ?? {})
      .map(Number)
      .sort((a, b) => a - b),
  }
}

/** Whether content is a service this plugin would store, with what it says about it. Pure. */
export function checkBookingServiceContent(
  content: Readonly<Record<string, unknown>>,
): PluginDraftCheck {
  const read = readBookingServiceContent(content)
  if (read.ok === false) return read
  return { ok: true, facts: factsOf(read.value) }
}

function recordOf(service: FirebaseFirestore.DocumentSnapshot): PluginDraftRecord {
  const data = (service.data() ?? {}) as HostBookingService
  return {
    id: service.id,
    name: String(data.name ?? ''),
    versionId: null,
    facts: { ...factsOf(data), status: data.status === 'draft' ? 'draft' : 'active' },
  }
}

function roleRefusal(host: FirebaseFirestore.DocumentSnapshot, uid: string): PluginDraftRefusal | null {
  const role = (host.get('memberRoles') ?? {})[uid]
  return hostRoleCanWrite(role) ? null : { status: 403, error: BOOKING_SERVICE_ROLE_REFUSAL }
}

function planRefusal(org: PluginDraftContext['org']): PluginDraftRefusal | null {
  return checkEntitlement(org as never, 'bookings')
    ? null
    : { status: 403, error: BOOKING_SERVICE_PLAN_REFUSAL }
}

/**
 * The allowance, counted as `/api/hosts/resources` counts a service create:
 * every document in the collection.
 */
function roomRefusal(org: PluginDraftContext['org'], used: number): PluginDraftRefusal | null {
  const quota = checkQuota(org as never, 'servicesPerHost', used)
  return quota.allowed ? null : { status: 403, error: bookingServiceLimitRefusal(quota.limit) }
}

export interface BookingServiceDraftWriterDeps {
  /** The Admin SDK handle; specs hand in a double. */
  firestore?: () => Firestore
}

export function createBookingServiceDraftWriter(
  deps: BookingServiceDraftWriterDeps = {},
): PluginResourceDraftWriter {
  const firestore = deps.firestore ?? (() => firebaseAdmin.app().firestore() as unknown as Firestore)
  return {
    refusal: async (context) => {
      const hostRef = firestore().collection('hosts').doc(context.hostId)
      const host = await hostRef.get()
      if (!host.exists) return { status: 404, error: 'Unknown site' }
      const early = roleRefusal(host, context.uid) ?? planRefusal(context.org)
      if (early) return early
      const used = (await hostRef.collection('services').count().get()).data().count
      return roomRefusal(context.org, Number(used) || 0)
    },

    check: (content) => checkBookingServiceContent(content),

    read: async ({ hostId, id }) => {
      const service = await firestore()
        .collection('hosts')
        .doc(hostId)
        .collection('services')
        .doc(id)
        .get()
      return service.exists ? recordOf(service) : null
    },

    write: async (request): Promise<PluginDraftWrite> => {
      // The request's name is the one asked for; the content's stands in.
      const asked = line(request.name)
      const read = readBookingServiceContent(asked ? { ...request.content, name: asked } : request.content)
      if (read.ok === false) return { ok: false, status: 400, error: read.problems[0] }
      const db = firestore()
      const hostRef = db.collection('hosts').doc(request.hostId)
      const servicesRef = hostRef.collection('services')
      const serviceRef = servicesRef.doc(request.id)
      return db.runTransaction(async (tx): Promise<PluginDraftWrite> => {
        // Every read before any write, which Firestore requires.
        const [host, existing] = await Promise.all([tx.get(hostRef), tx.get(serviceRef)])
        if (!host.exists) return { ok: false, status: 404, error: 'Unknown site' }
        // Asked again under the same id: the draft it already wrote.
        if (existing.exists) return { ok: true, replayed: true, ...recordOf(existing) }
        const early = roleRefusal(host, request.uid) ?? planRefusal(request.org)
        if (early) return { ok: false, ...early }
        const used = (await tx.get(servicesRef.count())).data().count
        const room = roomRefusal(request.org, Number(used) || 0)
        if (room) return { ok: false, ...room }
        tx.create(serviceRef, {
          ...read.value,
          status: 'draft',
          createdAt: request.now,
          updatedAt: request.now,
          createdBy: request.uid,
        })
        return {
          ok: true,
          replayed: false,
          id: request.id,
          name: read.value.name,
          versionId: null,
          facts: factsOf(read.value),
        }
      })
    },
  }
}

export const bookingServiceDraftWriter = createBookingServiceDraftWriter()

/**
 * Registers the writer; the console surface calls it, since only the console
 * runs AI jobs (AGL-3026). Idempotent: a second call replaces the first.
 */
export function registerBookingServiceDraftWriter(): void {
  registerPluginResourceDraftWriter(BOOKING_SERVICE_DRAFT_RESOURCE, bookingServiceDraftWriter, {
    pluginId: BUNDLE_ID,
  })
}
