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
 * This app's `core.site-erase` (AGL-3936): a server removal runs the delete
 * route's own path — `eraseHost` with this app's sending-domain teardown,
 * the tenant cache drop, the workspace's feed and the staff audit — and
 * refuses what the route refuses. The route's own orderings are proved in
 * `app/api/hosts/delete/route.spec.ts`, which runs the same helper.
 */

export {}

const mockCalls: string[] = []
let mockHost: Record<string, unknown> | null = null
let mockOrg: Record<string, unknown> = {}
const mockEraseHost = jest.fn(async (..._args: unknown[]) => {
  mockCalls.push('eraseHost')
})
const mockLogOrgActivity = jest.fn(async (..._args: unknown[]) => {
  mockCalls.push('feed')
})
const mockAuditAdd = jest.fn(async (..._args: unknown[]) => {
  mockCalls.push('audit')
})
const mockDrop = jest.fn(async (..._args: unknown[]) => {
  mockCalls.push('cache')
  return true
})
const mockTeardown = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (name: string) => ({
          doc: (id: string) => ({
            get: async () => {
              const data = name === 'hosts' ? mockHost : mockOrg
              return {
                id,
                exists: data !== null,
                get: (field: string) => (data ?? {})[field],
                data: () => data ?? undefined,
              }
            },
          }),
          add: name === 'adminAudit' ? (...args: unknown[]) => mockAuditAdd(...args) : undefined,
        }),
      }),
    }),
    firestore: { FieldValue: { serverTimestamp: () => '__now__' } },
  },
  eraseHost: (...args: unknown[]) => mockEraseHost(...args),
  logOrgActivity: (...args: unknown[]) => mockLogOrgActivity(...args),
}))

jest.mock('./tenant-revalidate', () => ({
  __esModule: true,
  dropDeletedSiteCache: (...args: unknown[]) => mockDrop(...args),
}))

jest.mock('./provision-sending-domain', () => ({
  __esModule: true,
  get teardownSendingDomain() {
    return mockTeardown
  },
}))

import { consoleSiteEraser } from './erase-site'

const REQUEST = {
  hostId: 'host-kc',
  orgId: 'org-kc',
  activity: 'Removed an empty site',
  reason: 'ai-start-empty',
}

beforeEach(() => {
  mockCalls.length = 0
  mockHost = { orgId: 'org-kc', displayName: 'Kc x carder', subdomain: 'kc-x-carder', screens: {} }
  mockOrg = {}
  for (const mock of [mockEraseHost, mockLogOrgActivity, mockAuditAdd, mockDrop]) mock.mockClear()
})

describe('the console’s site eraser', () => {
  it('runs the delete route’s path, in its order, with nobody named as the actor', async () => {
    expect(await consoleSiteEraser.erase(REQUEST)).toEqual({ erased: true })
    expect(mockCalls).toEqual(['eraseHost', 'cache', 'feed', 'audit'])
    expect(mockEraseHost).toHaveBeenCalledWith('host-kc', { tearDownSendingDomain: mockTeardown })
    expect(mockLogOrgActivity).toHaveBeenCalledWith('org-kc', { uid: null }, 'Removed an empty site', {
      type: 'host',
      id: 'host-kc',
      name: 'Kc x carder',
    })
    expect(mockAuditAdd.mock.calls[0][0]).toMatchObject({
      actorUid: 'system:cron',
      action: 'host.deleted',
      target: 'hosts/host-kc',
      before: { displayName: 'Kc x carder', reason: 'ai-start-empty' },
    })
    // The cache drop reads the snapshot taken before the erase.
    const dropped = mockDrop.mock.calls[0][0] as { id: string; get: (field: string) => unknown }
    expect(dropped.id).toBe('host-kc')
    expect(dropped.get('subdomain')).toBe('kc-x-carder')
  })

  it('erases nothing for a site already gone, or one in another workspace now', async () => {
    mockHost = null
    expect(await consoleSiteEraser.erase(REQUEST)).toEqual({ erased: false, reason: 'missing' })
    mockHost = { orgId: 'org-other' }
    expect(await consoleSiteEraser.erase(REQUEST)).toEqual({ erased: false, reason: 'moved' })
    expect(mockCalls).toEqual([])
  })

  it('refuses a site its consent group still needs, as the route does', async () => {
    // A consent group change that includes the site is still running.
    mockOrg = { consentGroupsChange: { hostIds: ['host-kc'] } }
    expect(await consoleSiteEraser.erase(REQUEST)).toEqual({ erased: false, reason: 'consent-group' })
    expect(mockCalls).toEqual([])
  })
})
