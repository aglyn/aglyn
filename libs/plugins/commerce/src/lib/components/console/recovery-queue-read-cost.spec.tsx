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
 * @jest-environment jsdom
 */

/**
 * Whether the queue depths this card reports can be believed (AGL-3321).
 *
 * Every figure here is a COUNT over a whole collection, and the card's purpose
 * is to be the place a merchant notices a background job has stopped — a queue
 * that is always empty and a queue that is never drained look identical from
 * outside, and these chips are the only thing that tells them apart.
 *
 * The card used to read two hundred checkouts and two hundred alerts and
 * count those, so a queue deeper than that read short. Each figure is now a
 * Firestore count query. What this file has to catch:
 *
 *  - A FIGURE THAT IS NOT THE JOB'S. Each count is answered here the way
 *    Firestore answers its `where`s — by the contract double's `rowAnswers`
 *    — and compared with a literal restatement of the tests
 *    `scanAbandonedCheckouts` and `scanRestockAlerts` apply, over a fixture
 *    far past the old ceiling, covering every state a row can be in.
 *  - A READ OF THE COLLECTION. The one listener is the five-row recent list.
 *  - A WRITER THAT STOPPED STAMPING. A query cannot find a checkout without
 *    `recoveryState`, so both writers are pinned.
 *  - A MISSING INDEX, which throws FAILED_PRECONDITION in production only.
 */

import { cleanup, render, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { missingListQueryIndexes } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import {
  CHECKOUT_GIVE_UP_AFTER_MS,
  CHECKOUT_REMIND_AFTER_MS,
  checkoutRecoveryState,
} from '../../model/checkout-recovery'

type Row = Record<string, unknown> & { $id: string }
interface Asked {
  path: string
  constraints: Array<
    | { kind: 'where'; path: string; op: string; value: unknown }
    | { kind: 'orderBy'; path: string; direction: 'asc' | 'desc' }
    | { kind: 'limit'; value: number }
  >
}

const mockListens: Asked[] = []
const mockCounts: Asked[] = []
let mockCheckouts: Row[] = []
let mockAlerts: Row[] = []

/** Firestore's answer to one query over the fixture for its collection. */
function mockAnswer(asked: Asked): Row[] {
  const { rowAnswers } = jest.requireActual(
    '@aglyn/tenant-feature-instance/testing/list-query-double',
  )
  let rows = asked.path.endsWith('/checkouts')
    ? mockCheckouts
    : asked.path.endsWith('/restockAlerts')
      ? mockAlerts
      : []
  for (const entry of asked.constraints) {
    if (entry.kind === 'where') rows = rows.filter((row) => rowAnswers(row, entry))
  }
  for (const entry of asked.constraints) {
    if (entry.kind !== 'orderBy') continue
    // An order drops every document without the field.
    rows = rows
      .filter((row) => row[entry.path] !== undefined)
      .sort((a, b) =>
        entry.direction === 'desc'
          ? Number(b[entry.path]) - Number(a[entry.path])
          : Number(a[entry.path]) - Number(b[entry.path]),
      )
  }
  const cap = asked.constraints.find((entry) => entry.kind === 'limit')
  return cap && cap.kind === 'limit' ? rows.slice(0, cap.value) : rows
}

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/'), constraints: [] }),
  query: (base: Asked, ...constraints: Asked['constraints']) => ({
    path: base.path,
    constraints: [...base.constraints, ...constraints],
  }),
  where: (path: string, op: string, value: unknown) => ({ kind: 'where', path, op, value }),
  orderBy: (path: string, direction: 'asc' | 'desc' = 'asc') => ({
    kind: 'orderBy',
    path,
    direction,
  }),
  limit: (value: number) => ({ kind: 'limit', value }),
  getCountFromServer: async (asked: Asked) => {
    mockCounts.push(asked)
    return { data: () => ({ count: mockAnswer(asked).length }) }
  },
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: (build: () => Asked) => {
    const asked = build()
    mockListens.push(asked)
    return { data: mockAnswer(asked) }
  },
}))

