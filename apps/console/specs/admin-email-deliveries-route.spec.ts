/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
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
 * The mail a site or an organization's sites sent (AGL-3380), read across
 * recipients from the delivery log by `hostId`, newest first — on an index
 * the project deploys, or every staff read of it fails.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let wheres: Array<[string, string, unknown]> = []
let orders: Array<[string, string]> = []
let claims: Record<string, unknown> = {}
let org: Record<string, unknown> | undefined

const message = (path: string, data: Record<string, unknown>) => ({
  id: path.split('/').pop(),
  ref: { path },
  data: () => data,
  get: (key: string) => data[key],
})

function group(): any {
  return {
    where: (field: string, op: string, value: unknown) => {
      wheres.push([field, op, value])
      return group()
    },
    orderBy: (field: string, direction: string) => {
      orders.push([field, direction])
      return group()
    },
    startAfter: () => group(),
    limit: () => group(),
    get: async () => ({
      docs: [
        message('emailDeliveries/k1/messages/m1', { to: 'a@example.com', hostId: 'h1', firstSeenAtMs: 2 }),
        // A `messages` collection that is not the delivery log.
        message('hosts/h1/conversations/c1/messages/x', { hostId: 'h1', firstSeenAtMs: 1 }),
      ],
    }),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => (global as any).__claims() }),
      firestore: () => ({
        collectionGroup: () => (global as any).__group(),
        collection: () => ({
          doc: () => ({
            get: async () => {
              const data = (global as any).__org()
              return { exists: data !== undefined, get: (key: string) => data?.[key] }
            },
          }),
        }),
        doc: () => ({ get: async () => ({ exists: false }) }),
      }),
    }),
  },
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...(jest.requireActual('@aglyn/aglyn/server') as object),
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      query: Object.fromEntries(url.searchParams.entries()),
      body: undefined,
      headers: { authorization: request.headers.get('authorization') ?? undefined },
    }
  },
}))
;(global as any).__group = () => group()
;(global as any).__claims = () => claims
;(global as any).__org = () => org

import { GET } from '../app/api/admin/email-deliveries/route'

const get = (params: Record<string, string>) => {
  const url = new URL('https://console.test/api/admin/email-deliveries')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return GET(new Request(url.toString(), { headers: { authorization: 'Bearer t' } }))
}

beforeEach(() => {
  wheres = []
  orders = []
  claims = { uid: 'staff-1', email_verified: true, staff: true }
  org = { hosts: { h1: true, h2: true, gone: false } }
})

describe('the staff delivery log by site', () => {
  it('is staff only', async () => {
    claims = { uid: 'u1', email_verified: true }
    expect((await get({ hostId: 'h1' })).status).toBe(403)
  })

  it('needs a site or an organization', async () => {
    expect((await get({})).status).toBe(400)
  })

  it("reads one site's mail newest first, and only the delivery log's rows", async () => {
    const response = await get({ hostId: 'h1' })
    expect(response.status).toBe(200)
    expect(wheres).toEqual([['hostId', '==', 'h1']])
    expect(orders).toEqual([['firstSeenAtMs', 'desc']])
    const { rows } = await response.json()
    expect(rows.map((row: any) => row.$id)).toEqual(['emailDeliveries/k1/messages/m1'])
  })

  it("reads every live site of an organization's", async () => {
    expect((await get({ orgId: 'o1' })).status).toBe(200)
    expect(wheres).toEqual([['hostId', 'in', ['h1', 'h2']]])
  })

  it('the query has its index', () => {
    const file = JSON.parse(
      readFileSync(join(__dirname, '..', '..', '..', 'cloud', 'firebase-firestore.indexes.json'), 'utf8'),
    )
    expect(file.indexes).toContainEqual({
      collectionGroup: 'messages',
      queryScope: 'COLLECTION_GROUP',
      fields: [
        { fieldPath: 'hostId', order: 'ASCENDING' },
        { fieldPath: 'firstSeenAtMs', order: 'DESCENDING' },
      ],
    })
  })
})
