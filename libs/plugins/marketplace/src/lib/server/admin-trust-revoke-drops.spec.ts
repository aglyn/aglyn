/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock.
 *
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
 * Withdrawing realm trust drops every site's plugin set (AGL-4121).
 *
 * Each site resolved the version's trust once and cached it with its pages on
 * the week-long backstop, so the revoke must ask for the platform-wide drop at
 * its own call site. How that drop lands is `revoke-cache-drop.spec.ts`'s
 * subject; here only whether the route asks for it.
 */

const mockVerifyIdToken = jest.fn()
const mockDrops: string[] = []
let mockVersion: Record<string, unknown> = {}

jest.mock('./revoke-cache-drop', () => ({
  __esModule: true,
  dropCachesForListing: async (_firestore: unknown, listingId: string) => {
    mockDrops.push(listingId)
    return { dropped: 1, skipped: 0, complete: true }
  },
}))

jest.mock('@aglyn/aglyn/plugin-manager/plugin-trust-signing', () => ({
  __esModule: true,
  signPluginTrust: async () => ({ signed: true, signature: 'c2ln' }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request
      .clone()
      .json()
      .catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'verify' }, { status: 403 }),
  isImpersonationSession: () => false,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: mockVerifyIdToken }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              doc: () => ({
                get: async () => ({ get: (field: string) => mockVersion[field] }),
                set: async () => undefined,
              }),
            }),
          }),
          add: async () => undefined,
        }),
      }),
    }),
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'now', delete: () => 'DELETED' },
}))

import { marketplaceAdminTrust } from './admin-trust'

const act = (action: 'grant' | 'revoke') => {
  mockVerifyIdToken.mockResolvedValue({
    uid: 'u-1',
    email_verified: true,
    staff: true,
    staffRole: 'super',
  })
  return marketplaceAdminTrust(
    new Request('https://console.aglyn.com/api/marketplace/admin/trust', {
      method: 'POST',
      headers: {
        authorization: 'Bearer staff-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ listingId: 'lst_1', version: '1.0.0', action }),
    }),
  )
}

beforeEach(() => {
  mockDrops.length = 0
  mockVerifyIdToken.mockReset()
  mockVersion = { sha256: 'abc123', reviewState: 'approved' }
})

describe('withdrawing realm trust', () => {
  it('drops every site’s plugin set', async () => {
    mockVersion['trust'] = 'realm'
    expect((await act('revoke')).status).toBe(200)
    expect(mockDrops).toEqual(['lst_1'])
  })

  it('CONTROL: revoking trust a version never had changes nothing a site loads', async () => {
    expect((await act('revoke')).status).toBe(200)
    expect(mockDrops).toEqual([])
  })

  it('CONTROL: a grant drops nothing', async () => {
    expect((await act('grant')).status).toBe(200)
    expect(mockDrops).toEqual([])
  })
})
