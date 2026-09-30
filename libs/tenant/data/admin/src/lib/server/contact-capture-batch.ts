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
 * THE LOOKUPS OF MANY CAPTURES, PAID ONCE (AGL-3423).
 *
 * `upsertHostContact` is the one writer of the contacts collection, and for
 * a single capture it resolves everything it decides with on its own: the
 * site's org and consent group, the person the address already belongs to,
 * whether the site erased them, and how full the records band is. For a
 * form submission that is a handful of reads. For a file it was the same
 * handful again for every row, serially — a two-hundred-row chunk of an
 * Apollo export was thousands of round trips and three aggregate counts per
 * new person, and the request ran into the function's sixty seconds before
 * it could answer.
 *
 * A batch is those answers for every address in a request, read in a
 * number of round trips that does not grow with the file. The door is
 * handed it as {@link UpsertHostContactOptions.batch} and consults it in
 * place of each per-capture read; every decision is still the door's own,
 * made by the same code, so an import cannot drift into a second writer
 * with its own ideas about dedupe, consent, scope or the band.
 *
 * ## What a batch answers, and what it leaves to the door
 *
 * - **Who the address already is.** {@link findContactsByEmail} — the index
 *   and the `email` query, for every address at once. `claim` hands an
 *   address's answer out ONCE: a second capture of the same address in the
 *   same batch is asked live, so a create earlier in the batch is found
 *   rather than minted twice.
 * - **Whether the site erased them.** {@link hostErasedEmails}, one read.
 * - **Room in the records band.** One count, then a running tally in call
 *   order, so N creates admit exactly as N serial door calls would. A
 *   caller that creates OTHER records against the same band — the import's
 *   companies — spends from the same tally with {@link ContactCaptureBatch.admit},
 *   and may {@link ContactCaptureBatch.reserve} an address's room at its
 *   place in the file, so the order in which rows are later written does
 *   not decide which of them the band keeps.
 *
 * Any answer a batch does not have — a page of the lookup that failed, an
 * address it was not prepared with — is `undefined`, and the door reads for
 * itself exactly as it does without a batch.
 */

import {
  checkCrmRecordsQuota,
  type ConsentGroup,
} from '@aglyn/aglyn/server'
import { normalizeContactEmail } from '@aglyn/aglyn/app-utils/contacts'
import { firebaseAdmin } from './firebase-admin'
import { countCrmRecords } from './crm-records'
import { findContactsByEmail } from './contact-email-index'
import { hostErasedEmails } from './email-suppression'
import {
  consentGroupForSite,
  getOrgForHost,
  orgDataCollectionForHost,
} from './organizations'

/** The resolved answers a batch of captures on one site share. */
export interface ContactCaptureBatch {
  /** The site every capture in the batch is on; a door for another site ignores the batch. */
  readonly hostId: string
  readonly contactsRef: FirebaseFirestore.CollectionReference
  readonly group: ConsentGroup
  readonly orgBilling: Awaited<ReturnType<typeof getOrgForHost>>
  /**
   * What an address resolved to when the batch was prepared, without
   * spending it: the record, `null` for nobody, `undefined` for not known.
   */
  peek(email: string): FirebaseFirestore.DocumentSnapshot | null | undefined
  /**
   * The same answer, handed out once. Every later claim of the address is
   * `undefined`, so its door looks it up live.
   */
  claim(email: string): FirebaseFirestore.DocumentSnapshot | null | undefined
  /** Whether the site erased the address; `undefined` when the read failed. */
  erased(email: string): boolean | undefined
  /** Takes room for one more record in the band, now. False when the band refuses. */
  admit(): boolean
  /** Takes the address's room now, at its place in the caller's order. */
  reserve(email: string): boolean
  /** The door's question: the reserved answer when there is one, else {@link admit}. */
  admitCreate(email: string): boolean
}

/**
 * Reads, once, what every capture of `emails` on `hostId` would read for
 * itself. Throws only when the site or the band cannot be read at all —
 * the reads every capture would fail on — so a caller answers the request
 * rather than refusing every row one at a time.
 */
export async function prepareContactCaptureBatch(
  hostId: string,
  emails: readonly unknown[],
): Promise<ContactCaptureBatch> {
  const firestore = firebaseAdmin.app().firestore()
  const [contactsRef, orgBilling] = await Promise.all([
    orgDataCollectionForHost(hostId, 'contacts'),
    getOrgForHost(hostId),
  ])
  const group = await consentGroupForSite(
    hostId,
    (orgBilling?.org as Record<string, unknown> | undefined) ?? null,
  )
  const orgRef =
    contactsRef.parent ??
    firestore.collection('orgs').doc(String(orgBilling?.orgId ?? ''))
  const addresses = [
    ...new Set(
      emails
        .map((email) => normalizeContactEmail(email))
        .filter((email): email is string => !!email),
    ),
  ]
  const [existing, erased, counted] = await Promise.all([
    findContactsByEmail(contactsRef, addresses),
    hostErasedEmails(hostId, addresses, firestore),
    countCrmRecords(orgRef, contactsRef),
  ])

  const org = (orgBilling?.org as never) ?? null
  let used = counted.crmRecordsCount
  const claimed = new Set<string>()
  const tickets = new Map<string, boolean>()
  const admit = (): boolean => {
    if (!checkCrmRecordsQuota(org, used).allowed) return false
    used += 1
    return true
  }

  return {
    hostId,
    contactsRef,
    group,
    orgBilling,
    peek: (email) => existing.get(email),
    claim: (email) => {
      if (claimed.has(email)) return undefined
      claimed.add(email)
      return existing.get(email)
    },
    erased: (email) => (erased ? erased.has(email) : undefined),
    admit,
    reserve: (email) => {
      const ticket = tickets.get(email)
      if (ticket !== undefined) return ticket
      const admitted = admit()
      tickets.set(email, admitted)
      return admitted
    },
    admitCreate: (email) => {
      const ticket = tickets.get(email)
      if (ticket === undefined) return admit()
      tickets.delete(email)
      return ticket
    },
  }
}
