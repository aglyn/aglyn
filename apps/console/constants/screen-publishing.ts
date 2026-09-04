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

import type { HostUid, ScreenUid } from '@aglyn/aglyn'
import {
  isFirstPublishedRoute,
  trackEvent,
} from '@aglyn/aglyn/app-utils/analytics-events'
import { screenRoutePathToUrl } from '@aglyn/aglyn/app-utils/screen-route'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
  type DocumentReference,
  type Firestore,
  type WriteBatch,
} from 'firebase/firestore'
import revalidateLivePages from '../utils/revalidate-live-pages'
import {
  PUBLISH_OUTBOX_COLLECTION,
  sanitizePublishOutboxPaths,
} from './publish-outbox'

/**
 * The signed-in user, whose ID token authenticates the cache announcement.
 *
 * REQUIRED rather than optional, on every function here that writes the
 * routing map. An optional token is a token a call site can leave out, and a
 * call site that leaves it out announces nothing while still reporting a
 * successful publish — which is the exact failure this is being added to
 * remove. Making it part of the signature hands the job to the type checker:
 * a new publish surface cannot compile without saying who is publishing.
 */
export interface PublishAnnouncer {
  user: { getIdToken?: () => Promise<string> } | undefined | null
}

/**
 * Read the routing map, for the addresses a write is about to change.
 *
 * Answers an empty map when the read fails. The announcement is best effort
 * and the write is not: a host document that cannot be read must not stop a
 * publish, it only costs the announcement its knowledge of the OLD address.
 */
async function readRouteMap(
  firestore: Firestore,
  hostId: HostUid,
): Promise<Record<string, string>> {
  try {
    const snapshot = await getDoc(doc(firestore, 'hosts', hostId))
    return (snapshot.get('screens') ?? {}) as Record<string, string>
  } catch {
    return {}
  }
}

/**
 * The live addresses a routing-map write is about to change.
 *
 * ADDRESSES, not document ids, and that is the whole point of computing them
 * here. `/api/screens/revalidate` resolves a `screenId` through the routing
 * map, which is correct for a publish and empty for its opposite: an
 * unpublish removes the entry first, so the route would look the screen up,
 * find nothing, and answer `not-routed` — a reported success over a retired
 * page that is still cached and still being served. The old path is read
 * BEFORE the write and named outright, so retiring a page drops it.
 *
 * Both sides of every change are included: a rename has to drop the address
 * it moved away from as well as the one it moved to, or the old URL keeps
 * serving the page from cache while the map no longer points anywhere near
 * it.
 */
function changedPaths(
  before: Record<string, string>,
  after: Record<string, string | null | undefined>,
): string[] {
  const paths = new Set<string>()
  for (const [screenId, next] of Object.entries(after)) {
    const previous = before[screenId]
    const nextPath = next ?? undefined
    // An entry rewritten to the address it already had changes nothing a
    // visitor can see. Skipped so a whole-map sync — which rewrites every
    // descendant on a rename — announces the handful that moved rather than
    // the whole site, which the tenant would cap anyway.
    if (previous === nextPath) continue
    if (previous) paths.add(screenRoutePathToUrl(previous))
    if (nextPath) paths.add(screenRoutePathToUrl(nextPath))
  }
  return sanitizePublishOutboxPaths([...paths])
}

/**
 * ADD THE DURABLE COPY OF THE ANNOUNCE TO THE BATCH THAT PUBLISHES (AGL-2575).
 *
 * Staged into the caller's batch rather than written on its own, and that is
 * the entire property. An outbox entry written after the routing map is an
 * entry a closed tab can lose exactly like the fetch it replaces; an entry
 * written before it is an entry that can order a cache drop for a publish
 * that never happened. In the same batch it is neither: either both documents
 * land or neither does, so a pending entry always describes a publish that
 * really is live and a live publish always has something behind it.
 *
 * Returns the reference so the tab can delete it once its own announce has
 * actually landed — the happy path leaves nothing for the drain to find, and
 * the collection stays near-empty rather than becoming a log.
 */
function stagePublishOutboxEntry(
  batch: WriteBatch,
  firestore: Firestore,
  options: { hostId: HostUid; paths: string[] },
): DocumentReference | null {
  const { hostId, paths } = options
  if (!paths.length) return null
  const ref = doc(collection(firestore, PUBLISH_OUTBOX_COLLECTION))
  batch.set(ref, {
    hostId,
    paths,
    // A SERVER timestamp, and the rules pin it to `request.time`. The drain
    // orders by it and ages it, and both of those are meaningless against a
    // browser clock — which is settable, and skewed on plenty of machines
    // that are not being deliberately dishonest.
    createdAt: serverTimestamp(),
    attempts: 0,
  })
  return ref
}

