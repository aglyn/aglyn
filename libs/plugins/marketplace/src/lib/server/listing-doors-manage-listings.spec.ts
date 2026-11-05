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
 * @jest-environment node
 */

/**
 * The listing doors ask "Manage published listings" (AGL-4047).
 *
 * Editing a published listing (`update-listing`), its picture
 * (`/api/marketplace/preview-image`), its visibility (`set-visibility`) and
 * unpublishing or republishing it (`set-published`) asked
 * the owner-or-admin role helper. Each now asks the key, for
 * the workspace that published the listing, through `manageListingsRefusal`;
 * a refusal is answered as the gate words it and nothing is recorded or
 * written. The three `publish-plugin` actions let staff moderate, as they
 * did; the picture never let staff in and still does not.
 */

import { publisherAgreementConsent } from '../model/publisher-agreement'

const mockRefusal: { value: null | { status: 403; body: Record<string, unknown> } } = { value: null }
jest.mock('./publisher-permissions', () => ({
  manageListingsRefusal: jest.fn(async () => mockRefusal.value),
}))
jest.mock('./publisher-agreement-acceptance', () => ({
  recordPublisherAgreementAcceptance: jest.fn(async () => ({})),
}))
jest.mock('./listing-screen', () => ({ listingSubmissionRefusal: async () => null }))
jest.mock('./listing-query-fields', () => ({ refreshListingQueryFields: async () => undefined }))
jest.mock('./publisher-profile', () => ({ resolvePublisherProfile: async () => null }))
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
jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  isImpersonationSession: () => false,
}))

const mockStore: { writes: Array<Record<string, unknown>> } = { writes: [] }
jest.mock('@aglyn/tenant-data-admin', () => {
  const listing = {
    profileId: 'org-1',
    displayName: 'Listing',
    visibility: 'private',
    description: 'A listing',
    readme: 'Read me',
    license: 'MIT',
  }
  const listingRef = {
    get: async () => ({
      exists: true,
      data: () => listing,
      get: (field: string) => (listing as Record<string, unknown>)[field],
    }),
    set: async (data: Record<string, unknown>) => {
      mockStore.writes.push(data)
    },
  }
  return {
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: async () => ({ uid: 'uid-1', email_verified: true }),
        }),
        firestore: () => ({ collection: () => ({ doc: () => listingRef }) }),
        storage: () => ({ bucket: () => ({ file: () => ({ delete: async () => undefined }) }) }),
      }),
      firestore: { FieldValue: { serverTimestamp: () => 'NOW', delete: () => 'DELETE' } },
    },
    getOrgForUser: async () => null,
    notifyStaff: async () => undefined,
  }
})

import { previewImageHandler } from './preview-image'
import { publishPluginHandler } from './publish-plugin'

const gate = () =>
  (jest.requireMock('./publisher-permissions') as { manageListingsRefusal: jest.Mock }).manageListingsRefusal
const recorded = () =>
  (jest.requireMock('./publisher-agreement-acceptance') as { recordPublisherAgreementAcceptance: jest.Mock })
    .recordPublisherAgreementAcceptance

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

const request = (method: string, body: Record<string, unknown>) =>
  ({
    method,
    headers: { authorization: 'Bearer token' },
    body: { listingId: 'listing-1', agreement: publisherAgreementConsent(), ...body },
  }) as never

const DOORS: Array<[string, () => Promise<any>, boolean]> = [
  ['update-listing', async () => {
    const res = makeRes()
    await publishPluginHandler(request('POST', { action: 'update-listing', displayName: 'Renamed' }), res)
    return res
  }, true],
  ['set-visibility', async () => {
    const res = makeRes()
    await publishPluginHandler(request('POST', { action: 'set-visibility', visibility: 'private' }), res)
    return res
  }, true],
  ['set-published', async () => {
    const res = makeRes()
    await publishPluginHandler(request('POST', { action: 'set-published', published: false }), res)
    return res
  }, true],
  ['preview-image (remove)', async () => {
    const res = makeRes()
    await previewImageHandler(request('DELETE', {}), res)
    return res
  }, false],
]

const REFUSAL = {
  status: 403 as const,
  body: {
    error: 'Your role does not include "Manage published listings" — ask an organization admin',
    reason: 'permission',
    permission: 'marketplace.manageListings',
  },
}

beforeEach(() => {
  mockStore.writes = []
  mockRefusal.value = null
  gate().mockClear()
  recorded().mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

describe('the listing doors ask "Manage published listings" (AGL-4047)', () => {
  it.each(DOORS)('%s asks it of the listing’s publishing workspace', async (_name, call, staffMayModerate) => {
    await call()
    expect(gate()).toHaveBeenCalledTimes(1)
    const [caller, publisherOrgId, options] = gate().mock.calls[0]
    expect(caller).toMatchObject({ uid: 'uid-1' })
    expect(publisherOrgId).toBe('org-1')
    expect(options).toEqual({ staffMayModerate })
  })

  it.each(DOORS)('%s answers a refusal as the gate words it, and records and writes nothing', async (_name, call) => {
    mockRefusal.value = REFUSAL
    const res = await call()
    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual(REFUSAL.body)
    expect(recorded()).not.toHaveBeenCalled()
    expect(mockStore.writes).toEqual([])
  })

  it.each(DOORS)('%s goes on past the gate for a holder', async (_name, call) => {
    const res = await call()
    expect(res.statusCode).toBe(200)
    expect(recorded()).toHaveBeenCalledTimes(1)
  })
})
