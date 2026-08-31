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
 * WHERE ITEM 3 IS KEPT — one document per filing period.
 *
 * SERVER-ONLY. The shape, the validation and the rule that an unentered
 * period is `not computed` all live in `utils/taxable-purchases.ts`, which is
 * where they can be asserted without a Firestore.
 *
 * ## The period is the document id, and that is the isolation
 *
 * `platformTaxablePurchases/{period}`. There is no query, no scan and no
 * "latest entry" — a read for `2026-Q4` addresses that document and can
 * return no other, so a figure entered for one quarter has no path onto
 * another quarter's return. The alternative shape, one record holding a map
 * of periods, would put that isolation in a lookup that a partial write could
 * get wrong.
 *
 * ## Not cached
 *
 * `tax-filing-store.ts` caches for 15 seconds because its answer is one value
 * read on every page load. This one is per period, read on a staff page a
 * handful of times a quarter, and is written and immediately re-read by the
 * operator who wrote it. A cache would buy nothing and would let a filer see
 * their own entry missing for fifteen seconds after saving it.
 *
 * ## Deny-all, like every platform setting
 *
 * The collection admits no client at all (`cloud/firebase-firestore.rules`).
 * Every read here goes through the Admin SDK behind the staff gate on the two
 * routes that use it.
 */

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  taxablePurchasesEntry,
  taxablePurchasesPeriodKey,
  type StoredTaxablePurchases,
  type TaxablePurchasesEntry,
} from '../taxable-purchases'

/** One document per filing period. Nobody's browser may read it. */
export const TAXABLE_PURCHASES_COLLECTION = 'platformTaxablePurchases'

/** The `adminAudit.target` a change to one period is recorded against. */
export function taxablePurchasesTarget(period: string): string {
  return `${TAXABLE_PURCHASES_COLLECTION}/${period}`
}

/**
 * The entry stored for one period, or `null`.
 *
 * A read FAILURE also returns `null`, and null renders `not computed`. That is
 * the safe direction here and it is worth saying why, because for the filing
 * configuration the safe direction was the opposite: falling back to "no
 * figure" asks the operator for a number they already have to hand, while
 * inventing one — or worse, a zero — would put an unsupported figure on a
 * document signed under penalty of perjury.
 */
export async function readTaxablePurchases(
  period: string,
  options?: { firestore?: any },
): Promise<TaxablePurchasesEntry | null> {
  const key = taxablePurchasesPeriodKey(period)
  if (!key) return null
  try {
    const firestore = options?.firestore ?? firebaseAdmin.app().firestore()
    const snapshot = await firestore
      .collection(TAXABLE_PURCHASES_COLLECTION)
      .doc(key)
      .get()
    if (!snapshot?.exists) return null
    return taxablePurchasesEntry(
      (snapshot.data() ?? null) as StoredTaxablePurchases | null,
      key,
    )
  } catch (error) {
    // The period is safe to log — it is a quarter, not a customer. Nothing
    // else from this document reaches a log line.
    console.error('[taxable-purchases-store] entry unavailable', key, error)
    return null
  }
}
