/**
 * @jest-environment node
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
 * /api/media/stock-photos driven in-process (AGL-4066). Only the token check,
 * the scope resolver, Firestore and the provider are stood in; the route's
 * wiring and the lib's handler run for real. What the route owes:
 *
 *  1. A signed-in member with a verified email, as the upload route asks.
 *  2. Every request, a search included, checked as an upload to that
 *     library is: `resolveMediaScope` with the uploads gate, its refusal
 *     (a lockdown's 423 included) answered as it stands.
 *  3. The stored copy read back from the library the request named.
 */

const mockDecoded: Record<string, unknown> = {}
const mockScopeCalls: unknown[][] = []
let mockScopeError: { status: number; message: string; response?: Response } | null = null
const mockReads: string[] = []

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => mockDecoded }),
      firestore: () => ({
        collection: (name: string) => ({
          doc: (id: string) => ({
            collection: (sub: string) => ({
              doc: (mediaId: string) => ({
                get: async () => {
                  mockReads.push(`${name}/${id}/${sub}/${mediaId}`)
                  return { exists: true, data: () => ({ fileName: 'pixabay-1.jpg', contentType: 'image/jpeg', cdnPath: `/api/media/cdn/${id}/${mediaId}` }) }
                },
              }),
            }),
          }),
        }),
      }),
    }),
  },
}))

jest.mock('../utils/server/media-scope', () => ({
  __esModule: true,
  resolveMediaScope: async (...args: unknown[]) => {
    mockScopeCalls.push(args)
    return mockScopeError ? { error: mockScopeError } : { scope: { collection: 'hosts' } }
  },
}))

import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { registerPluginMediaIngest } from '@aglyn/aglyn/plugin-manager/plugin-media-ingest'
import { registerStockPhotoProvider } from '@aglyn/aglyn/plugin-manager/stock-photo-provider'
import { POST } from '../app/api/media/stock-photos/route'

const PHOTO = {
  provider: 'pixabay',
  id: '1',
  width: 1280,
  height: 853,
  pageUrl: 'https://pixabay.com/photos/yoga-1/',
  photographer: 'StudioLight',
  tags: ['yoga'],
}

const post = (body: Record<string, unknown>, token = 'token-1') =>
  POST(
    new Request('https://console.example/api/media/stock-photos', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }),
  )

beforeEach(() => {
  resetPluginServicesForTests()
  Object.assign(mockDecoded, { uid: 'member-1', email_verified: true, staff: false })
  mockScopeCalls.length = 0
  mockReads.length = 0
  mockScopeError = null
  registerStockPhotoProvider(
    {
      id: 'pixabay',
      label: 'Pixabay',
      isConfigured: () => true,
      search: async () => ({ photos: [PHOTO], cached: true }),
      download: async () => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff]), contentType: 'image/jpeg' }),
      credit: () => ({ providerLabel: 'Pixabay', license: 'Pixabay Content License', licenseUrl: 'https://pixabay.com/service/license-summary/', attributionRequired: false, text: 'Photo by StudioLight on Pixabay.' }),
    },
    { pluginId: 'test' },
  )
  registerPluginMediaIngest(
    {
      findStockPhoto: async () => null,
      ingest: async () => ({ ok: true, mediaId: 'new-1', src: 'media:org:o1/new-1' }),
    },
    { pluginId: 'test' },
  )
})
afterAll(() => resetPluginServicesForTests())

describe('POST /api/media/stock-photos (AGL-4066)', () => {
  it('asks for a signed-in member with a verified email', async () => {
    expect((await post({ action: 'status', hostId: 'h1' }, '')).status).toBe(401)
    mockDecoded['email_verified'] = false
    expect((await post({ action: 'status', hostId: 'h1' })).status).toBe(403)
    expect(mockScopeCalls).toHaveLength(0)
  })

  it('checks every request as an upload to the library it names', async () => {
    mockDecoded['staff'] = true
    const answer = await post({ action: 'search', hostId: 'h1', query: 'yoga' })
    expect(answer.status).toBe(200)
    expect((await answer.json()).hits[0]).toMatchObject({ sourceKey: 'pixabay:1', photographer: 'StudioLight' })
    expect(mockScopeCalls).toEqual([[{ hostId: 'h1' }, {}, 'member-1', { staff: true, feature: 'uploads' }]])
  })

  it("answers the scope's refusal as it stands, a lockdown's included", async () => {
    mockScopeError = { status: 423, message: 'Locked', response: Response.json({ error: 'This workspace is locked' }, { status: 423 }) }
    const locked = await post({ action: 'search', orgId: 'o1', query: 'yoga' })
    expect(locked.status).toBe(423)
    expect(await locked.json()).toEqual({ error: 'This workspace is locked' })
    mockScopeError = { status: 403, message: 'Editing the organization library requires the editor role' }
    const viewer = await post({ action: 'status', orgId: 'o1' })
    expect(viewer.status).toBe(403)
    expect(await viewer.json()).toEqual({ status: 'refused', message: 'Editing the organization library requires the editor role' })
  })

  it('reads the stored copy back from the library the request named', async () => {
    const answer = await post({ action: 'import', orgId: 'o1', ref: { query: 'yoga', orientation: 'any', id: '1' } })
    expect(await answer.json()).toMatchObject({ status: 'ok', reused: false, media: { $id: 'new-1', fileName: 'pixabay-1.jpg' } })
    expect(mockReads).toEqual(['orgs/o1/media/new-1'])
  })
})
