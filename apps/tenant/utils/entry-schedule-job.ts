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

import { registerPluginJob } from '@aglyn/aglyn/server'
import { firebaseAdmin, getSiteLockdown } from '@aglyn/tenant-data-admin'
import { tenantDataTag } from '@aglyn/tenant-data-admin/render-cache'
import { collectionLivePageTarget } from '@aglyn/tenant-data-admin/server/collection-live-pages'
import {
  applyDueEntrySchedule,
  entryScheduleDueAtMs,
} from '@aglyn/tenant-runtime/get-collection-content'
import { revalidateTag } from 'next/cache'
import { dropLivePagesInProcess } from './live-page-dropper'
import { createNextDueMemo } from './publish-schedule-next-due'

/**
 * Publish scheduled content entries at their time, and drop the pages that
 * list them (AGL-3340).
 *
 * The content twin of `apply-publish-schedules` (AGL-1159), for the same
 * reason. An entry's schedule used to apply only inside a render —
 * `flipDueEntry` in `get-collection-content.ts` — and a render only happens
 * when a page's cached copy has expired and somebody asks for it. The
 * catch-all caches for an hour, so a post scheduled for 09:00 reached `/blog`
 * whenever that page next expired and was visited, and reached every other
 * page that lists it on each page's own clock. On 2026-09-25 a 09:00 post was
 * still missing from the first visit to `/blog` after it, and from the
 * sitemap nearly two hours later.
 *
 * So this beat does what the console does for a post somebody publishes by
 * hand: flip the entry, then drop the collection's addresses and every screen
 * that renders the collection. Both halves are shared rather than restated —
 * the flip is the render's own executor, and the pages come from the same
 * scope the console's revalidate route asks — so a scheduled post and a
 * published one cannot reach different pages.
 *
 * The render-time flip stays as the backstop, exactly as the lazy executor
 * does for screens: with this beat down, a schedule still applies on the next
 * natural regeneration. What the backstop cannot do is drop the OTHER pages,
 * and one gap remains even with the beat running — a regeneration that
 * happens to land between an entry's time and the next beat flips it first,
 * and the beat, which reads only `scheduled` entries, never sees it. That
 * page is fresh and the rest ride their window, which is the behavior this
 * beat replaces, narrowed to under a minute.
 */

/** Bound the work per beat; the rest are picked up on the next one. */
const BATCH_LIMIT = 100

/**
 * The same namespace `publish-schedule-job.ts` registers under: jobs that are
 * core rather than a plugin's.
 */
const CORE_JOB_NAMESPACE = 'core'

export const APPLY_ENTRY_SCHEDULES_JOB = 'apply-entry-schedules'

/**
 * This beat's own next-due memo — entries are a different set of schedules
 * from screens, with a different next-due time.
 */
const entryScheduleMemo = createNextDueMemo()

/** Test seam — the memo is module scope by design. */
export function resetEntryScheduleNextDue(): void {
  entryScheduleMemo.reset()
}

const ENTRY_PATH = /^hosts\/([^/]+)\/collections\/([^/]+)\/entries\/[^/]+$/

/**
 * The site and collection a due entry belongs to, from its document path —
 * or null for any `entries` collection that is not a site's content entries.
 *
 * A collection-group query reaches EVERY collection named `entries`, so the
 * path is checked rather than assumed. Today only content collections have
 * one; a future `entries` somewhere else must not be published by this beat
 * because it happens to carry a `status` of `scheduled`.
 */
export function entryScheduleAddress(
  path: string,
): { hostId: string; collectionId: string } | null {
  const match = ENTRY_PATH.exec(path)
  if (!match) return null
  return { hostId: match[1], collectionId: match[2] }
}

