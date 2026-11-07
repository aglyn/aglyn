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
 * An uninstall drops the site's plugin set (AGL-4121).
 *
 * The tenant caches each site's resolved plugins, and every page that read
 * them, on the week-long backstop, so an uninstalled bundle stops running on
 * live pages only through this drop. It must be the hard `'host'` expiry, it
 * must be sent even when the pin is already gone (a retry finishes a lost
 * drop), and a drop that neither landed nor was queued must fail the request.
 */

const mockDrops: Array<Record<string, unknown>> = []
const mockDropAnswer = { complete: true }

jest.mock('@aglyn/aglyn/plugin-manager/plugin-site-cache', () => ({
  __esModule: true,
  dropPluginSiteCache: async (options: Record<string, unknown>) => {
    mockDrops.push(options)
    return { complete: mockDropAnswer.complete }
  },
}))

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({
    orgId: 'buyer-org',
    permissions: { installPlugins: true },
  }),
}))

jest.mock('./version-stats', () => ({
  recordVersionMove: async () => undefined,
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const missing = { exists: false, get: () => undefined, data: () => undefined }
  const pin = { get: async () => missing, delete: async () => undefined }
  const firestore = {
    collection: (name: string) => {
      if (name === 'hosts') {
        return {
          doc: () => ({
            get: async () => ({
              exists: true,
              get: (field: string) =>
                field === 'memberRoles' ? { 'buyer-1': 'admin' } : undefined,
            }),
            collection: () => ({ doc: () => pin }),
          }),
        }
      }
      if (name === 'orgs') {
        return {
          doc: () => ({
            // No `enabledPlugins`: a default-open workspace, nothing to sync.
            get: async () => missing,
            collection: () => ({ doc: () => pin }),
          }),
        }
      }
      throw new Error(`unexpected collection: ${name}`)
    },
  }
  return {
    resolveOrgIdForHost: async () => 'buyer-org',
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: async () => ({ uid: 'buyer-1' }) }),
        firestore: () => firestore,
      }),
      firestore: { FieldValue: { serverTimestamp: () => 'NOW' } },
    },
  }
})

import { installPluginHandler } from './install-plugin'

function makeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
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

const uninstall = async () => {
  const res = makeRes()
  await installPluginHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: { listingId: 'listing-1', hostId: 'host-1', action: 'uninstall' },
    } as never,
    res as never,
  )
  return res
}

beforeEach(() => {
  mockDrops.length = 0
  mockDropAnswer.complete = true
})

describe('an uninstall', () => {
  it('hard-expires the site’s plugin set, even with the pin already gone', async () => {
    const res = await uninstall()
    expect(res.statusCode).toBe(200)
    expect(mockDrops).toEqual([
      expect.objectContaining({ hostIds: ['host-1'], plugins: 'host' }),
    ])
  })

  it('answers 503 when the drop neither landed nor was queued', async () => {
    mockDropAnswer.complete = false
    const res = await uninstall()
    expect(res.statusCode).toBe(503)
    expect(mockDrops.length).toBe(1)
  })
})
