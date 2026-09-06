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
 * DELETING A COMPANY IS A DETACH PASS AND THEN A DELETE (AGL-2597; shared
 * by the record page and the bulk bar since AGL-2621).
 *
 * Firestore does not cascade. A bare `deleteDoc` would leave every contact
 * at the company naming a record that no longer exists: their page would
 * render a link to nothing, and the `companyIds` mirror the company list
 * queries would keep matching a ghost. So the delete reads the contacts
 * that name this company, takes it off each of them in one batch, and
 * removes the document only when nobody is left pointing at it.
 *
 * Bounded at {@link COMPANY_DETACH_LIMIT} per pass — a batch holds that many
 * writes — and honest past it: the pass detaches what it can, reports that
 * more remain, and leaves the company standing so the next delete continues
 * from where this one stopped. A company is never deleted with a link still
 * on a contact.
 */

import { CRM_COLLECTIONS } from '@aglyn/aglyn'
import {
  collection,
  deleteDoc,
  doc,
  type Firestore,
  getDocs,
  limit,
  query,
  where,
  writeBatch,
} from 'firebase/firestore'
import {
  COMPANY_DETACH_LIMIT,
  CONTACT_COMPANY_IDS_FIELD,
  companyDetachUpdate,
} from './companies'

export interface CompanyDeleteOutcome {
  /** The document is gone. False when a pass detached and more remain. */
  deleted: boolean
  /** How many contacts this pass unlinked. */
  detached: number
  /** The pass hit its bound; the company stands until the next delete. */
  moreRemain: boolean
}

/** One company: unlink the contacts a batch can hold, then delete if nobody is left. */
export async function deleteCompanyDetaching(
  firestore: Firestore,
  scope: readonly [string, string],
  companyId: string,
): Promise<CompanyDeleteOutcome> {
  /*
   * One over the limit, so "more remain" is a fact from the probe row and
   * not a guess from a full page — the same reason the paged lists
   * over-fetch by one.
   */
  const probe = await getDocs(
    query(
      collection(firestore, scope[0], scope[1], 'contacts'),
      where(CONTACT_COMPANY_IDS_FIELD, 'array-contains', companyId),
      limit(COMPANY_DETACH_LIMIT + 1),
    ),
  )
  const linked = probe.docs.slice(0, COMPANY_DETACH_LIMIT)
  const moreRemain = probe.docs.length > COMPANY_DETACH_LIMIT
  if (linked.length) {
    const batch = writeBatch(firestore)
    for (const snapshot of linked) {
      batch.update(snapshot.ref, companyDetachUpdate(snapshot.data(), companyId))
    }
    await batch.commit()
  }
  if (moreRemain) {
    return { deleted: false, detached: linked.length, moreRemain }
  }
  await deleteDoc(
    doc(firestore, scope[0], scope[1], CRM_COLLECTIONS.companies, companyId),
  )
  return { deleted: true, detached: linked.length, moreRemain: false }
}

/**
 * What a failed delete says.
 *
 * The contact read runs without a scope predicate — it cannot carry one
 * beside the `array-contains` on the mirror — so the rules admit it only to
 * an org-wide member. A site-scoped member's delete stops there, and is
 * told why rather than shown a generic failure.
 */
export function companyDeleteFailureMessage(error: unknown): string {
  const denied =
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'permission-denied'
  return denied
    ? 'Your access is limited to specific sites, so the contacts at ' +
        'this company could not be read to unlink them. Ask an ' +
        'organization administrator to delete it.'
    : 'An error has occurred'
}