jest.mock('@aglyn/aglyn', () => ({
  pluginDocsHelp: () => ({ href: '#', title: 'x' }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('./entitlement-gate.component', () => ({
  EntitlementUpsell: () => null,
  useCommerceEntitlement: () => ({
    ready: true,
    entitled: true,
    upgradeHref: '/x',
    planLabel: 'Pro',
  }),
}))

import { RecoveryQueueCard } from './recovery-queue-card.component'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Every combination of the fields the scan reads, far past the old ceiling of
 * two hundred, each stamped as the writers stamp it: `recoveryState` from the
 * email and the reminder, `remindedAtMs` only once reminded.
 */
function checkoutFixture(now: number): Row[] {
  const rows: Row[] = []
  const ages = [10 * MINUTE, 2 * HOUR, 3 * DAY, 8 * DAY]
  let id = 0
  for (let copy = 0; copy < 25; copy += 1) {
    for (const status of ['open', 'completed', 'expired']) {
      for (const email of ['buyer@example.com', undefined]) {
        for (const reminded of [false, true]) {
          for (const age of ages) {
            const stored = {
              ...(email ? { email } : {}),
              ...(reminded ? { remindedAtMs: now - age / 2 } : {}),
            }
            id += 1
            rows.push({
              $id: `checkout-${String(id).padStart(4, '0')}`,
              status,
              ...stored,
              recoveryState: checkoutRecoveryState(stored),
              createdAtMs: now - age - copy,
            })
          }
        }
      }
    }
  }
  return rows
}

/** The tests `scanAbandonedCheckouts` applies, restated literally. */
function scanFigures(rows: readonly Row[], now: number) {
  const open = rows.filter((row) => row.status === 'open' && row.email)
  const age = (row: Row) => now - Number(row.createdAtMs ?? 0)
  return {
    due: open.filter(
      (row) =>
        !row.remindedAtMs &&
        age(row) >= CHECKOUT_REMIND_AFTER_MS &&
        age(row) <= CHECKOUT_GIVE_UP_AFTER_MS,
    ).length,
    waiting: open.filter((row) => !row.remindedAtMs && age(row) < CHECKOUT_REMIND_AFTER_MS)
      .length,
    reminded: open.filter((row) => row.remindedAtMs).length,
  }
}

/** Alerts as `notify-restock.ts` and `process-restock.ts` leave them. */
function alertFixture(now: number): Row[] {
  const rows: Row[] = []
  for (let index = 0; index < 330; index += 1) {
    const kind = index % 3
    rows.push({
      $id: `alert-${index}`,
      productId: 'p1',
      email: `shopper${index}@example.com`,
      createdAtMs: now - index * MINUTE,
      notifiedAtMs: kind === 0 ? null : now - index,
      ...(kind === 2 ? { skipped: true } : {}),
    })
  }
  return rows
}

beforeEach(() => {
  mockListens.length = 0
  mockCounts.length = 0
  mockCheckouts = []
  mockAlerts = []
})

afterEach(cleanup)

describe('every figure is the job’s own set, counted by query', () => {
  it('THE CONTROL: the fixture is past the old ceiling in every figure', () => {
    const now = Date.now()
    const figures = scanFigures(checkoutFixture(now), now)
    expect(checkoutFixture(now).length).toBeGreaterThan(200)
    expect(figures.due).toBeGreaterThan(0)
    expect(figures.waiting).toBeGreaterThan(0)
    expect(figures.reminded).toBeGreaterThan(0)
    // Pairwise different, so a chip reading another chip's query is caught.
    expect(new Set(Object.values(figures)).size).toBe(3)
  })

  it('counts exactly what the reminder job will act on', async () => {
    const now = Date.now()
    mockCheckouts = checkoutFixture(now)
    const expected = scanFigures(mockCheckouts, now)
    const { findByText } = render(<RecoveryQueueCard hostId="host-1" />)
    expect(await findByText(`${expected.due} due a reminder`)).toBeTruthy()
    expect(await findByText(`${expected.waiting} still within the first hour`)).toBeTruthy()
    expect(await findByText(`${expected.reminded} reminded`)).toBeTruthy()
  })

  it('counts waiting and notified alerts the way the notify job leaves them', async () => {
    const now = Date.now()
    mockAlerts = alertFixture(now)
    const waiting = mockAlerts.filter((row) => row.notifiedAtMs == null).length
    const notified = mockAlerts.filter((row) => row.notifiedAtMs != null && !row.skipped).length
    expect(waiting).toBeGreaterThan(100)
    expect(notified).toBeGreaterThan(100)
    expect(waiting + notified).toBeGreaterThan(200)
    const { findByText } = render(<RecoveryQueueCard hostId="host-1" />)
    expect(await findByText(`${waiting} shoppers waiting`)).toBeTruthy()
    expect(await findByText(`${notified} notified`)).toBeTruthy()
  })

  it('never shows a count it has not made', async () => {
    const { getByText, findByText } = render(<RecoveryQueueCard hostId="host-1" />)
    // Before the counts land, a dash — not a 0 that reads as an empty queue.
    expect(getByText('— due a reminder')).toBeTruthy()
    expect(getByText('— shoppers waiting')).toBeTruthy()
    expect(await findByText('0 due a reminder')).toBeTruthy()
  })

  it('names the five newest open checkouts that carry an email', async () => {
    const now = Date.now()
    mockCheckouts = checkoutFixture(now)
    const expected = mockCheckouts
      .filter((row) => row.status === 'open' && row.email)
      .sort((a, b) => Number(b.createdAtMs) - Number(a.createdAtMs))
      .slice(0, 5)
    const { getAllByText } = render(<RecoveryQueueCard hostId="host-1" />)
    expect(getAllByText(/^buyer@example\.com · started/)).toHaveLength(5)
    const listen = mockListens.find((asked) => asked.path.endsWith('/checkouts'))
    expect(mockAnswer(listen as Asked).map((row) => row.$id)).toEqual(
      expected.map((row) => row.$id),
    )
    await waitFor(() => expect(mockCounts).toHaveLength(6))
  })
})

describe('what the card reads', () => {
  it('listens to five checkouts and nothing else; every figure is a count', async () => {
    render(<RecoveryQueueCard hostId="host-1" />)
    await waitFor(() => expect(mockCounts).toHaveLength(6))
    expect(new Set(mockListens.map((asked) => JSON.stringify(asked))).size).toBe(1)
    expect(mockListens[0].path).toBe('hosts/host-1/checkouts')
    expect(mockListens[0].constraints).toContainEqual({ kind: 'limit', value: 5 })
    expect(mockListens[0].constraints).toContainEqual({
      kind: 'orderBy',
      path: 'createdAtMs',
      direction: 'desc',
    })
    expect(mockCounts.every((asked) => !asked.constraints.some((c) => c.kind === 'limit'))).toBe(
      true,
    )
  })
})

describe('every shape the card asks has its index', () => {
  const indexFile = JSON.parse(
    readFileSync(
      join(__dirname, '../../../../../../../cloud/firebase-firestore.indexes.json'),
      'utf8',
    ),
  )

  /** The composite an asked query needs, or null when single-field indexes serve it. */
  const compositeOf = (asked: Asked): string | null => {
    const wheres = asked.constraints.filter((c) => c.kind === 'where') as Array<{
      path: string
      op: string
    }>
    const order = asked.constraints.find((c) => c.kind === 'orderBy') as
      | { path: string; direction: 'asc' | 'desc' }
      | undefined
    const equalities = [
      ...new Set(wheres.filter((w) => w.op === '==' || w.op === 'in').map((w) => w.path)),
    ]
    const range = wheres.find((w) => !['==', 'in'].includes(w.op))
    const sortPath = order?.path ?? range?.path
    if (!sortPath || equalities.length === 0) return null
    const direction = order?.direction === 'desc' ? 'DESCENDING' : 'ASCENDING'
    return [...equalities.map((path) => `${path}:ASCENDING`), `${sortPath}:${direction}`].join(',')
  }

  it('needs ONE composite on checkouts and none on alerts', async () => {
    render(<RecoveryQueueCard hostId="host-1" />)
    await waitFor(() => expect(mockCounts).toHaveLength(6))
    const shapes = new Set(
      [...mockCounts, ...mockListens]
        .map((asked) => `${asked.path.split('/').pop()}:${compositeOf(asked)}`)
        .filter((shape) => !shape.endsWith(':null')),
    )
    expect([...shapes]).toEqual([
      'checkouts:status:ASCENDING,recoveryState:ASCENDING,createdAtMs:DESCENDING',
    ])
    expect(
      missingListQueryIndexes(indexFile, 'checkouts', [
        {
          fields: [
            { fieldPath: 'status', order: 'ASCENDING' },
            { fieldPath: 'recoveryState', order: 'ASCENDING' },
            { fieldPath: 'createdAtMs', order: 'DESCENDING' },
          ],
        },
      ]),
    ).toEqual([])
  })

  it('keeps the collection-scope single-field indexes the overrides would otherwise drop', () => {
    // A field override REPLACES the automatic indexes, so the scans' overrides
    // must still hold the collection-scope index the counts run on.
    const scopes = (collectionGroup: string, fieldPath: string) =>
      (
        indexFile.fieldOverrides.find(
          (entry: { collectionGroup: string; fieldPath: string }) =>
            entry.collectionGroup === collectionGroup && entry.fieldPath === fieldPath,
        )?.indexes ?? []
      ).map((index: { queryScope: string; order?: string }) => `${index.queryScope}:${index.order}`)
    expect(scopes('checkouts', 'status')).toContain('COLLECTION:ASCENDING')
    expect(scopes('restockAlerts', 'notifiedAtMs')).toContain('COLLECTION:ASCENDING')
  })
})

describe('the writers stamp what the counts ask', () => {
  const read = (file: string) => readFileSync(join(__dirname, '../../server', file), 'utf8')

  it('a checkout is created with its recovery state', () => {
    expect(read('cart-checkout.ts')).toContain('recoveryState: checkoutRecoveryState({ email })')
  })

  it('a reminder stamps the state beside `remindedAtMs`', () => {
    expect(read('process-abandoned.ts')).toMatch(
      /\.set\(\{ remindedAtMs: now, recoveryState: reminded \}/,
    )
  })

  it('an alert is created with an explicit null `notifiedAtMs`', () => {
    expect(read('notify-restock.ts')).toMatch(/\.add\(\{[^}]*notifiedAtMs: null/)
  })

  it('an alert is only ever skipped as it is retired, so notified = retired − skipped', () => {
    const source = read('process-restock.ts')
    const skips = source.match(/skipped: true/g) ?? []
    expect(skips.length).toBeGreaterThan(0)
    expect(source.match(/\{ notifiedAtMs: Date\.now\(\), skipped: true \}/g)?.length).toBe(
      skips.length,
    )
  })
})
