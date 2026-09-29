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

import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  writeBatch,
  type DocumentReference,
  type Firestore,
  type WriteBatch,
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
 * Shared here rather than kept in the console because plugins write these
 * documents too, and a plugin cannot import the console.
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

/** Stages one site-wide outbox entry into the caller's batch. */
export function stageSiteWideOutboxEntry(
  batch: SiteWideEntryWriter,
  firestore: Firestore,
  hostId: string,
): DocumentReference {
  const ref = doc(collection(firestore, SITE_WIDE_OUTBOX_COLLECTION))
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
export async function commitWithSiteWideEntry(
  hostId: string,
  commit: (stage: StageSiteWideEntry | undefined) => Promise<void>,
): Promise<DocumentReference | null> {
  // A holder rather than a `let`: the stager assigns it inside a callback,
  // which control-flow narrowing cannot see.
  const staged: { entry: DocumentReference | null } = { entry: null }
  try {
    await commit((batch, firestore) => {
      staged.entry = stageSiteWideOutboxEntry(batch, firestore, hostId)
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
  await deleteDoc(entry).catch(() => undefined)
}

/**
 * Asks the console to drop every cached page of the site, and answers its
 * reason — `'ok'` only when the drop landed.
 *
 * The plugin-side door to the console's own `/api/screens/revalidate`, which
 * a plugin cannot import. Never throws: a cache hint that fails must not make
 * a successful save look failed, and the outbox entry and the hour-long
 * window are both underneath it.
 */
export async function announceSiteWideChange(options: {
  /** The signed-in user; its ID token authenticates the console route. */
  user: { getIdToken?: () => Promise<string> } | null | undefined
  hostId: string
}): Promise<string | null> {
  const { user, hostId } = options
  if (!hostId) return null
  try {
    const response = await authorizedFetch(user, '/api/screens/revalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostId, entireHost: true }),
    })
    if (!response.ok) return `console-${response.status}`
    const body = (await response.json().catch(() => null)) as {
      reason?: unknown
    } | null
    return typeof body?.reason === 'string' ? body.reason : 'ok'
  } catch {
    return null
  }
}

/**
 * After the write has landed: ask for the drop, and release the entry when it
 * lands. Fire and forget — it never rejects.
 */
export function settleSiteWideChange(options: {
  user: { getIdToken?: () => Promise<string> } | null | undefined
  hostId: string
  entry: DocumentReference | null
}): void {
  const { user, hostId, entry } = options
  void announceSiteWideChange({ user, hostId })
    .then((reason) => releaseSiteWideOutboxEntry(entry, reason))
    .catch(() => undefined)
}

/**
 * THE ONE CALL A PLUGIN'S CONSOLE CARD MAKES TO SAVE SOMETHING A PUBLISHED
 * PAGE RENDERS.
 *
 * `write` stages the card's writes into the batch it is handed —
 * `batch.update(ref, …)`, `batch.set(ref, …, { merge: true })`,
 * `batch.delete(ref)` — and the batch commits with the site-wide outbox entry
 * beside them. Resolves when the write has landed, rejects exactly when it
 * did not; the drop runs behind it and never rejects.
 */
export async function writeSiteWideChange(options: {
  firestore: Firestore
  user: { getIdToken?: () => Promise<string> } | null | undefined
  hostId: string
  write: (batch: WriteBatch) => void
}): Promise<void> {
  const { firestore, user, hostId, write } = options
  const entry = await commitWithSiteWideEntry(hostId, async (stage) => {
    const batch = writeBatch(firestore)
    write(batch)
    stage?.(batch, firestore)
    await batch.commit()
  })
  settleSiteWideChange({ user, hostId, entry })
}
