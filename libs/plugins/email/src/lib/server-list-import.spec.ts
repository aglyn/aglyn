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
 * WHAT THE PERMISSION STEP READS — `email/list-import-screening`: the
 * screening the dry run kept on the list's import ledger, behind the gate
 * every list route stands behind.
 */

const ORG_ID = 'org-1'
const HOST_ID = 'site-1'
const LIST_PATH = `orgs/${ORG_ID}/lists/list-1`

let store: Record<string, Record<string, any>> = {}
let membership: { orgId: string; member: Record<string, unknown> } | null = null

const docHandle = (path: string): any => ({
  id: path.slice(path.lastIndexOf('/') + 1),
  get: async () => ({
    exists: store[path] !== undefined,
    get: (field: string) => store[path]?.[field],
  }),
  collection: (name: string) => ({ doc: (id: string) => docHandle(`${path}/${name}/${id}`) }),
})

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  registerPluginApiRoute: jest.fn(),
  ...jest.requireActual('@aglyn/aglyn/app-utils/organizations'),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  getOrgForHost: async () => ({ orgId: ORG_ID, org: {} }),
  resolveOrgMembership: async () => membership,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => ({ uid: 'editor-uid' }) }),
      firestore: () => ({ collection: (name: string) => ({ doc: (id: string) => docHandle(`${name}/${id}`) }) }),
    }),
  },
}))

import { emailListImportScreeningHandler } from './server-list-import'

async function ask(body: Record<string, unknown>) {
  const out: { code: number; body: any } = { code: 0, body: undefined }
  const res: any = {
    status(code: number) {
      out.code = code
      return res
    },
    json(payload: unknown) {
      out.body = payload
      return res
    },
  }
  await emailListImportScreeningHandler(
    { method: 'POST', body, headers: { authorization: 'Bearer token' } } as never,
    res,
  )
  return out
}

beforeEach(() => {
  store = {
    [`hosts/${HOST_ID}`]: { memberRoles: { 'editor-uid': 'editor' } },
    [LIST_PATH]: { name: 'Newsletter' },
    [`${LIST_PATH}/imports/job-1`]: { total: 3, screening: { roleAccounts: 1, purchaseTellColumns: ['Append'] } },
  }
  membership = { orgId: ORG_ID, member: { role: 'editor', allHosts: true } }
})

describe('the permission step’s readout', () => {
  it('answers what the dry run found in the file', async () => {
    const answer = await ask({ hostId: HOST_ID, listId: 'list-1', jobId: 'job-1' })
    expect(answer.code).toBe(200)
    expect(answer.body).toMatchObject({ listName: 'Newsletter', total: 3, screening: { roleAccounts: 1 } })
  })

  it('answers nothing yet before a dry run', async () => {
    const answer = await ask({ hostId: HOST_ID, listId: 'list-1', jobId: 'job-2' })
    expect(answer.body).toMatchObject({ screening: null, total: null })
  })

  it('refuses a single-site collaborator, as every list route does', async () => {
    membership = { orgId: ORG_ID, member: { role: 'editor', allHosts: false } }
    const answer = await ask({ hostId: HOST_ID, listId: 'list-1', jobId: 'job-1' })
    expect(answer.code).toBe(403)
  })

  it('refuses a request that names no import', async () => {
    expect((await ask({ hostId: HOST_ID, listId: 'list-1' })).code).toBe(400)
  })
})
