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
 * "WHO ACCESSED MY DATA", ANSWERED ON THE SUBJECT'S OWN PAGE — AND FILTERED
 * ACROSS THE WHOLE TRAIL (AGL-3321).
 *
 * `/api/admin/users/audit` reads the account's audit trail for its staff page
 * as two tables, changes and reads, each a page at a time. An entry is about
 * an account four ways — it did it, it was the target, it was the subject, or
 * it was about an address the account holds — and each is its own query. The
 * double below ANSWERS the queries (where, order, cursor, limit) from a seed of
 * rows stamped the way every writer stamps them, so these assert what the
 * route returns, not how it spells the call.
 *
 *  1. An entry naming this account as its subject, or an address it holds,
 *     comes back though its target names a message.
 *  2. A burst of reads cannot push a change off the change table: they are
 *     different queries (`kind`), never one window.
 *  3. A filter or a search reaches an entry however deep in the trail it is,
 *     because it is on every half's query — and what the query cannot take is
 *     refused by name, not applied to some rows.
 */

import { Timestamp } from 'firebase-admin/firestore'
import { withAdminAuditIndex } from '@aglyn/aglyn/app-utils/admin-audit-index'

/** One seeded `adminAudit` document, before the writer's stamp. */
interface SeedRow {
  id: string
  actorUid?: string
  action: string
  target?: string
  subjectUid?: string
  subjectAddressKey?: string
  note?: string
  at: string
  repeatCount?: number
  lastAt?: string
}

interface Where {
  field: string
  op: string
  value: unknown
}

let stored: Array<{ id: string; data: Record<string, unknown> }> = []
/** Every `adminAudit` query the route ran, as its predicates. */
let ran: Where[][] = []

const mockDecodedToken: Record<string, unknown> = {}

const millis = (value: unknown): number =>
  (value as { toMillis?: () => number } | null)?.toMillis?.() ?? 0

/** A document snapshot, as a query hands it back and a cursor takes it. */
function snapshot(row: { id: string; data: Record<string, unknown> }) {
  return {
    id: row.id,
    exists: true,
    ref: { path: `adminAudit/${row.id}` },
    get: (field: string) => row.data[field],
    data: () => row.data,
  }
}

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
      return millis(value) >= millis(where.value)
    case '<':
      return millis(value) < millis(where.value)
    default:
      throw new Error(`the double does not answer ${where.op}`)
  }
}

/** Newest first; among equal instants, id descending — Firestore's own tie order. */
const newestFirst = (
  a: { id: string; data: Record<string, unknown> },
  b: { id: string; data: Record<string, unknown> },
) => millis(b.data['at']) - millis(a.data['at']) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)

function auditQuery(
  wheres: Where[] = [],
  after: ReturnType<typeof snapshot> | null = null,
  count = Number.POSITIVE_INFINITY,
): any {
  return {
    where: (field: unknown, op: string, value: unknown) =>
      auditQuery([...wheres, { field: String(field), op, value }], after, count),
    orderBy: (field: unknown, direction: string) => {
      if (String(field) !== 'at' || direction !== 'desc') {
        throw new Error(`the trail is ordered by at desc, not ${String(field)} ${direction}`)
      }
      return auditQuery(wheres, after, count)
    },
    startAfter: (cursor: ReturnType<typeof snapshot>) => auditQuery(wheres, cursor, count),
    limit: (next: number) => auditQuery(wheres, after, next),
    get: async () => {
      ran.push(wheres)
      let rows = stored.filter((row) => wheres.every((where) => holds(where, row.data))).sort(newestFirst)
      if (after) {
        const cursor = { id: after.id, data: after.data() }
        rows = rows.filter((row) => newestFirst(cursor, row) < 0)
      }
      return { docs: rows.slice(0, count).map(snapshot) }
    },
  }
}

const mockFirestore = {
  collection: (name: string) => {
    if (name !== 'adminAudit') throw new Error(`the route read ${name}`)
    return auditQuery()
  },
  doc: (path: string) => ({
    get: async () => {
      const row = stored.find((entry) => `adminAudit/${entry.id}` === path)
      return row ? snapshot(row) : { exists: false }
    },
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
  findUserByUidAcrossPools: async (uid: string) =>
    uid === 'nobody' ? null : { tenantId: null, record: { uid, email: 'casey@customer.example' } },
}))

