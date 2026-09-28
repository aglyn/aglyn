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
 * Run history is PAGED BY ITS QUERY, and every filter is on it (AGL-3321).
 *
 * The card used to read two hundred activity entries, keep the runs among
 * them and page, filter and search THOSE — so a run older than the window was
 * unreachable, and a search for it answered "no runs match" about a history
 * that held it. It is now one query: this automation's entries, runs only,
 * newest first, with the search word as another predicate, a page at a time.
 *
 * The fixture is evaluated as Firestore would evaluate the query the card
 * builds — its `where`s, its order, its limit — so a row can only appear if
 * the QUERY selected it. Most entries are not runs, and the run the search
 * looks for sits far past the first page.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import type { ListQueryOp } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { answerListQuery } from '@aglyn/tenant-feature-instance/testing/list-query-double'
import { HostRunHistoryCard } from './host-run-history-card.component'

jest.setTimeout(60_000)

/** How many runs the fixture holds — several pages of them. */
const RUNS = 48
/** Entries that are NOT runs, interleaved with the runs by time. */
const NON_RUNS = 90

const pad = (index: number) => String(index).padStart(3, '0')
const tokens = (text: string) => {
  const out = new Set<string>()
  for (const word of text.toLowerCase().split(' ')) {
    for (let end = 1; end <= Math.min(word.length, 12); end += 1) out.add(word.slice(0, end))
  }
  return [...out]
}

/** Newest first. Run 040 is the one a webhook failed on — page five. */
const runEntries = Array.from({ length: RUNS }, (_, index) => {
  const summary = index === 40 ? 'Webhook 500' : `Run ${pad(index)}`
  return {
    $id: `run-${pad(index)}`,
    createdAt: { seconds: 900_000 - index * 10 },
    trigger: 'formSubmission',
    target: { id: 'wf-1', type: 'workflow' },
    action: 'Action ran on formSubmission',
    result: index === 40 ? 'failed' : 'succeeded',
    summary,
    summaryTokens: tokens(summary),
    // Who set each run off (AGL-3376); runs before it recorded nobody.
    ...(index === 0
      ? { triggeredBy: { kind: 'member', uid: 'u1', email: 'rep@example.test' } }
      : index === 1
        ? { triggeredBy: { kind: 'visitor', email: 'guest@example.test' } }
        : {}),
  }
})
const otherEntries = Array.from({ length: NON_RUNS }, (_, index) => ({
  $id: `pub-${pad(index)}`,
  createdAt: { seconds: 900_000 - index * 10 - 5 },
  action: 'Published screen',
  target: { id: 'wf-1', type: 'workflow' },
}))
/** Another automation's runs, which the scope must never reach. */
const elsewhere = Array.from({ length: 5 }, (_, index) => ({
  $id: `other-${pad(index)}`,
  createdAt: { seconds: 950_000 - index },
  trigger: 'formSubmission',
  target: { id: 'wf-2', type: 'workflow' },
  result: 'failed',
  summary: 'Webhook 500',
  summaryTokens: tokens('Webhook 500'),
}))
const allEntries = [...runEntries, ...otherEntries, ...elsewhere]

type Constraint =
  | { where: string; op: string; value: any }
  | { orderBy: string; direction?: string }
  | { limit: number }

let mockQueries: Constraint[][] = []

/**
 * Firestore's answer to the constraints, over the fixture — the contract's
 * own answer (`answerListQuery`), so this spec restates no matcher.
 */
function evaluate(constraints: Constraint[]): any[] {
  const order = constraints.find((constraint) => 'orderBy' in constraint) as
    | { orderBy: string; direction?: 'asc' | 'desc' }
    | undefined
  const rows = answerListQuery(allEntries, {
    filters: constraints.flatMap((constraint) =>
      'where' in constraint
        ? [{ path: constraint.where, op: constraint.op as ListQueryOp, value: constraint.value }]
        : [],
    ),
    orderBy: order
      ? { path: order.orderBy, direction: order.direction ?? 'asc' }
      : { path: '__name__', direction: 'asc' },
    served: [],
    searched: null,
    refused: [],
    notices: [],
  })
  const cap = constraints.find((constraint) => 'limit' in constraint) as { limit: number } | undefined
  return cap ? rows.slice(0, cap.limit) : rows
}

