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
import {
  collection,
  doc,
  type DocumentData,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  updateDoc,
  where,
} from 'firebase/firestore'
import {
  type BookingActions,
  bookingActions,
  type BookingState,
  bookingState,
  BOOKING_STATE_LABELS,
} from '../../lib/model/booking-manage'
import { storedBookingTimeZone } from '../../lib/model/booking-time'
import {
  type BookedInterval,
  type BookingSlot,
  bookingLinkFor,
  bookingServiceIsOffered,
  computeOpenSlotPage,
  type HostBookingService,
} from '../../lib/model/bookings'
import { type BookingsMobileContext, newAttemptKey, nowOf } from './context'

/*
 * The data the Bookings screens read and the actions they take (AGL-3621).
 *
 * Reads are Firestore queries under the console's rules, each one an index
 * the console already has: `startsAtMs` alone for the calendar, `serviceId`
 * then `startsAtMs` for one service. Check-in and moving a booking go
 * through `bookings/check-in` and `bookings/reschedule`, which decide in a
 * transaction; canceling a paid booking goes through `bookings/refund`, as
 * the console's cancel does, so a canceled booking is never left unrefunded.
 */

export const bookingsKeys = {
  all: (hostId: string) => ['bookings', hostId] as const,
  site: (hostId: string) => ['bookings', hostId, 'site'] as const,
  services: (hostId: string) => ['bookings', hostId, 'services'] as const,
  range: (hostId: string) => ['bookings', hostId, 'range'] as const,
  one: (hostId: string, bookingId: string) => ['bookings', hostId, 'one', bookingId] as const,
}

/** The most bookings one view reads; a fuller range says so rather than looking complete. */
export const RANGE_READ_LIMIT = 500

