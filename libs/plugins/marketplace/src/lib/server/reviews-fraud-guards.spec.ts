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
 *
 * @jest-environment node
 */

/**
 * Fake ratings (AGL-3365): the publishing workspace rating its own listing
 * through a member who is not a manager, and brand-new accounts rating in a
 * burst. The honest installer from another workspace still rates.
 */

const DAY = 86_400_000
let mockDocs: Map<string, Record<string, unknown>>
let mockUid = 'rater-1'
let mockCreatedMs = Date.now() - 400 * DAY

jest.mock('./publisher-profile', () => ({ canActAsPublisher: async () => false }))

jest.mock('@aglyn/tenant-data-admin', () => {
  const snapshot = (path: string) => {
    const data = mockDocs.get(path)
    return { exists: data !== undefined, data: () => data, get: (field: string) => data?.[field] }
  }
  const docRef = (path: string): any => ({
    path,
    get: async () => snapshot(path),
    collection: (name: string) => ({
      doc: (id: string) => docRef(`${path}/${name}/${id}`),
      limit: () => ({
        get: async () => ({
          docs: [...mockDocs.keys()]
            .filter((key) => key.startsWith(`${path}/${name}/`))
            .map((key) => ({ id: key.split('/').pop() })),
        }),
      }),
    }),
  })
  return {
    isImpersonationSession: () => false,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: async () => ({ uid: mockUid, email_verified: true, name: 'Rater' }),
          getUser: async () => ({ metadata: { creationTime: new Date(mockCreatedMs).toUTCString() } }),
        }),
        firestore: () => ({
          collection: (name: string) => ({ doc: (id: string) => docRef(`${name}/${id}`) }),
          getAll: async (...refs: Array<{ path: string }>) => refs.map((ref) => snapshot(ref.path)),
          runTransaction: async (work: (tx: unknown) => Promise<unknown>) =>
            work({
              get: async (ref: { path: string }) => snapshot(ref.path),
              set: (ref: { path: string }, value: Record<string, unknown>) => mockDocs.set(ref.path, value),
              update: (ref: { path: string }, value: Record<string, unknown>) =>
                mockDocs.set(ref.path, { ...(mockDocs.get(ref.path) ?? {}), ...value }),
            }),
        }),
      }),
      firestore: { FieldValue: { serverTimestamp: () => 'NOW' } },
    },
  }
})

import { reviewsHandler } from './reviews'

function makeRes() {
  const res: any = {
    statusCode: 0,
    body: undefined,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = payload
      return res
    },
  }
  return res
}

const rate = async () => {
  const res = makeRes()
  await reviewsHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: { listingId: 'listing-1', rating: 5 },
    } as any,
    res,
  )
  return res
}

beforeEach(() => {
  mockUid = 'rater-1'
  mockCreatedMs = Date.now() - 400 * DAY
  mockDocs = new Map<string, Record<string, unknown>>([
    ['marketplaceListings/listing-1', { profileId: 'org-pub', displayName: 'Forms Pro' }],
    ['orgs/org-pub/members/owner-1', { role: 'owner' }],
    ['users/rater-1/orgs/org-buyer', { role: 'owner' }],
    ['orgs/org-buyer', { hosts: {} }],
    ['orgs/org-buyer/installs/listing-1', { version: '1.0.0' }],
  ])
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('fake ratings (AGL-3365)', () => {
  it('lets an established installer from another workspace rate — the control', async () => {
    const res = await rate()
    expect(res.statusCode).toBe(200)
  })

  it('refuses a rating from ANY member of the publishing workspace', async () => {
    mockDocs.set('orgs/org-pub/members/rater-1', { role: 'editor' })
    const res = await rate()
    expect(res.statusCode).toBe(403)
    expect(mockDocs.get('marketplaceListings/listing-1/reviews/rater-1')).toBeUndefined()
  })

  it('refuses a rating vouched for by the publisher workspace’s own install', async () => {
    mockDocs.delete('users/rater-1/orgs/org-buyer')
    mockDocs.set('users/rater-1/orgs/org-pub', { role: 'viewer' })
    mockDocs.set('orgs/org-pub', { hosts: {} })
    mockDocs.set('orgs/org-pub/installs/listing-1', { version: '1.0.0' })
    const res = await rate()
    expect(res.statusCode).toBe(403)
  })

  it('refuses a rating from a brand-new account, without saying where the line is', async () => {
    mockCreatedMs = Date.now() - 2 * 60 * 60 * 1000
    const res = await rate()
    expect(res.statusCode).toBe(403)
    expect(res.body).toMatchObject({ reason: 'account-too-new' })
    expect(String(res.body.error)).not.toMatch(/\d/)
  })
})
