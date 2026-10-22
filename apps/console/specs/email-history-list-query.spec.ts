/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom, where `Request` is not a
 * constructor.
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
 * WHAT WE SENT ONE PERSON, FILTERED AND SEARCHED ON THE QUERY (AGL-3321).
 *
 * `/api/admin/users/email-history` reads `emailDeliveries/{key}/messages`
 * for every address the account holds, with every clause and the search word
 * on each address's query, merged newest first. The double ANSWERS the
 * queries (where, order, cursor, limit), so these assert what comes back:
 * a filter reaches a message however deep it is, a page never repeats or
 * skips one across addresses, and what the query cannot take is refused.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  listQueryIndexes,
  missingListQueryIndexes,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { emailDeliverySearchTokens } from '@aglyn/tenant-data-admin/server/email-delivery-log'
import { emailSuppressionKey } from '@aglyn/tenant-data-admin/server/email-suppression'
import { EMAIL_HISTORY_QUERY } from '../utils/email-history-list-query'

interface Where {
  field: string
  op: string
  value: unknown
}

/** `emailDeliveries/{key}/messages/{id}` → the stored message. */
let stored = new Map<string, Record<string, unknown>>()
let ran: Where[][] = []
const mockDecodedToken: Record<string, unknown> = {}

const holds = (where: Where, data: Record<string, unknown>): boolean => {
  const value = data[where.field]
  switch (where.op) {
    case '==':
      return value === where.value
    case 'in':
      return (where.value as unknown[]).includes(value)
    case 'array-contains':
      return Array.isArray(value) && value.includes(where.value)
    case '>=':
      return Number(value) >= Number(where.value)
    case '<':
      return Number(value) < Number(where.value)
    default:
      throw new Error(`the double does not answer ${where.op}`)
  }
}

function snapshot(path: string) {
  const data = stored.get(path)
  const id = path.split('/').pop() as string
  return {
    id,
    exists: Boolean(data),
    ref: { path },
    get: (field: string) => data?.[field],
    data: () => data,
  }
}

/** An order as the double answers it: the field in its direction, then the id the same way. */
interface Order {
  field: string
  direction: 'asc' | 'desc'
}

const NEWEST_FIRST: Order = { field: 'firstSeenAtMs', direction: 'desc' }

/** Firestore's own order across the values the double stores: null, numbers, then text. */
const rank = (value: unknown) => (value === null || value === undefined ? 0 : typeof value === 'number' ? 1 : 2)

const inOrder = (order: Order) => (a: string, b: string) => {
  const sign = order.direction === 'desc' ? -1 : 1
  const left = stored.get(a)?.[order.field]
  const right = stored.get(b)?.[order.field]
  const byValue =
    rank(left) - rank(right) ||
    (typeof left === 'number' && typeof right === 'number'
      ? left - right
      : String(left ?? '') < String(right ?? '')
        ? -1
        : String(left ?? '') > String(right ?? '')
          ? 1
          : 0)
  const ida = a.split('/').pop() as string
  const idb = b.split('/').pop() as string
  return sign * byValue || sign * (ida < idb ? -1 : ida > idb ? 1 : 0)
}

const newestFirst = inOrder(NEWEST_FIRST)

/** The header orders the double answers (AGL-3680): one field each, either way. */
const ORDERABLE = new Set(['firstSeenAtMs', 'subject', 'context', 'status', 'openCount', 'clickCount'])

function messagesQuery(
  parent: string,
  wheres: Where[] = [],
  after: string | null = null,
  count = Number.POSITIVE_INFINITY,
  order: Order = NEWEST_FIRST,
): any {
  return {
    doc: (id: string) => ({ get: async () => snapshot(`${parent}/${id}`) }),
    where: (field: unknown, op: string, value: unknown) =>
      messagesQuery(parent, [...wheres, { field: String(field), op, value }], after, count, order),
    orderBy: (field: unknown, direction: string) => {
      if (!ORDERABLE.has(String(field)) || (direction !== 'desc' && direction !== 'asc')) {
        throw new Error(`ordered by ${String(field)} ${direction}`)
      }
      return messagesQuery(parent, wheres, after, count, { field: String(field), direction })
    },
    startAfter: (cursor: { ref: { path: string } }) =>
      messagesQuery(parent, wheres, cursor.ref.path, count, order),
    limit: (next: number) => messagesQuery(parent, wheres, after, next, order),
    get: async () => {
      ran.push(wheres)
      const compare = inOrder(order)
      let paths = [...stored.keys()]
        .filter((path) => path.startsWith(`${parent}/`))
        .filter((path) => wheres.every((where) => holds(where, stored.get(path) ?? {})))
        .sort(compare)
      if (after) paths = paths.filter((path) => compare(after, path) < 0)
      return { docs: paths.slice(0, count).map(snapshot) }
    },
  }
}

