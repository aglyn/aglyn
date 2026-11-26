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
 * `/api/hosts/theme` `preview` (AGL-3668): the theme picker's preview of a
 * theme the site is not using yet, for the native apps, which cannot run the
 * console's `ThemePreview`. It must read the theme the console would preview
 * (a preset from the registry, a saved theme from the library, the edits
 * stashed on it laid over), change nothing, and ask what the editor's values
 * ask ("Edit site content").
 */

import type { HostTheme } from '@aglyn/shared-data-types'

const mockVerifyIdToken = jest.fn()
const mockUpdate = jest.fn()
const docs: Record<string, Record<string, unknown> | undefined> = {}

function mockDoc(path: string): Record<string, unknown> {
  return {
    get: async () => ({ exists: docs[path] !== undefined, data: () => docs[path] }),
    update: (...args: unknown[]) => mockUpdate(path, ...args),
    collection: (name: string) => ({ doc: (id: string) => mockDoc(`${path}/${name}/${id}`) }),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
      firestore: () => ({ collection: (name: string) => ({ doc: (id: string) => mockDoc(`${name}/${id}`) }) }),
    }),
  },
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  getOrgForHost: async () => null,
  isImpersonationSession: () => false,
  lockdownRefusal: async () => null,
  logHostActivity: async () => undefined,
}))

jest.mock('@aglyn/tenant-data-admin/server/theme-library-write', () => ({
  __esModule: true,
  runThemeLibraryAction: jest.fn(),
}))

jest.mock('@aglyn/aglyn/plugin-manager/plugin-site-cache', () => ({
  __esModule: true,
  dropPluginSiteCache: jest.fn(),
}))

const PRESET: HostTheme = {
  colorSchemes: {
    light: { primary: { main: '#18181b', contrastText: '#fafafa' } },
    dark: { primary: { main: '#fafafa', contrastText: '#18181b' } },
  },
} as HostTheme

jest.mock('@aglyn/aglyn/plugin-manager/plugin-theme-presets', () => ({
  __esModule: true,
  listServerThemePresets: () => [{ id: 'minimal', name: 'Minimal', description: 'Plain', theme: PRESET }],
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: Object.fromEntries([...request.headers.entries()].map(([key, value]) => [key.toLowerCase(), value])),
  }),
}))

jest.mock('@aglyn/aglyn/app-utils/host-permissions', () => ({
  __esModule: true,
  holdsSiteKey: (snapshot: { data: () => Record<string, unknown> }, uid: string) =>
    (snapshot.data()['editors'] as string[] | undefined)?.includes(uid) === true,
  siteKeyRefusal: () => 'Your site role does not include this permission.',
}))

const { POST } = require('../app/api/hosts/theme/route')

function preview(target: Record<string, unknown>) {
  return POST(
    new Request('https://console.aglyn.com/api/hosts/theme', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostId: 'h1', action: 'preview', target }),
    }),
  ) as Promise<Response>
}

beforeEach(() => {
  jest.clearAllMocks()
  for (const key of Object.keys(docs)) delete docs[key]
  docs['hosts/h1'] = { subdomain: 'juniper', editors: ['editor-uid'] }
  mockVerifyIdToken.mockResolvedValue({ uid: 'editor-uid', email_verified: true })
})

describe('POST /api/hosts/theme preview', () => {
  it('previews a built-in theme from the registry in light and dark, changing nothing', async () => {
    const response = await preview({ kind: 'preset', id: 'minimal' })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.name).toBe('Minimal')
    expect(body.edited).toBe(false)
    expect(body.light.primary.main).toBe('#18181b')
    expect(body.dark.primary.main).toBe('#fafafa')
    expect(body.light.typography.length).toBeGreaterThan(8)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('previews a saved theme with the edits stashed on it', async () => {
    docs['hosts/h1/themes/t1'] = {
      kind: 'custom',
      name: 'Spring',
      theme: PRESET,
      override: {
        patch: { colorSchemes: { light: { primary: { main: '#0055aa', contrastText: '#ffffff' } } } },
      },
    }
    const response = await preview({ kind: 'custom', id: 't1' })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.name).toBe('Spring')
    expect(body.edited).toBe(true)
    expect(body.light.primary.main).toBe('#0055aa')
    expect(body.dark.primary.main).toBe('#fafafa')
  })

  it('refuses a theme that is not in the library or not registered', async () => {
    expect((await preview({ kind: 'custom', id: 'gone' })).status).toBe(404)
    expect((await preview({ kind: 'preset', id: 'nope' })).status).toBe(404)
    expect((await preview({ kind: 'other' })).status).toBe(400)
  })

  it('asks Edit site content, as the editor’s values do', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'someone-else', email_verified: true })
    expect((await preview({ kind: 'default' })).status).toBe(403)
  })

  it('previews the default on the site’s base', async () => {
    const body = await (await preview({ kind: 'default' })).json()
    expect(body.light.primary.main).toMatch(/^#|^rgb/)
    expect(body.light.background.default).not.toBe('')
  })
})
