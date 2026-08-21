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
'use client'

import {
  campaignAttributionQuery,
  parseCampaignAttribution,
  type CampaignAttribution,
} from '@aglyn/aglyn'
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore'

/**
 * Keep the campaign that produced an account, on the account (AGL-1731).
 *
 * The GA4 `sign_up` hit already carries the campaign, and that answers "how
 * many signups did the September campaign produce". It cannot answer the
 * question the spend is actually judged on — "how much REVENUE did it
 * produce" — because that arrives weeks later, from a Stripe webhook, in a
 * process that has no browser session and no memory of a URL. Attribution has
 * to be durable to be worth having.
 *
 * ## Why `users/{uid}`, and why that is the erasure-safe answer
 *
 * The same document, and the same reasoning, as the AGL-1535 plan intent this
 * sits beside: signup already writes it, the rules already make it
 * owner-read/write, and it survives the email-verification wall — including
 * the very common case where the verification click happens on a phone, in
 * whatever browser the mail client opened, where no browser-local marker
 * exists at all.
 *
 * It is also the only shape that is automatically covered by the erasure
 * cascade. `eraseUser` does a `recursiveDelete(users/{uid})`, so a FIELD on
 * that document is erased and disclosed with the document; the export reads
 * the doc whole. AGL-1448 had to go and find three org-keyed collections that
 * the cascade could not see, and the lesson is that the invisible thing is
 * always a NEW top-level collection or a doc keyed outside those trees — a
 * new field on a document already swept is the one shape that cannot become a
 * fourth. That is why this is a field and not a `signupCampaigns` collection,
 * which is the design it would otherwise obviously want to be.
 *
 * ## Why it is never consumed
 *
 * Unlike the plan intent — which is read once, cleared, and would hijack
 * every future org jump if it were not — this is a fact about how the account
 * began. It has no expiry and no consume: a campaign that stopped being true
 * after seven days would be a campaign that could not be joined to a purchase
 * that closed in week three, which is precisely the join the field exists
 * for.
 */

const FIELD = 'signupCampaign'

interface StoredSignUpCampaign {
  /** The canonical wire form, e.g. `utm_source=google&utm_medium=cpc`. */
  query: string
  createdAtMs: number
}

/**
 * Record the campaign for the account that just signed up. Best-effort by
 * contract, like every other post-account-creation write on that page: a
 * failed attribution write must never surface as a failed sign-up.
 *
 * Writes nothing at all when there was no campaign — an organic signup should
 * leave no field, not an empty one, so that "arrived from nowhere" and "never
 * asked" stay distinguishable in whatever reads this later.
 */
export async function rememberSignUpCampaign(
  firestore: Firestore,
  uid: string,
  campaign: CampaignAttribution | null,
): Promise<void> {
  if (!firestore || !uid || !campaign) return
  const query = campaignAttributionQuery(campaign)
  if (!query) return
  const stored: StoredSignUpCampaign = { query, createdAtMs: Date.now() }
  try {
    await setDoc(doc(firestore, 'users', uid), { [FIELD]: stored }, { merge: true })
  } catch (error) {
    console.error('sign-up campaign write failed', error)
  }
}

/**
 * Read back the campaign an account began with, or null.
 *
 * Re-parsed rather than trusted, for the same reason the plan intent is:
 * `users/{uid}` is owner-writable, so this field is owner-forgeable. Re-parsing
 * through the allowlist means a hand-edited document can name no more than a
 * hand-edited URL could — a marketing label, capped and scrubbed, and nothing
 * that touches entitlement or price.
 */
export async function readSignUpCampaign(
  firestore: Firestore,
  uid: string,
): Promise<CampaignAttribution | null> {
  if (!firestore || !uid) return null
  let stored: Partial<StoredSignUpCampaign> | null = null
  try {
    const snapshot = await getDoc(doc(firestore, 'users', uid))
    stored = (snapshot.data()?.[FIELD] ?? null) as typeof stored
  } catch (error) {
    // A denied or offline read costs a report row, never a page.
    console.error('sign-up campaign read failed', error)
    return null
  }
  if (!stored || typeof stored.query !== 'string' || !stored.query) return null
  return parseCampaignAttribution(new URLSearchParams(stored.query))
}
