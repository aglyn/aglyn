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

/**
 * THE TWO GATES A FLOW EMAIL OWES THAT A REPLY DOES NOT.
 *
 * `sendEmail`'s marketing seam already asks the three questions every
 * merchant-triggered message owes — both suppression lists, the per-person
 * frequency ceiling, and an unsubscribe mechanism — at one chokepoint, for
 * any caller that declares `marketing: { hostId, siteBase }`. Two more belong
 * to a message a CAMPAIGN would owe and an immediate reply would not:
 *
 *  1. **The consent split.** Does this person have a basis to be mailed
 *     marketing by this site, under the org's own policy?
 *  2. **The topic filter.** Have they left this particular stream?
 *
 * ## Why a flow email is on the campaign's side of that line
 *
 * `marketing-send.ts` draws it precisely: a message is marketing when the
 * merchant decided to mail them, rather than because the recipient just did
 * something. An action's immediate `sendEmail` is the second — the visitor
 * submitted the form a moment ago and the reply is the response to it, which
 * is why that path is priority `transactional` and consults no consent
 * record.
 *
 * A step that runs three days later is the first. The person did one thing
 * once; everything after the wait is the merchant's schedule, not the
 * recipient's act. So a flow email is checked here, and the answer is the
 * same one a campaign would get for the same person.
 *
 * ## What this deliberately does NOT do
 *
 * It compares no count against any limit. A flow send is metered on the cost
 * meter like every other automated message and is refused by no plan quota —
 * `emailSendsPerMonth` governs campaigns, which are the discretionary send a
 * customer can see, delay and argue with. Making a sequence stop mid-way
 * through somebody's welcome series because a monthly figure moved would be a
 * capacity limit enforced at the person, which is the shape this codebase
 * refuses everywhere else.
 */

import {
  DEFAULT_CAMPAIGN_TOPIC_ID,
  readMarketingBasis,
  marketingConsentVerdict,
  resolveMarketingConsentPolicy,
} from '@aglyn/aglyn/server'
import firebaseAdmin from './firebase-admin'
import { filterTopicSendable } from './email-suppression'
import { orgDataQueryForHost } from './organizations'

/** Why a flow's email was not sent. Null when it may go. */
export type FlowEmailRefusal =
  /** No basis to mail this person marketing, under the org's policy. */
  | 'consent-withheld'
  /** They have left the stream this message belongs to. */
  | 'topic-unsubscribed'

/**
 * The person's own record, from the two silos that hold a consent basis for
 * somebody an automation can reach.
 *
 * `contacts` first because it is the canonical person store and the one the
 * consent capture surfaces write; `leads` second because a welcome series
 * fires on a sign-up that may not have produced a contact yet. Two keyed
 * reads at most, and only on a message that is about to be sent — the
 * expensive shape would be reading these on a beat, for people no step is
 * mailing.
 *
 * An address in NEITHER silo reads as record-less, which is what
 * `readMarketingBasis(null)` describes: `unrecorded`, with no capture date.
 * Under a `forward` policy that grandfathers and under `strict` it is
 * withheld — the same answer a campaign gives the same address, which is the
 * property that matters.
 */
async function readPersonRecord(
  hostId: string,
  email: string,
  firestore?: any,
): Promise<Record<string, unknown> | null> {
  const db = firestore ?? firebaseAdmin.app().firestore()
  try {
    const { query } = await orgDataQueryForHost(hostId, 'contacts')
    const contact = (await query.where('email', '==', email).limit(1).get())
      .docs[0]
    if (contact) return contact.data() as Record<string, unknown>
  } catch (error) {
    console.error('[flow-email] contact lookup failed', hostId, error)
  }
  try {
    const lead = (
      await db
        .collection('hosts')
        .doc(hostId)
        .collection('leads')
        .where('email', '==', email)
        .limit(1)
        .get()
    ).docs[0]
    if (lead) return lead.data() as Record<string, unknown>
  } catch (error) {
    console.error('[flow-email] lead lookup failed', hostId, error)
  }
  return null
}

/**
 * May this site mail this person this flow's message?
 *
 * FAILS CLOSED on consent and OPEN on topic, which is the asymmetry
 * `filterTopicSendable` already argues one layer down: a missing consent
 * basis is the whole question, where a topic preference is a narrower fact
 * whose lookup failing is no reason to withhold a message the person has a
 * basis to receive.
 *
 * @param org the owning org's document data, already read by the caller's
 *            entitlement gate. Passed rather than re-read: the executor holds
 *            it for the whole run, and the policy is the only thing needed
 *            from it.
 */
export async function flowEmailRefusal(options: {
  hostId: string
  email: string
  topicId?: string | null
  org?: unknown
  firestore?: any
}): Promise<FlowEmailRefusal | null> {
  const email = String(options.email ?? '')
    .trim()
    .toLowerCase()
  if (!email) return 'consent-withheld'

  const policy = resolveMarketingConsentPolicy(
    (options.org as Record<string, unknown> | undefined)?.[
      'marketingConsentPolicy'
    ],
  )
  const record = await readPersonRecord(
    options.hostId,
    email,
    options.firestore,
  )
  if (
    marketingConsentVerdict(readMarketingBasis(record), policy) === 'withheld'
  ) {
    return 'consent-withheld'
  }

  const topicId =
    String(options.topicId ?? '').trim() || DEFAULT_CAMPAIGN_TOPIC_ID
  const sendable = await filterTopicSendable(
    options.hostId,
    topicId,
    [email],
    options.firestore,
  )
  return sendable.length ? null : 'topic-unsubscribed'
}
