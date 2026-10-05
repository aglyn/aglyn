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
 * One more unsubscribe on a campaign send, told by the plugin that serves the
 * unsubscribe page (`plugin-send-tallies`, AGL-3080). Where the send is found
 * is `campaign-conversion-attribution.send-ref.spec.ts`'s claim.
 */

const updates: Array<[string, unknown]> = []
let found: { path: string } | null = null

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => ({}) }) },
}))
jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async () => 'org-1',
}))
jest.mock('./campaign-conversion-attribution', () => ({
  __esModule: true,
  resolveCampaignSendRef: async () =>
    found
      ? {
          update: async (patch: unknown) => {
            updates.push([found!.path, patch])
          },
        }
      : null,
}))

import { countCampaignSendUnsubscribe } from './send-tally'

beforeEach(() => {
  updates.length = 0
  found = null
})

it('counts the unsubscribe on the send, and says it was this plugin’s', async () => {
  found = { path: 'orgs/org-1/campaigns/s1' }
  expect(await countCampaignSendUnsubscribe({ hostId: 'site-1', sendId: 's1' })).toBe(true)
  expect(updates).toHaveLength(1)
  expect(updates[0][0]).toBe('orgs/org-1/campaigns/s1')
  expect(Object.keys(updates[0][1] as object)).toEqual(['stats.unsubscribes'])
})

it('answers false, and creates nothing, for a send it does not keep', async () => {
  expect(await countCampaignSendUnsubscribe({ hostId: 'site-1', sendId: 'gone' })).toBe(false)
  expect(updates).toEqual([])
})