/*
 * The address resolver. Returns the account's two addresses so the address
 * half has keys to query with; `addressKeys` is the real derivation's shape.
 */
jest.mock('@aglyn/tenant-data-admin/server/account-addresses', () => ({
  __esModule: true,
  resolveAccountAddresses: async () => ({
    uid: 'casey_uid',
    primary: 'casey@customer.example',
    addresses: [
      { address: 'casey@customer.example', sources: ['primary'], key: 'key_primary' },
      { address: 'former@customer.example', sources: ['stored'], key: 'key_former' },
    ],
    incomplete: false,
  }),
  addressKeys: (set: { addresses: { key: string }[] }) => set.addresses.map((entry) => entry.key),
}))

const route = require('../app/api/admin/users/audit/route') as {
  GET: (request: Request) => Promise<Response>
}

function seed(rows: SeedRow[]) {
  stored = rows.map(({ id, at, lastAt, ...rest }) => ({
    id,
    data: withAdminAuditIndex<Record<string, unknown>>({
      ...rest,
      at: Timestamp.fromDate(new Date(at)),
      ...(lastAt ? { lastAt: Timestamp.fromDate(new Date(lastAt)) } : {}),
    }),
  }))
}

async function trail(
  kind: 'change' | 'access',
  params: Record<string, string> = {},
  status = 200,
): Promise<any> {
  const search = new URLSearchParams({ uid: 'casey_uid', kind, ...params })
  const response = await route.GET(
    new Request(`https://app.aglyn.com/api/admin/users/audit?${search}`, {
      headers: { authorization: 'Bearer staff-token' },
    }),
  )
  expect(response.status).toBe(status)
  return response.json()
}

/** Every page of a table, following its cursor to the end. */
async function everyPage(kind: 'change' | 'access', params: Record<string, string> = {}) {
  const rows: any[] = []
  let cursor: string | null = null
  for (let guard = 0; guard < 50; guard += 1) {
    const page: any = await trail(kind, { ...params, ...(cursor ? { cursor } : {}) })
    rows.push(...page.rows)
    if (!page.hasMore) return rows
    cursor = page.nextCursor
  }
  throw new Error('the cursor never reached the end')
}

const halfOf = (wheres: Where[]) =>
  wheres
    .filter((where) => ['actorUid', 'target', 'subjectUid', 'subjectAddressKey'].includes(where.field))
    .map((where) => `${where.field}=${String(where.value)}`)
    .join('')

beforeEach(() => {
  stored = []
  ran = []
  Object.assign(mockDecodedToken, {
    uid: 'staff_1',
    email: 'staff@example.com',
    email_verified: true,
    staff: true,
  })
})

