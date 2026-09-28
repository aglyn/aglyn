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

import { formCampaignFields } from '@aglyn/aglyn/app-utils/forms'

/**
 * `inCampaign` restamped from what each form's `campaignIds` now holds
 * (AGL-3330) — for the one writer of `campaignIds` that cannot say what it
 * is leaving behind.
 *
 * Every other writer sets the ids through `formCampaignFields`, which
 * returns the boolean beside them. A campaign's deletion takes its one id out
 * of every form holding it with `arrayRemove`, which is what keeps it from
 * clobbering a campaign added to the same form in the meantime — and which
 * means the write does not know whether the array came out empty. So each
 * form is read back inside a transaction and its flag set from the array as
 * it stands, which is exactly what a concurrent picker save would also
 * leave.
 *
 * Idempotent: a form whose flag already agrees is not written.
 *
 * @returns how many forms were restamped.
 */
export async function restampFormsInCampaign(
  firestore: FirebaseFirestore.Firestore,
  refs: readonly FirebaseFirestore.DocumentReference[],
): Promise<number> {
  let restamped = 0
  for (const formRef of refs) {
    const wrote = await firestore.runTransaction(async (tx) => {
      const form = await tx.get(formRef)
      if (!form.exists) return false
      const { inCampaign } = formCampaignFields(form.get('campaignIds'))
      if (form.get('inCampaign') === inCampaign) return false
      tx.update(formRef, { inCampaign })
      return true
    })
    if (wrote) restamped += 1
  }
  return restamped
}
