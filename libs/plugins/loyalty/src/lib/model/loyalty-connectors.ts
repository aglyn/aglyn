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
 * A store's own Smile.io or Yotpo Loyalty account, connected in place of the
 * built-in points (AGL-3677). Pure and client-safe: the console card, the
 * server and the specs read one answer.
 *
 * ONE PROGRAM AT A TIME. A connected program owns the points: what a sale
 * earns, what a refund takes back and what a buyer spends are written to the
 * merchant's account, and the built-in program stops awarding points, welcome
 * points and referral rewards of its own. Store credit a merchant gave by hand
 * is money owed, not points, so it stays spendable.
 *
 * Both vendors take a merchant's own credentials, and neither needs an app of
 * Aglyn's:
 *
 * - Smile.io: a private API key the merchant creates in Smile Admin (Settings
 *   → Developer), sent as a bearer token. Smile offers API keys on its Plus
 *   and Enterprise plans. An API key cannot create Smile customers, so a buyer
 *   Smile does not know yet earns once they join the merchant's Smile program.
 * - Yotpo Loyalty & Referrals: the account's GUID and API key, from the
 *   Loyalty admin's Settings, sent as `X-GUID` and `X-API-KEY`. A buyer Yotpo
 *   does not know is enrolled.
 */

export type LoyaltyConnectorId = 'smile' | 'yotpo'

export const LOYALTY_CONNECTOR_IDS: readonly LoyaltyConnectorId[] = [
  'smile',
  'yotpo',
]

export const LOYALTY_CONNECTOR_LABELS: Record<LoyaltyConnectorId, string> = {
  smile: 'Smile.io',
  yotpo: 'Yotpo Loyalty',
}

export function isLoyaltyConnectorId(
  value: unknown,
): value is LoyaltyConnectorId {
  return value === 'smile' || value === 'yotpo'
}

/** One credential field the merchant pastes, as the card draws it. */
export interface LoyaltyConnectorField {
  name: 'apiKey' | 'guid'
  label: string
  helper: string
  secret: boolean
}

export const LOYALTY_CONNECTOR_FIELDS: Record<
  LoyaltyConnectorId,
  LoyaltyConnectorField[]
> = {
  smile: [
    {
      name: 'apiKey',
      label: 'Smile.io API key',
      helper:
        'In Smile Admin, open Settings → Developer and create a key with the customer read, points transaction read and points transaction write scopes.',
      secret: true,
    },
  ],
  yotpo: [
    {
      name: 'guid',
      label: 'GUID',
      helper: 'In the Yotpo Loyalty admin, under Settings → General.',
      secret: false,
    },
    {
      name: 'apiKey',
      label: 'API key',
      helper: 'On the same Settings page, beside the GUID.',
      secret: true,
    },
  ],
}

/** The credentials as the server opens them. Never leaves the server. */
export interface LoyaltyConnectorCredentials {
  apiKey: string
  guid?: string
}

/** Why each credential is refused before any vendor is asked, or `null`. */
export function loyaltyConnectorCredentialsProblem(
  provider: LoyaltyConnectorId,
  raw: unknown,
): string | null {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >
  for (const field of LOYALTY_CONNECTOR_FIELDS[provider]) {
    const value = String(source[field.name] ?? '').trim()
    if (!value) return `Enter the ${field.label}.`
    if (value.length > 200 || /\s/.test(value))
      return `That ${field.label} is not one ${LOYALTY_CONNECTOR_LABELS[provider]} issues.`
  }
  return null
}

/**
 * Where one points movement stands at the vendor.
 *
 * - `pending`: written with its cause, not yet sent.
 * - `sending`: claimed by a sender; the call is in flight, or the sender died
 *   mid-call and the next pass looks at the vendor before sending again.
 * - `synced`: the vendor has it.
 * - `retry`: the vendor refused or could not be reached; sent again later.
 * - `unmatched`: the vendor has no member for the address (Smile.io only).
 * - `skipped`: a test-mode sale; real points are never moved for one.
 */
export type LoyaltySyncStatus =
  'pending' | 'sending' | 'synced' | 'retry' | 'unmatched' | 'skipped'

/** Statuses a later pass sends again. */
export const LOYALTY_SYNC_OPEN: readonly LoyaltySyncStatus[] = [
  'pending',
  'retry',
  'sending',
]

/** How many times one movement is sent before it waits for the merchant's Send again. */
export const LOYALTY_SYNC_MAX_ATTEMPTS = 8

/** What the console card is served about the connection. Never a credential. */
export interface LoyaltyConnectionView {
  provider: LoyaltyConnectorId
  label: string
  /** The vendor's own name for the account, when it gave one. */
  accountLabel: string | null
  /** The last four characters of the API key, for the merchant to recognize it. */
  keyLast4: string
  connectedAtMs: number
  lastError: string | null
  lastSyncedAtMs: number | null
}

export interface LoyaltySyncRowView {
  id: string
  status: LoyaltySyncStatus
  points: number
  /** Points the vendor could not take: the balance had fewer than the refund or sale took back. */
  shortfallPoints: number
  kind: string
  orderId: string | null
  email: string
  error: string | null
  attempts: number
  atMs: number
}

/** The connection card's answer. `configured: false` means the deployment cannot connect one, and the card draws nothing. */
export interface LoyaltyConnectionAnswer {
  configured: boolean
  connection: LoyaltyConnectionView | null
  /** Movements waiting to reach the vendor, and those it refused, newest first. */
  attention: LoyaltySyncRowView[]
  /** What the built-in program still holds in points, which connecting replaces. */
  builtInPoints: number | null
}

/**
 * Whether an order id is a Stripe test-mode checkout session. Restated from
 * the seller's own rule (a plugin never imports another): a storefront order
 * is keyed by its session id, and a test session's id says so. An order the
 * id cannot place — a register sale — is live, which is the direction the
 * seller's rule fails in too.
 */
export function loyaltyOrderIsTestMode(
  order: { id?: unknown; livemode?: unknown } | string | null | undefined,
): boolean {
  if (order && typeof order === 'object' && typeof order.livemode === 'boolean')
    return !order.livemode
  const id = String(
    (order && typeof order === 'object' ? order.id : order) ?? '',
  )
  return /^cs_test_/.test(id)
}

/** The last four characters of a secret, for the card. */
export function secretLast4(secret: string): string {
  const value = String(secret ?? '')
  return value.length > 4 ? value.slice(-4) : ''
}