/**
 * ANNOUNCE THE ADDRESSES A ROUTING-MAP WRITE CHANGED (AGL-2573).
 *
 * Fired here, at the routing-map write, for the same reason `trackEvent` is:
 * registering or removing a path in the host's `screens` map IS what changes
 * what the live site serves, so every surface that publishes passes through
 * this file and no new publish button can quietly forget to announce. Before
 * this, only two of the publish surfaces dropped any cache at all — the
 * one-click Publish button, the screens list, screen delete, route
 * publish/unpublish and every slug rename left the live page serving its old
 * HTML until the ISR window lapsed on its own.
 *
 * BEST EFFORT, ALWAYS, and never awaited. The write has already landed by the
 * time this runs — a cache hint that fails must never make a successful
 * publish look failed.
 *
 * THE OUTBOX ENTRY IS RELEASED ONLY ON A PLAIN `ok` (AGL-2575). Anything else
 * — a refusing tenant, a network that went away, a reason this side does not
 * recognize — leaves the entry pending for the drain, because the question
 * the entry answers is whether the cache was actually dropped and every other
 * answer is "not known to be". The cost of being wrong in this direction is
 * one duplicate tag drop, which is a no-op; the cost of being wrong in the
 * other is the stale page this whole mechanism exists to prevent.
 *
 * The rejection is caught HERE rather than relied on not to happen.
 * `revalidateLivePages` swallows its own failures today, so this catch should
 * be unreachable; an unawaited promise that rejects anyway is an unhandled
 * rejection, which in a browser is a console error on a successful publish
 * and under Node kills the process. A best-effort call whose "best effort"
 * depends on another module never changing its mind is not best effort.
 */
function announceRouteChange(options: {
  user: PublishAnnouncer['user']
  hostId: HostUid
  paths: string[]
  outboxRef: DocumentReference | null
}): void {
  const { user, hostId, paths, outboxRef } = options
  if (!paths.length) return
  void revalidateLivePages({ user, hostId, paths })
    .then(async (result) => {
      if (!outboxRef || result?.reason !== 'ok') return
      // Best effort in its own right: an entry that fails to delete is drained
      // later and drops the same tag a second time, which is a no-op.
      await deleteDoc(outboxRef).catch(() => undefined)
    })
    .catch((error: unknown) => {
      console.error('[screen-publishing] announce failed', error)
    })
}

/**
 * Publishes a screen route: stores the screen's OWN slug segment on the
 * screen doc and registers the fully COMPOSED path (ancestor segments +
 * own, see `composeScreenRoutePath`) in the host's `screens` routing map —
 * the map is what the tenant site matches request paths against, so a
 * screen without an entry is unreachable. Dotted field paths keep sibling
 * map entries untouched. `path` defaults to `slug` for parent-less screens.
 */
