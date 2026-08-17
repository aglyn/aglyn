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
 * The Data card's two HEAD-COUNTS are server aggregates, not the lengths of
 * its two capped listeners (AGL-1716, the AGL-1706 shape).
 *
 * The record listener is `limit(500)` and the dataset listener `limit(100)`
 * — both correct for a table and a picker. What neither may do is answer
 * "how many does this org have", and both did:
 *
 *  * `records.length` saturated at 500 and was handed to
 *    `checkQuota(org, 'recordsPerDataset', …)`, whose bands are 1,000 /
 *    10,000 / 100,000 / 500,000 / 1,000,000 — so on EVERY paid plan the
 *    check compared 500 against thousands and could never refuse. The
 *    importer then computed `room = limit − records.length`, so the same
 *    understated number did not merely fail to refuse, it INFLATED the
 *    slots the importer offered.
 *  * `datasets.length` saturated at 100 and fed `checkDatasetQuota`, whose
 *    limits run to 250 / 500 / 2,000 above that window.
 *
 * `api/orgs/datasets` — the route that actually enforces both — counts with
 * `collection('datasets').count()` and `collection('records').count()` on
 * these exact paths. So the card offered headroom the API would refuse and
 * then failed the action, the AGL-1716 shape exactly.
 *
 * Contracts:
 *
 *  1. THE RECORD QUOTA READS THE AGGREGATE. Red before the fix: 500 loaded
 *     rows are under every paid band, so "Add record" opened the editor on a
 *     dataset with 600,000 documents on a plan that includes 500,000.
 *  2. THE DATASET QUOTA READS THE AGGREGATE. Red before the fix for the
 *     same reason: 100 rows are under the 250 this plan allows.
 *  3. A DESTRUCTIVE PROMPT QUOTES THE REAL SIZE. Red before: deleting a
 *     600,000-document collection warned about "its 500 documents".
 *  4. THE LISTS KEEP THEIR CAPS. The count and the list are different
 *     questions; fixing the first must not start streaming the second.
 *  5. A MUTATION RE-READS THE COUNT. A one-shot goes stale exactly where
 *     the listener used to refresh for free.
 *  6. AN UNANSWERED AGGREGATE DOES NOT ANSWER THE QUESTION. Pending or
 *     denied, the loaded rows stand in — a lower bound and this card's
 *     prior behaviour — never 0, which `checkQuota` would answer as "no
 *     usage" on a collection that is over its band.
 *
 * No counting RULE moves: `checkQuota` and `checkDatasetQuota` are
 * untouched, and neither number is metered by `report-usage`.
 *
 * NO STRIPE PATH IS EXERCISED and no production data is read.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { ReactNode } from 'react'
import { HostDatasetsCard } from './host-datasets-card.component'

/**
 * These fixtures are large ON PURPOSE — the contract is about what a
 * SATURATED listener does, so the listener has to actually be saturated,
 * and 500 MUI table rows take real time to render in jsdom. Comfortably
 * under the default 5s alone; over it when the suite runs alongside the
 * rest of the project's workers. The fixture size is the contract, so the
 * budget moves rather than the fixture.
 *
 * This budget is NOT the one the old `settled()` used to exhaust, and
 * raising it would never have helped: an RTL `waitFor` carries its own
 * 1,000ms default, so a missed state update reported as a timeout this
 * file's own 30s appeared to contradict (AGL-1762).
 */
jest.setTimeout(30_000)


/**
 * Stock `scale`, no per-org override: `recordsPerDataset: 500000`,
 * `datasetsPerOrg: 250` against `maxDatasetsPerOrg: 500` (so the effective
 * dataset limit is 250), `features.dataStore` on. Real `checkQuota`, real
 * `checkDatasetQuota` — only the counts are staged.
 */
const ORG = { $id: 'org-1', plan: 'scale' } as any

/** What the server says the org actually has. */
const SERVER_DATASETS = 300
const SERVER_RECORDS = 600_000
/** What the two capped listeners can ever hand back. */
const DATASET_ROWS = 100
const RECORD_ROWS = 500

