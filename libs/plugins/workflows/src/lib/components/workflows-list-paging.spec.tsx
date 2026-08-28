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
 * The workflows list is ORDERED, CEILINGED and PAGED — and not paged by the
 * query (AGL-693).
 *
 * It was `limit(100)` with no `orderBy`, every row rendered at once, and no
 * footer anywhere. Naming the order does not change WHICH hundred documents
 * come back — document-id order is what a bare cap already returns — and that
 * is the claim, not a bug fix: what it buys is that the next edit cannot
 * quietly reach for `orderBy('name')`, which would HIDE every workflow written
 * without a name rather than mis-sorting the list.
 *
 * What does change is the control and the bound: one page at a time, and a
 * probe that says when there is more than the card read.
 *
 * ## Why the QUERY is not paged
 *
 * `nameTaken` tests the draft against these rows, and computed variables look
 * their workflow up BY NAME (AGL-185/AGL-261) — so a duplicate silently
 * rebinds a live binding. On a ten-row server page that check would compare a
 * new workflow against a tenth of the site and let one through.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'

jest.setTimeout(30_000)

const CEILING = 100
const TOTAL = 101

/** Ids run opposite to names, so the ceiling's bound is visible on screen. */
const workflowDocs = Array.from({ length: TOTAL }, (_, index) => ({
  $id: `wf-${String(index).padStart(3, '0')}`,
  name: `flow_${String(TOTAL - 1 - index).padStart(3, '0')}`,
  steps: [],
}))

/** Mixed writers, for the trap case: `orderBy` filters as well as sorts. */
const mixedWriters = [
  ...workflowDocs.slice(0, 4),
  { $id: 'wf-900', steps: [] },
  { $id: 'wf-901', steps: [] },
]

const byCollection: Record<string, Array<Record<string, any>>> = {
  workflows: workflowDocs,
  functions: [],
  variables: [],
}

const firestoreAnswer = (
  all: Array<Record<string, any>>,
  constraints: Array<Record<string, any>>,
) => {
  const order = constraints.find((item) => 'orderBy' in item)
  const cap = constraints.find((item) => 'limit' in item)?.limit
  const field = order
    ? order.orderBy === '__name__'
      ? '$id'
      : order.orderBy
    : null
  const matching = field ? all.filter((doc) => doc[field] !== undefined) : all
  const sorted = [...matching].sort((a, b) =>
    String(a[field ?? '$id']) < String(b[field ?? '$id']) ? -1 : 1,
  )
  return typeof cap === 'number' ? sorted.slice(0, cap) : sorted
}

let mockCapsAsked: number[] = []
let served = TOTAL
const FIRESTORE = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useHostResourceApi: () => jest.fn().mockResolvedValue({ id: 'new' }),
  useHostActivityLogger: () => jest.fn(),
  useUser: () => ({ data: { uid: 'uid-test', getIdToken: jest.fn() } }),
  useConsoleHostRoute: () => ({ base: null, orgSlug: null, subdomain: null }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
  useFirestoreCollection: (build: () => any) => {
    const built = build()
    const name = String(built?.path ?? '').split('/').pop() ?? ''
    const cap = (built?.constraints ?? []).find(
      (item: any) => 'limit' in item,
    )?.limit
    if (typeof cap === 'number' && name === 'workflows') mockCapsAsked.push(cap)
    return {
      data: firestoreAnswer(
        (byCollection[name] ?? []).slice(0, served),
        built?.constraints ?? [],
      ),
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
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: unknown, direction?: string) => ({
    orderBy: field,
    direction,
  }),
  documentId: () => '__name__',
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  setDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
  // Under every plan band, so Add opens its dialog rather than refusing.
  getCountFromServer: async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    return { data: () => ({ count: 40 }) }
  },
}))

jest.mock('@aglyn/shared-util-timestamp', () => ({
  Timestamp: { now: () => ({ seconds: 0 }) },
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))

import { HostWorkflowsCard } from './host-workflows-card.component'

const ORG = { $id: 'org-1', plan: 'scale' } as any

beforeEach(() => {
  mockCapsAsked = []
  served = TOTAL
})

const mount = async () => {
  render(<HostWorkflowsCard hostId="host-1" org={ORG} />)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const renderedNames = () =>
  Array.from(document.querySelectorAll('p'))
    .map((node) => (node.textContent ?? '').trim())
    .filter((text) => /^flow_\d{3}$/.test(text))

describe('the workflows list is ceilinged and paged (AGL-693)', () => {
  it('THE CONTROL: naming the order changes nothing, and that is the claim', () => {
    const bare = firestoreAnswer(workflowDocs, [{ limit: CEILING }])
    const named = firestoreAnswer(workflowDocs, [
      { orderBy: '__name__' },
      { limit: CEILING },
    ])
    expect(named.map((row) => row.$id)).toEqual(bare.map((row) => row.$id))
  })

  it('THE TRAP: ordering on `name` would hide rows, not reorder them', () => {
    const onName = firestoreAnswer(mixedWriters, [{ orderBy: 'name' }])
    expect(onName).toHaveLength(4)
    expect(onName.length).toBeLessThan(mixedWriters.length)
    expect(
      firestoreAnswer(mixedWriters, [{ orderBy: '__name__' }]),
    ).toHaveLength(mixedWriters.length)
  })

  it('reads the ceiling PLUS a probe and renders one page', async () => {
    await mount()
    expect(mockCapsAsked).toContain(CEILING + 1)
    expect(renderedNames()).toHaveLength(TABLE_PAGE_SIZE_DEFAULT)
    // `flow_000` is on the document the probe found and the window does not
    // hold, so the alphabetically first workflow is not the first row.
    expect(renderedNames()[0]).toBe('flow_001')
  })

  it('pages to a row the first page never held', async () => {
    await mount()
    fireEvent.click(screen.getByLabelText('Go to next page'))
    await waitFor(() => expect(renderedNames()[0]).toBe('flow_011'))
  })

  it('THE POINT: the duplicate-name check sees a name off the page', async () => {
    await mount()
    expect(renderedNames()).not.toContain('flow_050')
    fireEvent.click(screen.getByRole('button', { name: 'Add workflow' }))
    const [field] = await screen.findAllByLabelText('Name')
    fireEvent.change(field, { target: { value: 'flow_050' } })
    await waitFor(() =>
      expect(
        screen.getByText('A workflow with this name already exists'),
      ).toBeTruthy(),
    )
  })

  it('says so when the ceiling bit, and stays quiet when it did not', async () => {
    await mount()
    expect(screen.getByText(/a name may already be taken/)).toBeTruthy()

    // Exactly the ceiling: the off-by-one a `length >= CEILING` comparison
    // gets wrong, in the one collection size where it matters.
    served = CEILING
    document.body.innerHTML = ''
    await mount()
    expect(screen.queryByText(/a name may already be taken/)).toBeNull()
  })
})