export interface BookingRow {
  id: string
  serviceId: string
  serviceName: string
  name: string
  email: string
  phone: string | null
  address: string | null
  startsAtMs: number
  endsAtMs: number
  /** The zone the booking is told in, when it carries one. */
  timeZone: string | undefined
  state: BookingState
  stateLabel: string
  paidCents: number
  refundedCents: number
  checkedInAtMs: number | null
  actions: BookingActions
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const cents = (value: unknown): number => Math.max(0, Math.round(Number(value ?? 0)) || 0)

export function bookingRow(id: string, data: DocumentData, nowMs: number): BookingRow {
  const state = bookingState(data, nowMs)
  const checkedInAtMs = Number(data['checkedInAtMs'] ?? 0)
  return {
    id,
    serviceId: text(data['serviceId']),
    serviceName: text(data['serviceName']) || 'Booking',
    name: text(data['name']) || text(data['email']) || 'Guest',
    email: text(data['email']),
    phone: text(data['phone']) || null,
    address: text(data['address']) || null,
    startsAtMs: Number(data['startsAtMs'] ?? 0),
    endsAtMs: Number(data['endsAtMs'] ?? 0),
    timeZone: storedBookingTimeZone(data),
    state,
    stateLabel: BOOKING_STATE_LABELS[state],
    paidCents: cents(data['paidAmountCents']),
    refundedCents: cents(data['refundedCents']),
    checkedInAtMs: checkedInAtMs > 0 ? checkedInAtMs : null,
    actions: bookingActions(data, nowMs),
  }
}

/** What the calendar shows about a row beside its time. */
export function bookingSubtitle(row: BookingRow): string {
  const parts = [row.serviceName]
  if (row.checkedInAtMs) parts.push('Checked in')
  else if (row.state !== 'confirmed') parts.push(row.stateLabel)
  return parts.join(' · ')
}

export interface BookingsSite {
  timeZone: string
  site: { cname?: string | null; subdomain?: string | null }
  bookingPath: string | null
}

async function data(context: BookingsMobileContext, path: string): Promise<DocumentData | null> {
  const snapshot = await getDoc(doc(context.firestore, path)).catch(() => null)
  return snapshot?.exists() ? (snapshot.data() ?? null) : null
}

/** The site's zone, public naming and booking page, as the console resolves them. */
export function bookingsSiteQuery(context: BookingsMobileContext) {
  return {
    queryKey: bookingsKeys.site(context.hostId),
    queryFn: async (): Promise<BookingsSite> => {
      const [host, org, hostSettings, orgSettings] = await Promise.all([
        data(context, `hosts/${context.hostId}`),
        context.orgId ? data(context, `orgs/${context.orgId}`) : Promise.resolve(null),
        data(context, `hosts/${context.hostId}/pluginSettings/bookings`),
        context.orgId ? data(context, `orgs/${context.orgId}/pluginSettings/bookings`) : Promise.resolve(null),
      ])
      const path = text(hostSettings?.['bookingPath']) || text(orgSettings?.['bookingPath'])
      return {
        timeZone: resolveSiteTimeZone(org as { timeZone?: string } | null, host as { timeZone?: string } | null),
        site: { cname: (host?.['cname'] as string | null) ?? null, subdomain: (host?.['subdomain'] as string | null) ?? null },
        bookingPath: path || null,
      }
    },
    staleTime: 10 * 60_000,
  }
}

export interface ServiceRow {
  id: string
  name: string
  durationMinutes: number
  offered: boolean
  service: HostBookingService
}

/** The site's services, by name; a draft is listed but cannot be booked. */
export function servicesQuery(context: BookingsMobileContext) {
  return {
    queryKey: bookingsKeys.services(context.hostId),
    queryFn: async (): Promise<ServiceRow[]> => {
      const snapshot = await getDocs(query(collection(context.firestore, 'hosts', context.hostId, 'services'), limit(100)))
      return snapshot.docs
        .filter((entry) => !entry.data()['deletedAt'])
        .map((entry) => {
          const service = entry.data() as HostBookingService
          return {
            id: entry.id,
            name: text(service.name) || 'Service',
            durationMinutes: Number(service.durationMinutes) || 30,
            offered: bookingServiceIsOffered(service),
            service,
          }
        })
        .sort((a, b) => a.name.localeCompare(b.name))
    },
    staleTime: 5 * 60_000,
  }
}

export interface BookingsRange {
  rows: BookingRow[]
  /** True when the range held more than one read returns. */
  truncated: boolean
}

/** Every booking starting inside `[fromMs, toMs)`, optionally for one service. */
export function bookingsRangeQuery(
  context: BookingsMobileContext,
  args: { fromMs: number; toMs: number; serviceId?: string | null },
) {
  return {
    queryKey: [...bookingsKeys.range(context.hostId), args.fromMs, args.toMs, args.serviceId ?? ''] as const,
    queryFn: async (): Promise<BookingsRange> => {
      const constraints = [
        ...(args.serviceId ? [where('serviceId', '==', args.serviceId)] : []),
        where('startsAtMs', '>=', args.fromMs),
        where('startsAtMs', '<', args.toMs),
        orderBy('startsAtMs', 'asc'),
        limit(RANGE_READ_LIMIT),
      ]
      const snapshot = await getDocs(query(collection(context.firestore, 'hosts', context.hostId, 'bookings'), ...constraints))
      const nowMs = nowOf(context)
      return {
        rows: snapshot.docs.map((entry) => bookingRow(entry.id, entry.data(), nowMs)),
        truncated: snapshot.docs.length >= RANGE_READ_LIMIT,
      }
    },
  }
}

/** One booking, as its detail reads it. Null once it is gone. */
export function bookingQuery(context: BookingsMobileContext, bookingId: string) {
  return {
    queryKey: bookingsKeys.one(context.hostId, bookingId),
    queryFn: async (): Promise<BookingRow | null> => {
      const snapshot = await getDoc(doc(context.firestore, 'hosts', context.hostId, 'bookings', bookingId))
      return snapshot.exists() ? bookingRow(snapshot.id, snapshot.data(), nowOf(context)) : null
    },
  }
}

/** The days of open times a move offers per page, as the booking widget's strip. */
export const SLOT_PAGE_DAYS = 14

/**
 * Open times a booking could move to: the service's hours less every other
 * live booking of it, computed by the same pure walk the public booking
 * route uses. The route checks the chosen time again in its transaction.
 */
export function openSlotsQuery(
  context: BookingsMobileContext,
  args: { booking: Pick<BookingRow, 'id' | 'serviceId'>; service: HostBookingService | null; fromMs: number },
) {
  return {
    queryKey: [...bookingsKeys.one(context.hostId, args.booking.id), 'slots', args.fromMs] as const,
    queryFn: async (): Promise<{ slots: BookingSlot[]; nextFromMs: number | null }> => {
      if (!args.service) return { slots: [], nextFromMs: null }
      const nowMs = nowOf(context)
      const fromMs = Math.max(args.fromMs, nowMs)
      const toMs = fromMs + SLOT_PAGE_DAYS * 24 * 60 * 60_000
      const snapshot = await getDocs(
        query(
          collection(context.firestore, 'hosts', context.hostId, 'bookings'),
          where('serviceId', '==', args.booking.serviceId),
          where('startsAtMs', '>=', fromMs - 24 * 60 * 60_000),
          where('startsAtMs', '<', toMs),
          orderBy('startsAtMs', 'asc'),
          limit(RANGE_READ_LIMIT),
        ),
      )
      const booked: BookedInterval[] = snapshot.docs
        .filter((entry) => entry.id !== args.booking.id)
        .filter((entry) => {
          const state = bookingState(entry.data(), nowMs)
          return state === 'confirmed' || state === 'pendingPayment'
        })
        .map((entry) => ({ startsAtMs: Number(entry.data()['startsAtMs'] ?? 0), endsAtMs: Number(entry.data()['endsAtMs'] ?? 0) }))
      const page = computeOpenSlotPage(args.service, fromMs, toMs, booked)
      return { slots: page.slots, nextFromMs: page.nextFromMs }
    },
  }
}

export function setCheckedIn(
  context: BookingsMobileContext,
  bookingId: string,
  checkedIn: boolean,
): Promise<{ ok: true; checkedInAtMs: number | null }> {
  return context.api.request('/api/bookings/check-in', {
    method: 'POST',
    body: { hostId: context.hostId, bookingId, checkedIn },
  })
}

export function rescheduleBooking(
  context: BookingsMobileContext,
  bookingId: string,
  startsAtMs: number,
): Promise<{ ok: true; startsAtMs: number; endsAtMs: number; notified: boolean }> {
  return context.api.request('/api/bookings/reschedule', {
    method: 'POST',
    body: { hostId: context.hostId, bookingId, startsAtMs },
  })
}

/**
 * Cancels a booking. A paid one is refunded through the refund route, which
 * writes `canceled` itself once the money is back and leaves the booking
 * standing when the refund fails; a free one is canceled as the console's
 * own card cancels it.
 */
export async function cancelBooking(
  context: BookingsMobileContext,
  row: Pick<BookingRow, 'id' | 'actions'>,
  attemptKey: string = newAttemptKey('booking-cancel'),
): Promise<{ refundedCents: number }> {
  if (row.actions.refundCents > 0) {
    await context.api.request('/api/bookings/refund', {
      method: 'POST',
      body: { hostId: context.hostId, bookingId: row.id },
      idempotencyKey: attemptKey,
    })
    return { refundedCents: row.actions.refundCents }
  }
  await updateDoc(doc(context.firestore, 'hosts', context.hostId, 'bookings', row.id), { status: 'canceled' })
  return { refundedCents: 0 }
}

/** The public link a guest books a service at, or null for a site with no public address yet. */
export function serviceBookingLink(site: BookingsSite, serviceId: string): string | null {
  return bookingLinkFor({ site: site.site, service: { id: serviceId }, path: site.bookingPath })
}

/** Dollars as the site's money, for a refund line. */
export function formatUsd(centsValue: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(centsValue / 100)
}