const datasetDocs = Array.from({ length: DATASET_ROWS }, (_, index) => ({
  $id: `ds-${String(index).padStart(3, '0')}`,
  displayName: `Collection ${String(index).padStart(3, '0')}`,
  model: { order: ['title'], fields: { title: { name: 'Title', type: 'text' } } },
  visibleTo: ['org'],
}))
const recordDocs = Array.from({ length: RECORD_ROWS }, (_, index) => ({
  $id: `rec-${index}`,
  values: { title: `Row ${index}` },
}))

/** Mutable so a spec can choose how each aggregate resolves. */
const aggregate: { datasets: number | null; records: number | null } = {
  datasets: SERVER_DATASETS,
  records: SERVER_RECORDS,
}

/**
 * STABLE, like the real hook. `useOrgDataScope` memoises its return
 * explicitly (a fresh tuple is a query dependency and would reopen the
 * listener every render), so a mock handing back a new array each time
 * would not be modelling the hook — it would be inventing a dependency
 * churn no caller ever sees.
 */
const DATA_SCOPE = { scope: ['orgs', 'org-1'], orgId: 'org-1' }
/**
 * Stable for the same reason, and load-bearing: `firestore` is a dependency
 * of this card's reference-picker effect, which calls `setRefOptions({})`
 * with a FRESH object on its early return. A `() => ({})` stub hands back a
 * new instance every render, so that effect re-runs on every render and its
 * setState schedules the next one — an unbounded update loop that belongs
 * entirely to the stub. The real `useFirestore` returns one app instance.
 */
const FIRESTORE = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useOrgDataScope: () => DATA_SCOPE,
  useScopeTokens: () => ({ tokens: ['org'], orgWide: true, loaded: true }),
  useUser: () => ({ data: { uid: 'uid-test' } }),
  useHostActivityLogger: () => jest.fn(),
  // The two listeners are told apart by the last path segment their
  // `collection()` stub returns.
  useFirestoreCollection: (build: () => unknown) => {
    const path = build() as string | null
    return {
      data: path === 'datasets' ? datasetDocs : path === 'records' ? recordDocs : [],
      status: 'success',
      fromCache: false,
    }
  },
}))

const limitSpy = jest.fn((value: number) => value)
/** Paths are joined so the two aggregates are distinguishable. */
const countSpy = jest.fn(async (path: string) => {
  // A server aggregate is a NETWORK round-trip: its answer cannot land in
  // the same drain as the mount that asked for it. Resolving it there was
  // the fixture's own fiction, and it is what let a settle helper that
  // flushed a fixed number of microtasks look correct (AGL-1756/1758/1762).
  //
  // TWO macrotasks, not one, and the difference is measured rather than
  // guessed: `await act(async () => …)` resolves through React's
  // `enqueueTask` (`setImmediate`, else a `MessageChannel`), so the old
  // helper's own settle already yielded to the task queue once for free.
  // Two is the first schedule it cannot beat, and still orders of magnitude
  // cheaper than any real `getCountFromServer`.
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  const key = path.includes('records') ? 'records' : 'datasets'
  if (aggregate[key] == null) {
    throw Object.assign(new Error('denied'), { code: 'permission-denied' })
  }
  return { data: () => ({ count: aggregate[key] }) } as any
})

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  // The LAST segment names the listener's collection; the joined path names
  // the aggregate's, since `datasets/{id}/records` ends in both.
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  query: (path: string) => path.split('/').pop(),
  limit: (value: number) => limitSpy(value),
  where: () => 'where',
  doc: () => ({}),
  getCountFromServer: (path: string) => countSpy(path),
  getDocs: jest.fn().mockResolvedValue({ docs: [] }),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  setDoc: jest.fn().mockResolvedValue(undefined),
  writeBatch: () => ({ set: jest.fn(), update: jest.fn(), commit: jest.fn() }),
}))

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
const confirm = jest.fn().mockRejectedValue(new Error('cancelled'))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm }),
}))

beforeEach(() => {
  jest.clearAllMocks()
  confirm.mockRejectedValue(new Error('cancelled'))
  aggregate.datasets = SERVER_DATASETS
  aggregate.records = SERVER_RECORDS
})

