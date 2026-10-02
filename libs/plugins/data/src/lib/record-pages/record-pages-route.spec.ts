/**
 * @jest-environment node
 *
 * The docblock above must stay the file's FIRST comment: below the license it
 * is silently ignored, and this suite needs `Request`/`Response`.
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
 * Saving a record template (AGL-3475): the one writer of a site's bindings,
 * and every refusal that stands between an author and a published route that
 * would serve the wrong thing.
 */

const mockDocs = new Map<string, Record<string, unknown> | undefined>()
const mockWrites: Array<{ op: 'set' | 'delete'; path: string; data?: unknown }> = []
const mockDrops: unknown[] = []
const mockAnnounces: unknown[] = []
const mockBindings = jest.fn()
const mockDataset = jest.fn()
let mockToken: Record<string, unknown> = {}
let mockCollections: Array<Record<string, unknown>> = []

const docRef = (path: string): any => ({
  get: async () => ({
    exists: mockDocs.has(path),
    data: () => mockDocs.get(path),
  }),
  set: async (data: unknown) => {
    mockWrites.push({ op: 'set', path, data })
  },
  delete: async () => {
    mockWrites.push({ op: 'delete', path })
  },
  collection: (name: string) => collectionRef(`${path}/${name}`),
})
const collectionRef = (path: string): any => ({
  doc: (id: string) => docRef(`${path}/${id}`),
  select: () => ({
    get: async () => ({
      docs: (path.endsWith('/collections') ? mockCollections : []).map((data) => ({
        data: () => data,
        get: (field: string) => data[field],
      })),
    }),
  }),
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => mockToken }),
      firestore: () => ({ collection: (name: string) => collectionRef(name) }),
    }),
  },
  emailUnverifiedResponse: () => Response.json({ error: 'verify' }, { status: 403 }),
  isImpersonationSession: () => false,
  isServerReleaseFlagOnForOrg: async () => true,
  lockdownRefusal: async () => null,
}))
jest.mock('@aglyn/tenant-data-admin/server/id-token-refusal', () => ({
  isRefusedIdToken: () => false,
}))
jest.mock('@aglyn/aglyn/plugin-manager/plugin-site-cache', () => ({
  dropPluginSiteCache: async (request: unknown) => {
    mockDrops.push(request)
    return { dropped: 1, skipped: 0, complete: true }
  },
}))
jest.mock('../server/announce-dataset-records', () => ({
  announceDatasetRecords: async (request: unknown) => {
    mockAnnounces.push(request)
  },
}))
jest.mock('./record-page-live-paths.server', () => ({
  readRecordPageBindingsUncached: (...args: unknown[]) => mockBindings(...args),
  recordPagePathsOf: async (_host: string, binding: { base: string }) => ({
    paths: [`/${binding.base}/roofing`],
    truncated: false,
  }),
}))
jest.mock('./record-page-read.server', () => ({
  readSiteDataset: (...args: unknown[]) => mockDataset(...args),
}))

import { recordPagesHandler } from './record-pages-route'

const MODEL = {
  order: ['name', 'slug', 'summary'],
  fields: {
    name: { name: 'Name', type: 'text' },
    slug: { name: 'Page address', type: 'text', customType: 'pageAddress' },
    summary: { name: 'Summary', type: 'text' },
  },
}

const save = (body: Record<string, unknown> = {}, init: { method?: string; token?: boolean } = {}) =>
  recordPagesHandler(
    new Request('https://console.test/api/hosts/record-pages', {
      method: init.method ?? 'POST',
      headers: {
        'content-type': 'application/json',
        ...(init.token === false ? {} : { authorization: 'Bearer token' }),
      },
      ...(init.method === 'GET'
        ? {}
        : {
            body: JSON.stringify({
              action: 'save',
              hostId: 'host-1',
              screenId: 'tmpl',
              datasetId: 'services',
              base: 'services',
              slugField: 'slug',
              seoDescriptionField: 'summary',
              ...body,
            }),
          }),
    }),
    {} as never,
  ) as Promise<Response>

const status = async (response: Promise<Response>) => (await response).status
const error = async (response: Promise<Response>) => ((await (await response).json()) as any).error

beforeEach(() => {
  mockDocs.clear()
  mockWrites.splice(0)
  mockDrops.splice(0)
  mockAnnounces.splice(0)
  mockToken = { uid: 'u1', email_verified: true }
  mockCollections = [{ slug: 'blog', kind: 'content' }]
  mockDocs.set('hosts/host-1', { orgId: 'org-1', memberRoles: { u1: 'editor' } })
  mockDocs.set('orgs/org-1', { plan: 'starter' })
  mockDocs.set('hosts/host-1/screens/tmpl', { kind: 'template', versionId: 'v1' })
  mockBindings.mockResolvedValue([])
  mockDataset.mockResolvedValue({
    id: 'services',
    name: 'Services',
    model: MODEL,
    ref: { parent: { parent: { id: 'org-1' } } },
  })
})

