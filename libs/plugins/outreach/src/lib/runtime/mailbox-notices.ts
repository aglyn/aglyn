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

import { outreachReconnectRequiredSentence, type OutreachMailboxNoticeKind } from '../engine/mailbox-notice'
import { mailboxRef } from '../mailboxes/mailbox-credentials'
import type { OutreachMailbox } from '../model/outreach.types'
import { outreachOrgCollection } from '../storage/outreach-records'
import type { OutreachRuntimeDeps } from './runtime-deps'

/**
 * TELLING THE OWNER, ONCE (AGL-3244).
 *
 * A mailbox that stops sending — paused by its own health, or refused by
 * Google — is told to its owner the moment the runtime writes the state,
 * and told ONCE: the write that changes the status is the trigger, so a run
 * that finds the mailbox already paused or already waiting to be
 * reconnected sends nothing. The pause's write lives in
 * `mailbox-health-store.ts` and calls {@link notifyOutreachMailboxOwner}
 * after its transaction; the reconnect's write is
 * {@link noteOutreachMailboxReconnectRequired}, here, which does the same
 * inside one transaction that reads the status first.
 *
 * The notice is a courtesy beside the state: nothing here throws, and a
 * notice that could not be sent leaves the mailbox exactly as paused as it
 * was.
 */

/** The activity target a mailbox's rows are filed under (AGL-2978). */
const MAILBOX_TARGET = 'outreach:mailbox' as const

/** How many enrollments are active on a mailbox — the ones its pause is holding. */
export async function countOutreachMailboxWaiting(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  mailboxId: string,
): Promise<number> {
  try {
    const active = await outreachOrgCollection(firestore, orgId, 'enrollments')
      .where('mailboxId', '==', mailboxId)
      .where('status', '==', 'active')
      .get()
    return active.size
  } catch (error) {
    console.error('[outreach] counting a mailbox’s waiting enrollments failed', error)
    return 0
  }
}

/** Emails the owner through the platform's seam; never throws. */
export async function notifyOutreachMailboxOwner(
  deps: Pick<OutreachRuntimeDeps, 'firestore' | 'notifyMailboxOwner'>,
  input: {
    orgId: string
    mailbox: Pick<OutreachMailbox, 'id' | 'email' | 'sendAs' | 'displayName' | 'connectedByUid'>
    kind: OutreachMailboxNoticeKind
    message: string
  },
): Promise<void> {
  const { mailbox } = input
  try {
    const waiting = await countOutreachMailboxWaiting(deps.firestore(), input.orgId, mailbox.id)
    await deps.notifyMailboxOwner({
      orgId: input.orgId,
      mailboxId: mailbox.id,
      connectedByUid: mailbox.connectedByUid,
      kind: input.kind,
      mailbox: { email: mailbox.email, sendAs: mailbox.sendAs, displayName: mailbox.displayName },
      message: input.message,
      waiting,
    })
  } catch (error) {
    console.error('[outreach] the mailbox owner could not be told', error)
  }
}

/**
 * Marks a mailbox `reconnect_required` and tells its owner — once: a
 * mailbox already waiting to be reconnected is left as it is, and nobody is
 * told twice. Answers whether this call was the one that marked it.
 */
export async function noteOutreachMailboxReconnectRequired(
  deps: Pick<OutreachRuntimeDeps, 'firestore' | 'notifyMailboxOwner' | 'logOrgActivity'>,
  input: { orgId: string; mailboxId: string; errorCode: string; nowMs: number },
): Promise<boolean> {
  const firestore = deps.firestore()
  const ref = mailboxRef(firestore, input.orgId, input.mailboxId)
  let marked: OutreachMailbox | null
  try {
    marked = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      if (!snapshot.exists) return null
      const mailbox = { ...(snapshot.data() as OutreachMailbox), id: snapshot.id }
      if (mailbox.status === 'reconnect_required') return null
      transaction.update(ref, {
        status: 'reconnect_required',
        'health.lastErrorAtMs': input.nowMs,
        'health.lastErrorCode': input.errorCode,
        updatedAtMs: input.nowMs,
      })
      return mailbox
    })
  } catch (error) {
    console.error('[outreach] marking a mailbox reconnect_required failed', error)
    return false
  }
  if (!marked) return false
  const message = outreachReconnectRequiredSentence(input.errorCode)
  try {
    await deps.logOrgActivity(
      input.orgId,
      { uid: null },
      `A mailbox in Sequences needs reconnecting: Google stopped accepting its connection (${input.errorCode})`,
      { type: MAILBOX_TARGET, id: marked.id, name: marked.email },
    )
  } catch (error) {
    console.error('[outreach] the reconnect activity line could not be written', error)
  }
  await notifyOutreachMailboxOwner(deps, { orgId: input.orgId, mailbox: marked, kind: 'reconnect_required', message })
  return true
}
