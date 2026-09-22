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
 * An open lead, closed as converted because the person became a
 * relationship on their own (AGL-3232).
 *
 * Salesforce closes a lead when somebody converts it. Aglyn has two doors
 * that make a person a contact without anybody deciding anything — a
 * member account and a purchase — and a lead left open behind either of
 * them is a rep chasing a customer. So a relationship capture asks here,
 * after the contact exists: the site's lead for the address, if it is
 * still open, is stamped converted onto that contact, the way the convert
 * dialog stamps one, with `convertedBy` saying which door did it.
 *
 * Only an OPEN lead: one already converted names its contact and must keep
 * naming it, and one closed as unqualified was a decision — a person the
 * team judged not real who then buys something is a fact for the contact's
 * timeline, not a reason to rewrite the team's verdict.
 *
 * Never throws: the capture that made the contact has already happened,
 * and a lead that could not be stamped is one somebody converts by hand.
 */

import {
  type CrmLeadFields,
  isCrmLeadOpen,
  normalizeContactEmail,
  personKey,
} from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'

/** Which door closed the lead, recorded on it beside the conversion stamp. */
export type LeadAutoConvertedBy = 'signup' | 'purchase' | 'backfill'

export interface ConvertOpenLeadOntoContactInput {
  hostId: string
  email: unknown
  /** `orgs/{orgId}/contacts/{contactId}` — the relationship the lead became. */
  contactId: string
  by: LeadAutoConvertedBy
}

/**
 * Stamp the site's open lead for `email` as converted onto `contactId`.
 * `true` when a lead was stamped; `false` when the site holds none, holds
 * one that is not open, or the write failed.
 */
export async function convertOpenLeadOntoContact(
  input: ConvertOpenLeadOntoContactInput,
): Promise<boolean> {
  const email = normalizeContactEmail(input.email)
  const key = email ? personKey(email) : null
  if (!key || !input.contactId) return false
  try {
    const leadRef = firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(input.hostId)
      .collection('leads')
      .doc(key)
    const snapshot = await leadRef.get()
    if (!snapshot.exists) return false
    const lead = (snapshot.data() ?? {}) as Record<string, unknown> & CrmLeadFields
    if (lead.convertedContactId || !isCrmLeadOpen(lead)) return false
    await leadRef.set(
      {
        status: 'qualified',
        convertedContactId: input.contactId,
        convertedAtMs: Date.now(),
        convertedBy: input.by,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    return true
  } catch (error) {
    console.error('convertOpenLeadOntoContact failed', input.hostId, error)
    return false
  }
}

export default convertOpenLeadOntoContact
