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
 * Yotpo Loyalty & Referrals with the merchant's own GUID and API key
 * (AGL-3677), both from the Loyalty admin's Settings and sent as `X-GUID` and
 * `X-API-KEY`. No app of Aglyn's.
 *
 *   GET  /api/v2/customers?customer_email=   `points_balance`, `yotpo_customer_id`
 *   POST /api/v2/customers                   enroll an address Yotpo lacks
 *   POST /api/v2/points/adjust               `point_adjustment_amount`, signed,
 *                                            with `history_title`; 423 while
 *                                            the record is busy
 *
 * The points a sale earns are adjusted, not left to a Yotpo "make a purchase"
 * campaign: Yotpo never sees an Aglyn order otherwise, and the store's own
 * rates decide earning and spending in one place.
 */

export const YOTPO_API_BASE = 'https://loyalty.yotpo.com/api/v2'

const VENDOR = 'Yotpo'

function headers(credentials: LoyaltyConnectorCredentials) {
  return {
    'X-GUID': String(credentials.guid ?? ''),
    'X-API-KEY': credentials.apiKey,
  }
}

function toMember(body: any): LoyaltyVendorMember | null {
  if (!body || typeof body !== 'object') return null
  const id = body.yotpo_customer_id ?? body.third_party_id ?? body.email
  if (!id || !body.email) return null
  return { id: String(id), points: vendorWhole(body.points_balance) }
}

async function fetchCustomer(
  fetchImpl: LoyaltyVendorFetch,
  credentials: LoyaltyConnectorCredentials,
  email: string,
  withHistory: boolean,
) {
  return vendorJson(fetchImpl, {
    vendor: VENDOR,
    method: 'GET',
    url: `${YOTPO_API_BASE}/customers?${new URLSearchParams({
      customer_email: email,
      with_history: withHistory ? 'true' : 'false',
    })}`,
    headers: headers(credentials),
    accept: [404],
  })
}

export function createYotpoAdapter(
  fetchImpl: LoyaltyVendorFetch,
): LoyaltyVendorAdapter {
  const adapter: LoyaltyVendorAdapter = {
    id: 'yotpo',
    async verify(credentials) {
      // An address no store has: a 404 is an answer from an account that let us in.
      await fetchCustomer(
        fetchImpl,
        credentials,
        'connection-check@aglyn.invalid',
        false,
      )
      return { accountLabel: null }
    },
    async findMember(credentials, email) {
      const answer = await fetchCustomer(fetchImpl, credentials, email, false)
      if (answer.status === 404) return null
      return toMember(answer.body)
    },
    async enrollMember(credentials, input) {
      const [first, ...rest] = String(input.name ?? '')
        .trim()
        .split(/\s+/)
      await vendorJson(fetchImpl, {
        vendor: VENDOR,
        method: 'POST',
        url: `${YOTPO_API_BASE}/customers`,
        headers: headers(credentials),
        body: {
          email: input.email,
          ...(first ? { first_name: first } : {}),
          ...(rest.length ? { last_name: rest.join(' ') } : {}),
        },
      })
      return adapter.findMember(credentials, input.email)
    },
    async adjust(credentials, adjustment) {
      await vendorJson(fetchImpl, {
        vendor: VENDOR,
        method: 'POST',
        url: `${YOTPO_API_BASE}/points/adjust`,
        headers: headers(credentials),
        insufficient: [422],
        body: {
          customer_email: adjustment.email,
          point_adjustment_amount: adjustment.points,
          apply_adjustment_to_points_earned: adjustment.earned,
          history_title: `${adjustment.title} · Aglyn ${adjustment.ref}`.slice(
            0,
            120,
          ),
        },
      })
      return { id: null }
    },
    async hasAdjustment(credentials, input) {
      const answer = await fetchCustomer(
        fetchImpl,
        credentials,
        input.email,
        true,
      )
      if (answer.status === 404) return false
      const items: any[] = Array.isArray(answer.body?.history_items)
        ? answer.body.history_items
        : []
      return items.some((item) =>
        JSON.stringify(item ?? {}).includes(`Aglyn ${input.ref}`),
      )
    },
  }
  return adapter
}