describe('an entry about a person reaches that person’s page', () => {
  const mailRead: SeedRow = {
    id: 'audit_mail',
    actorUid: 'staff_1',
    action: 'email.message-viewed',
    target: 'emailDeliveries/msg_1',
    subjectUid: 'casey_uid',
    at: '2026-08-27T10:00:00.000Z',
    repeatCount: 2,
    lastAt: '2026-08-27T10:00:01.000Z',
  }

  it('asks all four questions, each for one table', async () => {
    await trail('access')
    expect(ran.map(halfOf).sort()).toEqual([
      'actorUid=casey_uid',
      'subjectAddressKey=key_primary,key_former',
      'subjectUid=casey_uid',
      'target=users/casey_uid',
    ])
    for (const wheres of ran) {
      expect(wheres).toContainEqual({ field: 'kind', op: '==', value: 'access' })
    }
  })

  it('reaches an access that names NO subject uid, by its address key', async () => {
    seed([
      {
        id: 'audit_shared',
        action: 'email.message-viewed',
        actorUid: 'staff_1',
        target: 'emailDeliveries/msg_shared',
        subjectAddressKey: 'key_former',
        at: '2026-08-20T10:00:00.000Z',
      },
    ])
    const payload = await trail('access')
    const entry = payload.rows.find((row: any) => row.id === 'audit_shared')
    expect(entry).toBeDefined()
    expect(entry.subjectUid).toBeNull()
  })

  it('CONTROL: an access about an address this account does not hold stays away', async () => {
    seed([
      {
        id: 'audit_stranger',
        action: 'email.message-viewed',
        actorUid: 'staff_1',
        target: 'emailDeliveries/msg_stranger',
        subjectAddressKey: 'key_someone_else',
        at: '2026-08-20T10:00:00.000Z',
      },
    ])
    expect((await trail('access')).rows).toEqual([])
  })

  it('returns a staff read of this account’s mail, with its collapsed repeats', async () => {
    seed([mailRead])
    const [entry] = (await trail('access')).rows
    expect(entry).toMatchObject({
      id: 'audit_mail',
      action: 'email.message-viewed',
      subjectUid: 'casey_uid',
      // The target still names the MESSAGE; the subject is a separate fact.
      target: 'emailDeliveries/msg_1',
      kind: 'access',
      repeatCount: 2,
      lastAt: '2026-08-27T10:00:01.000Z',
    })
    // A read is not a change.
    expect((await trail('change')).rows).toEqual([])
  })

  it('does not return an entry about somebody else', async () => {
    seed([{ ...mailRead, id: 'audit_other', subjectUid: 'other_uid' }])
    expect((await trail('access')).rows).toEqual([])
  })

  it('counts an entry answered by two halves once', async () => {
    seed([
      {
        id: 'audit_both',
        actorUid: 'staff_1',
        action: 'user.impersonate',
        target: 'users/casey_uid',
        subjectUid: 'casey_uid',
        at: '2026-08-27T09:00:00.000Z',
      },
    ])
    expect((await trail('change')).rows.map((row: any) => row.id)).toEqual(['audit_both'])
  })
})

describe('a moderation decision reaches the page it belongs on', () => {
  it('returns the decision on the review author’s page, as a change', async () => {
    seed([
      {
        id: 'report_actioned',
        actorUid: 'staff_1',
        action: 'marketplace-report-status',
        target: 'marketplaceReports/' + 'b'.repeat(40),
        subjectUid: 'casey_uid',
        at: '2026-08-28T09:00:00.000Z',
      },
    ])
    const [entry] = (await trail('change')).rows
    expect(entry.target).toBe('marketplaceReports/' + 'b'.repeat(40))
    expect(entry.subjectUid).toBe('casey_uid')
    expect(entry.kind).toBe('change')
  })

  it('finds nothing for an entry carrying no target and no subject', async () => {
    seed([
      {
        id: 'legacy_report',
        actorUid: 'staff_1',
        action: 'marketplace-report-status',
        at: '2026-08-28T09:00:00.000Z',
      },
    ])
    expect((await trail('change')).rows).toEqual([])
  })

  it('still resolves a well-formed writer that targets the account', async () => {
    seed([
      {
        id: 'erasure',
        actorUid: 'staff_9',
        action: 'user.erased',
        target: 'users/casey_uid',
        at: '2026-08-28T07:00:00.000Z',
      },
    ])
    const rows = (await trail('change')).rows
    expect(rows.map((row: any) => [row.action, row.subjectUid])).toEqual([['user.erased', null]])
  })
})

describe('an access cannot displace a change', () => {
  const at = (hour: number, minute: number) =>
    `2026-08-27T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`
  const reads: SeedRow[] = Array.from({ length: 40 }, (_unused, index) => ({
    id: `read_${String(index).padStart(2, '0')}`,
    actorUid: index % 2 ? 'casey_uid' : 'staff_7',
    action: 'email.message-viewed',
    target: `emailDeliveries/m_${index}`,
    ...(index % 2 ? {} : { subjectUid: 'casey_uid' }),
    at: at(12, index),
  }))
  const impersonation: SeedRow = {
    id: 'impersonation',
    actorUid: 'staff_9',
    action: 'user.impersonate',
    target: 'users/casey_uid',
    subjectUid: 'casey_uid',
    // OLDER than every read: the case one time-ordered window gets wrong.
    at: at(8, 0),
  }

  it('keeps an impersonation on the first page of changes under a flood of reads', async () => {
    seed([...reads, impersonation])
    const changes = await trail('change')
    expect(changes.rows.map((row: any) => row.id)).toEqual(['impersonation'])
    expect(changes.hasMore).toBe(false)
  })

  it('still returns every read, a page at a time, none twice and none skipped', async () => {
    seed([...reads, impersonation])
    const rows = await everyPage('access', { pageSize: '7' })
    expect(rows.map((row: any) => row.id)).toEqual(
      [...reads].reverse().map((row) => row.id),
    )
  })

  it('classifies an unknown action as a change, not an access', async () => {
    seed([
      {
        id: 'novel',
        actorUid: 'staff_1',
        action: 'something.nobody.classified',
        target: 'users/casey_uid',
        at: '2026-08-27T11:00:00.000Z',
      },
    ])
    expect((await trail('change')).rows.map((row: any) => row.kind)).toEqual(['change'])
  })
})

