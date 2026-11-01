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
'use client'

import { CRM_COLLECTIONS } from '@aglyn/aglyn'
import { doc, type Firestore, getDoc } from 'firebase/firestore'
import type { CrmActivityRecordReads } from '../model/crm-activity-link'

/**
 * How long a save waits on one record. A durable console tab reads through
 * whichever tab holds the lease, and a hidden tab wakes once a minute, so an
 * unbounded read could hold the **Log** button that long (AGL-3806) for what
 * is bookkeeping beside the entry.
 */
const READ_DEADLINE_MS = 4_000

function withinDeadline<T>(read: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), READ_DEADLINE_MS)
  })
  return Promise.race([read, deadline]).finally(() => clearTimeout(timer))
}

/**
 * The client's reads for the activity rollup (AGL-4123), `orgs/{orgId}/…` by
 * id. A record the rules refuse this reader rejects here, and the rollup
 * treats that as a record that names no company.
 */
export function crmActivityClientReads(
  firestore: Firestore,
  orgId: string,
): CrmActivityRecordReads {
  const read = async (collection: string, id: string) => {
    const snapshot = await withinDeadline(getDoc(doc(firestore, 'orgs', orgId, collection, id)))
    return snapshot?.exists() ? (snapshot.data() as Record<string, unknown>) : null
  }
  return {
    deal: (id) => read(CRM_COLLECTIONS.deals, id),
    contact: (id) => read('contacts', id),
  }
}