registerPluginJob({
  pluginId: CORE_JOB_NAMESPACE,
  name: APPLY_ENTRY_SCHEDULES_JOB,
  // Every beat, as for screens: the resolution scheduling promises.
  intervalMinutes: 1,
  description:
    'Publish content entries whose scheduled time has passed, and drop the cached pages that list them.',
  lockdown: { scope: 'per-host' },
  handler: async () => {
    const firestore = firebaseAdmin.app().firestore()

    // Collection-group across every site, ordered by `publishAt` with no time
    // bound, behind the next-due memo — the screens beat's shape and its
    // argument (AGL-1440). Needs the COLLECTION_GROUP index on `entries`
    // (status, publishAt); without it this throws, the runner isolates the
    // failure, and the render-time flip is still underneath.
    //
    // A REFUSED schedule keeps `status: 'scheduled'` and so still comes back
    // here. `entryScheduleDueAtMs` answers null for one, which makes it
    // neither due nor the next-due time; it still takes a slot in the batch,
    // which would matter only once a hundred refusals sat at the head of the
    // platform's queue.
    const dueDocs = await entryScheduleMemo.readDueSchedules({
      now: Date.now(),
      read: async () =>
        (
          await firestore
            .collectionGroup('entries')
            .where('status', '==', 'scheduled')
            .orderBy('publishAt')
            .limit(BATCH_LIMIT)
            .get()
        ).docs,
      publishAtMs: (row) => entryScheduleDueAtMs(row.data()),
    })

    if (!dueDocs.length) return

    // Pages are dropped per COLLECTION, once, with every entry this beat
    // published in it — three posts due at 09:00 on one blog are one scan of
    // the site, not three.
    const published = new Map<
      string,
      { hostId: string; collectionId: string; entrySlugs: string[] }
    >()

    for (const doc of dueDocs) {
      const address = entryScheduleAddress(doc.ref.path)
      if (!address) continue
      const { hostId, collectionId } = address

      try {
        // LOCKDOWN (AGL-1621), for the reasons `publish-schedule-job.ts`
        // gives: a publish is a write, so any lock stops it, and a schedule
        // skipped here stays `scheduled` — it lands on the first beat after
        // the lift, late but not lost.
        if (await getSiteLockdown(hostId)) continue

        // The render's own executor: the `scheduledPublishing` gate, the
        // terminal refusal, and the fields a flip writes.
        const outcome = await applyDueEntrySchedule({ hostId, entry: doc })
        if (outcome !== 'published') continue

        const key = `${hostId}/${collectionId}`
        const group = published.get(key) ?? {
          hostId,
          collectionId,
          entrySlugs: [],
        }
        const slug = String(doc.get('slug') ?? '').trim()
        if (slug) group.entrySlugs.push(slug)
        published.set(key, group)
      } catch (error) {
        // One bad entry must not stop the batch — the rest are still due.
        console.error(
          `[apply-entry-schedules] ${hostId}/${collectionId}/${doc.id} failed:`,
          error,
        )
      }
    }

    for (const { hostId, collectionId, entrySlugs } of published.values()) {
      let paths = 0
      let truncated = false
      try {
        const target = await collectionLivePageTarget({
          firestore,
          hostId,
          collectionId,
          entrySlugs,
        })
        if (target) {
          // Drops the host's document tag first, then each page.
          await dropLivePagesInProcess(target)
          paths = target.paths.length
          truncated = target.truncated
        } else {
          // No page to name — a site with no subdomain yet — but the rows
          // cached for it are still the ones from before the flip.
          revalidateTag(tenantDataTag(hostId), 'max')
        }
      } catch (error) {
        console.error(
          `[apply-entry-schedules] ${hostId}/${collectionId} drop failed:`,
          error,
        )
      }
      // One line per collection published, on success as well as failure: a
      // beat that only logs failures cannot tell "every schedule landed" from
      // "it never ran".
      console.log(
        JSON.stringify({
          tag: 'AGL-3340:entry-schedule-published',
          hostId,
          collectionId,
          entrySlugs,
          paths,
          truncated,
        }),
      )
    }
  },
})
