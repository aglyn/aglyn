/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves the
 * suite on jsdom.
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
 * An unlocked password-protected screen names its site (AGL-2883).
 *
 * The page ships `nodes: null` and this route composes the tree — the site's
 * layout included — once the password checks out. The composition fills host
 * variables in from the site it is handed and renders each as nothing
 * without one, so the route reads the site document and hands it over, and
 * the enricher slice reuses that copy instead of reading it again.
 */

const mockSite = { $id: 'site-1', displayName: 'Northwind Coffee' }
const mockRead: { outcome: 'found' | 'failed' } = { outcome: 'found' }
const mockComposeCalls: Array<Record<string, unknown>> = []
const mockEnrichCalls: Array<Record<string, unknown>> = []
const mockPassword = 'open sesame'

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  consumeRateLimit: async () => ({ allowed: true, resetMs: Date.now() + 1000 }),
  visitorContentRefusal: async () => null,
  getHostDocAdmin: async () => {
    if (mockRead.outcome === 'failed') throw new Error('firestore down')
    return mockSite
  },
}))
jest.mock('@aglyn/tenant-runtime/get-screen', () => ({
  __esModule: true,
  default: async () => ({
    screen: {
      $id: 'vault',
      protection: {
        passwordHash: jest
          .requireActual('crypto')
          .createHash('sha256')
          .update(mockPassword)
          .digest('hex'),
      },
    },
  }),
}))
jest.mock('@aglyn/tenant-runtime/compose-screen-nodes', () => ({
  __esModule: true,
  default: async (options: Record<string, unknown>) => {
    mockComposeCalls.push(options)
    return { root: {} }
  },
}))
jest.mock('@aglyn/tenant-runtime/enrich-gated-page', () => ({
  __esModule: true,
  enrichGatedScreenPage: async (options: Record<string, unknown>) => {
    mockEnrichCalls.push(options)
    return {}
  },
}))
jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: { ensureAll: async () => undefined },
}))

import { POST } from '../app/api/protection/unlock/route'

const unlock = () =>
  POST(
    new Request('https://northwind.example/api/protection/unlock', {
      method: 'POST',
      body: JSON.stringify({
        hostId: 'site-1',
        screenId: 'vault',
        password: mockPassword,
      }),
    }),
  )

beforeEach(() => {
  mockRead.outcome = 'found'
  mockComposeCalls.length = 0
  mockEnrichCalls.length = 0
})

describe('an unlocked protected screen names its site (AGL-2883)', () => {
  it('composes the tree against the site document', async () => {
    const response = await unlock()
    // 200, not 401: the password checked out, so the tree was composed.
    expect(response.status).toBe(200)
    expect(mockComposeCalls).toHaveLength(1)
    expect(mockComposeCalls[0]?.['host']).toBe(mockSite)
  })

  it('hands the enricher the same copy rather than reading it twice', async () => {
    await unlock()
    expect(mockEnrichCalls[0]?.['host']).toBe(mockSite)
  })

  it('still unlocks when the site cannot be read', async () => {
    mockRead.outcome = 'failed'
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await unlock()
    spy.mockRestore()
    // The page without its business name beats no page at all.
    expect(response.status).toBe(200)
    expect(mockComposeCalls[0]?.['host']).toBeNull()
    // And the enricher is left to read the site itself.
    expect(mockEnrichCalls[0]).not.toHaveProperty('host')
  })
})