const mount = (org: any = ORG) => render(<HostDatasetsCard orgId="org-1" org={org} />)

/**
 * The aggregate for `which` has ANSWERED — settled either way, and its
 * answer has reached a render.
 *
 * This replaces a helper that waited for `countSpy` to have been called
 * TWICE and then flushed a fixed two microtasks, assuming both answers had
 * arrived (AGL-1762). It was the worst of the five copies of that shape: a
 * single call-count threshold gated TWO independent promise chains on one
 * tick budget, so both had to reach state inside it. When they did not, the
 * click read `RECORD_ROWS` of 500 or `DATASET_ROWS` of 100 — under
 * `scale`'s 500,000 records and 250 datasets, so nothing was refused — and
 * the trailing `waitFor` spent RTL's 1,000ms default, not this file's
 * `jest.setTimeout(30_000)`, before reporting a value mismatch that reads
 * as a timeout.
 *
 * A tick budget cannot be made large enough, only large enough for today's
 * promise chain, so the condition replaces it rather than widening it. Nor
 * is a call count a condition: it says the read STARTED.
 *
 * NEITHER earlier remedy transfers here, and both were checked first.
 * AGL-1758's is a `waitFor` on a rendered caption: this card renders no
 * consequence of either count on mount — `datasetCount` reaches nothing but
 * `checkDatasetQuota`, `recordCount` reaches `checkQuota`, the delete
 * prompt (which is a click away) and a schema dialog that is closed, and
 * `quota.limit` appears only inside the refusal snackbars. AGL-1756's is a
 * wrapping mock over `checkQuota`, waited on for the number it was computed
 * FROM: the products card calls it in a `useMemo` during render, while this
 * one calls both gates inside click handlers, so there is nothing to
 * observe until after the click the counts were supposed to have settled
 * before.
 *
 * So the condition is the card's OWN promise, per aggregate — this is the
 * naming the old threshold could not do. Awaiting it is not a tick count at
 * any remove: reactions run in registration order, the card registered its
 * `.then` in the effect and this registers later, so its setState has
 * already been called when this resumes, and `act`'s exit yields a
 * macrotask and flushes the work loop that renders it.
 *
 * It subsumes AGL-1756's separate `readRejected()`: a denied read is
 * settled too, and awaiting it is the only way to tell "the read failed and
 * the rows stood in" from "the read has not answered yet", since each
 * fallback is also the value the FIRST render used.
 */
const countAnswered = async (which: 'datasets' | 'records') => {
  // The JOINED path names what the aggregate counted — the record read ends
  // in `…/datasets/{id}/records`, the dataset read in `…/datasets` — which
  // is the same rule `countSpy` itself answers by.
  const isMine = (path: unknown) =>
    String(path).endsWith('/records') === (which === 'records')
  await waitFor(() =>
    expect(countSpy.mock.calls.some(([path]) => isMine(path))).toBe(true),
  )
  await act(async () => {
    await Promise.all(
      countSpy.mock.results
        .filter((_result, index) => isMine(countSpy.mock.calls[index][0]))
        .map((result) => result.value.catch(() => undefined)),
    )
  })
}

/**
 * Both, awaited one at a time on its own promise. Every case needs the
 * whole mount settled — an aggregate left in flight lands its setState
 * outside `act` — but each case turns on ONE of them, named where it does.
 */
const bothCountsAnswered = async () => {
  await countAnswered('datasets')
  await countAnswered('records')
}