describe('the filters and the search are on the query, over the whole trail', () => {
  const deep: SeedRow[] = [
    ...Array.from({ length: 60 }, (_unused, index) => ({
      id: `touch_${String(index).padStart(2, '0')}`,
      actorUid: 'staff_2',
      action: 'user.updateProfile',
      target: 'users/casey_uid',
      at: `2026-08-${String(10 + Math.floor(index / 24)).padStart(2, '0')}T${String(index % 24).padStart(2, '0')}:00:00.000Z`,
    })),
    {
      id: 'the_one',
      actorUid: 'staff_3',
      action: 'user.disable',
      target: 'users/casey_uid',
      note: 'Chargeback fraud ring',
      at: '2026-07-01T00:00:00.000Z',
    },
  ]

  it('an Action filter finds the one entry past every page a window would hold', async () => {
    seed(deep)
    const page = await trail('change', {
      filters: JSON.stringify([{ field: 'action', op: 'equals', value: 'user.disable' }]),
    })
    expect(page.rows.map((row: any) => row.id)).toEqual(['the_one'])
    expect(page.refused).toEqual([])
    for (const wheres of ran) {
      expect(wheres).toContainEqual({ field: 'action', op: '==', value: 'user.disable' })
    }
  })

  it('the search reads the stamped tokens on every half', async () => {
    seed(deep)
    const page = await trail('change', { search: 'chargeback' })
    expect(page.rows.map((row: any) => row.id)).toEqual(['the_one'])
    for (const wheres of ran) {
      expect(wheres).toContainEqual({ field: 'searchTokens', op: 'array-contains', value: 'chargeback' })
    }
  })

  it('When is a range over the order, and pages to the end', async () => {
    seed(deep)
    const rows = await everyPage('change', {
      pageSize: '9',
      filters: JSON.stringify([{ field: 'at', op: 'before', value: '2026-08-11' }]),
    })
    // Every entry dated before the 11th — a calendar day, read where the
    // reader is (`listFilterDay`) — newest first, each once.
    const expected = deep
      .filter((row) => new Date(row.at) < new Date(2026, 7, 11))
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .map((row) => row.id)
    expect(rows.map((row: any) => row.id)).toEqual(expected)
  })

  it('refuses by name what the tables do not offer, and applies nothing for it', async () => {
    seed(deep)
    const page = await trail('change', {
      filters: JSON.stringify([{ field: 'target', op: 'equals', value: 'users/someone' }]),
    })
    expect(page.refused).toEqual([
      {
        clause: { field: 'target', op: 'equals', value: 'users/someone' },
        reason: 'this list does not filter by that',
      },
    ])
    expect(page.rows).toHaveLength(25)
  })
})

describe('who may ask, and how', () => {
  it('is staff only', async () => {
    mockDecodedToken['staff'] = false
    await trail('change', {}, 403)
  })

  it('names the table it fills', async () => {
    const response = await route.GET(
      new Request('https://app.aglyn.com/api/admin/users/audit?uid=casey_uid&kind=both', {
        headers: { authorization: 'Bearer staff-token' },
      }),
    )
    expect(response.status).toBe(400)
  })

  it('refuses unreadable filters rather than listing everything', async () => {
    await trail('change', { filters: '{not json' }, 400)
  })

  it('says when the account does not exist', async () => {
    const response = await route.GET(
      new Request('https://app.aglyn.com/api/admin/users/audit?uid=nobody&kind=change', {
        headers: { authorization: 'Bearer staff-token' },
      }),
    )
    expect(response.status).toBe(404)
  })
})
