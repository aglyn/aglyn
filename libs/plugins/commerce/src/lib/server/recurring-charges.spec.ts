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
 * The memberships a site sells, as a security lockdown asks for them
 * (AGL-3364): read from this plugin's own `hosts/{hostId}/subscriptions`
 * records, only the ones that can still bill, and only for the locked sites.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({ firebaseAdmin: {} }))

import {
  LIVE_SUBSCRIPTION_STATUSES,
  listCommerceLiveSubscriptions,
  type RecurringChargesFirestore,
} from './recurring-charges'

const records: Record<string, { status: string }> = {
  'hosts/h1/subscriptions/sub_live': { status: 'active' },
  'hosts/h1/subscriptions/sub_trial': { status: 'trialing' },
  'hosts/h1/subscriptions/sub_done': { status: 'canceled' },
  'hosts/h2/subscriptions/sub_other_site': { status: 'active' },
}

const queried: Array<{ hostId: string; statuses: readonly string[] }> = []

const firestore: RecurringChargesFirestore = {
  collection: () => ({
    doc: (hostId: string) => ({
      collection: () => ({
        where: (_field, _op, statuses) => ({
          get: async () => {
            queried.push({ hostId, statuses })
            return {
              docs: Object.entries(records)
                .filter(
                  ([path, data]) =>
                    path.startsWith(`hosts/${hostId}/subscriptions/`) &&
                    statuses.includes(data.status),
                )
                .map(([path]) => ({ id: path.split('/').pop() as string })),
            }
          },
        }),
      }),
    }),
  }),
}

describe('the storefront subscriptions a lockdown pauses (AGL-3364)', () => {
  it('lists the live ones of the named sites only, from the stored records', async () => {
    await expect(listCommerceLiveSubscriptions(firestore, ['h1'])).resolves.toEqual([
      { subscriptionId: 'sub_live', hostId: 'h1' },
      { subscriptionId: 'sub_trial', hostId: 'h1' },
    ])
    expect(queried).toEqual([{ hostId: 'h1', statuses: LIVE_SUBSCRIPTION_STATUSES }])
    expect(LIVE_SUBSCRIPTION_STATUSES).not.toContain('canceled')
  })
})
