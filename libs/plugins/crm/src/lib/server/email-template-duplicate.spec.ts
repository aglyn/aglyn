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
 * `crm/email-template-duplicate` (AGL-2936): the copy keeps the letter and
 * the scope, is filed under the person copying, is unique by name, meets
 * the listing's ceiling, and writes the org row.
 */

interface Doc {
  [key: string]: unknown
}

const store = new Map<string, Doc>()

const snapshotOf = (path: string) => ({
  id: path.split('/').pop(),
  exists: store.has(path),
  data: () => store.get(path),
  get: (field: string) => store.get(path)?.[field],
})

const children = (prefix: string) =>
  [...store.keys()].filter(
    (path) => path.startsWith(`${prefix}/`) && !path.slice(prefix.length + 1).includes('/'),
  )

const collectionRef = (prefix: string): any => ({
  doc: (id: string) => docRef(`${prefix}/${id}`),
  select: () => ({
    get: async () => {
      const docs = children(prefix).map(snapshotOf)
      return { docs, size: docs.length }
    },
  }),
  add: async (data: Doc) => {
    store.set(`${prefix}/auto-${store.size}`, data)
  },
})

const docRef = (path: string): any => ({
  path,
  get: async () => snapshotOf(path),
  collection: (name: string) => collectionRef(`${path}/${name}`),
})

const mockFirestore = () => ({
  collection: (name: string) => collectionRef(name),
  runTransaction: async (body: (tx: unknown) => Promise<unknown>) =>
    body({
      get: async (target: { get: () => Promise<unknown> }) => target.get(),
      create: (ref: { path: string }, data: Doc) => {
        store.set(ref.path, data)
      },
    }),
})

const mockLogResourceDuplicated = jest.fn(async (..._args: unknown[]) => undefined)
let mockUid = 'uid-1'

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => mockFirestore(),
      auth: () => ({ verifyIdToken: async () => ({ uid: mockUid, email: 'ada@example.test' }) }),
    }),
  },
  logResourceDuplicated: (...args: unknown[]) => mockLogResourceDuplicated(...args),
  resolveOrgIdForHost: async () => 'org-1',
}))
jest.mock('@aglyn/tenant-data-admin/server/id-token-refusal', () => ({
  __esModule: true,
  isRefusedIdToken: () => false,
}))
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  __esModule: true,
  resolveOrgPermissions: async () => ({ orgWide: true, orgId: 'org-1' }),
}))

import type { PluginApiResponse } from '@aglyn/aglyn/server'
import { crmEmailTemplateDuplicateHandler } from './email-template-duplicate'

function makeResponse() {
  const result = { status: 0, body: undefined as any }
  const res: PluginApiResponse = {
    status(code) {
      result.status = code
      return res
    },
    json(body) {
      result.body = body
    },
    send(body) {
      result.body = body
    },
    setHeader() {
      return res
    },
  } as unknown as PluginApiResponse
  return { res, result }
}

const call = async (body: Record<string, unknown>) => {
  const { res, result } = makeResponse()
  await crmEmailTemplateDuplicateHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: { hostId: 'host-1', templateId: 'tpl-1', ...body },
      query: {},
    } as never,
    res,
  )
  return result
}

beforeEach(() => {
  store.clear()
  mockUid = 'uid-1'
  mockLogResourceDuplicated.mockClear()
  store.set('hosts/host-1', { orgId: 'org-1', memberRoles: { 'uid-1': 'author', 'uid-2': 'viewer' } })
  store.set('orgs/org-1/crmEmailTemplates/tpl-1', {
    name: 'Welcome',
    subject: 'Hi {{contact.firstName}}',
    body: 'Thanks for joining.',
    kind: 'template',
    visibility: 'personal',
    ownerUid: 'uid-9',
    createdByUid: 'uid-9',
    hostId: 'host-1',
    visibleTo: ['host:host-1'],
    createdAtMs: 1,
    updatedAtMs: 1,
  })
})

it('copies the letter and scope, files it under the caller, and writes the row', async () => {
  const { status, body } = await call({ name: 'Welcome back' })
  expect(status).toBe(200)
  expect(body).toEqual({ templateId: expect.any(String), name: 'Welcome back' })
  expect(store.get(`orgs/org-1/crmEmailTemplates/${body.templateId}`)).toMatchObject({
    name: 'Welcome back',
    subject: 'Hi {{contact.firstName}}',
    body: 'Thanks for joining.',
    kind: 'template',
    visibility: 'personal',
    ownerUid: 'uid-1',
    createdByUid: 'uid-1',
    hostId: 'host-1',
    visibleTo: ['host:host-1'],
  })
  expect(mockLogResourceDuplicated).toHaveBeenCalledWith(
    'emailTemplate',
    { uid: 'uid-1', email: 'ada@example.test' },
    {
      orgId: 'org-1',
      hostId: 'host-1',
      source: { id: 'tpl-1', name: 'Welcome' },
      target: { id: body.templateId, name: 'Welcome back' },
    },
  )
})

it('defaults the name and numbers a taken one', async () => {
  store.set('orgs/org-1/crmEmailTemplates/tpl-2', { name: 'Copy of Welcome' })
  const { body } = await call({})
  expect(body.name).toBe('Copy of Welcome 2')
})

it('meets the listing ceiling', async () => {
  for (let index = 0; index < 200; index += 1) {
    store.set(`orgs/org-1/crmEmailTemplates/filler-${index}`, { name: `F${index}` })
  }
  const { status, body } = await call({})
  expect(status).toBe(403)
  expect(body.error).toMatch(/200 email templates/)
  expect(mockLogResourceDuplicated).not.toHaveBeenCalled()
})

it('refuses a viewer on the site and an unknown template', async () => {
  mockUid = 'uid-2'
  expect((await call({})).status).toBe(403)
  mockUid = 'uid-1'
  expect((await call({ templateId: 'nope' })).status).toBe(404)
})
