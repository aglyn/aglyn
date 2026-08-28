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
 * The campaign history is CEILINGED, PAGED, and orderable on no date at all
 * (AGL-693, AGL-272).
 *
 * This is the clearest case in the sweep of a list that CANNOT be paged by the
 * server today, and the reason is in the writer: `campaign-send.ts` records a
 * sent campaign as `{status:'sent', sentAt}` and a scheduled one as
 * `{status:'scheduled', sendAtMs}`, and there is no `createdAt` anywhere. So
 * `orderBy('sentAt')` drops every scheduled campaign and `orderBy('sendAtMs')`
 * drops every sent one — the field-presence trap, in both directions at once.
 *
 * The card therefore holds a whole window and sorts it, which is honest
 * because the rows are the whole window; a page of an id-ordered walk
 * re-sorted by date would run in one order within a page and another across
 * pages. What the conversion adds is the footer and the probe: the history is
 * bounded, and now it says so.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'

jest.setTimeout(30_000)

const CEILING = 30
const TOTAL = 31

/**
 * Half sent, half scheduled — which is the shape that makes both candidate
 * orderings lossy. `subject` carries the index so a row can be identified on
 * screen, and the send dates run OPPOSITE to the ids so the chronological sort
 * is visible in the rendered order.
 */
const campaignDocs = Array.from({ length: TOTAL }, (_, index) => {
  const seconds = (TOTAL - index) * 86_400
  return {
    $id: `camp-${String(index).padStart(2, '0')}`,
    subject: `Campaign ${String(index).padStart(2, '0')}`,
    audience: 'leads',
    ...(index % 2 === 0
      ? { status: 'sent', sentAt: { seconds } }
      : { status: 'scheduled', sendAtMs: seconds * 1000 }),
  }
})

const SENT = campaignDocs.filter((row) => 'sentAt' in row).length
const SCHEDULED = campaignDocs.filter((row) => 'sendAtMs' in row).length

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
  // `orderBy` FILTERS as well as sorts.
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
  useUser: () => ({ data: { uid: 'uid-test', getIdToken: jest.fn() } }),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'], orgId: 'org-1' }),
  useOrgPlan: () => ({ org: { $id: 'org-1', plan: 'scale' }, ready: true }),
  useHostActivityLogger: () => jest.fn(),
  useConsoleHostRoute: () => ({ base: null, orgSlug: null, subdomain: null }),
  useHostResourceApi: () => jest.fn().mockResolvedValue({ id: 'new' }),
  useHostVersionApi: () => jest.fn().mockResolvedValue({ id: 'v1' }),
  useHost: () => ({ data: undefined }),
  useFirestoreDoc: () => ({ data: undefined, status: 'success' }),
  useFirestoreCollection: (build: () => any) => {
    const built = build()
    const name = String(built?.path ?? '').split('/').pop() ?? ''
    const cap = (built?.constraints ?? []).find(
      (item: any) => 'limit' in item,
    )?.limit
    if (typeof cap === 'number' && name === 'campaigns') mockCapsAsked.push(cap)
    return {
      data:
        name === 'campaigns'
          ? firestoreAnswer(
              campaignDocs.slice(0, served),
              built?.constraints ?? [],
            )
          : [],
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
}))

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  pluginDocsHelp: () => undefined,
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useParams: () => ({}),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
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

import HostCampaignsCard from './campaigns-card'

beforeEach(() => {
  mockCapsAsked = []
  served = TOTAL
})

const mount = async () => {
  render(<HostCampaignsCard hostId="host-1" />)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const renderedSubjects = () =>
  Array.from(document.querySelectorAll('p'))
    .map((node) => (node.textContent ?? '').trim())
    .filter((text) => /^Campaign \d{2}$/.test(text))

describe('the campaign history is bounded and paged (AGL-693)', () => {
  it('THE CONTROL: the fixture holds both writers’ shapes', () => {
    // Without both, "no date field is on every campaign" is not a property of
    // the fixture and the trap below proves nothing.
    expect(SENT).toBeGreaterThan(0)
    expect(SCHEDULED).toBeGreaterThan(0)
    expect(SENT + SCHEDULED).toBe(TOTAL)
  })

  it('THE TRAP: EITHER date ordering drops half the history', () => {
    // Driven through the evaluator the card is fed. This is why the history
    // cannot be paged by the server without a change to `campaign-send.ts`.
    expect(firestoreAnswer(campaignDocs, [{ orderBy: 'sentAt' }])).toHaveLength(
      SENT,
    )
    expect(
      firestoreAnswer(campaignDocs, [{ orderBy: 'sendAtMs' }]),
    ).toHaveLength(SCHEDULED)
    // The document name is on every one of them.
    expect(
      firestoreAnswer(campaignDocs, [{ orderBy: '__name__' }]),
    ).toHaveLength(TOTAL)
  })

  it('reads the ceiling PLUS a probe and renders one page', async () => {
    await mount()
    expect(mockCapsAsked).toContain(CEILING + 1)
    expect(renderedSubjects()).toHaveLength(TABLE_PAGE_SIZE_DEFAULT)
  })

  it('keeps the history NEWEST FIRST across both writers', async () => {
    await mount()
    // `Campaign 00` is the newest and is stored as a SENT campaign;
    // `Campaign 01` is the next and is SCHEDULED. Both appear, in date order,
    // which no single server ordering could have produced.
    expect(renderedSubjects()[0]).toBe('Campaign 00')
    expect(renderedSubjects()[1]).toBe('Campaign 01')
  })

  it('pages to a campaign the first page never held', async () => {
    await mount()
    fireEvent.click(screen.getByLabelText('Go to next page'))
    await waitFor(() => expect(renderedSubjects()[0]).toBe('Campaign 10'))
  })

  it('says so when the ceiling bit, and stays quiet when it did not', async () => {
    await mount()
    expect(screen.getByText(/no date field that every send stamps/)).toBeTruthy()

    served = CEILING
    document.body.innerHTML = ''
    await mount()
    expect(screen.queryByText(/no date field that every send stamps/)).toBeNull()
  })
})
