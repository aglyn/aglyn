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

import {
  deleteDoc,
  doc,
  serverTimestamp,
  type DocumentReference,
  type Firestore,
} from 'firebase/firestore'

/**
 * A SITE-WIDE CHANGE, SAVED FROM THE BROWSER, AND THE CACHE DROP IT OWES
 * (AGL-3386).
 *
 * A site's settings, and the plugin data its pages render — the theme, the
 * announcement bar, a product, a site variable — are client Firestore writes
 * with no publish step. The live site is ISR-cached for an hour, so each of
 * those writes has to tell the tenant to drop the site's cached pages, or the
 * change waits out the hour while the console says it is saved.
 *
 * Telling it from the tab is the fast path, and a tab is not durable: close
 * it, sleep the laptop or lose the network between the write and the fetch,
 * and the write has landed while the drop has landed nowhere. So the drop is
 * also WRITTEN DOWN, as a publish outbox entry in the same batch as the
 * write — either both land or neither does — and the console's scheduled
 * drain fires any entry the tab did not get to release. This is the same
 * mechanism a screen publish uses (AGL-2575); the entry carries
 * `entireHost: true`, because a site-wide setting has no address of its own.
 *
 * This is the outbox half for the native app (AGL-3621), which saves the
 * same documents and owes the same drop. The browser's copy is
 * `@aglyn/tenant-feature-instance/hooks/helpers/site-wide-change`, left as it
 * was because a web bundle may not grow by a byte for the app; this one takes
 * the entry id from its caller, since the id helper's barrel is not free of
 * React. `site-wide-outbox.spec.ts` beside that file holds the two to the
 * same collection, the same entry and the same retry.
 */

/**
 * The publish outbox. The console's `PUBLISH_OUTBOX_COLLECTION` is the same
 * collection, and `host-document-writes-sweep.spec.ts` holds the two names
 * and the entry's keys to the console's constants and to the rule.
 */
export const SITE_WIDE_OUTBOX_COLLECTION = 'publishOutbox'

/**
 * What a site-wide entry names. The rule insists every entry names at least
 * one address; the drain reads `entireHost` and drops every routed page of
 * the site instead, which is what a site-wide change needs.
 */
export const SITE_WIDE_OUTBOX_PATHS: readonly string[] = ['/']

/**
 * What an entry can be staged into: a batch, or a transaction — anything
 * whose `set` lands in the same commit as the write beside it.
 */
export interface SiteWideEntryWriter {
  set(ref: DocumentReference, data: Record<string, unknown>): unknown
}

/**
 * Stages one site-wide outbox entry into the caller's batch, under `entryId`:
 * the id every console resource carries, never an SDK auto-id.
 */
export function stageSiteWideOutboxEntryAs(
  batch: SiteWideEntryWriter,
  firestore: Firestore,
  hostId: string,
  entryId: string,
): DocumentReference {
  const ref = doc(firestore, SITE_WIDE_OUTBOX_COLLECTION, entryId)
  batch.set(ref, {
    hostId,
    paths: [...SITE_WIDE_OUTBOX_PATHS],
    // A server timestamp: the rules pin it to `request.time`, and the drain
    // ages entries by it.
    createdAt: serverTimestamp(),
    attempts: 0,
    entireHost: true,
  })
  return ref
}

/** Adds a site-wide outbox entry to a batch that is about to commit. */
export type StageSiteWideEntry = (
  batch: SiteWideEntryWriter,
  firestore: Firestore,
) => void

const isPermissionDenied = (error: unknown): boolean =>
  (error as { code?: unknown } | null)?.code === 'permission-denied'

/**
 * Commits a write with its site-wide outbox entry beside it, and answers the
 * entry — or `null` when the write had to land without one.
 *
 * `commit` performs the write. It is handed the stager on the first attempt
 * and must put the entry in the SAME batch as the write; it is called again
 * without one if that batch is refused.
 *
 * The retry is what keeps the entry from ever costing a save. The entry is
 * the durable copy of a cache drop, and the write is the user's work: a rule
 * that refuses the entry — the window between a code release and the rules
 * deploy that admits it, or a role the outbox rule does not cover — must
 * leave the save exactly as it was without it, with the tab's own drop still
 * behind it. A write the rules refuse on its own merits is refused again,
 * and that second refusal is the one the caller sees.
 */
export async function commitWithSiteWideEntryAs(
  hostId: string,
  commit: (stage: StageSiteWideEntry | undefined) => Promise<void>,
  newEntryId: () => string,
): Promise<DocumentReference | null> {
  // A holder rather than a `let`: the stager assigns it inside a callback,
  // which control-flow narrowing cannot see.
  const staged: { entry: DocumentReference | null } = { entry: null }
  try {
    await commit((batch, firestore) => {
      staged.entry = stageSiteWideOutboxEntryAs(batch, firestore, hostId, newEntryId())
    })
    return staged.entry
  } catch (error) {
    if (!staged.entry || !isPermissionDenied(error)) throw error
    await commit(undefined)
    return null
  }
}

/**
 * Releases an entry once its drop is KNOWN to have landed — a plain `ok` from
 * the console route and nothing else. Any other answer leaves it for the
 * drain, because the entry is the only record that the site may still be
 * stale; the cost of keeping one needlessly is a duplicate drop, which is a
 * no-op.
 */
export async function releaseSiteWideOutboxEntry(
  entry: DocumentReference | null,
  reason: string | null | undefined,
): Promise<void> {
  if (!entry || reason !== 'ok') return
  await deleteDoc(entry).catch((): void => undefined)
}
