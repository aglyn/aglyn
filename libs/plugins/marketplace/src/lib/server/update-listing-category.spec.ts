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
 * A listing edit files a site starter under a kind of site (AGL-4049).
 *
 * `update-listing` held every listing to the plugin taxonomy, so a starter
 * filed under "Home services & trades" could not be saved at all, and a
 * category the editor wrote to `categories` was not the field the starter
 * shelf reads. A starter's category is its own `category`, from the style
 * names; every other listing keeps the fixed taxonomy.
 */

import { publisherAgreementConsent } from '../model/publisher-agreement'

jest.mock('./publisher-agreement-acceptance', () => ({
  recordPublisherAgreementAcceptance: jest.fn(async () => ({})),
}))
jest.mock('./listing-screen', () => ({ listingSubmissionRefusal: async () => null }))
jest.mock('./listing-query-fields', () => ({ refreshListingQueryFields: async () => undefined }))
jest.mock('./publisher-profile', () => ({
  canActAsPublisher: async () => true,
  resolvePublisherProfile: async () => null,
}))
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({ resolveOrgPermissions: async () => null }))
jest.mock('@aglyn/aglyn/server', () => ({
  checkEntitlement: () => true,
  checkPluginBundle: () => ({ ok: true, problems: [] }),
  createResourceUid: () => 'unused',
  MAX_PLUGIN_BUNDLE_BYTES: 1,
  pluginArtifactPath: () => '',
  PLUGIN_VERIFIER_VERSION: 1,
  validatePluginManifest: () => ({ ok: true }),
}))

const mockStore: { listing: Record<string, unknown>; writes: Array<Record<string, unknown>> } = {
  listing: {},
  writes: [],
}
jest.mock('@aglyn/tenant-data-admin', () => {
  const listingRef = {
    get: async () => ({ data: () => mockStore.listing }),
    set: async (data: Record<string, unknown>) => {
      mockStore.writes.push(data)
    },
  }
  return {
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: async () => ({ uid: 'uid-1', staff: true }) }),
        firestore: () => ({ collection: () => ({ doc: () => listingRef }) }),
      }),
      firestore: { FieldValue: { serverTimestamp: () => 'NOW', delete: () => 'DELETE' } },
    },
    getOrgForUser: async () => null,
    notifyStaff: async () => undefined,
  }
})

import { publishPluginHandler } from './publish-plugin'

async function save(body: Record<string, unknown>) {
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
  await publishPluginHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: { action: 'update-listing', listingId: 'listing-1', agreement: publisherAgreementConsent(), ...body },
    } as never,
    res,
  )
  return res
}

beforeEach(() => {
  mockStore.writes = []
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

describe('a site starter’s category (AGL-4049)', () => {
  beforeEach(() => {
    mockStore.listing = { artifactType: 'siteStarter', profileId: 'org-1', category: 'design', displayName: 'Starter site' }
  })

  it('saves a style name to the starter’s own category', async () => {
    const res = await save({ category: 'Home services & trades' })
    expect(res.statusCode).toBe(200)
    expect(mockStore.writes[0]).toMatchObject({ category: 'Home services & trades' })
    expect(mockStore.writes[0]).not.toHaveProperty('categories')
  })

  it('keeps the category it has, and clears it on None', async () => {
    expect((await save({ category: 'design' })).statusCode).toBe(200)
    expect(mockStore.writes[0]).toMatchObject({ category: 'design' })
    expect((await save({ category: '' })).statusCode).toBe(200)
    expect(mockStore.writes[1]).toMatchObject({ category: 'DELETE' })
  })

  it('takes the list a native editor sends, read as the starter’s category', async () => {
    const res = await save({ categories: ['Portfolio'] })
    expect(res.statusCode).toBe(200)
    expect(mockStore.writes[0]).toMatchObject({ category: 'Portfolio' })
    expect(mockStore.writes[0]).not.toHaveProperty('categories')
  })

  it('refuses a plugin category, and writes nothing', async () => {
    const res = await save({ category: 'analytics' })
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('Pick the kind of site this starter is from the Category menu')
    expect(mockStore.writes).toEqual([])
  })
})

describe('every other listing keeps the fixed taxonomy', () => {
  beforeEach(() => {
    mockStore.listing = { artifactType: 'plugin', type: 'plugin', profileId: 'org-1', displayName: 'Widget' }
  })

  it('saves a taxonomy category to `categories`', async () => {
    const res = await save({ categories: ['seo'] })
    expect(res.statusCode).toBe(200)
    expect(mockStore.writes[0]).toMatchObject({ categories: ['seo'] })
  })

  it('refuses a style name, as before', async () => {
    const res = await save({ categories: ['Portfolio'] })
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('categories must be up to 3 entries from the fixed taxonomy')
  })
})
