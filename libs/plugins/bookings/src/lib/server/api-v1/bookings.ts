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
import { ApiErrors, apiJson, listResponse } from '@aglyn/tenant-data-admin'
import {
  type ApiV1Context,
  paginate,
  requireScope,
} from '@aglyn/tenant-data-admin/server/api-v1-kit'
import { bookingViewFromData } from '../../model/booking-view'

/**
 * A site's bookings on the customer REST API,
 * `/v1/sites/{siteId}/bookings/…` (AGL-3643). Registered from this plugin's
 * console server declarations; the console's `/v1` router owns the pipeline
 * in front — the key, the plan's API access, the request quota, the rate
 * limit — and refuses a site the key's organization does not own before it
 * hands a request here.
 *
 * Read-only: `bookings:read`, and the `bookings` plan feature. The scope is
 * asked first and the plan second, the order every commerce resource asks
 * them in (AGL-900), so a key without the scope is told about the scope
 * whatever plan its organization is on.
 */

/** The statuses a booking is stored with, and so the ones `?status=` takes. */
export const BOOKING_LIST_STATUSES = ['confirmed', 'pendingPayment', 'canceled'] as const

function requireBookings(ctx: ApiV1Context): Response | null {
  return checkEntitlement(ctx.org, 'bookings')
    ? null
    : ApiErrors.planRequired({
        message: 'Bookings are not included in this organization’s plan',
        code: 'bookings',
        headers: ctx.headers,
      })
}

export async function handleBookings(
  request: Request,
  ctx: ApiV1Context,
  segments: string[],
  url: URL,
): Promise<Response> {
  const [, hostId, , bookingId, extra] = segments
  const denied = requireScope(ctx, 'bookings:read')
  if (denied) return denied
  const unentitled = requireBookings(ctx)
  if (unentitled) return unentitled
  if (request.method !== 'GET') {
    return ApiErrors.methodNotAllowed({ headers: { ...ctx.headers, Allow: 'GET' } })
  }
  if (extra !== undefined) {
    return ApiErrors.notFound({ message: 'Unknown endpoint', headers: ctx.headers })
  }
  const collection = ctx.firestore.collection('hosts').doc(hostId).collection('bookings')
  const nowMs = Date.now()

  if (bookingId) {
    const snapshot = await collection.doc(bookingId).get()
    if (!snapshot.exists) {
      return ApiErrors.notFound({ message: 'No such booking', headers: ctx.headers })
    }
    return apiJson(bookingViewFromData(snapshot.id, snapshot.data() ?? {}, nowMs), { headers: ctx.headers })
  }

  let query: FirebaseFirestore.Query = collection
  const status = url.searchParams.get('status')
  if (status !== null) {
    if (!(BOOKING_LIST_STATUSES as readonly string[]).includes(status)) {
      return ApiErrors.badRequest({
        message: 'Unknown booking status',
        code: 'validation_failed',
        fields: { status: `Must be one of: ${BOOKING_LIST_STATUSES.join(', ')}` },
        headers: ctx.headers,
      })
    }
    query = query.where('status', '==', status)
  }
  const serviceId = url.searchParams.get('serviceId')
  if (serviceId) query = query.where('serviceId', '==', serviceId)
  const { docs, nextCursor } = await paginate(query, url)
  return listResponse(
    docs.map((doc) => bookingViewFromData(doc.id, doc.data() ?? {}, nowMs)),
    nextCursor,
    ctx.headers,
  )
}
