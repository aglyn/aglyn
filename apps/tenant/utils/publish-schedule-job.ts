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

import { registerPluginJob, screenRoutePathToUrl } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { tenantDataTag } from '@aglyn/tenant-data-admin/render-cache'
import applyDuePublishSchedule from '@aglyn/tenant-runtime/apply-publish-schedule'
import { revalidatePath, revalidateTag } from 'next/cache'
import { readDueSchedules } from './publish-schedule-next-due'

/**
 * Apply due publish schedules on a beat, instead of waiting for a visitor
 * (AGL-1159).
 *
 * `applyDuePublishSchedule` is LAZY: it runs during ISR revalidation, so a
 * schedule takes effect on the first regeneration after its time. That made
 * scheduled publishing structurally bound to the revalidate window — a publish
 * set for 09:00 goes live whenever the window next expires and somebody
 * happens to visit. It also blocked AGL-1150's actual load-time win, because
 * lengthening the window would make scheduled publishes proportionally later.
 *
 * This runs the same executor on a schedule and then drops the page's cache,
 * so the publish lands at its time regardless of the window. The lazy path
 * stays exactly as it was and remains the backstop: if the beat is down, a
 * schedule still applies on the next natural regeneration, which is the
 * behaviour we had before.
 *
 * SCREENS ONLY, deliberately. A layout's affected URLs are the whole nested
 * layout→screen graph, and applying a layout schedule here without dropping
 * every one of those pages would mark the schedule `applied` while visitors
 * kept the old chrome — worse than leaving it lazy, because the lazy path at
 * least applies and serves in the same render. Layout schedules continue
 * through `get-layout-version` untouched.
 */

/** Bound the work per beat; the rest are picked up on the next one. */
const BATCH_LIMIT = 100

/**
 * Namespace for jobs that are core rather than a plugin's. The registry keys
 * on `pluginId:name` and never interprets `pluginId`, so this only has to be
 * stable and not collide with a real bundle id.
 */
const CORE_JOB_NAMESPACE = 'core'

export const APPLY_PUBLISH_SCHEDULES_JOB = 'apply-publish-schedules'

registerPluginJob({
  pluginId: CORE_JOB_NAMESPACE,
  name: APPLY_PUBLISH_SCHEDULES_JOB,
  // The beat is the real resolution — the runner treats a job as due when
  // `now - lastRun >= intervalMinutes`, so 1 means "every beat".
  intervalMinutes: 1,
  description: 'Publish screens whose scheduled time has passed, and drop their cached pages.',
  handler: async () => {
    const firestore = firebaseAdmin.app().firestore()

    // Collection-group across every host: schedules are per screen, and the
    // beat has no host context. Needs the composite index on
    // (publishSchedule.status, publishSchedule.publishAt) — the same one the
    // previous `publishAt <= now` range shape used — without it this throws,
    // the runner isolates the failure, and it retries next beat.
    //
    // Ordered by publishAt with NO time bound, behind the next-due memo
    // (AGL-1440): one probe returns what is due AND when the next schedule
    // lands, so an idle platform pays one read per memo window instead of
    // one per beat. See publish-schedule-next-due.ts for the staleness
    // argument (a schedule the probe has seen still publishes on its exact
    // beat; only a brand-new one can wait, bounded by the memo age, with
    // the lazy ISR executor unchanged as the backstop).
    const dueDocs = await readDueSchedules({
      now: Date.now(),
      read: async () =>
        (
          await firestore
            .collectionGroup('screens')
            .where('publishSchedule.status', '==', 'pending')
            .orderBy('publishSchedule.publishAt')
            .limit(BATCH_LIMIT)
            .get()
        ).docs,
      publishAtMs: (row) => {
        const at = row.get('publishSchedule.publishAt') as
          | { toMillis?: () => number }
          | Date
          | null
          | undefined
        if (at instanceof Date) return at.getTime()
        return typeof at?.toMillis === 'function' ? at.toMillis() : null
      },
    })

    if (!dueDocs.length) return

    // Host docs hold both the routing map and the subdomain, and several due
    // screens usually share one host — read each at most once.
    const hostCache = new Map<string, FirebaseFirestore.DocumentSnapshot>()
    const readHost = async (hostId: string) => {
      const cached = hostCache.get(hostId)
      if (cached) return cached
      const snapshot = await firestore.collection('hosts').doc(hostId).get()
      hostCache.set(hostId, snapshot)
      return snapshot
    }

    for (const doc of dueDocs) {
      // `hosts/{hostId}/screens/{screenId}` — the grandparent is the host.
      const hostId = doc.ref.parent.parent?.id
      if (!hostId) continue

      try {
        // The executor re-checks the `scheduledPublishing` entitlement and
        // handles the unpublish action. Reused rather than reimplemented
        // precisely so this beat cannot drift from the lazy path.
        await applyDuePublishSchedule({
          hostId: hostId as never,
          collectionName: 'screens',
          docId: doc.id,
          parent: {
            versionId: doc.get('versionId'),
            publishSchedule: doc.get('publishSchedule'),
          },
        })

        // The beat just flipped a version pointer (or dropped a routing-map
        // entry, for an unpublish) — bust the host's document cache so the
        // page regeneration below reads the flip instead of a still-warm
        // screen doc (AGL-1302). Once per host would suffice; per screen is
        // harmless and keeps the failure isolation of this loop intact.
        revalidateTag(tenantDataTag(hostId), 'max')

        const hostSnapshot = await readHost(hostId)
        if (!hostSnapshot.exists) continue
        const screens = (hostSnapshot.get('screens') ?? {}) as Record<
          string,
          string
        >
        const routePath = screens[doc.id]
        // An unpublish drops the routing-map entry, so `routePath` is gone by
        // now. That path still needs its cache dropped — otherwise the page
        // keeps serving after being unpublished — so fall back to the path the
        // schedule was pointing at before this ran.
        const previousPath = (doc.get('slug') as string | undefined) ?? undefined
        const target = routePath ?? previousPath
        if (!target) continue

        // Same cache key the middleware rewrites to: `/{host}{path}`, NOT the
        // public URL.
        const url = screenRoutePathToUrl(target)
        revalidatePath(`/${hostId}${url === '/' ? '' : url}`)
      } catch (error) {
        // One bad screen must not stop the batch — the rest are still due.
        console.error(
          `[apply-publish-schedules] ${hostId}/${doc.id} failed:`,
          error,
        )
      }
    }
  },
})
