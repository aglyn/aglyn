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
import type { PluginApiHandler, PluginApiRequest } from '@aglyn/aglyn/app-utils/api-plugins'
import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import {
  firebaseAdmin,
  getOrgForHost,
  hostSendingIdentity,
  meterHostEmail,
  renderHostEmailWithTokens,
} from '@aglyn/tenant-data-admin'
import { getSiteLockdown } from '@aglyn/tenant-data-admin/server/tenant-write-lockdown'
import { resolveBrandingProfile } from '@aglyn/aglyn/server'
import {
  bookingDurationMs,
  checkInRefusal,
  type ManagedBooking,
  rescheduleRefusal,
} from '../model/booking-manage'
import { type BookedInterval, type HostBookingService, isSlotOpen } from '../model/bookings'
import { bookingTimeZone, formatBookingWhen, storedBookingTimeZone } from '../model/booking-time'

/*
 * Checking a guest in and moving a booking (AGL-3621), for the site's team.
 *
 * The Aglyn app's bookings calendar calls these; any console surface may
 * too. Each is a member route: the caller's ID token names them, the host's `memberRoles`
 * must give them a content-writing role (the same roles the rules let write
 * a booking directly), and a locked-down site refuses. Each decides inside
 * ONE transaction, re-reading the booking, so two phones acting at once
 * cannot both move it or check in a guest whose booking was just canceled.
 *
 * Moving a booking re-checks the new slot against the service's hours and
 * every other live booking of that service in the same transaction the
 * public booking route uses, so a move can never double-book. It keeps the
 * booking's own length, clears the reminder stamp so the 24-hour reminder
 * goes out for the new time, and tells the guest by email.
 */

/** The Firestore surface these routes use: the Admin SDK's, narrowed so a spec can hand in a double. */
export interface ManageDocSnapshot {
  readonly exists: boolean
  readonly id?: string
  get(field: string): unknown
  data(): Record<string, unknown> | undefined
}
export interface ManageDocRef {
  readonly id: string
}
export interface ManageQuery {
  where(field: string, op: '==' | '>=' | '<', value: unknown): ManageQuery
  limit(count: number): ManageQuery
}
export interface ManageTransaction {
  get(ref: ManageDocRef): Promise<ManageDocSnapshot>
  get(query: ManageQuery): Promise<{ docs: ManageDocSnapshot[] }>
  update(ref: ManageDocRef, data: Record<string, unknown>): unknown
}
export interface ManageFirestore {
  doc(path: string): ManageDocRef & { get(): Promise<ManageDocSnapshot> }
  collection(path: string): ManageQuery
  runTransaction<T>(fn: (transaction: ManageTransaction) => Promise<T>): Promise<T>
}

export interface RescheduleNotice {
  hostId: string
  bookingId: string
  to: string
  name: string
  serviceName: string
  when: string
  previousWhen: string
  timezone: string
}

export interface BookingManageDeps {
  firestore: () => ManageFirestore
  verifyIdToken: (token: string) => Promise<{ uid: string }>
  /** True when the site is locked down and must not take writes. */
  siteLocked: (hostId: string) => Promise<boolean>
  /** The zone a booking is told in when the document carries none. */
  timeZoneFor: (hostId: string, service: HostBookingService | undefined) => Promise<string>
  notifyRescheduled: (notice: RescheduleNotice) => Promise<void>
  now: () => number
}

/** Field the booking stamps when the guest arrives. */
export const CHECKED_IN_AT = 'checkedInAtMs'
export const CHECKED_IN_BY = 'checkedInBy'

class Refusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const bearerOf = (req: PluginApiRequest): string => {
  const header = String(req.headers['authorization'] ?? req.headers['Authorization'] ?? '')
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
}

const bodyOf = (req: PluginApiRequest): Record<string, unknown> => {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  return (req.body ?? {}) as Record<string, unknown>
}

/** The member, their right to write this site's bookings, and the site being open. */
async function authorize(
  deps: BookingManageDeps,
  req: PluginApiRequest,
  hostId: string,
): Promise<{ uid: string }> {
  const token = bearerOf(req)
  if (!token) throw new Refusal(401, 'Unauthenticated')
  let uid: string
  try {
    uid = (await deps.verifyIdToken(token)).uid
  } catch {
    throw new Refusal(401, 'Unauthenticated')
  }
  const host = await deps.firestore().doc(`hosts/${hostId}`).get()
  if (!host.exists) throw new Refusal(404, 'Unknown site')
  const role = ((host.get('memberRoles') ?? {}) as Record<string, unknown>)[uid]
  if (!hostRoleCanWrite(role)) throw new Refusal(403, 'Your role on this site cannot change bookings')
  if (await deps.siteLocked(hostId)) throw new Refusal(423, 'This site is locked and cannot take changes right now')
  return { uid }
}