const mockFirestore = {
  collection: (name: string) => ({
    doc: (key: string) => ({
      collection: (child: string) => messagesQuery(`${name}/${key}/${child}`),
    }),
  }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => mockDecodedToken }),
      firestore: () => mockFirestore,
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  findUserByUidAcrossPools: async (uid: string) => ({
    tenantId: null,
    record: { uid, email: 'casey@customer.example' },
  }),
}))

jest.mock('@aglyn/tenant-data-admin/server/account-addresses', () => ({
  __esModule: true,
  resolveAccountAddresses: async () => ({
    uid: 'casey_uid',
    primary: 'casey@customer.example',
    addresses: [
      { address: 'casey@customer.example', sources: ['primary'], key: 'k1' },
      { address: 'former@customer.example', sources: ['stored'], key: 'k2' },
    ],
    incomplete: false,
  }),
}))

const route = require('../app/api/admin/users/email-history/route') as {
  GET: (request: Request) => Promise<Response>
}

const PRIMARY = emailSuppressionKey('casey@customer.example') as string
const FORMER = emailSuppressionKey('former@customer.example') as string

function seed(
  key: string,
  id: string,
  message: { to: string; subject?: string; context?: string; status?: string; at: number; openCount?: number },
) {
  stored.set(`emailDeliveries/${key}/messages/${id}`, {
    messageId: id,
    provider: 'resend',
    to: message.to,
    subject: message.subject ?? null,
    context: message.context ?? null,
    status: message.status ?? 'delivered',
    firstSeenAtMs: message.at,
    openCount: message.openCount ?? 0,
    clickCount: 0,
    searchTokens: emailDeliverySearchTokens(message),
  })
}

async function history(params: Record<string, string> = {}, status = 200): Promise<any> {
  const search = new URLSearchParams({ uid: 'casey_uid', ...params })
  const response = await route.GET(
    new Request(`https://app.aglyn.com/api/admin/users/email-history?${search}`, {
      headers: { authorization: 'Bearer staff-token' },
    }),
  )
  expect(response.status).toBe(status)
  return response.json()
}

async function everyPage(params: Record<string, string> = {}) {
  const rows: any[] = []
  let cursor: string | null = null
  for (let guard = 0; guard < 50; guard += 1) {
    const page: any = await history({ ...params, ...(cursor ? { cursor } : {}) })
    rows.push(...page.rows)
    if (!page.hasMore) return rows
    cursor = page.nextCursor
  }
  throw new Error('the cursor never reached the end')
}

const T0 = Date.UTC(2026, 8, 1)

beforeEach(() => {
  stored = new Map()
  ran = []
  Object.assign(mockDecodedToken, {
    uid: 'staff_1',
    email: 'staff@example.com',
    email_verified: true,
    staff: true,
  })
  // Forty to the current address and twenty to the former one, interleaved
  // in time, and one receipt from long ago.
  for (let at = 0; at < 40; at += 1) {
    seed(PRIMARY, `p${String(at).padStart(2, '0')}`, {
      to: 'casey@customer.example',
      subject: `Weekly digest ${at}`,
      context: 'campaign',
      at: T0 + at * 3_600_000,
    })
  }
  for (let at = 0; at < 20; at += 1) {
    seed(FORMER, `f${String(at).padStart(2, '0')}`, {
      to: 'former@customer.example',
      subject: `Sign-in code ${at}`,
      context: 'sign-in',
      at: T0 + at * 7_200_000 + 1_800_000,
    })
  }
  seed(FORMER, 'receipt', {
    to: 'former@customer.example',
    subject: 'Your receipt for invoice 1042',
    context: 'billing',
    status: 'bounced',
    at: T0 - 90 * 86_400_000,
  })
})

