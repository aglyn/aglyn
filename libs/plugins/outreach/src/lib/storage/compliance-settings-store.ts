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
 * Where the organization's compliance settings are kept (AGL-2980):
 * `orgs/{orgId}/outreachSettings/compliance`, one document.
 *
 * SERVER ONLY. The rules let an Outreach member read the document and refuse
 * every client write, so the settings route is the one writer and this is
 * the one place that knows the path. The sending runtime reads it through
 * {@link readOutreachComplianceSettingsDoc} before every send, because the
 * footer is written from it and must say what the organization says now.
 *
 * Firestore is a parameter throughout, as in the CRM's server modules: the
 * callers hold one, and a module that reached for the Admin app itself
 * would drag it into every spec that only wants the arithmetic.
 */

import {
  outreachComplianceSettingsEqual,
  readOutreachComplianceSettings,
} from '../model/compliance-settings'
import {
  OUTREACH_COLLECTIONS,
  OUTREACH_COMPLIANCE_SETTINGS_ID,
  type OutreachComplianceSettings,
  type OutreachComplianceSettingsDocument,
} from '../model/outreach.types'

/** `orgs/{orgId}/outreachSettings/compliance`. */
export function outreachComplianceSettingsRef(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
): FirebaseFirestore.DocumentReference {
  return firestore
    .collection('orgs')
    .doc(orgId)
    .collection(OUTREACH_COLLECTIONS.settings)
    .doc(OUTREACH_COMPLIANCE_SETTINGS_ID)
}

/**
 * The organization's compliance settings, defaults applied — an
 * organization that never saved them reads as no legal name, no address,
 * and the United States alone.
 */
export async function readOutreachComplianceSettingsDoc(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
): Promise<OutreachComplianceSettingsDocument> {
  const snapshot = await outreachComplianceSettingsRef(firestore, orgId).get()
  return readOutreachComplianceSettings(snapshot.exists ? snapshot.data() : null)
}

export interface WriteOutreachComplianceSettingsInput {
  orgId: string
  /** Already validated: `validateOutreachComplianceSettings(...).settings`. */
  settings: OutreachComplianceSettings
  byUid: string
  nowMs: number
}

export interface WriteOutreachComplianceSettingsResult {
  settings: OutreachComplianceSettingsDocument
  /** False when the save said what was already stored, and nothing was written. */
  changed: boolean
}

/**
 * Stores the settings when they differ from what is stored, in a
 * transaction, so two members saving at once each compare against the
 * other's write rather than both believing they changed nothing — and the
 * activity line a change earns is written once per actual change.
 */
export async function writeOutreachComplianceSettings(
  firestore: FirebaseFirestore.Firestore,
  input: WriteOutreachComplianceSettingsInput,
): Promise<WriteOutreachComplianceSettingsResult> {
  const ref = outreachComplianceSettingsRef(firestore, input.orgId)
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const current = readOutreachComplianceSettings(snapshot.exists ? snapshot.data() : null)
    // A document that was never saved is a change even when the save
    // restates the defaults: the organization has now said them.
    if (snapshot.exists && outreachComplianceSettingsEqual(current, input.settings)) {
      return { settings: current, changed: false }
    }
    const next: OutreachComplianceSettingsDocument = {
      legalName: input.settings.legalName,
      brandName: input.settings.brandName,
      postalAddress: input.settings.postalAddress,
      allowedCountries: [...input.settings.allowedCountries],
      updatedAtMs: input.nowMs,
      updatedByUid: input.byUid,
    }
    transaction.set(ref, next)
    return { settings: next, changed: true }
  })
}
