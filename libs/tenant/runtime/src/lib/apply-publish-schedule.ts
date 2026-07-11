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

import type * as Aglyn from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * Lazy scheduled-publishing executor (AGL-61): if the doc carries a pending
 * `publishSchedule` whose time has passed, flip the `versionId` pointer and
 * mark the schedule applied. Runs during ISR revalidation, so a schedule
 * takes effect on the first regeneration after its time (within the
 * revalidate window) — no dedicated cron needed. Returns the effective
 * versionId; fail-open on write errors (the pointer flips next revalidate).
 */
export async function applyDuePublishSchedule(options: {
  hostId: Aglyn.HostUid
  collectionName: 'screens' | 'layouts'
  docId: string
  parent: Pick<Aglyn.AglynScreen, 'versionId' | 'publishSchedule'>
}): Promise<Aglyn.VersionUid | undefined> {
  const { hostId, collectionName, docId, parent } = options
  const schedule = parent.publishSchedule
  const publishAtMs = (schedule?.publishAt?.seconds ?? 0) * 1000
  if (schedule?.status !== 'pending' || publishAtMs > Date.now()) {
    return parent.versionId
  }

  // Scheduled unpublish (AGL-113, screens only): drop the routing-map entry
  // so the path 404s on the next revalidate. This render still serves the
  // current version — the map is matched before this runs.
  if (schedule.action === 'unpublish') {
    if (collectionName === 'screens') {
      try {
        const firestore = firebaseAdmin.app().firestore()
        const hostRef = firestore.collection('hosts').doc(hostId)
        await Promise.all([
          hostRef.update({
            [`screens.${docId}`]: FieldValue.delete(),
          }),
          hostRef.collection(collectionName).doc(docId).update({
            'publishSchedule.status': 'applied',
          }),
        ])
      } catch (error) {
        console.error(error)
      }
    }
    return parent.versionId
  }

  if (!schedule.versionId) return parent.versionId

  try {
    await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .collection(collectionName)
      .doc(docId)
      .update({
        versionId: schedule.versionId,
        'publishSchedule.status': 'applied',
      })
  } catch (error) {
    console.error(error)
  }
  // Serve the scheduled version for this render either way — the schedule
  // is due, and the write (or its retry next revalidate) makes it durable.
  return schedule.versionId
}

export default applyDuePublishSchedule
