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

import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { isHostPluginEnabled, type PluginApiHandler } from '@aglyn/aglyn/server'
import { BUNDLE_ID } from '../constants/bundle-common'
import * as CommerceModel from '../model'
import {
  readLiveReservations,
  reservationAvailabilityQuery,
} from './reservation-availability-query'
import { bodyOf, gate, resolved, validId, type ProductsWriteDeps } from './products-write'

/*
 * `POST /api/commerce/reservations/walk-in` (AGL-4046): a staff walk-in,
 * race-safe.
 *
 * The console Reservations card and the native apps used to write a walk-in
 * straight from the client after their own availability read. Two staff on two
 * devices could both read the last free unit (the last RV hookup) and both
 * write a stay into it. This route re-asks availability INSIDE the transaction
 * that writes, on the same query and the same `isRangeAvailable` rule the
 * storefront's `/api/commerce/reserve` uses, so the loser's transaction re-runs
 * on the winner's write and is refused.
 *
 * Who may call it is who the Firestore rules let write a reservation from the
 * console: a verified member with a content-write role on the site
 * (`canWriteHostContent`: admin, editor, author), or staff, while the site,
 * its org and the platform are not frozen. That is `products-write.ts`'s
 * `gate`, reused rather than restated. The commerce plugin must also be on for
 * the site.
 *
 * The stay is written with exactly the fields the card wrote: confirmed, no
 * email, no deposit, nothing paid. Payment is collected at the register.
 */

export const WALK_IN_GONE = 'That resource is gone.'
export const WALK_IN_TAKEN_ONE_UNIT = 'Those dates are taken'
export const WALK_IN_TAKEN_EVERY_UNIT =
  'Every unit is taken on at least one of those nights'
export const WALK_IN_PLUGIN_OFF = 'Reservations are not turned on for this site'
export const WALK_IN_ID_CONFLICT = 'That walk-in id belongs to another stay'

/** The refusal for dates with no free unit, worded for the resource. */
export function walkInTakenMessage(resource: CommerceModel.HostResource): string {
  return CommerceModel.resourceUnits(resource) > 1
    ? WALK_IN_TAKEN_EVERY_UNIT
    : WALK_IN_TAKEN_ONE_UNIT
}

const dayOf = (value: unknown): number => {
  const ms = Number(value)
  return Number.isFinite(ms) && ms > 0 ? CommerceModel.toDayMs(ms) : 0
}

type Outcome =
  | { status: 200; body: { reservationId: string; replayed?: true } }
  | { status: 409; body: { error: string } }

export function createReservationWalkInHandler(
  options: ProductsWriteDeps = {},
): PluginApiHandler {
  return async (req, res) => {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }
    const deps = resolved(options)
    const body = bodyOf(req)
    const hostId = body['hostId']
    const resourceId = body['resourceId']
    const checkInDayMs = dayOf(body['checkInDayMs'])
    const checkOutDayMs = dayOf(body['checkOutDayMs'])
    const guestName =
      typeof body['guestName'] === 'string'
        ? body['guestName'].trim().slice(0, 120)
        : ''
    // Optional, client-minted: a retry of the same walk-in (a dropped
    // response on a weak signal) finds its own stay instead of booking a
    // second unit.
    const requestedId = body['reservationId']
    if (
      !validId(hostId) ||
      !validId(resourceId) ||
      !checkInDayMs ||
      !checkOutDayMs ||
      (requestedId !== undefined && requestedId !== null && !validId(requestedId))
    ) {
      return res.status(400).json({ error: 'Missing walk-in details' })
    }
    try {
      const door = await gate(req, res, hostId, deps)
      if (!door) return
      if (!isHostPluginEnabled(door.org as never, door.host.data() as never, BUNDLE_ID)) {
        return res.status(403).json({ error: WALK_IN_PLUGIN_OFF })
      }
      const db = deps.firestore()
      const hostRef = db.collection('hosts').doc(hostId)
      const resourceSnapshot = await hostRef.collection('resources').doc(resourceId).get()
      const resource = resourceSnapshot.data() as CommerceModel.HostResource | undefined
      if (!resourceSnapshot.exists || !resource) {
        return res.status(404).json({ error: WALK_IN_GONE })
      }
      // The one rule for what can be booked (no nights, under the minimum
      // stay), shared with the card, the widget and both native apps.
      const quote = CommerceModel.computeReservationQuote(resource, checkInDayMs, checkOutDayMs)
      if (quote.problem) return res.status(400).json({ error: quote.problem })

      const reservations = hostRef.collection('reservations')
      const availability = reservationAvailabilityQuery(reservations, resourceId, checkInDayMs)
      const reservationRef = reservations.doc(
        typeof requestedId === 'string' ? requestedId : createResourceUid(),
      )
      const outcome: Outcome = await db.runTransaction(async (transaction) => {
        const [existing, fresh] = await Promise.all([
          transaction.get(reservationRef),
          transaction.get(availability),
        ])
        if (existing.exists) {
          const same =
            existing.get('resourceId') === resourceId &&
            Number(existing.get('checkInDayMs')) === checkInDayMs &&
            Number(existing.get('checkOutDayMs')) === checkOutDayMs
          return same
            ? { status: 200, body: { reservationId: reservationRef.id, replayed: true } }
            : { status: 409, body: { error: WALK_IN_ID_CONFLICT } }
        }
        // Re-timed inside the transaction: a retry under contention runs
        // later, and a pending hold's 30-minute lapse is measured from now.
        const nowMs = deps.now()
        if (
          !CommerceModel.isRangeAvailable(
            resource,
            readLiveReservations(fresh),
            checkInDayMs,
            checkOutDayMs,
            nowMs,
          )
        ) {
          return { status: 409, body: { error: walkInTakenMessage(resource) } }
        }
        transaction.set(reservationRef, {
          resourceId,
          status: 'confirmed',
          checkInDayMs,
          checkOutDayMs,
          guestName: guestName || null,
          guestEmail: null,
          nights: quote.nights,
          totalCents: quote.totalCents,
          depositCents: 0,
          paidCents: 0,
          createdAtMs: nowMs,
        } satisfies CommerceModel.HostReservation)
        return { status: 200, body: { reservationId: reservationRef.id } }
      })
      return res.status(outcome.status).json(outcome.body)
    } catch (error) {
      console.error('Walk-in reservation failed', error)
      return res.status(500).json({ error: 'Walk-in failed' })
    }
  }
}

export const reservationWalkInHandler = createReservationWalkInHandler()
