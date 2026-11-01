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

/** The card a quote names, as far as this person may see it. */
export interface PayQuoteCard {
  type?: string | null
  brand?: string | null
  last4?: string | null
  email?: string | null
}

/** What the pay door answers a `quote` with: what will be charged, before it is. */
export interface PayQuote {
  listingName: string
  amountCents: number
  taxCents: number
  totalCents: number
  /** `null` for someone who may buy but may not see billing. */
  card: PayQuoteCard | null
  /** Whether this person holds `billing.manage`, which paying takes. */
  canPay: boolean
}

/** The two things a workspace needs before it can be charged. */
export type PayPrerequisite = 'card_required' | 'billing_address_required'

/** Reads the prerequisite a refusal names, or `null` when it names none. */
export function payPrerequisiteOf(status: number, payload: unknown): PayPrerequisite | null {
  const code = (payload as { code?: unknown } | null | undefined)?.code
  return status === 412 && (code === 'card_required' || code === 'billing_address_required')
    ? code
    : null
}

/** Dollars and cents, for a line a buyer is about to agree to. */
export function formatPayCents(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

/** The saved method in words, wallets included: they carry an email, not a number. */
export function payCardLabel(card: PayQuoteCard | null): string {
  if (card?.last4) return `${(card.brand ?? card.type ?? 'card').toUpperCase()} •••• ${card.last4}`
  if (card?.email) return `${card.type ?? 'wallet'} · ${card.email}`
  return 'the card on file'
}
