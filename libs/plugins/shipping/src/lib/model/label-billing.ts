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
 * WHAT A LABEL COSTS THE MERCHANT (AGL-3612). Pure; client-safe.
 *
 * A label on the platform's carrier accounts is billed to the PLATFORM by the
 * provider, so the platform recovers it from the merchant: at cost, plus
 * {@link LABEL_MARKUP_PCT}, which is ZERO — a pass-through, and any other
 * figure is the owner's decision, made here and nowhere else. A label on a
 * carrier account the merchant connected is billed to the merchant by the
 * carrier, so it costs them nothing here.
 */

/** The platform's markup on a label it pays for, in percent. The owner's call. */
export const LABEL_MARKUP_PCT = 0

/** How a label's cost is recovered. */
export type LabelBillingMethod =
  /** Taken from the merchant's Stripe balance when the label is bought. */
  | 'account_debit'
  /** Added to the workspace's next monthly usage invoice. */
  | 'usage_invoice'
  /** The merchant's own carrier account paid; nothing to recover. */
  | 'carrier_account'
  /** A test-mode label: nothing was charged by anyone. */
  | 'test'

export type LabelBillingState =
  /** Recovery not started. */
  | 'pending'
  /** Recovered: debited, or counted toward the month. */
  | 'charged'
  /** The provider refunded a void, and the merchant was given it back. */
  | 'credited'
  /** Nothing to recover. */
  | 'not_billed'
  /** The debit failed; the month's invoice carries it instead. */
  | 'deferred'

/** The cents the merchant is charged for a label that cost the platform `costCents`. */
export function labelChargeCents(costCents: number, markupPct: number = LABEL_MARKUP_PCT): number {
  const cost = Math.max(0, Math.round(Number(costCents) || 0))
  const pct = Number.isFinite(markupPct) && markupPct > 0 ? markupPct : 0
  return cost + Math.round((cost * pct) / 100)
}
