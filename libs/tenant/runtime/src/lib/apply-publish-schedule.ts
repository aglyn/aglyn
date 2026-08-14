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
import {
  checkEntitlement,
  composeScreenRoutePath,
  findScreenIdByRoutePath,
  SCREEN_KIND_EMAIL,
} from '@aglyn/aglyn/server'
// Deep import, like the Measurement Protocol sender's: `analytics-events.ts`
// is deliberately DOM-free so both sides of the publish path can share the
// one definition of `first_publish` (AGL-1588).
import { isFirstPublishedRoute } from '@aglyn/aglyn/app-utils/analytics-events'
import {
  firebaseAdmin,
  getOrgForHost,
  sendGa4SitePublished,
} from '@aglyn/tenant-data-admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'

/** Parent chains deeper than `composeScreenRoutePath` accepts are invalid. */
const MAX_ANCESTOR_READS = 32

/**
 * Why a due publish declined to make the screen reachable. Recorded on the
 * schedule as `skipped-unroutable` — see {@link resolveScheduledRoutePath}.
 */
type RouteRefusal = 'not-a-page' | 'no-path' | 'path-taken'

/**
 * The routing-map path a due publish should register for a screen that has
 * no entry yet, or the reason it must not get one (AGL-1589).
 *
 * Reads the screen and walks its ancestor chain (one doc per level, bounded)
 * because the composed path is `parent segments + own slug` and the executor
 * is handed only the version pointer and the schedule. Runs at most once per
 * schedule that actually comes due, and never for the common case — a screen
 * whose route is already live is answered from the host document alone.
 *
 * The three refusals are all "this cannot become an address", and all three
 * are silent no-ops if left unrecorded, which is the bug this issue is about:
 *
 * - `not-a-page` — an email document (AGL-1383). It has no URL, the serve
 *   path refuses to render it, and a routing entry would make it BILLABLE
 *   against `screensPerHost` without making it reachable. `kind: 'template'`
 *   is deliberately NOT refused: a collection entry template is routed on
 *   purpose, which is how the compose pipeline picks it up (AGL-1400).
 * - `no-path` — the screen or an ancestor has no slug, so there is no address
 *   to publish at.
 * - `path-taken` — another screen already holds the address. The interactive
 *   path refuses this with a message ("Another screen is already published at
 *   …"); registering it anyway would put two screens at one path and could
 *   take a LIVE page off the site, which is a worse bug than the one being
 *   fixed here.
 */
async function resolveScheduledRoutePath(options: {
  hostRef: FirebaseFirestore.DocumentReference
  screenId: string
  routing: Record<string, string>
}): Promise<{ path: string } | { refused: RouteRefusal }> {
  const { hostRef, screenId, routing } = options
  const screens = hostRef.collection('screens')
  const screensById: Record<string, Aglyn.ScreenRouteNode | undefined> = {}

  let currentId: string | undefined = screenId
  for (let depth = 0; currentId && depth < MAX_ANCESTOR_READS; depth += 1) {
    if (screensById[currentId]) break // cycle — composeScreenRoutePath refuses
    const snapshot = await screens.doc(currentId).get()
    if (!snapshot.exists) break
    if (currentId === screenId) {
      if (
        snapshot.get('deletedAt') != null ||
        snapshot.get('kind') === SCREEN_KIND_EMAIL
      ) {
        return { refused: 'not-a-page' }
      }
    }
    screensById[currentId] = {
      slug: snapshot.get('slug'),
      parentId: snapshot.get('parentId'),
    }
    currentId = snapshot.get('parentId')
  }

  const path = composeScreenRoutePath(screenId, screensById)
  if (!path) return { refused: 'no-path' }
  const owner = findScreenIdByRoutePath(routing, path)
  if (owner && owner !== screenId) return { refused: 'path-taken' }
  return { path }
}

