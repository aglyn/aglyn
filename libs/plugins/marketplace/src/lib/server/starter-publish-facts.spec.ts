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
 * What the native apps ask before a starter publish (AGL-4049). The gates are
 * the door's own, then the release flag, which staff pass; the answer is what
 * the console's form works out for itself, so the theme a publish names and
 * the setup steps it says are the same on every surface.
 */

const mockPermissions = {
  current: { orgId: 'org-1', permissions: { publishToMarketplace: true } } as {
    orgId: string | null
    permissions: Record<string, boolean>
  },
}
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => mockPermissions.current,
}))

const mockPublisher: { current: Record<string, unknown> | null } = { current: { sellsAsPlatform: false } }
jest.mock('./publisher-profile', () => ({
  PUBLISHER_PROFILES: 'publisherProfiles',
  resolvePublisherProfile: async () => mockPublisher.current,
}))

jest.mock('./starters', () => ({ SITE_STARTERS_UNRELEASED: 'Site starters are not available for this workspace yet' }))

const mockClaims: { current: Record<string, unknown> } = { current: { uid: 'member-1' } }
const mockFlag = { on: true }
const mockHost: { current: Record<string, unknown> | null } = { current: null }
const mockProfile: { current: Record<string, unknown> | null } = { current: null }
const mockScreens: Record<string, Record<string, unknown>> = {}

const doc = (id: string, data: Record<string, unknown> | null | undefined) => ({
  id,
  exists: !!data,
  data: () => data ?? undefined,
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => mockClaims.current }),
      firestore: () => ({
        collection: (name: string) => ({
          doc: (id: string) => ({
            id,
            get: async () => doc(id, name === 'hosts' ? mockHost.current : mockProfile.current),
            collection: () => ({ doc: (screenId: string) => ({ id: screenId }) }),
          }),
        }),
        getAll: async (...refs: Array<{ id: string }>) => refs.map(({ id }) => doc(id, mockScreens[id])),
      }),
    }),
  },
  getOrgForHost: async () => ({ orgId: 'org-1', org: { plan: 'pro' } }),
  isServerReleaseFlagOnForOrg: async () => mockFlag.on,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  checkEntitlement: (org: { plan?: string }) => org.plan !== 'free',
}))

jest.mock('@aglyn/tenant-data-admin/server/id-token-refusal', () => ({
  isRefusedIdToken: () => true,
}))

import { DEFAULT_SITE_THEME } from '@aglyn/aglyn/app-utils/default-site'
import { starterPublishFactsHandler } from './starter-publish-facts'

async function ask(query: Record<string, unknown> = { hostId: 'h1' }, method = 'GET', authorization = 'Bearer t') {
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
  await starterPublishFactsHandler({ method, query, headers: { authorization } } as never, res, undefined as never)
  return res
}

beforeEach(() => {
  mockPermissions.current = { orgId: 'org-1', permissions: { publishToMarketplace: true } }
  mockPublisher.current = { sellsAsPlatform: false }
  mockClaims.current = { uid: 'member-1' }
  mockFlag.on = true
  mockHost.current = { theme: DEFAULT_SITE_THEME, screens: { home: '/', about: 'about' } }
  mockProfile.current = { handle: 'acme', stripeAccountId: 'acct_1', stripeChargesEnabled: true }
  Object.assign(mockScreens, { home: { versionId: 'v1' }, about: { versionId: 'v1' } })
})

describe('GET /api/marketplace/starter-publish-facts', () => {
  it('reads, and only reads', async () => {
    expect((await ask({}, 'POST')).statusCode).toBe(405)
  })

  it('needs a site and a person', async () => {
    expect((await ask({})).statusCode).toBe(400)
    expect((await ask({ hostId: 'h1' }, 'GET', '')).statusCode).toBe(401)
  })

  it('refuses whoever the door would refuse, naming the permission', async () => {
    mockPermissions.current = { orgId: 'org-1', permissions: {} }
    const refused = await ask()
    expect(refused.statusCode).toBe(403)
    expect(refused.body.error).toContain('"Publish to marketplace"')
  })

  it('is behind the release flag, which staff pass', async () => {
    mockFlag.on = false
    expect((await ask()).statusCode).toBe(403)
    mockClaims.current = { uid: 'staff-1', staff: true }
    expect((await ask()).statusCode).toBe(200)
  })

  it('answers what the console works out: the pages, the built-in theme and the words for them', async () => {
    const { statusCode, body } = await ask()
    expect(statusCode).toBe(200)
    expect(body.captures).toBe(
      'Captures its 2 published pages, the shared header and footer they sit in, and the theme you choose below.',
    )
    expect(body.builtin).toMatchObject({ kind: 'builtin', base: 'starter', fonts: null })
    expect(body.builtinDetail).toContain('A site created from it can switch to another built-in theme.')
    expect(body.fontsNote).toBeNull()
    expect(body).toMatchObject({ steps: {}, blocked: false })
  })

  it('says a site that wears its own theme has no built-in to name', async () => {
    mockHost.current = { theme: { colorSchemes: { light: { primary: { main: '#123456' } } } }, screens: { home: '/' } }
    const { body } = await ask()
    expect(body.builtin).toBeNull()
    expect(body.builtinDetail).toContain('wears its own theme')
  })

  it('names each setup step, and only a step a free publish needs turns Publish off', async () => {
    mockProfile.current = { handle: 'acme' }
    const payouts = (await ask()).body
    expect(Object.keys(payouts.steps)).toEqual(['payouts'])
    expect(payouts.blocked).toBe(false)

    mockProfile.current = null
    const profile = (await ask()).body
    expect(Object.keys(profile.steps)).toEqual(['profile'])
    expect(profile.blocked).toBe(true)
  })

  it('needs no payouts for the platform, which sells without them', async () => {
    mockProfile.current = { handle: 'acme' }
    mockPublisher.current = { sellsAsPlatform: true }
    expect((await ask()).body.steps).toEqual({})
  })

  it('says a site with no published Home has nothing to start from', async () => {
    mockHost.current = { theme: DEFAULT_SITE_THEME, screens: { about: 'about' } }
    const { body } = await ask()
    expect(Object.keys(body.steps)).toEqual(['home'])
    expect(body.blocked).toBe(true)
  })

  it('answers 404 for a site that is gone', async () => {
    mockHost.current = null
    expect((await ask()).statusCode).toBe(404)
  })
})
