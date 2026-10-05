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
  type CrmDealContactRole,
  crmListFieldsPatch,
  dealContactRoleFields,
  dealContactRolesOf,
  dealContactRolesRepointed,
  dealContactRolesWithout,
} from '@aglyn/aglyn/app-utils/crm'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * A CONTACT LEAVING THE DEALS IT IS ON (AGL-3521): Salesforce's Opportunity
 * Contact Roles, kept in step with a contact that is merged away, deleted or
 * erased.
 *
 * A deal names its contacts twice over — every one in `contactRoles`, and
 * the Primary as `contactId` — so a deal is found by either:
 * `contactRoleContactIds` (the list field every writer stamps from the
 * roles) and `contactId` (a deal written before roles, which holds that
 * alone). Each match is rewritten through the one pure rule
 * (`dealContactRolesWithout` / `dealContactRolesRepointed`), its Primary and
 * `contactId` written together and its list fields restamped, so a written
 * deal falls out of both queries and the next pass finds only what is left.
 */

/** How many deals one pass reads, and one batch writes. */
const PAGE = 400
/** A ceiling on passes, so a query that keeps answering cannot loop forever. */
const PASSES = 25

/**
 * The deals naming `contactId`, each with that contact moved to `to` —
 * a merge's survivor — or, with `to` null, taken off the deal. A Primary
 * taken off leaves the deal with none, and `contactId` with it. Answers how
 * many deals were written. A failure is logged and that query's sweep
 * stops: a deal still naming the contact reads it as a person who is not
 * there, which is how a deal named a deleted contact before roles existed.
 */
export async function sweepDealContactRoles(
  firestore: FirebaseFirestore.Firestore,
  deals: FirebaseFirestore.CollectionReference,
  contactId: string,
  to: string | null,
  label: string,
): Promise<number> {
  if (!contactId || contactId === to) return 0
  let written = 0
  // Each query on its own: a deal the first could not reach may still name
  // the contact as its `contactId`.
  for (const field of ['contactRoleContactIds', 'contactId'] as const) {
    try {
      const query = deals.where(field, field === 'contactId' ? '==' : 'array-contains', contactId)
      for (let pass = 0; pass < PASSES; pass += 1) {
        const page = await query.limit(PAGE).get()
        if (page.empty) break
        const batch = firestore.batch()
        for (const deal of page.docs) {
          batch.update(deal.ref, dealContactRolesUpdate(deal.data() ?? {}, contactId, to))
        }
        await batch.commit()
        written += page.size
        if (page.size < PAGE) break
      }
    } catch (error) {
      console.error(`${label}: deal contact roles sweep failed on ${field}`, error)
    }
  }
  return written
}

/** One deal's update once `contactId` is moved to `to`, or taken off for `null`. */
export function dealContactRolesUpdate(
  deal: Record<string, unknown>,
  contactId: string,
  to: string | null,
): Record<string, unknown> {
  const roles = dealContactRolesOf(deal)
  const next: CrmDealContactRole[] =
    to === null ? dealContactRolesWithout(roles, contactId) : dealContactRolesRepointed(roles, contactId, to)
  const fields = dealContactRoleFields(next)
  const after = { ...deal, contactRoles: fields.contactRoles, contactId: fields.contactId ?? undefined }
  return {
    contactRoles: fields.contactRoles,
    contactId: fields.contactId ?? FieldValue.delete(),
    // The name the drawer copied beside the Primary goes when the Primary does.
    ...(fields.contactId !== deal['contactId'] ? { contactName: FieldValue.delete() } : {}),
    ...crmListFieldsPatch('deals', after),
    updatedAt: FieldValue.serverTimestamp(),
  }
}
