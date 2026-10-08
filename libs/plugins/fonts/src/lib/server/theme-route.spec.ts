/**
 * @jest-environment ./jest-environment-node-shared.cjs
 */
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

import { fontsThemeRoute } from './theme-route'

const state: {
  token: Record<string, unknown> | null
  host: Record<string, unknown> | null
  locked: Response | null
  updates: Array<Record<string, unknown>>
} = { token: null, host: null, locked: null, updates: [] }

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    firestore: { Timestamp: { now: () => 'now' } },
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => {
          if (!state.token) throw Object.assign(new Error('bad token'), { code: 'auth/argument-error' })
          return state.token
        },
      }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => ({
              exists: state.host !== null,
              get: (field: string) => state.host?.[field],
              data: () => state.host,
            }),
            update: async (fields: Record<string, unknown>) => {
              state.updates.push(fields)
            },
          }),
        }),
      }),
    }),
  },
  getOrgForHost: async () => ({ org: { id: 'o1' } }),
  lockdownRefusal: async () => state.locked,
  logHostActivity: async () => undefined,
}))

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  isEmailVerified: (token: Record<string, unknown>) => token['email_verified'] === true,
  isImpersonationSession: () => false,
}))

jest.mock('@aglyn/aglyn/plugin-manager/plugin-site-cache', () => ({ dropPluginSiteCache: async () => undefined }))

const FACE = {
  family: 'Acme Sans',
  weight: 400,
  style: 'normal',
  category: 'sans-serif',
  metrics: { unitsPerEm: 1000, ascent: 900, descent: -200, lineGap: 0, xWidthAvg: 500 },
}

const post = (body: unknown, query = '?hostId=h1') =>
  fontsThemeRoute(
    new Request(`https://console.test/api/fonts/theme${query}`, {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

beforeEach(() => {
  state.token = { uid: 'u1', email_verified: true }
  state.host = { memberRoles: { u1: 'editor' } }
  state.locked = null
  state.updates = []
})

describe('POST /api/fonts/theme (AGL-3668)', () => {
  it('lists nothing for a site with no installed fonts, and writes nothing', async () => {
    const response = await post({ op: 'list' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ fonts: [] })
    expect(state.updates).toEqual([])
  })

  it('plans an upload for a face the theme does not hold', async () => {
    const response = await post({ op: 'plan', face: FACE })
    expect(await response.json()).toEqual({ plan: { mode: 'upload' } })
  })

  it('installs a face and stores the difference as the site override', async () => {
    const response = await post({ op: 'install', face: FACE, mediaId: 'm1', version: 'aaaa' })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { fonts: Array<{ family: string; faces: Array<{ mediaId?: string }> }> }
    expect(body.fonts[0]?.family).toBe('Acme Sans')
    expect(body.fonts[0]?.faces[0]?.mediaId).toBe('m1')
    expect(state.updates).toHaveLength(1)
    expect(state.updates[0]).toHaveProperty('themeOverride')
    expect(state.updates[0]?.['updatedAt']).toBe('now')
  })

  it('refuses a caller without a valid token, an unverified address, or a role that cannot edit the theme', async () => {
    state.token = null
    expect((await post({ op: 'list' })).status).toBe(401)
    state.token = { uid: 'u1', email_verified: false }
    expect((await post({ op: 'list' })).status).toBe(403)
    state.token = { uid: 'u1', email_verified: true }
    state.host = { memberRoles: { u1: 'author' } }
    expect((await post({ op: 'list' })).status).toBe(403)
    state.token = { uid: 's1', email_verified: true, staff: true }
    expect((await post({ op: 'list' })).status).toBe(200)
  })

  it('needs a site, an operation it can read, and a site that exists', async () => {
    expect((await post({ op: 'list' }, '')).status).toBe(400)
    expect((await post({ op: 'nope' })).status).toBe(400)
    state.host = null
    expect((await post({ op: 'list' })).status).toBe(404)
  })

  it('writes nothing while the account is locked down', async () => {
    state.locked = Response.json({ error: 'locked' }, { status: 423 })
    const response = await post({ op: 'remove-family', family: 'Acme Sans' })
    expect(response.status).toBe(423)
    expect(state.updates).toEqual([])
  })
})
