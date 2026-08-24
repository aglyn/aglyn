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

import { deploymentLivemode } from '@aglyn/aglyn/app-utils/stripe-deployment-mode'
import {
  ORG_BILLING_DOC_ID,
  ORG_BILLING_SUBCOLLECTION,
  STRIPE_CUSTOMER_ID_TEST_FIELD,
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

/**
 * Which PHYSICAL field holds this deployment's Stripe customer id (AGL-2486).
 *
 * Live keeps `stripeCustomerId`, so live behaviour is byte-identical to before
 * this existed and no stored document needs migrating. Test mode gets its own
 * slot, which starts empty on every org — the first test-mode checkout mints a
 * fresh test customer instead of sending a live `cus_…` to a `sk_test` key and
 * taking a 502.
 *
 * Read at call time rather than at module load: a spec flips
 * `process.env.STRIPE_SECRET_KEY` between cases, and a cached verdict would
 * make the second case answer for the first.
 */
function customerIdField(): 'stripeCustomerId' | typeof STRIPE_CUSTOMER_ID_TEST_FIELD {
  return deploymentLivemode() ? 'stripeCustomerId' : STRIPE_CUSTOMER_ID_TEST_FIELD
}

/**
 * Collapse a stored billing document to the logical shape callers expect.
 *
 * `stripeCustomerId` on the RESULT always means "the customer id for the mode
 * this deployment spends in". The test id never leaks out under its physical
 * name, and — the part that matters — test mode does NOT fall back to the live
 * id when its own slot is empty. That fallback is precisely the bug: it is what
 * sent `cus_UuQjDdd1oxPMNH` to a `sk_test` key.
 */
function projectBillingMode(doc: OrgBillingDoc): OrgBillingDoc {
  const stored = { ...(doc ?? {}) } as Record<string, unknown>
  const testId = stored[STRIPE_CUSTOMER_ID_TEST_FIELD]
  // The physical twin never reaches a caller in either mode: every reader
  // treats `stripeCustomerId` as THE customer, so a second field carrying a
  // second answer is exactly the ambiguity this fix removes.
  delete stored[STRIPE_CUSTOMER_ID_TEST_FIELD]
  if (deploymentLivemode()) return stored as OrgBillingDoc
  // No `??` fallback to the live id. That fallback IS the bug.
  stored['stripeCustomerId'] = (testId ?? null) as string | null
  return stored as OrgBillingDoc
}

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
  return projectBillingMode(await readStoredOrgBilling(orgId))
}

/**
 * The STORED document, before any mode projection — both physical ids intact.
 *
 * Private on purpose: a caller holding this holds two answers to "which
 * customer", which is the ambiguity `projectBillingMode` exists to remove. It
 * is factored out only so the mode census below reads the very same bytes
 * `readOrgBilling` reads, org-doc fallback included. Two separate reads would
 * be two chances to diverge, and the census exists precisely to explain what
 * `readOrgBilling` returned.
 */
async function readStoredOrgBilling(orgId: string): Promise<OrgBillingDoc> {
  const billingSnapshot = await orgBillingRef(orgId).get()
  if (billingSnapshot.exists) {
    return (billingSnapshot.data() ?? {}) as OrgBillingDoc
  }
  const orgSnapshot = await db().collection('orgs').doc(orgId).get()
  // The legacy inline fields predate mode-keying entirely, so anything found
  // there is a LIVE id by construction — the org doc was last written by a
  // `sk_live_` deployment. Projected by the caller all the same, so a
  // test-mode read of an un-backfilled org gets no customer rather than a live
  // one.
  return pickOrgBillingFields(orgSnapshot.data() as never) as OrgBillingDoc
}

/**
 * Which Stripe MODES this org has a stored customer for (AGL-2486, follow-up).
 *
 * `readOrgBilling` answering `stripeCustomerId: null` has two completely
 * different meanings — "this workspace has never been billed" and "this
 * workspace's customer lives in the other Stripe world and THIS deployment
 * cannot see it" — and every surface downstream rendered them as the same
 * sentence, "No invoices yet." That is the swallowed-query-as-measured-zero
 * shape: nothing looks wrong, and the wrong reading is the reassuring one.
 *
 * The fix is NOT to fall back to the other mode's id — that fallback is the
 * original bug, and it stays deleted. It is to let a caller say which of the
 * two silences it is looking at.
 *
 * Returns BOOLEANS, never ids. A test-mode surface asking this question must
 * not come away holding a live `cus_…`: it would have no legitimate use for
 * one, and putting it in a JSON response would publish a live customer id to
 * every browser on a test deployment.
 */
export async function readOrgBillingCustomerModes(
  orgId: string,
): Promise<{ live: boolean; test: boolean }> {
  if (!orgId) return { live: false, test: false }
  const stored = (await readStoredOrgBilling(orgId)) as Record<string, unknown>
  // A stored `null` (the webhook's "Stripe says this is gone") and an empty
  // string are both absences, so presence is a non-empty STRING — not `in`,
  // and not truthiness on an unknown.
  const present = (value: unknown) => typeof value === 'string' && value.length > 0
  return {
    live: present(stored['stripeCustomerId']),
    test: present(stored[STRIPE_CUSTOMER_ID_TEST_FIELD]),
  }
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
 * `writeInline` mirrored the keys back onto the org doc as well. It was on
 * during the migration so a rollback lost nothing, and is now OFF: writing them
 * inline is what the whole issue exists to stop, and leaving it on would let the
 * next Stripe webhook silently re-add the fields minutes after they were
 * deleted, re-opening the exposure with nothing to show for it.
 *
 * The option survives for a deliberate one-off rollback, and nothing passes it.
 *
 * The READ fallback in `readOrgBilling` deliberately stays. It costs one get on
 * a doc that no longer exists, and it is the only thing standing between an org
 * the backfill somehow missed and a paying workspace rendering as Free.
 */
export async function writeOrgBilling(
  orgId: string,
  patch: Partial<OrgBillingDoc>,
  options: { writeInline?: boolean } = {},
): Promise<void> {
  if (!orgId) return
  const { writeInline = false } = options
  const fields = pickOrgBillingFields(patch as never) as Record<string, unknown>
  // The logical key becomes the mode's PHYSICAL key (AGL-2486). A test-mode
  // write therefore cannot overwrite the live customer id — which it silently
  // did before this, destroying the live linkage on the first completed test
  // checkout.
  const field = customerIdField()
  if (field !== 'stripeCustomerId' && 'stripeCustomerId' in fields) {
    fields[field] = fields['stripeCustomerId']
    delete fields['stripeCustomerId']
  }
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

  // Off the PHYSICAL field, so a test-mode write indexes its own customer.
  // The index needs no mode-keying of its own: it is keyed by the customer id,
  // and Stripe ids are unique across modes, so the live and test entries are
  // two documents that both resolve to this org.
  const customerId = fields[field]
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
