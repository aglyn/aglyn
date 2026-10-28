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
import { isHostPluginEnabled, type PluginApiHandler } from '@aglyn/aglyn/server'
import { zonedDayKey } from '@aglyn/shared-util-timestamp/zoned-time'
import { logHostActivity } from '@aglyn/tenant-data-admin'
import { BUNDLE_ID } from '../constants/bundle-common'
import {
  changedCheckInCustomerFields,
  checkInDayLabel,
  dueCheckInsForReservation,
  newCheckInDocument,
  reservationCheckInId,
  STAY_CHECK_IN_SETTINGS_DOC,
  stayCheckInPlan,
  storedStayCheckIns,
  type HostCheckIn,
} from '../model/commerce-check-in'
import {
  readStayCheckInMode,
  reservationGuests,
  reservationGuestsProblem,
  stayChecksInPerGuest,
  type HostReservation,
  type HostResource,
} from '../model/commerce-reservations'
import { reservationsOnPlan } from './reservation-availability-query'
import { bodyOf, gate, resolved, validId, type ProductsWriteDeps } from './products-write'
import { WALK_IN_PERMISSION, WALK_IN_PLAN_REFUSAL, WALK_IN_PLUGIN_OFF } from './reservation-walk-in'

/*
 * `POST /api/commerce/reservations/guests` (AGL-4043): staff change how many
 * guests a stay is for after it is booked — a family arrives with one more,
 * or one fewer.
 *
 *   Body: { hostId, reservationId, guests }
 *
 * `guests` is a whole number from 1 up to what the resource sleeps
 * (`resourceGuestCeiling`). Who may ask is who may book a walk-in: the same
 * gate (`products-write.ts`'s), asking "Book walk-ins and change guests"
 * (`commerce.walkIns`, AGL-4047) on the site, or staff, while nothing is
 * frozen; the commerce plugin on for the site; and the store's plan taking
 * reservations. A stay that is pending, confirmed or
 * checked in can change; one cancelled, a no-show or checked out cannot.
 *
 * WHEN THE STAY IS CHECKED IN ONE GUEST AT A TIME, its check-ins follow in
 * the same transaction, on today and every later day that already has them
 * (`stayCheckInPlan`): added guests get new waiting check-ins; removed guests
 * take away only waiting ones, never one already checked in. A count below
 * how many are checked in on one of those days is refused, and nothing is
 * written. A day with no check-ins yet is left to its own reconcile, which
 * reads the new count.
 *
 * Every change stamps who made it and when on the stay, and writes a line to
 * the site's activity log. Asking for the count the stay already has answers
 * `unchanged` and writes nothing, so a retried tap is harmless.
 */

export const RESERVATION_GUESTS_GONE = 'That stay is gone.'
export const RESERVATION_GUESTS_CLOSED =
  'Guests can change only on a stay that is booked or checked in'
/** A member who does not hold the key a guests change asks: the walk-in's refusal, naming it. */
export const RESERVATION_GUESTS_PERMISSION_REFUSAL = WALK_IN_PERMISSION.refusal

/** The most check-ins of one stay, from today on, the route reads in its transaction. */
export const RESERVATION_GUESTS_CHECK_IN_ROWS = 500

/** The statuses whose guests can change. */
const OPEN_STATUSES: ReadonlyArray<HostReservation['status']> = ['pending', 'confirmed', 'checked_in']

/** The refusal for a count below how many are already checked in on a day. */
export function guestsBelowCheckedInMessage(checkedIn: number, dayKey: string, todayKey: string): string {
  const when = dayKey === todayKey ? 'today' : `on ${checkInDayLabel(dayKey)}`
  return `${checkedIn} of this stay’s guests are already checked in ${when}. Undo a check-in first, or keep ${checkedIn} or more.`
}

export interface ReservationGuestsDeps extends ProductsWriteDeps {
  logActivity?: typeof logHostActivity
}

type Outcome =
  | {
      status: 200
      body: {
        reservationId: string
        guests: number
        previousGuests: number
        unchanged?: true
        checkIns?: { added: number; removed: number }
      }
      activity?: { previous: number; resourceName: string; arrivalDayMs: number }
    }
  | { status: 400 | 404 | 409; body: { error: string } }