export async function publishScreenRoute(
  firestore: Firestore,
  ids: { hostId: HostUid; screenId: ScreenUid } & PublishAnnouncer,
  slug: string,
  path: string = slug,
): Promise<void> {
  const { hostId, screenId, user } = ids
  // Read the routing map BEFORE writing to it (AGL-1588). `first_publish`
  // asks what the map looked like a moment ago, and a moment later it can
  // never be empty. One extra document read on a rare, deliberate, already
  // multi-write action; the alternative was threading the map through six
  // call sites as an optional argument, where a surface that forgot it would
  // simply report nothing and look identical to one that answered `false`.
  //
  // Left `undefined` when the read fails: the param is optional, the
  // sanitizer drops undefined, and one hit with no breakdown value is better
  // than one asserting a `false` nobody checked.
  let firstPublish: boolean | undefined
  // The same read answers what this screen's address was a moment ago, which
  // is what a re-publish onto a DIFFERENT path has to drop alongside the new
  // one (AGL-2573). One read, two questions, both of which can only be asked
  // before the write.
  let before: Record<string, string> = {}
  try {
    const hostSnapshot = await getDoc(doc(firestore, 'hosts', hostId))
    before = (hostSnapshot.get('screens') ?? {}) as Record<string, string>
    firstPublish = isFirstPublishedRoute(
      hostSnapshot.get('screens') as Record<string, unknown> | undefined,
    )
  } catch {
    firstPublish = undefined
  }
  const paths = changedPaths(before, { [screenId]: path })
  // ONE BATCH, and the outbox entry is in it (AGL-2575). Two independent
  // writes could already half-land; adding a third document that has to be
  // atomic with them is what makes the batch the right shape rather than a
  // tidier `Promise.all`.
  const batch = writeBatch(firestore)
  // `publishedAt` records when the route went live; it rides the same merge
  // as the slug so publishing stamps it in one write (cleared on unpublish).
  batch.set(
    doc(firestore, 'hosts', hostId, 'screens', screenId),
    { slug, publishedAt: Timestamp.now() },
    { merge: true },
  )
  batch.update(doc(firestore, 'hosts', hostId), {
    [`screens.${screenId}`]: path,
  })
  const outboxRef = stagePublishOutboxEntry(batch, firestore, { hostId, paths })
  await batch.commit()
  // "% who publish a site" — the GTM plan's headline activation metric
  // (AGL-1561). Fired HERE, at the routing-map write, rather than at each of
  // the five publish buttons: registering a path in the host's `screens` map
  // IS what makes a page reachable on the live site, so every surface that
  // publishes a route passes through this function and no new publish button
  // can be added that quietly forgets to be counted.
  //
  // Deliberately NOT fired for a version-pointer republish (swapping which
  // saved version a live route serves). That is a content update to a site
  // that is already published, and counting it here would let one activated
  // org look like many, which is the opposite of what an activation rate is
  // for. Only a route going live counts.
  //
  // No ids in the payload: the metric is "did this user ever publish", which
  // GA answers from the event alone, and a host id would be a resource
  // identifier bought for nothing.
  //
  // `first_publish` (AGL-1588) is the one param worth the space, and it is
  // registered as a custom dimension. It separates "the site came alive" from
  // "a page was added to a live site" — which is the difference between the
  // GTM §6 activation metric and a publish count, and is not back-fillable:
  // a publish that already happened cannot be re-reported as a first one.
  // See `isFirstPublishedRoute` for what all three publish paths mean by it.
  trackEvent('site_published', { first_publish: firstPublish })
  announceRouteChange({ user, hostId, paths, outboxRef })
}

/**
 * Applies a set of routing-map changes in one write: a `path` string sets
 * the entry, `null` removes it. Used to cascade descendant path rewrites
 * when a screen's slug or parent changes (hierarchical slugs).
 */
export async function syncScreenRouteEntries(
  firestore: Firestore,
  hostId: HostUid,
  entries: Record<ScreenUid, string | null>,
  announcer: PublishAnnouncer,
): Promise<void> {
  if (!Object.keys(entries).length) return
  // Read before the write: an entry being REMOVED carries `null`, so the
  // address that is about to stop resolving exists nowhere else by the time
  // the announcement is made (AGL-2573).
  const before = await readRouteMap(firestore, hostId)
  const updates: Record<string, unknown> = {}
  for (const [screenId, path] of Object.entries(entries)) {
    updates[`screens.${screenId}`] = path ?? deleteField()
  }
  const paths = changedPaths(before, entries)
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, 'hosts', hostId), updates)
  const outboxRef = stagePublishOutboxEntry(batch, firestore, { hostId, paths })
  await batch.commit()
  announceRouteChange({ user: announcer.user, hostId, paths, outboxRef })
}

/**
 * Removes a screen's routing-map entry (and its stored slug when
 * `clearSlug`), making the path 404 after the tenant's ISR revalidate.
 * Used on unpublish and on screen delete.
 */
export async function unpublishScreenRoute(
  firestore: Firestore,
  ids: { hostId: HostUid; screenId: ScreenUid } & PublishAnnouncer,
  options?: { clearSlug?: boolean },
): Promise<void> {
  const { hostId, screenId, user } = ids
  // THE case the routing map cannot answer afterwards, and the one where
  // staleness is worst: a page taken off the site keeps being served from
  // cache, so the address the visitor sees is one the owner believes they
  // retired (AGL-2573).
  const before = await readRouteMap(firestore, hostId)
  const paths = changedPaths(before, { [screenId]: null })
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, 'hosts', hostId), {
    [`screens.${screenId}`]: deleteField(),
  })
  // Drop `publishedAt` too (the route is no longer live), and the slug when
  // asked. Always writes the screen doc now so an unpublished screen never
  // keeps a stale published date.
  batch.set(
    doc(firestore, 'hosts', hostId, 'screens', screenId),
    {
      publishedAt: deleteField(),
      ...(options?.clearSlug ? { slug: deleteField() } : {}),
    },
    { merge: true },
  )
  const outboxRef = stagePublishOutboxEntry(batch, firestore, { hostId, paths })
  await batch.commit()
  announceRouteChange({ user, hostId, paths, outboxRef })
}
