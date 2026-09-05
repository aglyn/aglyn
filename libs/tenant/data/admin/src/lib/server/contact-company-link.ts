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
 * The contact–company link as the Admin SDK writes it (AGL-2613).
 *
 * The console's writers apply `planContactCompanyLink` with the client
 * SDK's sentinels; the server doors — the capture that links on domain, the
 * create route, a lead's conversion, the upsert carrying a door's company —
 * apply the same plan with `FieldValue`'s. One planner, two sentinel sets,
 * and this file is the second: nothing here decides whether an id leaves the
 * mirror, it only spells the answer in Admin terms.
 *
 * Imported by module path rather than from the `@aglyn/aglyn/server` barrel,
 * for the reason `upsert-contact.ts` gives: the door's specs substitute a
 * fixture barrel, and a helper that reached the planner only through the
 * barrel would find `undefined` there and take the door down with it.
 */

import {
  COMPANY_CONTACTS_COUNT_FIELD,
  CONTACT_COMPANY_IDS_FIELD,
  type ContactCompanyLinkPlan,
  planContactCompanyLink,
  readContactCompanyLink,
} from '@aglyn/aglyn/app-utils/crm'
import { contactFacetPath } from '@aglyn/aglyn/app-utils/contacts'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * The plan's mirror change as the sentinel — or array — an Admin write takes.
 * Both an `update()` and a merge-`set()` accept these at the top level of
 * the document, which is where the mirror lives.
 */
export function contactCompanyMirrorValue(
  plan: ContactCompanyLinkPlan,
): unknown | undefined {
  const change = plan.mirror
  if (!change) return undefined
  if (change.op === 'union') return FieldValue.arrayUnion(change.companyId)
  if (change.op === 'remove') return FieldValue.arrayRemove(change.companyId)
  return change.companyIds
}

/**
 * The contact's patch for a plan, in `update()` shape: the holder's facet by
 * DOTTED path — a nested object would replace every other holder's facet —
 * and the mirror at the top of the document.
 */
export function contactCompanyLinkFields(
  plan: ContactCompanyLinkPlan,
  groupId: string,
): Record<string, unknown> {
  const mirror = contactCompanyMirrorValue(plan)
  return {
    [contactFacetPath(groupId, 'companyId')]: plan.companyId ?? FieldValue.delete(),
    ...(mirror !== undefined ? { [CONTACT_COMPANY_IDS_FIELD]: mirror } : {}),
  }
}

/** The company's patch: its contacts count moved by `delta`. */
export function companyContactsCountFields(delta: number): Record<string, unknown> {
  return { [COMPANY_CONTACTS_COUNT_FIELD]: FieldValue.increment(delta) }
}

/**
 * Move each company's count the plan names, one `update()` each, without
 * failing the caller.
 *
 * Separate writes rather than a batch, for the callers that cannot batch:
 * the upsert has already written the contact by the time it knows the plan
 * held, and a capture door must not fail because a company document was
 * deleted between the link and the count. A count that could not move is
 * logged and left; the company's own page takes the live aggregate, which
 * is what corrects a stale figure.
 */
export async function settleCompanyContactsCounts(
  companiesRef: FirebaseFirestore.CollectionReference | null,
  plan: ContactCompanyLinkPlan | null,
): Promise<void> {
  if (!companiesRef || !plan?.counts.length) return
  await Promise.all(
    plan.counts.map((count) =>
      companiesRef
        .doc(count.companyId)
        .update(companyContactsCountFields(count.delta))
        .catch((error: unknown) => {
          console.error(
            'contact company count could not move',
            count.companyId,
            count.delta,
            error,
          )
        }),
    ),
  )
}

export interface WriteContactCompanyLinkOptions {
  firestore: FirebaseFirestore.Firestore
  contactRef: FirebaseFirestore.DocumentReference
  /**
   * The stored contact, BEFORE this write — what the planner reads the
   * previous link and the mirror off. `null` for a row the caller has just
   * created with no company on it.
   */
  contact: Record<string, unknown> | null | undefined
  companiesRef: FirebaseFirestore.CollectionReference
  groupId: string
  /** The company to link for this holder, or `null` to unlink. */
  companyId: string | null
}

/**
 * Link a contact to a company FOR ONE HOLDER — or unlink, with `null` — as
 * ONE commit: the facet and the mirror on the contact, and the count on
 * each company the link moves. `null` when the document already said so.
 *
 * A batch rather than two writes because the count is a derived figure of
 * the mirror: a mirror that changed while the count did not is a company
 * list that says "3" over a page of four. `updatedAt` moves on the contact
 * — a link is an edit of the person's record — and not on the company,
 * whose list is ordered by its own edits and would otherwise reshuffle on
 * every capture.
 */
export async function writeContactCompanyLink(
  options: WriteContactCompanyLinkOptions,
): Promise<ContactCompanyLinkPlan | null> {
  const { firestore, contactRef, contact, companiesRef, groupId, companyId } =
    options
  const plan = planContactCompanyLink(
    readContactCompanyLink(contact, groupId),
    companyId,
  )
  if (!plan) return null
  const batch = firestore.batch()
  batch.update(contactRef, {
    ...contactCompanyLinkFields(plan, groupId),
    updatedAt: FieldValue.serverTimestamp(),
  })
  for (const count of plan.counts) {
    batch.update(
      companiesRef.doc(count.companyId),
      companyContactsCountFields(count.delta),
    )
  }
  await batch.commit()
  return plan
}
