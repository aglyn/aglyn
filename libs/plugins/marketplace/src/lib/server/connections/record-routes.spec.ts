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

import { createMemoryFirestore, type MemoryFirestore } from '../../testing/memory-firestore'
import { registerMarketplaceDeclarations } from '../../declarations'
import { PLUGIN_CONNECTIONS_API_ROUTES } from '../../model/plugin-connections'
import { recordRoute } from './record-routes'

/**
 * The editor's read of a connection's record (AGL-4195):
 * `GET /api/plugin-connections/record`, behind the site gate every
 * connection route climbs, answering the record held to the pinned
 * declaration exactly as the published page holds it.
 */

const HOST = 'host-acme'
const FREE_HOST = 'host-free'
const LISTING = 'listingReviews'
const CONSOLE = 'https://app.example.com'

const CONNECTION = {
  id: 'reviews',
  provider: 'google',
  label: 'Google Business Profile',
  authorizationUrl: 'https://accounts.example.com/o/oauth2/auth',
  tokenUrl: 'https://oauth2.example.com/token',
  scopes: ['business.manage'],
  apiHosts: ['mybusiness.example.com'],
  sync: {
    intervalHours: 6,
    requests: [{ id: 'reviews', method: 'GET', url: 'https://mybusiness.example.com/v4/reviews', itemsPath: 'reviews' }],
    record: {
      fields: { rating: { request: 'reviews', type: 'number', path: 'averageRating' } },
      items: { request: 'reviews', maxItems: 5, fields: { author: { type: 'string', path: 'reviewer.displayName', maxLength: 100 } } },
    },
  },
}

let db: MemoryFirestore

const TOKENS: Record<string, Record<string, unknown>> = {
  'tok-admin': { uid: 'uid-admin', email_verified: true },
  'tok-editor': { uid: 'uid-editor', email_verified: true },
}

const firebaseAdminFake = {
  app: () => ({
    firestore: () => db,
    auth: () => ({
      verifyIdToken: async (token: string) => {
        const decoded = TOKENS[token]
        if (!decoded) throw Object.assign(new Error('Decoding Firebase ID token failed'), { code: 'auth/argument-error' })
        return decoded
      },
    }),
  }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  get firebaseAdmin() {
    return firebaseAdminFake
  },
  getOrgForHost: async (hostId: string) => {
    if (hostId === 'host-acme') return { orgId: 'org-acme', org: { plan: 'starter', subscription: { status: 'active' } } }
    if (hostId === 'host-free') return { orgId: 'org-free', org: { plan: 'free' } }
    return null
  },
  logHostActivity: async () => undefined,
}))

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  get firebaseAdmin() {
    return firebaseAdminFake
  },
  isEmailVerified: (decoded: { email_verified?: boolean }) => decoded.email_verified === true,
  isImpersonationSession: () => false,
}))

beforeAll(() => {
  registerMarketplaceDeclarations()
})

beforeEach(() => {
  db = createMemoryFirestore()
  for (const hostId of [HOST, FREE_HOST]) {
    db.docs.set(`hosts/${hostId}`, { memberRoles: { 'uid-admin': 'admin', 'uid-editor': 'editor' } })
    db.docs.set(`hosts/${hostId}/installs/${LISTING}`, {
      listingId: LISTING,
      version: '1.0.0',
      manifest: { id: 'reviews-widget', connections: [CONNECTION] },
    })
    db.docs.set(`hosts/${hostId}/pluginConnections/record-${LISTING}__reviews`, {
      kind: 'record',
      listingId: LISTING,
      connectionId: 'reviews',
      version: '1.0.0',
      syncedAtMs: 1_700_000_000_000,
      fields: { rating: 4.8, undeclared: 'never' },
      items: [{ author: 'Sam', email: 'never' }],
    })
  }
})

const get = (query: Record<string, string>, token?: string) =>
  recordRoute(
    new Request(`${CONSOLE}/api/${PLUGIN_CONNECTIONS_API_ROUTES.record}?${new URLSearchParams(query)}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  )

const SITE = { hostId: HOST, listingId: LISTING, connectionId: 'reviews' }

describe('GET /api/plugin-connections/record (AGL-4195)', () => {
  it('is served at the path beside the other connection routes', () => {
    expect(PLUGIN_CONNECTIONS_API_ROUTES.record).toBe('plugin-connections/record')
  })

  it('answers the record, held to the declaration, to a member holding the site key', async () => {
    const response = await get(SITE, 'tok-admin')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      planAllows: true,
      record: {
        kind: 'record',
        listingId: LISTING,
        connectionId: 'reviews',
        version: '1.0.0',
        syncedAtMs: 1_700_000_000_000,
        fields: { rating: 4.8 },
        items: [{ author: 'Sam' }],
      },
    })
  })

  it('answers null before the first sync', async () => {
    db.docs.delete(`hosts/${HOST}/pluginConnections/record-${LISTING}__reviews`)
    expect(await (await get(SITE, 'tok-admin')).json()).toEqual({ record: null, planAllows: true })
  })

  it('answers null on a plan without connections', async () => {
    expect(await (await get({ ...SITE, hostId: FREE_HOST }, 'tok-admin')).json()).toEqual({ record: null, planAllows: false })
  })

  it('refuses without a sign-in, without the site key, and for a connection the site does not run', async () => {
    expect((await get(SITE)).status).toBe(401)
    expect((await get(SITE, 'tok-editor')).status).toBe(403)
    expect((await get({ ...SITE, connectionId: 'other' }, 'tok-admin')).status).toBe(404)
    expect((await get({ ...SITE, listingId: 'another-listing' }, 'tok-admin')).status).toBe(404)
    expect((await get({ hostId: HOST, listingId: LISTING }, 'tok-admin')).status).toBe(400)
  })

  it('answers only GET', async () => {
    const response = await recordRoute(new Request(`${CONSOLE}/api/plugin-connections/record`, { method: 'POST' }))
    expect(response.status).toBe(405)
  })
})