function answer(res: Parameters<PluginApiHandler>[1], error: unknown): void {
  if (error instanceof Refusal) {
    res.status(error.status).json({ error: error.message })
    return
  }
  console.error('[bookings/manage]', error)
  res.status(500).json({ error: 'That did not go through. Try again.' })
}

export function createBookingCheckInHandler(deps: BookingManageDeps): PluginApiHandler {
  return async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const body = bodyOf(req)
    const hostId = String(body['hostId'] ?? '')
    const bookingId = String(body['bookingId'] ?? '')
    const checkedIn = body['checkedIn'] !== false
    if (!hostId || !bookingId) return res.status(400).json({ error: 'Missing hostId or bookingId' })
    try {
      const { uid } = await authorize(deps, req, hostId)
      const firestore = deps.firestore()
      const ref = firestore.doc(`hosts/${hostId}/bookings/${bookingId}`)
      const result = await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists) throw new Refusal(404, 'Unknown booking')
        const booking = (snapshot.data() ?? {}) as ManagedBooking
        const nowMs = deps.now()
        const refusal = checkInRefusal(booking, checkedIn, nowMs)
        if (refusal) throw new Refusal(409, refusal)
        const already = Number(booking.checkedInAtMs ?? 0) > 0
        // Already where it was asked to be: a retried tap changes nothing.
        if (already === checkedIn) return { checkedInAtMs: already ? Number(booking.checkedInAtMs) : null }
        if (checkedIn) {
          transaction.update(ref, { [CHECKED_IN_AT]: nowMs, [CHECKED_IN_BY]: uid })
          return { checkedInAtMs: nowMs }
        }
        transaction.update(ref, { [CHECKED_IN_AT]: null, [CHECKED_IN_BY]: null })
        return { checkedInAtMs: null }
      })
      return res.status(200).json({ ok: true, ...result })
    } catch (error) {
      return answer(res, error)
    }
  }
}

export function createBookingRescheduleHandler(deps: BookingManageDeps): PluginApiHandler {
  return async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const body = bodyOf(req)
    const hostId = String(body['hostId'] ?? '')
    const bookingId = String(body['bookingId'] ?? '')
    const startsAtMs = Number(body['startsAtMs'])
    if (!hostId || !bookingId) return res.status(400).json({ error: 'Missing hostId or bookingId' })
    if (!Number.isFinite(startsAtMs) || startsAtMs <= 0) return res.status(400).json({ error: 'Pick a new time' })
    try {
      const { uid } = await authorize(deps, req, hostId)
      const firestore = deps.firestore()
      const ref = firestore.doc(`hosts/${hostId}/bookings/${bookingId}`)
      const first = await ref.get()
      if (!first.exists) throw new Refusal(404, 'Unknown booking')
      const serviceId = String(first.get('serviceId') ?? '')
      const serviceSnapshot = serviceId ? await firestore.doc(`hosts/${hostId}/services/${serviceId}`).get() : null
      const service = serviceSnapshot?.exists ? (serviceSnapshot.data() as HostBookingService) : undefined
      if (!service || serviceSnapshot?.get('deletedAt')) {
        throw new Refusal(409, 'This booking’s service no longer exists, so it cannot move')
      }

      const moved = await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists) throw new Refusal(404, 'Unknown booking')
        const booking = (snapshot.data() ?? {}) as ManagedBooking & Record<string, unknown>
        const nowMs = deps.now()
        const refusal = rescheduleRefusal(booking, startsAtMs, nowMs)
        if (refusal) throw new Refusal(409, refusal)
        const previousStartsAtMs = Number(booking.startsAtMs ?? 0)
        // Already at that time: a retried move writes nothing and tells no one twice.
        if (previousStartsAtMs === startsAtMs) return null
        const durationMs = bookingDurationMs(booking, service.durationMinutes)
        // The public booking route's own read: every booking of this service
        // from a day before the new time, so one running into it counts.
        const nearby = await transaction.get(
          firestore
            .collection(`hosts/${hostId}/bookings`)
            .where('serviceId', '==', serviceId)
            .where('startsAtMs', '>=', startsAtMs - 24 * 60 * 60_000)
            .limit(500),
        )
        const booked: BookedInterval[] = nearby.docs
          .filter((doc) => doc.id !== bookingId)
          .filter((doc) => {
            const status = doc.get('status')
            if (status === 'canceled') return false
            return !(status === 'pendingPayment' && Number(doc.get('expiresAtMs') ?? 0) < nowMs)
          })
          .map((doc) => ({ startsAtMs: Number(doc.get('startsAtMs') ?? 0), endsAtMs: Number(doc.get('endsAtMs') ?? 0) }))
        if (!isSlotOpen(service, startsAtMs, booked)) throw new Refusal(409, 'That time is not open. Pick another.')
        const endsAtMs = startsAtMs + durationMs
        transaction.update(ref, {
          startsAtMs,
          endsAtMs,
          rescheduledAtMs: nowMs,
          rescheduledBy: uid,
          rescheduledFromMs: previousStartsAtMs,
          // The reminder is owed again, for the new time.
          reminderSentAt: null,
        })
        return { booking, previousStartsAtMs, endsAtMs }
      })

      if (!moved) {
        return res.status(200).json({ ok: true, startsAtMs, endsAtMs: Number(first.get('endsAtMs') ?? 0), notified: false })
      }
      const to = String(moved.booking['email'] ?? '').trim()
      let notified = false
      if (to) {
        const timezone = storedBookingTimeZone(moved.booking) ?? (await deps.timeZoneFor(hostId, service))
        try {
          await deps.notifyRescheduled({
            hostId,
            bookingId,
            to,
            name: String(moved.booking['name'] ?? ''),
            serviceName: String(moved.booking['serviceName'] ?? service.name ?? ''),
            when: formatBookingWhen(startsAtMs, timezone),
            previousWhen: formatBookingWhen(moved.previousStartsAtMs, timezone),
            timezone,
          })
          notified = true
        } catch (error) {
          // The booking has moved whatever the mail did; the screen says the guest was not told.
          console.error('[bookings/reschedule] notice failed', hostId, bookingId, error)
        }
      }
      return res.status(200).json({ ok: true, startsAtMs, endsAtMs: moved.endsAtMs, notified })
    } catch (error) {
      return answer(res, error)
    }
  }
}