describe('the Data card head-counts are server aggregates (AGL-1716)', () => {
  it('refuses a record over the band the loaded window hid', async () => {
    mount()
    // Turns on the RECORD aggregate.
    await bothCountsAnswered()

    // 600,000 documents against `scale`'s included 500,000. Before the fix
    // the input was 500 — under every paid band — so this opened the
    // editor and the create then failed at `api/orgs/datasets`, which
    // counts the collection for real.
    fireEvent.click(screen.getByText('Add record'))

    // Asserted directly, not inside a `waitFor`: `handleOpenRecord` enqueues
    // before it awaits anything, so there is nothing here to wait FOR. A
    // budget around a synchronous assertion only decides how long a real
    // failure takes to report.
    expect(
      enqueueSnackbar.mock.calls.some((call) =>
        String(call[0]).includes('Record limit reached (500000)'),
      ),
    ).toBe(true)
    expect(screen.queryByText('New record')).toBeNull()
  })

  it('refuses a dataset over the limit the picker window hid', async () => {
    mount()
    // Turns on the DATASET aggregate.
    await bothCountsAnswered()

    // 300 datasets against `scale`'s effective 250. Before the fix the
    // input was the picker's 100 rows, comfortably under.
    fireEvent.click(screen.getByText('Add dataset'))

    // Direct, for the same reason as the record case above:
    // `handleAddDataset` enqueues before it awaits anything.
    expect(
      enqueueSnackbar.mock.calls.some((call) =>
        String(call[0]).includes('Dataset limit reached (250)'),
      ),
    ).toBe(true)
    expect(screen.queryByText('New dataset')).toBeNull()
  })

  it('quotes the real size in the delete prompt, not the loaded page', async () => {
    mount()
    // Turns on the RECORD aggregate — the prompt quotes `recordCount`.
    await bothCountsAnswered()

    // The toolbar's collection-level Delete; the per-row buttons carry the
    // same label and follow it in the DOM.
    fireEvent.click(screen.getAllByText('Delete')[0])

    await waitFor(() => expect(confirm).toHaveBeenCalled())
    const description = String(confirm.mock.calls[0][0].description)
    // Before the fix this read "and its 500 documents" for a collection of
    // 600,000 — a destructive prompt understating what it destroys.
    expect(description).toContain('and its 600000 documents')
    expect(description).not.toContain('its 500 documents')
  })

  it('keeps both lists capped — the caps were never the defect', async () => {
    mount()
    // Turns on neither count — the caps are the listeners' business.
    await bothCountsAnswered()

    // Fixing the head-counts must not turn a picker into 300 rows or a
    // table into 600,000. That the two questions now have two answers is
    // the entire point.
    expect(limitSpy).toHaveBeenCalledWith(100)
    expect(limitSpy).toHaveBeenCalledWith(500)
  })

  it('re-reads the record count after a delete', async () => {
    mount()
    // Both, so `mockClear` cannot drop a read that had not answered yet and
    // leave its resolution to land after the assertion below.
    await bothCountsAnswered()
    countSpy.mockClear()

    // Row-level delete is client-direct, so nothing else would tell the
    // one-shot aggregate that the collection shrank; it would sit stale for
    // the rest of the session, which is the bug wearing its own fix.
    fireEvent.click(screen.getAllByText('Delete')[1])

    await waitFor(() => expect(countSpy).toHaveBeenCalled())
    expect(
      countSpy.mock.calls.some((call) => String(call[0]).includes('records')),
    ).toBe(true)
  })

  it('falls back to the loaded rows, never to zero, when a read fails', async () => {
    aggregate.records = null
    mount()
    // Awaiting the record read is what makes the first half non-vacuous:
    // its fallback of 500 is also the value the FIRST render used, so any
    // condition that did not await the read itself would be satisfied
    // BEFORE it had failed — passing while proving nothing. The second half
    // turns on the DATASET aggregate having answered anyway.
    await bothCountsAnswered()

    fireEvent.click(screen.getAllByText('Delete')[0])
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    // The 500 known rows still stand in — a lower bound, and this card's
    // prior behaviour. A defaulted 0 would have deleted the document
    // warning from a destructive prompt entirely, and would answer
    // `checkQuota` as "no usage" on a collection that is over its band.
    expect(String(confirm.mock.calls[0][0].description)).toContain(
      'and its 500 documents',
    )
    // The dataset aggregate answered, so its count is unaffected by the
    // record read failing — one denial does not poison the other.
    fireEvent.click(screen.getByText('Add dataset'))
    expect(
      enqueueSnackbar.mock.calls.some((call) =>
        String(call[0]).includes('Dataset limit reached (250)'),
      ),
    ).toBe(true)
  })
})