/**
 * Lazy scheduled-publishing executor (AGL-61): if the doc carries a pending
 * `publishSchedule` whose time has passed, flip the `versionId` pointer,
 * register the screen's routing entry when the route is not live yet
 * (AGL-1589), and mark the schedule applied. Runs during ISR revalidation,
 * so a schedule
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

  // Plan gate (AGL-471): the console gates *writing* a schedule on the
  // scheduledPublishing entitlement, but this executor is the authority —
  // a schedule written directly to Firestore must not auto-publish on an
  // unentitled plan.
  const org = (await getOrgForHost(hostId))?.org ?? {}
  if (!checkEntitlement(org, 'scheduledPublishing')) {
    // Record the refusal instead of leaving it pending (AGL-1185).
    //
    // The refusal itself is correct and unchanged. What was wrong is that it
    // left no trace: the schedule stayed `pending` and permanently due, so the
    // moment the org upgraded to Business the next beat — every minute since
    // AGL-1159 — published it. Content scheduled on a plan that could not
    // honour it, and forgotten, would surface during an upgrade, which is
    // exactly when nobody is looking for it.
    //
    // Safe to write here because the dueness check above has already passed, so
    // this can only ever mark a schedule that came due and was declined. A
    // future-dated schedule is returned long before this point and is untouched.
    //
    // Terminal on purpose: upgrading does not resurrect it. A schedule whose
    // time passed while unentitled is stale by the time the plan changes, and
    // re-running it is the surprise this removes. Rescheduling is a deliberate
    // act, and the console can now say why the original never ran.
    //
    // Fail-open like every other write here — a failure leaves it pending,
    // which is today's behaviour, and the next beat retries.
    try {
      await firebaseAdmin
        .app()
        .firestore()
        .collection('hosts')
        .doc(hostId)
        .collection(collectionName)
        .doc(docId)
        .update({ 'publishSchedule.status': 'skipped-unentitled' })
    } catch (error) {
      console.error(error)
    }
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
            // Route no longer live — drop the published date to match the
            // interactive unpublish path (constants/screen-publishing.ts).
            publishedAt: FieldValue.delete(),
          }),
        ])
      } catch (error) {
        console.error(error)
      }
    }
    return parent.versionId
  }

  if (!schedule.versionId) return parent.versionId

  // Register the routing entry, not just the version pointer (AGL-1589).
  //
  // Until this, a due publish wrote `versionId` + `status: 'applied'` and
  // nothing else — never `hosts/{hostId}.screens.{screenId}`, the map the
  // tenant matches request paths against. A REPUBLISH was therefore correct
  // (the entry already existed, and only the version needed swapping) and a
  // FIRST publish silently was not: the schedule reported success, the
  // activity log said published, and the URL kept 404ing. Scheduled
  // publishing is a Business feature, so that was a paying customer's page.
  //
  // Mirrors `publishScreenRoute` (constants/screen-publishing.ts): the
  // composed path into the host's map, `publishedAt` stamped on the screen.
  // The stored `slug` is not rewritten — the path was composed FROM it, so
  // there is nothing to change.
  //
  // Screens only. A layout has no address of its own, exactly as the
  // unpublish branch above is screens-only.
  //
  // In practice the CRON BEAT is the only caller that reaches a first publish:
  // the lazy ISR path resolves a request path through the routing map before
  // it ever loads a screen, so an unrouted screen 404s without its schedule
  // being read. That is the same map this now writes — which is why the bug
  // could not heal itself on the next visit.
  const firestore = firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)
  const docRef = hostRef.collection(collectionName).doc(docId)

  let routePath: string | undefined
  // Decided from the routing map as read below — BEFORE the batch registers
  // this entry (AGL-1588). Left undefined outside the screens branch, where
  // no route is going live and no `site_published` is sent at all.
  let firstPublish: boolean | undefined
  if (collectionName === 'screens') {
    try {
      const routing = ((await hostRef.get()).get('screens') ?? {}) as Record<
        string,
        string
      >
      // An existing entry is the republish case: the route is already live,
      // this only swaps which version it serves, and there is nothing to
      // register and no activation to report.
      if (!routing[docId]) {
        // The same predicate the console's three publish surfaces use, so a
        // `first_publish` breakdown means one thing across all four senders.
        firstPublish = isFirstPublishedRoute(routing)
        const resolved = await resolveScheduledRoutePath({
          hostRef,
          screenId: docId,
          routing,
        })
        if ('refused' in resolved) {
          // Record the refusal rather than publishing a pointer at a page
          // nobody can reach — the AGL-1185 posture, for the same reason: an
          // unrecorded decline is indistinguishable from success, and leaving
          // it `pending` would re-attempt it on every beat forever. Terminal:
          // fixing the address is a deliberate act in the console, and
          // rescheduling is part of it.
          try {
            await docRef.update({
              'publishSchedule.status': 'skipped-unroutable',
            })
          } catch (error) {
            console.error(error)
          }
          return parent.versionId
        }
        routePath = resolved.path
      }
    } catch (error) {
      // Fail-open like every other write here: leave the schedule pending and
      // let the next beat (or revalidate) retry. Publishing the pointer while
      // the routing question is unanswered is the failure being fixed.
      console.error(error)
      return parent.versionId
    }
  }

  try {
    const applied = {
      versionId: schedule.versionId,
      'publishSchedule.status': 'applied',
    }
    if (routePath) {
      // ONE atomic commit, and the order matters more than the write count:
      // a status of `applied` with no routing entry is permanent (nothing
      // retries a terminal status), so the entry and the status must land
      // together or not at all. A failed commit leaves the schedule pending
      // and the next beat runs it again.
      const batch = firestore.batch()
      batch.update(hostRef, { [`screens.${docId}`]: routePath })
      batch.update(docRef, { ...applied, publishedAt: Timestamp.now() })
      await batch.commit()

      // A route just went live with no browser anywhere near it, which is
      // precisely what the client-side `site_published` in
      // `publishScreenRoute` cannot see (AGL-1562, AGL-1589). Awaited, not
      // floated: this render/beat is the only thing keeping the process
      // alive. It never throws, and it returns immediately when the
      // Measurement Protocol is not configured — which is the tenant app's
      // current state: GA4_MEASUREMENT_ID / GA4_API_SECRET are not set on the
      // aglyn-tenant Vercel project (checked 2026-08-14), so this is a clean
      // no-op until they are added. See docs/ANALYTICS.md.
      await sendGa4SitePublished({ hostId, firstPublish })
    } else {
      await docRef.update(applied)
    }
  } catch (error) {
    console.error(error)
  }
  // Serve the scheduled version for this render either way — the schedule
  // is due, and the write (or its retry next revalidate) makes it durable.
  return schedule.versionId
}

export default applyDuePublishSchedule
