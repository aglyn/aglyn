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
 * Run history is PAGED, and its ceiling says when it bit (AGL-2501).
 *
 * The card read two hundred activity entries, filtered them down to runs, and
 * then threw away all but the newest twenty-five with `.slice(0, max)`. Run
 * twenty-six was read, paid for, and unreachable — on the one surface a person
 * opens to ask "why did it not fire the time before last?".
 *
 * ## Why the page is a slice and not a second query
 *
 * The rows are already in hand, so a query per page would buy nothing and cost
 * a read. More importantly it could not be correct: `activity` holds publishes,
 * media saves and member changes as well as runs, and the run filter is a
 * CLIENT one — `actionRunResult` falls back to reading the prose `action` for
 * entries written before AGL-2171, which carry no `result` field, so
 * `where('result','in',…)` would exclude exactly the historic runs. A ten-row
 * server page would also arrive holding anything from zero to ten runs, with
 * no way to tell a short page from the end of the history.
 *
 * The fixture models both facts: most entries are not runs at all, and the
 * oldest runs carry only the legacy prose.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { HostRunHistoryCard } from './host-run-history-card.component'

jest.setTimeout(30_000)

/** The card's own activity ceiling. */
const WINDOW = 200
/** How many runs the fixture holds — far more than the old `max` of 25. */
const RUNS = 48
/** Entries that are NOT runs, so the client filter has real work to do. */
const NON_RUNS = 90

/**
 * Newest first, because the query orders that way. Every third run is a
 * pre-AGL-2171 entry carrying only `action: 'Action ran on …'` and no
 * `result` — the rows a server-side filter on `result` would silently drop.
 */
const runEntries = Array.from({ length: RUNS }, (_, index) => {
  const legacy = index % 3 === 0
  return {
    $id: `run-${String(index).padStart(3, '0')}`,
    createdAt: { seconds: 900_000 - index },
    trigger: 'formSubmission',
    target: { id: 'wf-1', type: 'workflow' },
    ...(legacy
      ? { action: 'Action ran on formSubmission' }
      : {
          action: 'Workflow ran on formSubmission',
          result: 'succeeded',
          summary: `Run ${String(index).padStart(3, '0')}`,
        }),
  }
})

const otherEntries = Array.from({ length: NON_RUNS }, (_, index) => ({
  $id: `pub-${String(index).padStart(3, '0')}`,
  createdAt: { seconds: 800_000 - index },
  action: 'Published screen',
  target: { id: 'wf-1', type: 'workflow' },
}))

/** More than the ceiling, so the probe has something to find. */
const filler = Array.from({ length: WINDOW }, (_, index) => ({
  $id: `old-${String(index).padStart(3, '0')}`,
  createdAt: { seconds: 100_000 - index },
  action: 'Published screen',
  target: { id: 'wf-1', type: 'workflow' },
}))

const allEntries = [...runEntries, ...otherEntries, ...filler]

/** Every cap the card asked for, so a ceiling that stopped probing is visible. */
let mockCapsAsked: number[] = []
const FIRESTORE = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useFirestoreCollection: (build: () => any) => {
    const built = build()
    const cap = (built?.constraints ?? []).find(
      (item: any) => 'limit' in item,
    )?.limit
    if (typeof cap === 'number') mockCapsAsked.push(cap)
    return {
      data: typeof cap === 'number' ? allEntries.slice(0, cap) : allEntries,
      status: 'success',
      fromCache: false,
    }
  },
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
    constraints: [],
  }),
  query: (base: any, ...constraints: unknown[]) => ({
    path: base?.path ?? base,
    constraints: [...(base?.constraints ?? []), ...constraints],
  }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: string, direction?: string) => ({
    orderBy: field,
    direction,
  }),
}))

jest.mock('@aglyn/aglyn', () => ({ pluginDocsHelp: () => undefined }))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

beforeEach(() => {
  mockCapsAsked = []
})

const renderedSummaries = () =>
  Array.from(document.querySelectorAll('tbody tr')).map(
    (row) => row.querySelectorAll('td')[3]?.textContent?.trim() ?? '',
  )

describe('the run history pages its runs (AGL-2501)', () => {
  it('THE CONTROL: the fixture holds more runs than the old slice showed', () => {
    // Without this every assertion below could pass on a fixture of fewer than
    // twenty-five runs, where a `.slice(0, 25)` and a pager are
    // indistinguishable.
    expect(RUNS).toBeGreaterThan(25)
    // And most of the window is NOT runs, so the client filter is doing the
    // work the comments say it is.
    expect(NON_RUNS).toBeGreaterThan(RUNS)
  })

  it('shows one page of runs, not every run in the window', () => {
    render(<HostRunHistoryCard hostId="host-1" targetId="wf-1" />)
    expect(document.querySelectorAll('tbody tr')).toHaveLength(
      TABLE_PAGE_SIZE_DEFAULT,
    )
  })

  it('reaches a run past the twenty-fifth, which the slice could not', async () => {
    render(<HostRunHistoryCard hostId="host-1" targetId="wf-1" />)
    // Run 26 is on page three. Under the old `.slice(0, 25)` it was read,
    // discarded and unreachable.
    fireEvent.click(screen.getByLabelText('Go to next page'))
    await waitFor(() => expect(renderedSummaries()[0]).toBe('Run 010'))
    fireEvent.click(screen.getByLabelText('Go to next page'))
    await waitFor(() => expect(renderedSummaries()[0]).toBe('Run 020'))
    expect(renderedSummaries()).toContain('Run 026')
  })

  it('keeps the LEGACY runs, which a server-side filter would drop', () => {
    render(<HostRunHistoryCard hostId="host-1" targetId="wf-1" />)
    // `run-000` carries only the prose `Action ran on …` and no `result`.
    // `actionRunSummary` renders it as `Ran`. Its presence is the reason the
    // filter cannot move into the query.
    expect(renderedSummaries()).toContain('Ran')
  })

  it('PROBES past the ceiling and says the history is longer', () => {
    render(<HostRunHistoryCard hostId="host-1" targetId="wf-1" />)
    // One document more than the ceiling. `length === WINDOW` cannot answer
    // this: it is wrong at exactly the count that equals the ceiling.
    expect(mockCapsAsked).toEqual([WINDOW + 1])
    expect(
      screen.getByText(/Older runs than that are recorded/),
    ).toBeTruthy()
  })

  it('the probe row is never rendered as a run', () => {
    render(<HostRunHistoryCard hostId="host-1" targetId="wf-1" />)
    // A card that rendered `WINDOW + 1` rows would be describing a window it
    // did not draw. The filler entries are not runs, so the check that bites
    // is on the count of runs the card believes it has.
    const countLine = document.querySelector('.MuiTablePagination-displayedRows')
    expect(countLine?.textContent).toContain(`of ${RUNS}`)
  })
})
