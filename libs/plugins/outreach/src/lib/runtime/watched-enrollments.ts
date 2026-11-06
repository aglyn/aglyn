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

/*==========================================
 * AN ORGANIZATION'S WATCHED ENROLLMENTS, READ ONCE PER SYNC RUN (AGL-4121)
 *
 * The sync job needs the watched enrollments twice over: each mailbox reads
 * its own (`mailboxId ==` within the watch window), and the possible-reply
 * step reads the whole organization's (AGL-4088). With six mailboxes and a
 * couple of hundred people in sequences, that was every watched enrollment
 * read twice every fifteen minutes, and it grew with each send.
 *
 * The organization's set is a superset of each mailbox's, read with the same
 * window and in the same order, so one read answers both. The subset is the
 * same documents in the same order the narrow query returns: both are
 * ordered by `lastSentAtMs` and then by path, and filtering keeps that order.
 *
 * A held set is only as fresh as the run's own writes allow. A mailbox's sync
 * can change another mailbox's enrollments — an opt-out stops every open
 * enrollment of the address in the organization — so any step that writes an
 * enrollment calls `touched()`, and after that:
 *
 * - the next mailbox reads its own with the narrow query, exactly as before;
 * - the next possible-reply read re-reads the organization's set, so it is at
 *   least as fresh as the single lazy read it replaces.
 *
 * A quiet run (no reply, bounce or opt-out, which is nearly every run) reads
 * the set once. Nothing reads it at all until a mailbox has opened, as
 * before: a run whose mailboxes cannot be opened reads no enrollments.
 *==========================================*/

/** The parts of a query document this reads. */
export interface WatchedEnrollmentDoc {
  id: string
  get(field: string): unknown
}

/** The two reads the cache stands in front of. */
export interface WatchedEnrollmentReads<D extends WatchedEnrollmentDoc> {
  /** Every enrollment of the organization written to within the watch window. */
  org(): Promise<D[]>
  /** The same, narrowed to one mailbox by the query itself. */
  mailbox(mailboxId: string): Promise<D[]>
}

export interface WatchedEnrollments<D extends WatchedEnrollmentDoc> {
  /** One mailbox's watched enrollments, in the narrow query's order. */
  forMailbox(mailboxId: string): Promise<D[]>
  /** The organization's watched enrollments. */
  forOrg(): Promise<D[]>
  /** This run wrote an enrollment: a held set may no longer be current. */
  touched(): void
}

export function watchedEnrollmentsOfOrg<D extends WatchedEnrollmentDoc>(
  reads: WatchedEnrollmentReads<D>,
): WatchedEnrollments<D> {
  let held: D[] | null = null
  let stale = false
  const readOrg = async (): Promise<D[]> => {
    const docs = await reads.org()
    held = docs
    stale = false
    return docs
  }
  return {
    async forMailbox(mailboxId) {
      if (held && stale) return reads.mailbox(mailboxId)
      const docs = held ?? (await readOrg())
      return docs.filter((doc) => doc.get('mailboxId') === mailboxId)
    },
    async forOrg() {
      return held && !stale ? held : readOrg()
    },
    touched() {
      stale = true
    },
  }
}
