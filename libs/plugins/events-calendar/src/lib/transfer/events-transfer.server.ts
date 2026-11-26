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
import { transferPlanRequired } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { isServerReleaseFlagOnForOrg } from '@aglyn/tenant-data-admin/server/release-flags'
import { TransferPlanRefusedError } from '@aglyn/tenant-data-admin/server/transfer-jobs'
import { EVENT_CATEGORIES_COLLECTION } from '../model/event-categories'
import {
  createEventsTransferResource,
  type EventsTransferResource,
} from './events-transfer'

/**
 * The `events` resource over the Admin SDK. Loaded by the console-server
 * declarations with the first hook a transfer calls, never at boot: this
 * module is what brings the transfer core, the Admin SDK and the plan table,
 * so the declarations import it lazily and import no other library lazily —
 * a lazy import of a library would make every static import of it, across
 * the plugin and the apps, a module boundary error.
 */
export function adminEventsTransferResource(): EventsTransferResource {
  const firestore = firebaseAdmin.app().firestore()
  return createEventsTransferResource({
    firestore,
    deleteField: () => firebaseAdmin.firestore.FieldValue.delete(),
    timestamp: (ms) => firebaseAdmin.firestore.Timestamp.fromMillis(ms),
    // The add-on the Events page is gated on, read the way the public
    // listing reads it: from the workspace's own document, and refused in
    // the transfer gate's own words (AGL-3548).
    requireEntitled: async (orgId) => {
      const org = await firestore.collection('orgs').doc(orgId).get()
      if (checkEntitlement(org.exists ? (org.data() as never) : null, 'eventCalendar')) return
      throw new TransferPlanRefusedError(transferPlanRequired('eventCalendar', 'Events', 'import'))
    },
    // Calendar v2's columns (AGL-4252), where the workspace has it.
    calendarV2: (orgId) => isServerReleaseFlagOnForOrg('release_events_calendar_v2', orgId),
    readCategories: async (hostId) => {
      const snapshot = await firestore
        .collection('hosts')
        .doc(hostId)
        .collection(EVENT_CATEGORIES_COLLECTION)
        .limit(100)
        .get()
      return snapshot.docs
        .map((doc) => [doc.id, String(doc.get('name') ?? '').trim()] as [string, string])
        .filter(([, name]) => Boolean(name))
    },
  })
}
