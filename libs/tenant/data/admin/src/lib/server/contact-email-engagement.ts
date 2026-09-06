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
 * THE CONTACT'S OWN ENGAGEMENT STAMP (AGL-2616):
 * `facets.{groupId}.lastEmailEngagementAtMs` on `orgs/{orgId}/contacts`.
 *
 * ## What it answers
 *
 * "When did this person last read one of OUR campaigns?" — on the record
 * page as "Last engaged", as a column on the list, and as the audience rule
 * `engagedWithinDays`. The per-person rollup on `emailDeliveries/{key}`
 * already answers "when did this address last read anything from anybody",
 * which is the right question for a sunset that refuses to mail cold
 * addresses and the wrong one for a re-engagement audience: it moves when
 * the person opens a receipt, an invite, or a sibling business's newsletter
 * on the same shared row. This stamp moves only when they open or click a
 * campaign this holder's own sites sent.
 *
 * ## What one webhook event costs
 *
 * The same bound the rollup keeps: only an event that is the FIRST of its
 * type for its message reaches here, which `recordEmailDeliveryEvent`'s
 * transaction already decided. A reader opening one newsletter six times is
 * one transaction, and a replayed event finds its type already recorded and
 * contributes nothing. Inside that bound the cost per person is one org
 * resolution and one group resolution per batch, then one keyed query and
 * at most one update per person.
 *
 * ## Forward-only, in a transaction
 *
 * Provider events are unordered and at-least-once, so an old instant
 * arriving late must not overwrite a fresh stamp — the same reasoning
 * `recordPersonEngagement` gives. The query for the contact rides inside
 * the transaction so the compare-and-write is atomic against a second event
 * for the same person landing in another instance.
 *
 * ## Only a contact this site may see, and only this holder's facet
 *
 * The contact row is shared by every site in the org. The stamp is written
 * under the sending site's consent group, never at the top of the document,
 * and only onto a row whose `visibleTo` admits the site — a person another
 * holder captured and this site never met is not this site's contact, and a
 * write onto their row would mint a facet for a holder that does not hold
 * them. `updatedAt` is left alone: an open is something the person did, not
 * an edit the team made, and a list sorted on recency must not reshuffle on
 * every mailbox prefetch.
 *
 * ## Never throws
 *
 * Best-effort for the reason everything on the webhook path is: a stamp that
 * failed loses a fact a page can live without, and a stamp that threw would
 * lose the provider's acknowledgement and teach it to retry the whole event.
 */

import {
  contactFacetPath,
  normalizeContactEmail,
  readContactFacet,
  visibleToHost,
} from '@aglyn/aglyn/server'
import { findContactByEmail } from './contact-email-index'
import type { EmailDeliveryEventOutcome } from './email-delivery-log'
import { firebaseAdmin } from './firebase-admin'
import { consentGroupForSite, orgDataCollectionForHost } from './organizations'

/** The facet field the stamp lives under. */
export const CONTACT_EMAIL_ENGAGEMENT_FIELD = 'lastEmailEngagementAtMs'

/** The event types that count as a person engaging with a campaign. */
const ENGAGEMENT_TYPES: ReadonlySet<EmailDeliveryEventOutcome['type']> = new Set([
  'opened',
  'clicked',
])

/**
 * Stamps the sending site's contact facet for every person these outcomes
 * say engaged for the first time with a message.
 *
 * @param hostId the site the campaign went out from — the `hostId` tag the
 *   send stamped, which is the only tenant identity a delivery event carries.
 * @returns how many contact documents were written.
 */
export async function recordContactEmailEngagement(args: {
  hostId: string
  outcomes: readonly EmailDeliveryEventOutcome[]
  firestore?: any
}): Promise<number> {
  const hostId = String(args.hostId ?? '')
  if (!hostId) return 0

  /** Address → the newest engagement instant in this batch. */
  const byEmail = new Map<string, number>()
  for (const outcome of args.outcomes) {
    if (!outcome.firstOfType) continue
    if (!ENGAGEMENT_TYPES.has(outcome.type)) continue
    const email = normalizeContactEmail(outcome.to)
    const at = Number(outcome.at)
    if (!email || !Number.isFinite(at) || at <= 0) continue
    byEmail.set(email, Math.max(byEmail.get(email) ?? 0, at))
  }
  if (!byEmail.size) return 0

  let contactsRef: FirebaseFirestore.CollectionReference
  let groupId: string
  try {
    contactsRef = await orgDataCollectionForHost(hostId, 'contacts')
    groupId = (await consentGroupForSite(hostId)).groupId
  } catch (error) {
    console.error('[contact-email-engagement] site could not be resolved', hostId, error)
    return 0
  }

  const db = args.firestore ?? firebaseAdmin.app().firestore()
  const field = contactFacetPath(groupId, CONTACT_EMAIL_ENGAGEMENT_FIELD)
  let written = 0
  for (const [email, at] of byEmail) {
    try {
      await db.runTransaction(async (transaction: any) => {
        /*
         * The same unscoped lookup the capture door makes — one human is one
         * row whichever site met them, and through the address index
         * (AGL-2633) the row is found under an address a merge folded into
         * it too — followed by the scope check the capture door's
         * `visibleTo` write is the source of. Read THROUGH the transaction:
         * the stamp below is a compare-and-set against the instant this
         * read saw.
         */
        const snapshot = await findContactByEmail(contactsRef, email, { transaction })
        if (!snapshot) return
        const data = (snapshot.data() ?? {}) as Record<string, unknown>
        if (!visibleToHost(data['visibleTo'] as string[] | undefined, hostId)) {
          return
        }
        const stored = Number(
          readContactFacet(data, groupId)[CONTACT_EMAIL_ENGAGEMENT_FIELD] ?? 0,
        )
        // Nothing moved forward, so nothing is written — the out-of-order
        // and the replayed event are the ordinary cases this skips.
        if (Number.isFinite(stored) && stored >= at) return
        transaction.update(snapshot.ref, { [field]: at })
        written += 1
      })
    } catch (error) {
      console.error('[contact-email-engagement] stamp failed', hostId, error)
    }
  }
  return written
}
