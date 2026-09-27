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
 * The team roster is filtered and searched by ITS QUERY (AGL-3321):
 * `GET /api/orgs/members` with `filters` or `search` plans them onto one
 * query over `orgs/{orgId}/members` and answers what it matches, paged by
 * document id; without them it answers the whole roster, as it always has.
 * A fake Firestore answers the where clauses it is handed, so a filter that
 * narrowed a page instead of the query would show up as a wrong answer.
 */

export {}

interface FakeMember {
  id: string
  data: Record<string, unknown>
}

let mockRoster: FakeMember[] = []
/** Each list query's where clauses, as `field op value`. */
let mockWheres: string[][] = []

jest.mock('@aglyn/tenant-data-admin', () => {
  const matches = (doc: FakeMember, [field, op, value]: [string, string, unknown]) => {
    const stored = doc.data[field]
    switch (op) {
      case '==':
        return stored === value
      case 'in':
        return (value as unknown[]).includes(stored)
      case 'array-contains':
        return Array.isArray(stored) && stored.includes(value)
      default:
        throw new Error(`unexpected operator ${op}`)
    }
  }
  const build = (state: {
    wheres: Array<[string, string, unknown]>
    after?: string | null
    limit: number
  }): any => ({
    where: (field: string, op: string, value: unknown) =>
      build({ ...state, wheres: [...state.wheres, [field, op, value]] }),
    orderBy: () => build(state),
    startAfter: (doc: { id: string }) => build({ ...state, after: doc.id }),
    limit: (value: number) => build({ ...state, limit: value }),
    get: async () => {
      mockWheres.push(state.wheres.map(([f, op, v]) => `${f} ${op} ${JSON.stringify(v)}`))
      const ordered = mockRoster
        .filter((doc) => state.wheres.every((where) => matches(doc, where)))
        .sort((a, b) => a.id.localeCompare(b.id))
      const start = state.after ? ordered.findIndex((doc) => doc.id === state.after) + 1 : 0
      const docs = ordered.slice(start, start + state.limit)
      return { docs: docs.map((doc) => ({ id: doc.id, data: () => ({ ...doc.data }) })) }
    },
  })
  const members = {
    ...build({ wheres: [], limit: 1000 }),
    doc: (id: string) => ({
      get: async () => ({ id, exists: mockRoster.some((doc) => doc.id === id) }),
    }),
  }
  return {
    __esModule: true,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: async () => ({ uid: 'u-admin', email_verified: true }),
        }),
        firestore: () => ({
          collection: () => ({ doc: () => ({ collection: () => members }) }),
        }),
      }),
      firestore: { FieldPath: { documentId: () => '__name__' } },
    },
    isImpersonationSession: () => false,
    emailUnverifiedResponse: () => Response.json({ error: 'verify' }, { status: 403 }),
    resolveOrgMembership: async () => ({ role: 'admin' }),
    lockdownRefusal: async () => null,
    getOrgDoc: async () => ({}),
    listOrgMembers: async () => mockRoster.map((doc) => ({ $id: doc.id, ...doc.data })),
  }
})

jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => false,
  sendEmail: jest.fn(),
}))
jest.mock('../app/api/_lib/render-system-email', () => ({ renderSystemEmail: jest.fn() }))

import { orgMemberListFields } from '@aglyn/tenant-data-admin/server/org-member-list-fields'
import { GET } from '../app/api/orgs/members/route'

const member = (id: string, fields: Record<string, unknown>): FakeMember => ({
  id,
  data: { ...fields, ...orgMemberListFields(fields) },
})

const get = (params: Record<string, string>) =>
  GET(
    new Request(
      `https://app.aglyn.test/api/orgs/members?${new URLSearchParams({ orgId: 'org-1', ...params })}`,
      { headers: { authorization: 'Bearer token' } },
    ),
  )

beforeEach(() => {
  mockWheres = []
  // A roster longer than one page, with the one the cases look for LAST.
  mockRoster = [
    ...Array.from({ length: 120 }, (_, index) =>
      member(`u-${String(index).padStart(3, '0')}`, {
        role: 'editor',
        allHosts: true,
        email: `person${index}@example.com`,
      }),
    ),
    member('u-zz-ada', {
      role: 'viewer',
      allHosts: false,
      hostAccess: { h1: 'viewer' },
      displayName: 'Ada Lovelace',
      email: 'ada@analytical.test',
      title: 'Engine Designer',
    }),
  ]
})

describe('the team roster filters and searches on its query (AGL-3321)', () => {
  it('finds a member past the first hundred by a word of the name, on the query', async () => {
    const response = await get({ search: 'lovelace' })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.members.map((one: { $id: string }) => one.$id)).toEqual(['u-zz-ada'])
    expect(mockWheres).toEqual([['searchTokens array-contains "lovelace"']])
    // The index is not something a reader is shown.
    expect(body.members[0].searchTokens).toBeUndefined()
  })

  it('serves Access and Role together as equalities', async () => {
    const response = await get({
      filters: JSON.stringify([
        { field: 'access', op: 'equals', value: 'collaborator' },
        { field: 'role', op: 'isAnyOf', value: 'viewer,editor' },
      ]),
    })
    const body = await response.json()
    expect(body.members.map((one: { $id: string }) => one.$id)).toEqual(['u-zz-ada'])
    expect(mockWheres[0]).toEqual([
      'consoleUserType == "collaborator"',
      'role in ["viewer","editor"]',
    ])
    expect(body.refused).toEqual([])
  })

  it('pages the matches by document id, and says when there are more', async () => {
    const first = await (await get({ filters: JSON.stringify([{ field: 'role', op: 'equals', value: 'editor' }]) })).json()
    expect(first.members).toHaveLength(100)
    expect(first.nextCursor).toBe('u-099')
    const second = await (
      await get({
        filters: JSON.stringify([{ field: 'role', op: 'equals', value: 'editor' }]),
        cursor: first.nextCursor,
      })
    ).json()
    expect(second.members).toHaveLength(20)
    expect(second.nextCursor).toBeNull()
  })

  it('refuses by name what it cannot put on the query, and applies none of it', async () => {
    const body = await (
      await get({ filters: JSON.stringify([{ field: 'role', op: 'startsWith', value: 'ed' }]) })
    ).json()
    expect(body.refused).toEqual([
      expect.objectContaining({ clause: { field: 'role', op: 'startsWith', value: 'ed' } }),
    ])
  })

  it('refuses a filters parameter it cannot read, rather than answering the whole roster', async () => {
    const response = await get({ filters: 'not json' })
    expect(response.status).toBe(400)
  })

  it('THE CONTROL: without filters or a search it answers the whole roster', async () => {
    const body = await (await get({})).json()
    expect(body.members).toHaveLength(121)
    expect(mockWheres).toEqual([])
  })
})