/** The email that tells a guest their booking moved, as the confirmation is sent. */
export async function sendRescheduledNotice(notice: RescheduleNotice): Promise<void> {
  if (!isEmailConfigured()) throw new Error('Email is not configured')
  const firestore = firebaseAdmin.app().firestore()
  const fallbackText =
    `Hi ${notice.name},\n\nYour booking for "${notice.serviceName}" is now on ` +
    `${notice.when} (${notice.timezone}). It was on ${notice.previousWhen}.\n\n` +
    `Reference: ${notice.bookingId}`
  const designed = await renderHostEmailWithTokens(firestore, notice.hostId, 'booking-rescheduled', {
    name: notice.name,
    'service.name': notice.serviceName,
    when: notice.when,
    previousWhen: notice.previousWhen,
    timezone: notice.timezone,
    'booking.ref': notice.bookingId,
  })
  const branding = resolveBrandingProfile((await getOrgForHost(notice.hostId).catch(() => null))?.org as never)
  await sendEmail({
    to: notice.to,
    subject: designed?.subject ?? `New time for ${notice.serviceName}`,
    text: designed?.text || fallbackText,
    ...(designed?.html ? { html: designed.html } : {}),
    fromName: branding.fromName,
    sendingIdentity: await hostSendingIdentity(notice.hostId),
    audience: 'tenant',
    context: 'booking rescheduled',
    owedFor: 'booking',
  })
  await meterHostEmail(notice.hostId)
}

/** The production wiring: the Admin SDK, the site lockdown verdict and the real send. */
export function bookingManageDeps(): BookingManageDeps {
  return {
    firestore: () => firebaseAdmin.app().firestore() as unknown as ManageFirestore,
    verifyIdToken: (token) => firebaseAdmin.app().auth().verifyIdToken(token),
    siteLocked: async (hostId) => Boolean(await getSiteLockdown(hostId)),
    timeZoneFor: async (hostId, service) => {
      const firestore = firebaseAdmin.app().firestore()
      const [host, owner] = await Promise.all([
        firestore.collection('hosts').doc(hostId).get(),
        getOrgForHost(hostId).catch(() => null),
      ])
      return bookingTimeZone({
        service: service ?? null,
        host: host.data() as { timeZone?: string } | undefined,
        org: owner?.org as { timeZone?: string } | null | undefined,
      })
    },
    notifyRescheduled: sendRescheduledNotice,
    now: () => Date.now(),
  }
}
