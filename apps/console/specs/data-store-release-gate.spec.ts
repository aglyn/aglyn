/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
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
 * `release_data_store` closes org-level dataset ADMINISTRATION, not just the
 * Data page (AGL-1653, the milder sibling of the add-on store leak).
 *
 * `<FeatureGate flag="release_data_store">` on the org Data page was the only
 * gate, so `POST /api/orgs/datasets` kept creating datasets and importing
 * records with the flag off. No billing path, which is why it ranks below the
 * add-on store — but it is the same split, and the same fix.
 *
 * The assertion surface is the Firestore `create`, not the status code: the
 * claim is that no dataset is WRITTEN, not merely that the caller saw an
 * error.
 */

const ORG_ID = 'org-1'

/** Whether `isServerReleaseFlagOnForOrg` should answer true. */
let mockFlagOn: boolean
/** Whether the caller's token carries the staff claim. */
let mockIsStaff: boolean
/** Every `(flagKey, orgId)` the route asked the release gate about. */
let mockGateCalls: Array<[string, string | null | undefined]>
/** Payloads written to `orgs/{id}/datasets/{id}` — the real side effect. */
let mockCreates: Array<Record<string, unknown>>

const datasetsCollection = {
  count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
  doc: () => ({
    create: async (payload: Record<string, unknown>) => {
      mockCreates.push(payload)
    },
  }),
}

const orgRef = {
  get: async () => ({ exists: true, data: () => ({ plan: 'pro' }) }),
  collection: () => datasetsCollection,
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({
          uid: 'user-1',
          email_verified: true,
          staff: mockIsStaff,
        }),
      }),
      firestore: () => ({ collection: () => ({ doc: () => orgRef }) }),
    }),
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Email unverified' }, { status: 403 }),
  isImpersonationSession: () => false,
  // Never locked, so a 423 can never be mistaken for the release gate.
  lockdownRefusal: async () => null,
  resolveOrgMembership: async () => ({ member: { role: 'owner' } }),
  isServerReleaseFlagOnForOrg: async (
    flagKey: string,
    orgId: string | null | undefined,
  ) => {
    mockGateCalls.push([flagKey, orgId])
    return mockFlagOn
  },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // Entitlement and quota both pass, so the only thing that can stop the
  // write is the release gate under test.
  checkEntitlement: () => true,
  checkDatasetQuota: () => ({ allowed: true, limit: 100 }),
  checkQuota: () => ({ allowed: true, limit: 100 }),
  coerceDocumentValues: (values: unknown) => values,
  createResourceUid: () => 'dataset-1',
  effectiveDatasetModel: () => ({}),
  validateDocument: () => ({ valid: true, errors: [] }),
  defaultScopeForNewResource: () => 'org',
  newResourceScopeFields: () => ({ resourceScope: ['org'] }),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request.json().catch(() => ({})),
    headers: { authorization: request.headers.get('authorization') ?? undefined },
  }),
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  Timestamp: { now: () => '__now__' },
}))

import { POST } from '../app/api/orgs/datasets/route'

async function createDataset() {
  return POST(
    new Request('https://app.aglyn.com/api/orgs/datasets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: 'Bearer test-token',
      },
      body: JSON.stringify({
        orgId: ORG_ID,
        action: 'create-dataset',
        displayName: 'Customers',
        fields: ['name'],
      }),
    }),
  )
}

beforeEach(() => {
  mockFlagOn = true
  mockIsStaff = false
  mockGateCalls = []
  mockCreates = []
})

describe('org dataset administration stops when its flag is off', () => {
  it('refuses create-dataset and writes nothing', async () => {
    mockFlagOn = false
    const response = await createDataset()
    expect(response.status).toBe(404)
    expect(mockCreates).toEqual([])
  })

  it('asks about the right flag, for the right org', async () => {
    mockFlagOn = false
    await createDataset()
    expect(mockGateCalls).toEqual([['release_data_store', ORG_ID]])
  })
})

describe('the gate is conditional, not a removal', () => {
  it('creates the dataset when the flag is on', async () => {
    // A hardcoded refusal would pass the suite above forever and break the
    // Data page from the day it ships.
    mockFlagOn = true
    const response = await createDataset()
    expect(response.status).toBe(200)
    expect(mockCreates).toHaveLength(1)
    expect(mockCreates[0]).toMatchObject({ displayName: 'Customers' })
  })

  it('lets staff through while the flag is off', async () => {
    // `FeatureGate` renders for staff (`released || isStaff`), so the route
    // has to agree or the page it renders is dead on arrival.
    mockFlagOn = false
    mockIsStaff = true
    const response = await createDataset()
    expect(response.status).toBe(200)
    expect(mockCreates).toHaveLength(1)
    expect(mockGateCalls).toEqual([])
  })
})
