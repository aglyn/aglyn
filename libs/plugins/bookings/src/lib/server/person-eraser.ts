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
  PluginPersonEraser,
  PluginPersonErasureReport,
} from '@aglyn/aglyn/plugin-manager/plugin-person-erasure'
import { updateWhereEquals } from '@aglyn/tenant-data-admin/server/paged-sweeps'
import { FieldValue } from 'firebase-admin/firestore'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'

/**
 * BOOKINGS' SHARE OF A PERSON ERASURE (AGL-2623, AGL-3080).
 *
 * A booking is the merchant's record of an appointment, kept as a record of
 * what was sold and when. So the person is taken OFF every booking they made
 * on a site of the workspace — their address, name and phone — and a stamp
 * says when; the booking itself, its service and its time stay.
 *
 * A DRY RUN counts the bookings and writes nothing.
 */

type Firestore = FirebaseFirestore.Firestore

export interface BookingsPersonEraserDeps {
  firestore(): Firestore
}

const LABEL = 'bookings person eraser'

export function createBookingsPersonEraser(deps: BookingsPersonEraserDeps): PluginPersonEraser {
  return async ({ orgId, email, dryRun, atMs }): Promise<PluginPersonErasureReport> => {
    const db = deps.firestore()
    const hosts = await db.collection('hosts').where('orgId', '==', orgId).get()
    let bookings = 0
    for (const host of hosts.docs) {
      const made = host.ref.collection('bookings')
      if (dryRun) {
        bookings += (await made.where('email', '==', email).get()).size
        continue
      }
      bookings += await updateWhereEquals(
        db,
        made,
        'email',
        email,
        {
          email: null,
          name: FieldValue.delete(),
          phone: FieldValue.delete(),
          customerErasedAtMs: atMs,
        },
        LABEL,
      )
    }
    return { bookings }
  }
}

/** The eraser over the platform's own Firestore, as the declarations register it. */
export const bookingsPersonEraser: PluginPersonEraser = (request) =>
  createBookingsPersonEraser({ firestore: () => firebaseAdmin.app().firestore() })(request)