export function createReservationGuestsHandler(options: ReservationGuestsDeps = {}): PluginApiHandler {
  return async (req, res) => {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }
    const deps = resolved(options)
    const logActivity = options.logActivity ?? logHostActivity
    const body = bodyOf(req)
    const hostId = body['hostId']
    const reservationId = body['reservationId']
    const rawGuests = body['guests']
    const guests = typeof rawGuests === 'number' || typeof rawGuests === 'string' ? Number(rawGuests) : NaN
    if (!validId(hostId) || !validId(reservationId) || rawGuests === undefined || rawGuests === null || rawGuests === '') {
      return res.status(400).json({ error: 'Missing guest details' })
    }
    try {
      const door = await gate(req, res, hostId, deps, { permission: WALK_IN_PERMISSION })
      if (!door) return
      if (!isHostPluginEnabled(door.org as never, door.host.data() as never, BUNDLE_ID)) {
        return res.status(403).json({ error: WALK_IN_PLUGIN_OFF })
      }
      if (!reservationsOnPlan(door.org)) {
        return res.status(403).json({ error: WALK_IN_PLAN_REFUSAL })
      }
      const db = deps.firestore()
      const hostRef = db.collection('hosts').doc(hostId)
      const reservationRef = hostRef.collection('reservations').doc(reservationId)
      const checkIns = hostRef.collection('checkIns')
      // Today on the store's calendar: earlier days are history, and stay
      // as they were checked in.
      const timeZone = resolveSiteTimeZone(
        door.org as { timeZone?: string },
        (door.host.data() ?? null) as { timeZone?: string } | null,
      )
      const todayKey = zonedDayKey(deps.now(), timeZone)

      const outcome: Outcome = await db.runTransaction(async (transaction) => {
        const stay = await transaction.get(reservationRef)
        if (!stay.exists) return { status: 404, body: { error: RESERVATION_GUESTS_GONE } }
        const reservation = stay.data() as HostReservation
        if (!OPEN_STATUSES.includes(reservation.status)) {
          return { status: 409, body: { error: RESERVATION_GUESTS_CLOSED } }
        }
        const resourceId = String(reservation.resourceId ?? '')
        const [resourceSnapshot, settings, stored] = await Promise.all([
          validId(resourceId) ? transaction.get(hostRef.collection('resources').doc(resourceId)) : null,
          transaction.get(hostRef.collection('settings').doc(STAY_CHECK_IN_SETTINGS_DOC)),
          transaction.get(
            checkIns
              .where('reservationId', '==', reservationId)
              .where('dayKey', '>=', todayKey)
              .limit(RESERVATION_GUESTS_CHECK_IN_ROWS),
          ),
        ])
        const resource = resourceSnapshot?.exists ? (resourceSnapshot.data() as HostResource) : null
        const problem = reservationGuestsProblem(guests, resource)
        if (problem) return { status: 400, body: { error: problem } }
        const previousGuests = reservationGuests(reservation)
        if (previousGuests === guests) {
          return { status: 200, body: { reservationId, guests, previousGuests, unchanged: true } }
        }

        // How the stay is checked in: the store's control, else the
        // resource's own setting; a resource gone since, once per stay.
        const mode = readStayCheckInMode(settings.exists ? settings.get('stays') : undefined)
        const perGuest = resource ? stayChecksInPerGuest(resource, mode) : mode === 'guest'
        const changed: HostReservation = { ...reservation, guests }
        const nowMs = deps.now()
        const byDay = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>()
        for (const doc of stored.docs) {
          const dayKey = String(doc.get('dayKey') ?? '')
          if (dayKey < todayKey) continue
          byDay.set(dayKey, [...(byDay.get(dayKey) ?? []), doc])
        }
        const creates: Array<{ ref: FirebaseFirestore.DocumentReference; data: HostCheckIn }> = []
        const drops: FirebaseFirestore.DocumentReference[] = []
        const patches: Array<{ ref: FirebaseFirestore.DocumentReference; patch: Record<string, unknown> }> = []
        for (const dayKey of [...byDay.keys()].sort()) {
          const docs = byDay.get(dayKey)!
          const existing = storedStayCheckIns(docs).get(reservationId) ?? []
          const due = dueCheckInsForReservation({
            reservationId,
            reservation: changed,
            resourceName: resource?.name ?? null,
            dayKey,
            perGuest,
            existing,
          })
          // A day the stay no longer covers is its own reconcile's to settle.
          if (!due.size) continue
          const plan = stayCheckInPlan({ unitCount: perGuest ? guests : 1, existing })
          if (perGuest && plan.checkedIn > guests) {
            return { status: 409, body: { error: guestsBelowCheckedInMessage(plan.checkedIn, dayKey, todayKey) } }
          }
          for (const place of plan.create) {
            const id = reservationCheckInId(reservationId, dayKey, place)
            const entry = due.get(id)
            if (entry) creates.push({ ref: checkIns.doc(id), data: newCheckInDocument(entry, nowMs) })
          }
          const dropped = new Set(plan.drop)
          for (const doc of docs) {
            if (dropped.has(doc.id)) {
              drops.push(doc.ref)
              continue
            }
            const entry = due.get(doc.id)
            if (!entry) continue
            const storedRow = doc.data() as Partial<HostCheckIn>
            // A guest already checked in keeps everything but the count of
            // the stay's check-ins, which the list reads as "2 of 3".
            const patch =
              storedRow.status === 'checked_in'
                ? storedRow.unitCount !== entry.unitCount
                  ? { unitCount: entry.unitCount }
                  : null
                : changedCheckInCustomerFields(storedRow, entry)
            if (patch) patches.push({ ref: doc.ref, patch: { ...patch, updatedAtMs: nowMs } })
          }
        }
        transaction.update(reservationRef, {
          guests,
          guestsChangedAtMs: nowMs,
          guestsChangedBy: door.uid,
        })
        for (const write of creates) transaction.create(write.ref, write.data)
        for (const ref of drops) transaction.delete(ref)
        for (const write of patches) transaction.update(write.ref, write.patch)
        return {
          status: 200,
          body: {
            reservationId,
            guests,
            previousGuests,
            checkIns: { added: creates.length, removed: drops.length },
          },
          activity: {
            previous: previousGuests,
            resourceName: resource?.name ?? '',
            arrivalDayMs: Number(reservation.checkInDayMs) || 0,
          },
        }
      })

      if (outcome.status === 200 && 'activity' in outcome && outcome.activity) {
        const { previous, resourceName, arrivalDayMs } = outcome.activity
        const arrival = arrivalDayMs ? new Date(arrivalDayMs).toISOString().slice(0, 10) : ''
        await logActivity(
          hostId,
          { uid: door.uid, email: door.email },
          `Changed a stay’s guests from ${previous} to ${guests}`,
          {
            type: 'commerce:reservation',
            id: reservationId,
            name: [resourceName || 'Stay', arrival].filter(Boolean).join(' · '),
          },
        )
      }
      return res.status(outcome.status).json(outcome.body)
    } catch (error) {
      console.error('Changing a stay’s guests failed', error)
      return res.status(500).json({ error: 'The guests could not be changed. Try again.' })
    }
  }
}

export const reservationGuestsHandler = createReservationGuestsHandler()
