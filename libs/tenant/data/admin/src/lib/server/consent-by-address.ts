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
 * A person's consent as their CONTACT records it, read by address.
 *
 * Three surfaces ask this, and they must get one answer:
 *
 *  - the list gate (`email/list-members-preview` and `-add`), deciding
 *    whether an address can be enrolled and on what basis;
 *  - `performCampaignSend`, for a list member a rule enrolled — the
 *    materializer writes no basis onto those rows, because matching a rule is
 *    not an opt-in, so the person's real basis is the one on their contact;
 *  - the list's Consent column, which shows what the send will act on.
 *
 * A copy per surface agrees only until the shape moves, which is how the
 * Consent column once reported every member as having no basis while the
 * sender mailed them.
 */

import type { ConsentGroup } from '@aglyn/aglyn/app-utils/consent-groups'
import { normalizeContactEmail } from '@aglyn/aglyn/app-utils/contacts'
import {
  grantEntriesAsRecorded,
  readMarketingBasis,
  type MarketingConsentRecord,
} from '@aglyn/aglyn/app-utils/marketing-consent'
import {
  refusalsOf,
  withRetainedRefusals,
} from '@aglyn/aglyn/app-utils/retained-refusals'
import { readRetainedRefusals } from './retained-refusals'

/** Addresses per `in` query — Firestore's disjunction limit. */
export const CONTACT_LOOKUP_CHUNK = 30

/**
 * The stored consent facts for these addresses, off the org's contacts.
 *
 * Read UNSCOPED, deliberately, exactly as the Inbox route reads it:
 * `scopedToHost` narrows an org collection to what one site may see, and a
 * refusal filtered out by that narrowing is a refusal the caller would then
 * step over — the failure mode is mailing or enrolling somebody who said no.
 * A grant cannot leak across sites through this read either: the record is
 * read for `group`, so another site's opt-in answers `otherGrant`, never
 * `granted`. Callers serving a browser must still prove the requester is an
 * org-wide member, which is the tier the rules grant the whole org's
 * contacts to.
 *
 * ## A refusal wins over an opt-in when the CRM holds both
 *
 * Nothing guarantees one contact per address — the collection is keyed by
 * resource id, not by email — so two records for one person can disagree.
 * Taking whichever the query happened to answer first would make the outcome
 * depend on document order. A recorded refusal is the answer whenever one
 * exists, which is the same precedence `assignmentBasis` applies within a
 * single record.
 *
 * ## A refusal outlives the contact it was written on (AGL-3338)
 *
 * Deleting a contact keeps every refusal it held in the org's retained store,
 * so the address is read with what was retained laid over whatever record is
 * left — `withRetainedRefusals` — and an address with no contact at all still
 * reads `declined` when its person said no. A grant given after the refusal,
 * on a contact the person signed up again through, is the person changing
 * their mind and reads `granted`. The grants carried onto a membership come
 * off the same merged record.
 *
 * A failed read falls to `declined` for the whole batch: a read that throws
 * can neither say the person consented nor that they refused, and the
 * direction that costs a retry is the one that does not reach somebody whose
 * stored refusal we simply failed to see. The retained store is read the
 * same way, and fails the same way.
 *
 * @param contacts the org's contacts collection
 *                 (`orgDataCollectionForHost(hostId, 'contacts')`), passed
 *                 as the pending lookup so a failure to resolve it reads as
 *                 the same `declined` as a failed query.
 * @param addresses normalized addresses (`normalizeContactEmail`).
 */
export async function readContactConsent(
  contacts:
    | FirebaseFirestore.CollectionReference
    | Promise<FirebaseFirestore.CollectionReference>,
  group: ConsentGroup,
  addresses: readonly string[],
): Promise<{
  stored: Map<string, MarketingConsentRecord>
  grants: Map<string, Record<string, Record<string, unknown>>>
}> {
  const found = new Map<string, MarketingConsentRecord>()
  const grants = new Map<string, Record<string, Record<string, unknown>>>()
  if (!addresses.length) {
    // Nothing to read, so the pending lookup is never awaited; a rejection
    // it carries is settled here rather than surfacing as unhandled.
    Promise.resolve(contacts).catch(() => undefined)
    return { stored: found, grants }
  }
  try {
    const collection = await contacts
    const chunks: string[][] = []
    for (let at = 0; at < addresses.length; at += CONTACT_LOOKUP_CHUNK) {
      chunks.push(addresses.slice(at, at + CONTACT_LOOKUP_CHUNK))
    }
    const [snapshots, retained] = await Promise.all([
      Promise.all(chunks.map((chunk) => collection.where('email', 'in', chunk).get())),
      readRetainedRefusals(collection, addresses),
    ])
    const consider = (email: string, data: Record<string, unknown> | null) => {
      const merged = withRetainedRefusals(data, refusalsOf(retained.get(email)))
      const record = readMarketingBasis(merged, group)
      const already = found.get(email)
      if (already?.basis === 'declined') return
      if (already && record.basis !== 'declined') return
      found.set(email, record)
      grants.set(email, grantEntriesAsRecorded(merged, group))
    }
    for (const snapshot of snapshots) {
      for (const doc of snapshot.docs) {
        const email = normalizeContactEmail(doc.get('email'))
        if (email) consider(email, doc.data() as Record<string, unknown>)
      }
    }
    // What was retained for an address no contact answers any more.
    for (const email of retained.keys()) {
      if (!found.has(email)) consider(email, null)
    }
    return { stored: found, grants }
  } catch (error) {
    console.error('[email] consent lookup failed', error)
    const refused: MarketingConsentRecord = {
      ...readMarketingBasis(null, group),
      basis: 'declined',
      // Attributed to nobody: this is what a failed read falls back to, not a
      // refusal anybody recorded.
      assertedBy: null,
      source: null,
      basisAtMs: null,
      capturedAtMs: null,
    }
    return {
      stored: new Map(addresses.map((email) => [email, refused])),
      // Nobody is reachable on a failed read, so nobody's grants travel.
      grants: new Map(),
    }
  }
}

/**
 * Lays each rule-enrolled member's contact basis over the basis its row
 * carries, where the row carries none.
 *
 * A row the dynamic-list materializer wrote (`via: 'rule'`) never holds a
 * basis of its own — see the ⛔ in `dynamic-list-materialize.ts` — so for
 * those rows the person's contact is the record. Only an `unrecorded` row
 * is filled: a basis stored on the membership (an attestation, an opt-in an
 * automation carried, a refusal) is a fact about that membership and stays
 * the answer. Rows enrolled any other way are untouched.
 *
 * @param contacts as for {@link readContactConsent}.
 * @param records the members' own records, keyed by normalized address;
 *                updated in place.
 * @param ruleMembers the normalized addresses of the `via: 'rule'` rows.
 */
export async function withContactConsentForRuleMembers(
  contacts:
    | FirebaseFirestore.CollectionReference
    | Promise<FirebaseFirestore.CollectionReference>,
  group: ConsentGroup,
  records: Map<string, MarketingConsentRecord>,
  ruleMembers: ReadonlySet<string>,
): Promise<Map<string, MarketingConsentRecord>> {
  const unrecorded = [...ruleMembers].filter(
    (email) => (records.get(email)?.basis ?? 'unrecorded') === 'unrecorded',
  )
  if (!unrecorded.length) return records
  const { stored } = await readContactConsent(contacts, group, unrecorded)
  for (const email of unrecorded) {
    const fromContact = stored.get(email)
    if (fromContact) records.set(email, fromContact)
  }
  return records
}
