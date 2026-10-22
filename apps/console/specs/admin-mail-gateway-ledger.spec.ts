/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
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
 * The staff read of the platform mail gateway ledger (AGL-3328).
 *
 * The collection is server-written and not client-readable, so this route is
 * the only door to it, and it is staff-only. Pinned here: the gate; that the
 * summary is one range on `lastBlockedAtMs` (no composite) from the first
 * instant of the hold's window; and that the table's every clause lands on
 * the Firestore query, ordered by document id, with no composite index
 * needed for any shape it can take.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import {
  listQueryIndexes,
  missingListQueryIndexes,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { MAIL_GATEWAY_LEDGER_LIST_QUERY } from '../utils/mail-gateway-ledger-list-query'

// A module, not a script — see `admin-csp-reports.spec.ts`.
export {}

let mockDecodedToken: Record<string, unknown>
let mockRows: Array<{ id: string; data: Record<string, unknown> }>
let mockQueries: Array<{
  where: Array<{ field: string; op: string; value: unknown }>
  orderBy: Array<{ field: string; direction: string }>
  limit: number
}>

const NOW = Date.parse('2026-09-28T15:00:00Z')
const DAY = 86_400_000
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Records what the query was built from; filters nothing, so a row a clause excludes would show a match after the read. */
const mockQuery = (
  where: Array<{ field: string; op: string; value: unknown }> = [],
  orderBy: Array<{ field: string; direction: string }> = [],
): any => ({
  where: (field: unknown, op: string, value: unknown) =>
    mockQuery([...where, { field: String(field), op, value }], orderBy),
  orderBy: (field: unknown, direction = 'asc') => mockQuery(where, [...orderBy, { field: String(field), direction }]),
  startAfter: () => mockQuery(where, orderBy),
  limit: (limit: number) => ({
    get: async () => {
      mockQueries.push({ where, orderBy, limit })
      return {
        docs: mockRows.map((row) => ({
          id: row.id,
          ref: { path: `mailGatewayLedger/${row.id}` },
          data: () => row.data,
        })),
      }
    },
  }),
})

const mockFirestore = {
  collection: () => mockQuery(),
  doc: () => ({ get: async () => ({ exists: false }) }),
}

jest.mock('@aglyn/tenant-data-admin', () => {
  const actual = jest.requireActual('@aglyn/tenant-data-admin/server/email-deliverability')
  return {
    __esModule: true,
    MAIL_GATEWAY_LEDGER_COLLECTION: actual.MAIL_GATEWAY_LEDGER_COLLECTION,
    mailGatewayLedgerRow: actual.mailGatewayLedgerRow,
    listRecentlyRefusedMailGatewayLedgers: actual.listRecentlyRefusedMailGatewayLedgers,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: async () => mockDecodedToken }),
        firestore: () => mockFirestore,
      }),
    },
    isImpersonationSession: () => false,
    emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const route = require('../app/api/admin/email-health/gateways/route') as {
  GET: (request: Request) => Promise<Response>
}

const get = (query = '', headers: Record<string, string> = { authorization: 'Bearer staff-token' }) =>
  route.GET(new Request(`https://app.aglyn.com/api/admin/email-health/gateways${query}`, { headers }))

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
  mockDecodedToken = { email_verified: true, staff: true }
  mockQueries = []
  mockRows = [
    {
      id: 'aglyn.com~barracuda',
      data: {
        sendingDomain: 'aglyn.com',
        gateway: 'barracuda',
        blocked: 2,
        lastBlockedAtMs: NOW - DAY,
        lastBlockedDetail: '550 5.7.0 rejected by gateway policy',
        days: { [day(NOW - DAY)]: { blocked: 1 }, [day(NOW - 4 * DAY)]: { blocked: 1 } },
        shared: true,
        updatedAtMs: NOW - DAY,
      },
    },
    {
      id: 'acme.example~proofpoint',
      data: {
        sendingDomain: 'acme.example',
        gateway: 'proofpoint',
        blocked: 1,
        delivered: 4,
        lastBlockedAtMs: NOW - 2 * DAY,
        days: { [day(NOW - 2 * DAY)]: { blocked: 1, delivered: 4 } },
        shared: false,
        updatedAtMs: NOW - 2 * DAY,
      },
    },
  ]
})