describe('saving a record template', () => {
  it('writes the binding and drops the pages it starts serving, its base included', async () => {
    const response = await save()
    expect(response.status).toBe(200)
    expect(mockWrites).toEqual([
      {
        op: 'set',
        path: 'hosts/host-1/recordPages/tmpl',
        data: expect.objectContaining({
          datasetId: 'services',
          base: 'services',
          slugField: 'slug',
          seoDescriptionField: 'summary',
          updatedBy: 'u1',
        }),
      },
    ])
    expect(mockDrops).toEqual([
      expect.objectContaining({
        hostIds: ['host-1'],
        paths: { 'host-1': ['/services', '/services/roofing'] },
      }),
    ])
    expect(mockAnnounces).toEqual([expect.objectContaining({ orgId: 'org-1', datasetId: 'services' })])
  })

  it('normalizes the base it stores', async () => {
    await save({ base: '/Services/Residential/' })
    expect((mockWrites[0]?.data as any).base).toBe('services/residential')
  })

  it('is refused without the publisher role, since a binding is a route', async () => {
    mockDocs.set('hosts/host-1', { orgId: 'org-1', memberRoles: { u1: 'author' } })
    expect(await status(save())).toBe(403)
    expect(mockWrites).toEqual([])
  })

  it('is refused for a page that is not yet a template', async () => {
    mockDocs.set('hosts/host-1/screens/tmpl', { kind: 'page' })
    const response = await save()
    expect(response.status).toBe(409)
    expect(((await response.json()) as any).code).toBe('not-template')
  })

  it('is refused on a plan without datasets', async () => {
    mockDocs.set('orgs/org-1', { plan: 'free' })
    expect(await error(save())).toMatch(/Starter/)
  })

  it('is refused for a dataset the site may not see', async () => {
    mockDataset.mockResolvedValue(null)
    expect(await status(save())).toBe(404)
  })

  it('is refused for an address field that is not a page address', async () => {
    expect(await error(save({ slugField: 'name' }))).toMatch(/Page address/)
  })

  it('is refused for a field the dataset does not have', async () => {
    expect(await error(save({ seoImageField: 'photo' }))).toMatch(/no field "photo"/)
  })

  it('is refused for a base a content collection already owns', async () => {
    expect(await error(save({ base: 'blog' }))).toMatch(/content collection/)
  })

  it('is refused for a reserved base', async () => {
    expect(await error(save({ base: 'search' }))).toMatch(/reserved/)
  })

  it('is refused for a base another template uses, but not a nested one', async () => {
    mockBindings.mockResolvedValue([
      { screenId: 'other', datasetId: 'areas', base: 'services', slugField: 'slug' },
    ])
    expect(await error(save())).toMatch(/already uses/)
    expect(await status(save({ base: 'services/residential' }))).toBe(200)
  })

  it('is refused for a second template of the same dataset on the site', async () => {
    mockBindings.mockResolvedValue([
      { screenId: 'other', datasetId: 'services', base: 'servicios', slugField: 'slug' },
    ])
    expect(await status(save())).toBe(409)
  })

  it('drops the pages it stops serving when the base moves', async () => {
    mockBindings.mockResolvedValue([
      { screenId: 'tmpl', datasetId: 'services', base: 'what-we-do', slugField: 'slug' },
    ])
    await save()
    expect((mockDrops[0] as any).paths['host-1']).toEqual(
      expect.arrayContaining(['/services/roofing', '/what-we-do', '/what-we-do/roofing']),
    )
  })

  it('answers only POST, and only a signed-in caller', async () => {
    expect(await status(save({}, { method: 'GET' }))).toBe(405)
    expect(await status(save({}, { token: false }))).toBe(401)
  })
})

describe('removing a record template', () => {
  it('deletes the binding and drops the pages it served', async () => {
    mockBindings.mockResolvedValue([
      { screenId: 'tmpl', datasetId: 'services', base: 'services', slugField: 'slug' },
    ])
    const response = await save({ action: 'remove' })
    expect(response.status).toBe(200)
    expect(mockWrites).toEqual([{ op: 'delete', path: 'hosts/host-1/recordPages/tmpl' }])
    expect((mockDrops[0] as any).paths['host-1']).toEqual(['/services', '/services/roofing'])
  })

  it('is a no-op for a page that is no template', async () => {
    expect(((await (await save({ action: 'remove' })).json()) as any).removed).toBe(false)
    expect(mockWrites).toEqual([])
  })
})
