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

/*
 * WHERE A CHECKOUT STANDS IN ABANDONED-CART RECOVERY, WRITTEN ON IT (AGL-3321).
 *
 * `scanAbandonedCheckouts` acts on an open checkout that carries an email and
 * has not been reminded yet. The console's recovery queue counts the same
 * set with Firestore count queries, and a query cannot ask for a field a
 * document lacks — "no email" and "not reminded yet" are both absences on a
 * checkout written before this field existed. So every writer stamps the
 * state explicitly:
 *
 *  - `cart-checkout.ts` on create: `pending` with an email, `none` without.
 *  - `process-abandoned.ts` beside `remindedAtMs`: `reminded`.
 *
 * `status` still says whether the checkout is open; this says only where it
 * stands in recovery. `tools/scripts/backfill-checkout-recovery-state.mjs`
 * stamps the checkouts written before, from the same two fields.
 */

/** `scanAbandonedCheckouts` waits this long before it will remind a checkout. */
export const CHECKOUT_REMIND_AFTER_MS = 60 * 60 * 1000

/** …and gives up after this, marking the checkout `expired`. */
export const CHECKOUT_GIVE_UP_AFTER_MS = 7 * 24 * 60 * 60 * 1000

/**
 * - `pending` — carries an email and has not been reminded: the scan's work.
 * - `reminded` — the scan has sent (or settled) its one reminder.
 * - `none` — no email, so there is nobody to remind.
 */
export type CheckoutRecoveryState = 'pending' | 'reminded' | 'none'

/** The field every checkout writer stamps. */
export const CHECKOUT_RECOVERY_STATE_FIELD = 'recoveryState'

/**
 * A checkout's recovery state from what it stores, read the way
 * `scanAbandonedCheckouts` reads it: a truthy `remindedAtMs` retires it, and
 * without an email there is nobody to remind.
 */
export function checkoutRecoveryState(checkout: {
  email?: unknown
  remindedAtMs?: unknown
}): CheckoutRecoveryState {
  if (!checkout.email) return 'none'
  return checkout.remindedAtMs ? 'reminded' : 'pending'
}
