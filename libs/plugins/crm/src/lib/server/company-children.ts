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

import { FieldValue } from 'firebase-admin/firestore'
import { COMPANY_DETACH_LIMIT } from '../model/company-delete-route'

/**
 * Clear `parentCompanyId` on at most `limit` companies under `companyId`
 * (AGL-3514), and say whether more remain. Shared by `crm/company-delete`
 * and the REST resource's delete, which calls it until none remain.
 */
export async function detachChildCompanies(
  firestore: FirebaseFirestore.Firestore,
  companies: FirebaseFirestore.CollectionReference,
  companyId: string,
  limit: number = COMPANY_DETACH_LIMIT,
): Promise<{ detached: number; moreRemain: boolean }> {
  // One past the bound, so "more remain" is a fact from the probe row.
  const probe = await companies
    .where('parentCompanyId', '==', companyId)
    .limit(limit + 1)
    .get()
  const children = probe.docs.slice(0, limit)
  if (children.length) {
    const batch = firestore.batch()
    for (const child of children) {
      batch.update(child.ref, {
        parentCompanyId: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
    await batch.commit()
  }
  return { detached: children.length, moreRemain: probe.docs.length > limit }
}
