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
  ORG_BILLING_DOC_ID,
  ORG_BILLING_SUBCOLLECTION,
  STRIPE_CUSTOMER_INDEX_COLLECTION,
  hasInlineOrgBilling,
  orgBillingStatusFrom,
  pickOrgBillingFields,
  type OrgBillingDoc,
} from '@aglyn/aglyn/server'
import { firebaseAdmin } from './firebase-admin'

/**
 * Server-side accessors for the manager-gated billing document (AGL-1028).
 *
 * Every server surface that used to read `orgs/{orgId}.stripeCustomerId` /
 * `.subscription` / `.seatAddons` goes through here instead. All of them are
 * Admin SDK, so rules never applied to them — this is a path change, not a
 * permission change. The permission change is entirely in the rules, where the
 * new subcollection is gated on `canManageOrg()`.
 */

const db = () => firebaseAdmin.app().firestore()

/** `orgs/{orgId}/billing/stripe`. */
export function orgBillingRef(orgId: string) {
  return db()
    .collection('orgs')
    .doc(orgId)
    .collection(ORG_BILLING_SUBCOLLECTION)
    .doc(ORG_BILLING_DOC_ID)
}

/**
 * Reads an org's commercial keys, falling back to the org doc.
 *
 * The fallback is what makes the migration safe to land in pieces: a reader
 * repointed here keeps working against an org that has not been backfilled
 * yet, and keeps working if the backfill missed one. It stops being reachable
 * only when the inline fields are finally deleted from the org doc — which is
 * the LAST step, taken once production has been observed reading from the new
 * location.
 *
 * Without it, the failure mode is silent and expensive: a missing billing doc
 * reads as `undefined`, which every caller downstream interprets as "no
 * subscription", i.e. a paying workspace rendered as Free.
 */
export async function readOrgBilling(orgId: string): Promise<OrgBillingDoc> {
  if (!orgId) return {}
  const billingSnapshot = await orgBillingRef(orgId).get()
  if (billingSnapshot.exists) {
    return (billingSnapshot.data() ?? {}) as OrgBillingDoc
  }
  const orgSnapshot = await db().collection('orgs').doc(orgId).get()
  return pickOrgBillingFields(orgSnapshot.data() as never) as OrgBillingDoc
}

/**
 * Writes the commercial keys to the billing doc and mirrors the status.
 *
 * Three writes, one batch:
 *
 * 1. the billing doc itself, `merge: true` to match what the org-doc write did;
 * 2. `billingStatus` back onto the org doc, so the AGL-275 dunning banner keeps
 *    working for non-managers who can no longer read `subscription`;
 * 3. the `stripeCustomers` reverse index, so the webhook can still resolve an
 *    org from a Stripe customer id without a query.
 *
 * `writeInline` keeps the old org-doc fields updated as well. It is on during
 * the migration so a rollback loses nothing, and comes off in the same commit
 * that deletes those fields.
 */
export async function writeOrgBilling(
  orgId: string,
  patch: Partial<OrgBillingDoc>,
  options: { writeInline?: boolean } = {},
): Promise<void> {
  if (!orgId) return
  const { writeInline = true } = options
  const fields = pickOrgBillingFields(patch as never)
  const batch = db().batch()
  const orgRef = db().collection('orgs').doc(orgId)

  batch.set(orgBillingRef(orgId), fields, { merge: true })

  // The status mirror is derived, so it is only written when this patch
  // actually carries a subscription — otherwise a partial update (a seat-addon
  // change, say) would blank the banner's input.
  const orgPatch: Record<string, unknown> = writeInline ? { ...fields } : {}
  if (patch.subscription !== undefined) {
    orgPatch['billingStatus'] = orgBillingStatusFrom(patch)
  }
  if (Object.keys(orgPatch).length) batch.set(orgRef, orgPatch, { merge: true })

  const customerId = fields.stripeCustomerId
  if (typeof customerId === 'string' && customerId) {
    batch.set(
      db().collection(STRIPE_CUSTOMER_INDEX_COLLECTION).doc(customerId),
      { orgId, updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp() },
      { merge: true },
    )
  }

  await batch.commit()
}

/**
 * Resolves an org id from a Stripe customer id.
 *
 * Prefers the reverse index; falls back to the legacy `where('stripeCustomerId')`
 * query on `orgs` for customers whose index entry has not been written yet.
 * The fallback disappears with the inline fields.
 */
export async function findOrgIdByStripeCustomer(
  customerId: string,
): Promise<string | null> {
  if (!customerId) return null
  const indexed = await db()
    .collection(STRIPE_CUSTOMER_INDEX_COLLECTION)
    .doc(customerId)
    .get()
  const mapped = indexed.get('orgId')
  if (typeof mapped === 'string' && mapped) return mapped
  const legacy = await db()
    .collection('orgs')
    .where('stripeCustomerId', '==', customerId)
    .limit(1)
    .get()
  return legacy.docs[0]?.id ?? null
}

/** Re-exported so callers do not need a second import to test migration state. */
export { hasInlineOrgBilling }
