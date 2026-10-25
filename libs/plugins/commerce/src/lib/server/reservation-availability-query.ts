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

import type * as CommerceModel from '../model'

/*
 * The availability read a booking is checked against, shared by the two
 * doors that write a stay under a transaction: the storefront's
 * `/api/commerce/reserve` and the staff walk-in (AGL-4046). One copy, so the
 * two cannot drift into answering "is this room free?" differently. The
 * reasoning behind the query's shape (the inequality that drops the past, the
 * ordering that decides what survives the 500 cap, the composite index it
 * needs) is written beside its first use in `reserve.ts`.
 */

/** The query's minimal shape, which the Admin SDK and spec doubles share. */
interface QueryLike {
  where(field: string, op: string, value: unknown): QueryLike
  orderBy(field: string): QueryLike
  limit(count: number): QueryLike
}

/** Every stay of one resource that ends after `checkInDayMs`, nearest first. */
export function reservationAvailabilityQuery<Q extends QueryLike>(
  reservations: Q,
  resourceId: string,
  checkInDayMs: number,
): Q {
  return reservations
    .where('resourceId', '==', resourceId)
    .where('checkOutDayMs', '>', checkInDayMs)
    .orderBy('checkOutDayMs')
    .limit(500) as Q
}

/**
 * The fields `isRangeAvailable` reads, off the query's documents.
 * `createdAtMs` matters: a `pending` hold lapses on it.
 */
export function readLiveReservations(snapshot: {
  docs: Array<{ get(field: string): unknown }>
}): CommerceModel.HostReservation[] {
  return snapshot.docs.map((docSnapshot) => ({
    checkInDayMs: Number(docSnapshot.get('checkInDayMs')),
    checkOutDayMs: Number(docSnapshot.get('checkOutDayMs')),
    status: String(docSnapshot.get('status')) as CommerceModel.ReservationStatus,
    createdAtMs: Number(docSnapshot.get('createdAtMs') ?? 0),
  })) as CommerceModel.HostReservation[]
}