const FIRESTORE = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
}))
jest.mock('@aglyn/tenant-feature-instance/hooks/use-firestore-collection', () => ({
  useFirestoreCollection: (build: () => any) => {
    const built = build()
    if (!built) return { data: [], status: 'loading', fromCache: false, serverDenied: false }
    mockQueries.push(built.constraints)
    return {
      data: evaluate(built.constraints),
      status: 'success',
      fromCache: false,
      serverDenied: false,
    }
  },
}))
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/'), constraints: [] }),
  query: (base: any, ...constraints: unknown[]) => ({
    path: base?.path ?? base,
    constraints: [...(base?.constraints ?? []), ...constraints],
  }),
  where: (field: string, op: string, value: unknown) => ({ where: field, op, value }),
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: string, direction?: string) => ({ orderBy: field, direction }),
  documentId: () => '__name__',
  Timestamp: { fromDate: (date: Date) => ({ seconds: date.getTime() / 1000 }) },
}))
jest.mock('@aglyn/aglyn', () => ({ pluginDocsHelp: () => undefined }))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

beforeEach(() => {
  mockQueries = []
})

const renderedSummaries = () =>
  Array.from(document.querySelectorAll('.MuiDataGrid-row')).map(
    (row) => row.querySelector('[data-field="summary"] p')?.textContent?.trim() ?? '',
  )
const lastQuery = () => mockQueries[mockQueries.length - 1]

describe('the run history is one query, paged by it (AGL-3321)', () => {
  it('THE CONTROL: most entries are not runs, and the sought run is past page one', () => {
    expect(NON_RUNS).toBeGreaterThan(RUNS)
    expect(40).toBeGreaterThan(TABLE_PAGE_SIZE_DEFAULT * 2)
  })

  it('asks for this automation’s runs, newest first, one page and a probe row', () => {
    render(<HostRunHistoryCard hostId="host-1" targetId="wf-1" />)
    expect(lastQuery()).toEqual([
      { where: 'target.id', op: '==', value: 'wf-1' },
      { where: 'result', op: 'in', value: ['succeeded', 'failed', 'skipped'] },
      { orderBy: 'createdAt', direction: 'desc' },
      { limit: TABLE_PAGE_SIZE_DEFAULT + 1 },
    ])
  })

  it('shows a page of RUNS — no publish in it, and no other automation’s run', () => {
    render(<HostRunHistoryCard hostId="host-1" targetId="wf-1" />)
    expect(renderedSummaries()).toEqual(
      Array.from({ length: TABLE_PAGE_SIZE_DEFAULT }, (_, index) => `Run ${pad(index)}`),
    )
  })

  it('names who set each run off, and says when that was not recorded (AGL-3376)', () => {
    render(<HostRunHistoryCard hostId="host-1" targetId="wf-1" />)
    expect(screen.getByRole('columnheader', { name: /^Who/ })).toBeTruthy()
    expect(screen.getByText('rep@example.test')).toBeTruthy()
    expect(screen.getByText('Site visitor (guest@example.test)')).toBeTruthy()
    expect(screen.getAllByText('Not recorded').length).toBe(TABLE_PAGE_SIZE_DEFAULT - 2)
  })

  it('reaches older runs by paging the query', async () => {
    render(<HostRunHistoryCard hostId="host-1" targetId="wf-1" />)
    fireEvent.click(screen.getByLabelText('Go to next page'))
    await waitFor(() => expect(renderedSummaries()[0]).toBe('Run 010'))
    expect(lastQuery()).toContainEqual({ limit: TABLE_PAGE_SIZE_DEFAULT * 2 + 1 })
  })

  it('finds a run far past the first page through the search, on the query', async () => {
    render(<HostRunHistoryCard hostId="host-1" targetId="wf-1" />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'webhook' } })
    await waitFor(() => expect(renderedSummaries()).toEqual(['Webhook 500']))
    expect(lastQuery()).toContainEqual({
      where: 'summaryTokens',
      op: 'array-contains',
      value: 'webhook',
    })
    // Still this automation's history: `wf-2`'s webhook failures are not in it.
    expect(lastQuery()).toContainEqual({ where: 'target.id', op: '==', value: 'wf-1' })
  })
})
