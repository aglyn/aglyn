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

import type { LoyaltyConnectorCredentials } from '../model/loyalty-connectors'
import { vendorJson, vendorWhole } from './http'
import type {
  LoyaltyVendorAdapter,
  LoyaltyVendorFetch,
  LoyaltyVendorMember,
} from './types'

/**
 * Smile.io's REST API with the merchant's own API key (AGL-3677).
 *
 * `https://api.smile.io/v1`, `Authorization: Bearer <key>` — the key a
 * merchant on Smile's Plus or Enterprise plan creates in Smile Admin. No app
 * of Aglyn's: Smile's merchant-credential path is for exactly one merchant's
 * integration, which this is.
 *
 *   GET  /customers?email=           the member and their `points_balance`
 *   POST /points_transactions        `points_change`, signed; a change that
 *                                    would take the balance below zero is
 *                                    refused (422)
 *   GET  /points_transactions?customer_id=   their history, for a resend
 *
 * An API key cannot create a Smile customer (only an OAuth app can), so a
 * buyer Smile does not know yet is `unmatched` until they join.
 */

export const SMILE_API_BASE = 'https://api.smile.io/v1'

const VENDOR = 'Smile.io'

function headers(credentials: LoyaltyConnectorCredentials) {
  return { Authorization: `Bearer ${credentials.apiKey}` }
}

function toMember(customer: any): LoyaltyVendorMember | null {
  if (!customer || customer.id === undefined || customer.id === null)
    return null
  if (customer.state === 'disabled') return null
  return {
    id: String(customer.id),
    points: vendorWhole(customer.points_balance),
  }
}

export function createSmileAdapter(
  fetchImpl: LoyaltyVendorFetch,
): LoyaltyVendorAdapter {
  return {
    id: 'smile',
    async verify(credentials) {
      await vendorJson(fetchImpl, {
        vendor: VENDOR,
        method: 'GET',
        url: `${SMILE_API_BASE}/customers?limit=1`,
        headers: headers(credentials),
      })
      return { accountLabel: null }
    },
    async findMember(credentials, email) {
      const answer = await vendorJson(fetchImpl, {
        vendor: VENDOR,
        method: 'GET',
        url: `${SMILE_API_BASE}/customers?${new URLSearchParams({ email, limit: '5' })}`,
        headers: headers(credentials),
      })
      const customers: any[] = Array.isArray(answer.body?.customers)
        ? answer.body.customers
        : []
      // Smile does not hold an address unique: the program's member wins over
      // a candidate, and the oldest record (lowest id) over a later duplicate.
      const sorted = customers
        .filter(
          (customer) => String(customer?.email ?? '').toLowerCase() === email,
        )
        .sort(
          (a, b) =>
            Number(a.state !== 'member') - Number(b.state !== 'member') ||
            Number(a.id) - Number(b.id),
        )
      for (const customer of sorted) {
        const member = toMember(customer)
        if (member) return member
      }
      return null
    },
    async enrollMember() {
      return null
    },
    async adjust(credentials, adjustment) {
      const answer = await vendorJson(fetchImpl, {
        vendor: VENDOR,
        method: 'POST',
        url: `${SMILE_API_BASE}/points_transactions`,
        headers: headers(credentials),
        insufficient: [422],
        body: {
          points_transaction: {
            customer_id: Number(adjustment.member.id),
            points_change: adjustment.points,
            description: adjustment.title,
            internal_note: `Rewards ref ${adjustment.ref}`,
          },
        },
      })
      const id = answer.body?.points_transaction?.id
      return { id: id === undefined || id === null ? null : String(id) }
    },
    async hasAdjustment(credentials, input) {
      const answer = await vendorJson(fetchImpl, {
        vendor: VENDOR,
        method: 'GET',
        url: `${SMILE_API_BASE}/points_transactions?${new URLSearchParams({ customer_id: input.member.id, limit: '250' })}`,
        headers: headers(credentials),
      })
      const rows: any[] = Array.isArray(answer.body?.points_transactions)
        ? answer.body.points_transactions
        : []
      return rows.some((row) =>
        String(row?.internal_note ?? '').includes(`Rewards ref ${input.ref}`),
      )
    },
  }
}