describe('the composites the table’s queries need', () => {
  it('one (field, firstSeenAtMs DESC) per equality and the tokens, all in the index file', () => {
    const file = JSON.parse(
      readFileSync(join(__dirname, '..', '..', '..', 'cloud', 'firebase-firestore.indexes.json'), 'utf8'),
    )
    const needed = listQueryIndexes(EMAIL_HISTORY_QUERY)
    expect(missingListQueryIndexes(file, 'messages', needed)).toEqual([])
    expect(
      needed
        .map((index) => index.fields.map((field) => `${field.fieldPath}:${field.order ?? field.arrayConfig}`).join(','))
        .sort(),
    ).toEqual([
      'clickCount:ASCENDING,firstSeenAtMs:DESCENDING',
      'context:ASCENDING,firstSeenAtMs:DESCENDING',
      'openCount:ASCENDING,firstSeenAtMs:DESCENDING',
      'searchTokens:CONTAINS,firstSeenAtMs:DESCENDING',
      'status:ASCENDING,firstSeenAtMs:DESCENDING',
    ])
  })
})

describe('every address, newest first, a page at a time', () => {
  it('pages through both addresses with no message twice and none skipped', async () => {
    const rows = await everyPage({ pageSize: '7' })
    const expected = [...stored.keys()].sort(newestFirst).map((path) => path.split('/').pop())
    expect(rows.map((row: any) => row.messageId)).toEqual(expected)
    expect(new Set(rows.map((row: any) => row.$id)).size).toBe(rows.length)
  })
})

describe('a header sort is every address’s order, merged in it (AGL-3680)', () => {
  it.each([
    ['subject', 'asc'],
    ['subject', 'desc'],
    ['context', 'asc'],
    ['firstSeenAtMs', 'asc'],
  ] as const)('%s %s pages through both addresses in that order, none twice or skipped', async (field, direction) => {
    const rows = await everyPage({ pageSize: '7', sort: `${field}:${direction}` })
    const expected = [...stored.keys()]
      .sort(inOrder({ field, direction }))
      .map((path) => path.split('/').pop())
    expect(rows.map((row: any) => row.messageId)).toEqual(expected)
  })

  it('falls back to newest first, and says so, when a filter is on', async () => {
    const page = await history({
      sort: 'subject:asc',
      filters: JSON.stringify([{ field: 'status', op: 'equals', value: 'delivered' }]),
    })
    expect(page.notices).toEqual([expect.stringContaining('Message sorts only with no filter or search on')])
  })
})

describe('the filters and the search are on every address’s query', () => {
  it('a Status filter finds the one message past every page a window would hold', async () => {
    const page = await history({
      filters: JSON.stringify([{ field: 'status', op: 'equals', value: 'bounced' }]),
    })
    expect(page.rows.map((row: any) => row.messageId)).toEqual(['receipt'])
    expect(ran).toHaveLength(2)
    for (const wheres of ran) expect(wheres).toContainEqual({ field: 'status', op: '==', value: 'bounced' })
  })

  it('the search reads the stamped tokens: a subject word, a sender, a domain', async () => {
    expect((await history({ search: 'invoice' })).rows.map((row: any) => row.messageId)).toEqual(['receipt'])
    expect((await history({ search: 'billing' })).rows.map((row: any) => row.messageId)).toEqual(['receipt'])
    const former = await everyPage({ search: 'former' })
    expect(former).toHaveLength(21)
  })

  it('Sent is one range over the order', async () => {
    const rows = await everyPage({
      pageSize: '9',
      filters: JSON.stringify([{ field: 'sentAtMs', op: 'before', value: '2026-08-15' }]),
    })
    expect(rows.map((row: any) => row.messageId)).toEqual(['receipt'])
  })

  it('refuses a Message filter beside the search by name, and applies neither half-way', async () => {
    const page = await history({
      search: 'digest',
      filters: JSON.stringify([{ field: 'subject', op: 'contains', value: 'code' }]),
    })
    expect(page.refused).toEqual([
      {
        clause: { field: 'subject', op: 'contains', value: 'code' },
        reason: 'cannot be combined with the search — clear the search to use it',
      },
    ])
    expect(page.rows.every((row: any) => row.subject.startsWith('Weekly digest'))).toBe(true)
  })

  it('is staff only', async () => {
    mockDecodedToken['staff'] = false
    await history({}, 403)
  })
})
