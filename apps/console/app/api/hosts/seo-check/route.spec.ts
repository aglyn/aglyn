/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom, where `Request` is not a
 * global.
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

/**
 * `/api/hosts/seo-check` — the site's SEO check is the PLATFORM's.
 *
 * The findings used to be reachable only through the AI plugin's audit job, so
 * a site owner without the add-on could not be told a title is too long. The
 * properties that keep it the platform's:
 *
 *  1. a member of the site gets the findings with no plan, add-on or plugin
 *     consulted — nothing here reads an entitlement, and the route imports no
 *     plugin (`check:lib-boundaries` holds the import; this holds the answer);
 *  2. it reads through the same scan the AI job audits with, so the two can
 *     never list different pages;
 *  3. a stranger to the site is told nothing about it.
 */

export {}

const mockVerifyIdToken = jest.fn()
const mockTemplateScreenIds = jest.fn(async (..._args: unknown[]) => ['tpl'])

/** Every document, keyed by slash path. */
let docs: Record<string, Record<string, unknown>> = {}

function mockMakeFirestore() {
  const ref = (path: string): any => ({
    collection: (name: string) => collection(`${path}/${name}`),
    get: async () => {
      const data = docs[path]
      return { exists: Boolean(data), data: () => data, get: (field: string) => data?.[field] }
    },
  })
  const collection = (path: string): any => {
    const query = {
      select: () => query,
      limit: () => query,
      get: async () => {
        const prefix = `${path}/`
        return {
          docs: Object.keys(docs)
            .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
            .map((key) => ({
              id: key.slice(prefix.length),
              data: () => docs[key],
              get: (field: string) => docs[key][field],
              ref: ref(key),
            })),
        }
      },
      doc: (id: string) => ref(`${path}/${id}`),
    }
    return query
  }
  return { collection }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
      firestore: () => mockMakeFirestore(),
    }),
  },
  getOrgForHost: async () => ({ orgId: 'org-1', org: {} }),
  resolveOrgIdForHost: async () => 'org-1',
  lockdownRefusal: async () => null,
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
}))

jest.mock('@aglyn/tenant-runtime/template-screens', () => ({
  __esModule: true,
  getTemplateScreenIds: (...args: unknown[]) => mockTemplateScreenIds(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: Object.fromEntries(new URL(request.url).searchParams),
    body: {},
    headers: { authorization: request.headers.get('authorization') ?? undefined },
  }),
}))

const mockReadRepeatRows = jest.fn(async (..._args: unknown[]) => ({
  services: { records: [{ $id: 'r1', name: 'Dimmable floor lamps' }] },
}))
jest.mock('@aglyn/aglyn/plugin-manager/repeat-rows', () => ({
  __esModule: true,
  readRepeatRows: (...args: unknown[]) => mockReadRepeatRows(...args),
}))

jest.mock('../../_lib/invalid-id-token-response', () => ({
  __esModule: true,
  invalidIdTokenResponse: () => null,
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET } = require('./route') as { GET: (request: Request) => Promise<Response> }

const call = (query: string) =>
  GET(new Request(`https://console.test/api/hosts/seo-check?${query}`, { headers: { authorization: 'Bearer tok' } }))

const heading = (text: string) => ({
  rootId: 'root',
  nodes: {
    root: { componentId: 'div', nodes: ['main'] },
    main: { componentId: 'section', props: { component: 'main' }, nodes: ['h'] },
    h: { componentId: 'muiTypography', props: { variant: 'h1', children: text }, nodes: [] },
  },
})

beforeEach(() => {
  mockVerifyIdToken.mockReset()
  mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email_verified: true })
  mockTemplateScreenIds.mockClear()
  docs = {
    'hosts/h1': {
      orgId: 'org-1',
      memberRoles: { u1: 'owner' },
      screens: { home: '/', lamps: 'lamps', tpl: 'post' },
      seo: { title: 'Acme', entity: { name: 'Acme', description: 'Lamps.' }, agent: { whenToUse: 'Lamps.' } },
    },
    'hosts/h1/screens/home': { displayName: 'Home', versionId: 'v1', seo: { title: 'Acme lamps, made to order', description: 'Brass lamps.' } },
    'hosts/h1/screens/home/versions/v1': heading('Brass desk lamps made to order'),
    'hosts/h1/screens/lamps': { displayName: 'Lamps', versionId: 'v2', seo: { title: 'x'.repeat(70) } },
    'hosts/h1/screens/lamps/versions/v2': heading('Every lamp we make'),
    'hosts/h1/screens/tpl': { displayName: 'Post', versionId: 'v3' },
  }
})

describe('the SEO check is the platform’s', () => {
  it('tells a site member what is wrong, with nothing but the site read', async () => {
    const response = await call('hostId=h1&keywords=%2Flamps%3A%20dimmable')
    expect(response.status).toBe(200)
    const { report } = await response.json()
    expect(report.pages.map((page: { screenId: string }) => page.screenId)).toEqual(['home', 'lamps'])
    const lamps = report.pages.find((page: { screenId: string }) => page.screenId === 'lamps')
    expect(lamps.findings.map((entry: { code: string }) => entry.code)).toEqual([
      'title-too-long',
      'description-missing',
      'orphan',
      'keyword-missing',
    ])
    expect(report.site).toEqual([])
    // Template screens are not pages: the runtime's list is what excludes them.
    expect(mockTemplateScreenIds).toHaveBeenCalledWith({ hostId: 'h1' })
  })

  it('checks each page as it publishes: a component’s heading and a repeat’s rows are the page’s (AGL-3501)', async () => {
    docs['hosts/h1/screens/lamps/versions/v2'] = {
      rootId: 'root',
      nodes: {
        root: { componentId: 'div', nodes: ['main'] },
        main: { componentId: 'section', props: { component: 'main' }, nodes: ['hero', 'list'] },
        hero: { componentId: 'reusableInstance', props: { refId: 'heading', propValues: { title: 'Brass floor lamps' } }, nodes: [] },
        list: { componentId: 'muiStack', props: { repeatDataset: 'services' }, nodes: ['row'] },
        row: { componentId: 'muiTypography', props: { children: '{{item.name}}' }, nodes: [] },
      },
    }
    docs['hosts/h1/components/heading'] = {
      rootId: 't',
      nodes: { t: { componentId: 'muiTypography', props: { variant: 'h1', children: '{{prop.title}}' }, nodes: [] } },
      props: [{ name: 'title', type: 'text', defaultValue: '' }],
    }
    const response = await call('hostId=h1&keywords=%2Flamps%3A%20floor%20lamps%2C%20dimmable')
    const { report } = await response.json()
    const lamps = report.pages.find((page: { screenId: string }) => page.screenId === 'lamps')
    const codes = lamps.findings.map((entry: { code: string }) => entry.code)
    expect(codes).not.toContain('h1-missing')
    expect(codes).not.toContain('keyword-missing')
    expect(mockReadRepeatRows).toHaveBeenCalledWith({ hostId: 'h1', keys: ['services'] })
  })

  it('tells a stranger to the site nothing', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'stranger', email_verified: true })
    docs['hosts/h1'] = { ...docs['hosts/h1'], memberRoles: {} }
    const response = await call('hostId=h1')
    expect(response.status).toBe(404)
  })

  it('refuses a request that names no site, and a caller with no token', async () => {
    expect((await call('')).status).toBe(400)
    const anonymous = await GET(new Request('https://console.test/api/hosts/seo-check?hostId=h1'))
    expect(anonymous.status).toBe(401)
  })
})
