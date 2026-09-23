/**
 * @jest-environment node
 */
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
 * WHERE AN ACCOUNT CAME FROM, and who may see how much of it (AGL-3289).
 *
 * The staff Acquisition card's route. Three properties are pinned because
 * each is a privacy promise the card makes to the person it is about:
 *
 * - the look at the sales workspace's people is written to `adminAudit`
 *   BEFORE any matcher reads them — a card that rendered and then failed to
 *   record the look would be the access the audit trail exists to never lose;
 * - city-level geography is `super` only, for the record's own geography and
 *   for the newest sign-in alike — every other role gets the country;
 * - an install with no sales workspace asks nobody and audits nothing.
 */

export {}

const order: string[] = []
const mockVerifyIdToken = jest.fn()
const mockAudit = jest.fn(async (entry: { action: string }) => {
  order.push(`audit:${entry.action}`)
})
const mockPooled = jest.fn()
const mockHouseHost = jest.fn((): string | null => 'house-host')
const mockOrgForHost = jest.fn(async () => ({ orgId: 'house-org', org: { slug: 'house', name: 'House' } }))
const mockDevices = jest.fn(async () => [
  { location: 'Sydney, NSW, AU', lastSeenMs: 1_700_000_000_000 },
])
const docs: Record<string, Record<string, unknown> | undefined> = {}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
      firestore: () => ({
        collection: (name: string) => ({
          doc: (id: string) => ({
            get: async () => {
              const data = docs[`${name}/${id}`]
              return {
                exists: Boolean(data),
                get: (field: string) => data?.[field],
                data: () => data,
              }
            },
          }),
        }),
      }),
    }),
  },
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
}))
jest.mock('@aglyn/tenant-data-admin/server/admin-audit', () => ({
  recordAdminAudit: (entry: { action: string }) => mockAudit(entry),
}))
jest.mock('@aglyn/tenant-data-admin/server/auth-pools', () => ({
  findUserByUidAcrossPools: (...args: unknown[]) => mockPooled(...args),
}))
jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  getOrgForHost: () => mockOrgForHost(),
}))
jest.mock('@aglyn/tenant-data-admin/server/platform-marketing-consent', () => ({
  platformMarketingHostId: () => mockHouseHost(),
}))
jest.mock('../app/api/_lib/device-registry', () => ({
  readDeviceRows: () => mockDevices(),
}))

import {
  registerPluginPersonMatcher,
  resetPluginPersonMatchers,
} from '@aglyn/aglyn/plugin-manager/plugin-person-matches'
import { GET } from '../app/api/admin/acquisition/route'

const RECORD = {
  v: 1,
  source: 'g2.com',
  medium: 'referral',
  channel: 'referral',
  capturedAt: 1_699_000_000_000,
  landing: { host: 'example.com', path: '/pricing' },
  referrerHost: 'www.g2.com',
  door: 'signup-password',
  provider: 'password',
  geo: { country: 'AU', region: 'NSW', city: 'Sydney' },
  recordedAt: 1_699_000_100_000,
  recordedBy: 'signup',
}

function get(query: string) {
  return GET(
    new Request(`https://app.example.com/api/admin/acquisition?${query}`, {
      headers: { authorization: 'Bearer token' },
    }),
  )
}

beforeEach(() => {
  order.length = 0
  jest.clearAllMocks()
  mockHouseHost.mockReturnValue('house-host')
  mockVerifyIdToken.mockResolvedValue({ uid: 'staff-1', email_verified: true, staff: true, staffRole: 'super' })
  mockPooled.mockResolvedValue({
    record: {
      email: 'person@personal.example',
      displayName: 'Matt Tropp',
      metadata: { creationTime: new Date(1_699_000_050_000).toUTCString() },
      providerData: [{ providerId: 'password' }],
    },
  })
  docs['users/uid-1'] = { acquisition: RECORD, firstName: 'Matt', lastName: 'Tropp' }
  docs['orgs/org-1'] = { acquisition: { ...RECORD, copiedFromUid: 'uid-1' }, createdByUid: 'uid-1' }
  resetPluginPersonMatchers()
  registerPluginPersonMatcher(
    async (request) => {
      order.push(`match:${request.email}`)
      return [
        {
          kind: 'contact',
          id: 'c1',
          label: 'Matthew Tropp',
          email: 'matthew@work.example',
          basis: 'name' as const,
          firstSeenAtMs: 1,
          sources: ['outreach'],
          href: '/house/crm/contacts/c1',
        },
      ]
    },
    { pluginId: 'crm' },
  )
})

it('refuses anyone without a staff claim', async () => {
  mockVerifyIdToken.mockResolvedValue({ uid: 'u', email_verified: true })
  expect((await get('uid=uid-1')).status).toBe(403)
})

it('records the look before any matcher reads the sales workspace', async () => {
  const response = await get('uid=uid-1')
  const body = await response.json()
  expect(order).toEqual(['audit:user.acquisition-viewed', 'match:person@personal.example'])
  expect(mockAudit).toHaveBeenCalledWith(
    expect.objectContaining({ actorUid: 'staff-1', target: 'users/uid-1', subjectUid: 'uid-1' }),
  )
  expect(body.matches).toMatchObject({ status: 'checked', workspace: { orgId: 'house-org', slug: 'house' } })
  expect(body.matches.items[0]).toMatchObject({ basis: 'name', pluginId: 'crm' })
  expect(body.subject).toMatchObject({ uid: 'uid-1', name: 'Matt Tropp', provider: 'password' })
})

it('shows city-level geography to super, and the country alone to every other role', async () => {
  const full = await (await get('uid=uid-1')).json()
  expect(full.cityLevel).toBe(true)
  expect(full.acquisition.geo).toEqual({ country: 'AU', region: 'NSW', city: 'Sydney' })
  expect(full.latestSignIn.location).toBe('Sydney, NSW, AU')

  mockVerifyIdToken.mockResolvedValue({ uid: 'staff-2', email_verified: true, staff: true, staffRole: 'support' })
  const narrow = await (await get('uid=uid-1')).json()
  expect(narrow.cityLevel).toBe(false)
  expect(narrow.acquisition.geo).toEqual({ country: 'AU', region: null, city: null })
  expect(narrow.latestSignIn.location).toBe('AU')
})

it('reads a workspace’s copy and names the account it came from', async () => {
  const body = await (await get('orgId=org-1')).json()
  expect(body.scope).toBe('org')
  expect(body.subject.uid).toBe('uid-1')
  expect(body.acquisition.copiedFromUid).toBe('uid-1')
  expect(order[0]).toBe('audit:org.acquisition-viewed')
})

it('asks nobody and audits nothing when no sales workspace is configured', async () => {
  mockHouseHost.mockReturnValue(null)
  const body = await (await get('uid=uid-1')).json()
  expect(body.matches).toEqual({ status: 'unconfigured', workspace: null, items: [], failed: [] })
  expect(order).toEqual([])
})

it('refuses a request that names both, or neither', async () => {
  expect((await get('uid=a&orgId=b')).status).toBe(400)
  expect((await get('')).status).toBe(400)
})