afterEach(() => jest.useRealTimers())

describe('GET /api/admin/email-health/gateways (AGL-3328)', () => {
  it('refuses without a token and refuses a non-staff token, before any read', async () => {
    expect((await get('', {})).status).toBe(401)
    mockDecodedToken = { email_verified: true, staff: false }
    expect((await get()).status).toBe(403)
    expect(mockQueries).toEqual([])
  })

  it('names the held pairs from one range on the last refusal, from the window’s first instant', async () => {
    const response = await get()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(mockQueries).toEqual([
      {
        where: [{ field: 'lastBlockedAtMs', op: '>=', value: Date.parse('2026-08-30T00:00:00.000Z') }],
        orderBy: [{ field: 'lastBlockedAtMs', direction: 'desc' }],
        limit: 501,
      },
    ])
    expect(body.refused).toHaveLength(2)
    expect(body.held).toEqual([
      expect.objectContaining({
        id: 'aglyn.com~barracuda',
        shared: true,
        holds: true,
        blocked30: 2,
        delivered30: 0,
        lastBlockedDetail: '550 5.7.0 rejected by gateway policy',
      }),
    ])
    // The per-day map is how the standing was computed, not something to ship.
    expect(body.refused[0].days).toBeUndefined()
    expect(body.truncated).toBe(false)
  })

  it('serves the table with every clause on the query, ordered by document id', async () => {
    const filters = JSON.stringify([
      { field: 'gateway', op: 'isAnyOf', value: 'barracuda,proofpoint' },
      { field: 'shared', op: 'is', value: 'true' },
      { field: 'sendingDomain', op: 'startsWith', value: 'aglyn.com' },
    ])
    const response = await get(`?view=rows&filters=${encodeURIComponent(filters)}&pageSize=25`)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.refused).toEqual([])
    const [query] = mockQueries
    expect(query.where.map((entry) => `${entry.field} ${entry.op}`)).toEqual([
      'gateway in',
      'shared ==',
      '__name__ >=',
      '__name__ <=',
    ])
    expect(query.orderBy).toEqual([{ field: '__name__', direction: 'asc' }])
    // Both rows come back as given: the route matched nothing after the read.
    expect(body.rows.map((row: { id: string }) => row.id)).toEqual(['aglyn.com~barracuda', 'acme.example~proofpoint'])
    expect(body.rows[0]).toMatchObject({ holds: true, gateway: 'barracuda' })
  })

  it('refuses unreadable filters rather than answering with the whole ledger', async () => {
    expect((await get('?view=rows&filters=not-json')).status).toBe(400)
  })
})

describe('the ledger table’s query shapes', () => {
  const INDEX_FILE = JSON.parse(
    readFileSync(join(__dirname, '..', '..', '..', 'cloud', 'firebase-firestore.indexes.json'), 'utf8'),
  )

  it('needs no composite index: every equality merges under the document-id order', () => {
    expect(listQueryIndexes(MAIL_GATEWAY_LEDGER_LIST_QUERY)).toEqual([])
    expect(
      missingListQueryIndexes(INDEX_FILE, 'mailGatewayLedger', listQueryIndexes(MAIL_GATEWAY_LEDGER_LIST_QUERY)),
    ).toEqual([])
  })

  it('puts every clause on one query and refuses none', () => {
    const plan = planListQuery(
      MAIL_GATEWAY_LEDGER_LIST_QUERY,
      {
        clauses: [
          { field: 'gateway', op: 'equals', value: 'mimecast' },
          { field: 'shared', op: 'is', value: 'false' },
          { field: 'sendingDomain', op: 'startsWith', value: 'acme' },
        ],
        search: [],
      },
      nameSearchNormalizers,
    )
    expect(plan.refused).toEqual([])
    expect(plan.orderBy).toMatchObject({ path: '__name__', direction: 'asc' })
  })
})
