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
 * The Page Activity card must not report a confident zero it has not earned
 * (AGL-2486).
 *
 * ## Why this spec EXECUTES the query instead of inspecting it
 *
 * The bug was invisible to any test that stubs `useFirestoreCollection` and
 * hands the card a fixture array, because the card's own rendering was never
 * wrong — the WINDOW it asked Firestore for was. `limit(200)` with no
 * `orderBy` returns documents in DOCUMENT-ID order, and the ids are
 * `addDoc()` auto-ids, so the card received a pseudo-random sample of the
 * collection and truthfully reported that its target was not in it.
 *
 * So the double below is a miniature Firestore rather than a stub: it applies
 * the `where` predicates, orders by the `orderBy` clause or, in its ABSENCE,
 * by document id ascending exactly as the real engine does, and then applies
 * the limit. That last detail is the whole point — a double that ignores
 * ordering is a double in which the shipped bug passes.
 *
 * The fixture mirrors the production host that produced the report: a log
 * far larger than the window, whose target's own entries all sort past the
 * id boundary.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  TABLE_PAGE_SIZE_DEFAULT,
  TABLE_ROWS_PER_PAGE_LABEL,
} from '@aglyn/shared-ui-jsx/const/table-pagination'
import HostActivityCard from './host-activity-card.component'

const HOST_ID = 'DXnRbPH4CQ'
/** A screen with recent entries whose ids all sort past the window. */
const BUSY_SCREEN = 'coOm073Tai'
/** A screen that genuinely has never been touched. */
const UNTOUCHED_SCREEN = 'never-touched'
/** A screen with MORE history than the window, so the probe finds a row. */
const CROWDED_SCREEN = 'crowded-screen'
/** The card's own ceiling. */
const WINDOW = 200

interface FakeDoc {
  id: string
  data: Record<string, any>
}

/**
 * 250 filler entries for OTHER targets, with ids that sort BELOW the target's
 * — the shape of a real log, where a busy site's noise crowds out any one
 * page. Any id-ordered window of 200 is entirely filler.
 */
const filler: FakeDoc[] = Array.from({ length: 250 }, (_, i) => ({
  id: `A${String(i).padStart(4, '0')}`,
  data: {
    action: 'Saved the screen',
    actorEmail: 'someone@example.com',
    target: { type: 'screen', id: `other-screen-${i}`, name: `Other ${i}` },
    createdAt: { seconds: 1_000 + i },
  },
}))

/**
 * The five real entries, with the production id prefixes (Y, h, j, k, t) —
 * every one of them past the boundary an id-ordered 200-row window reaches.
 */
const busy: FakeDoc[] = [
  ['YrLePecuBDjvYGqudofr', 'Updated SEO', 9_000],
  ['he7IFXlahkDSFbbcJ17m', 'Created screen', 5_000],
  ['jqoay5VdVYhiIlc29xE5', 'Saved the screen', 6_000],
  ['k0bfJSV6iL53HsVksQ9Q', 'Saved the screen', 7_000],
  ['tiqiMAtdTu8PdfOC70WX', 'Saved the screen', 8_000],
].map(([id, action, seconds]) => ({
  id: id as string,
  data: {
    action,
    actorEmail: 'actor@example.com',
    target: { type: 'screen', id: BUSY_SCREEN, name: 'Press — Entry Template' },
    createdAt: { seconds },
  },
}))

/**
 * One target with more entries than the window, so the TARGETED read can be
 * seen to truncate. Older than everything else, so the un-targeted feed's
 * newest-first order is unchanged by their presence.
 */
const crowded: FakeDoc[] = Array.from({ length: WINDOW + 5 }, (_, i) => ({
  id: `B${String(i).padStart(4, '0')}`,
  data: {
    action: 'Saved the screen',
    actorEmail: 'someone@example.com',
    target: { type: 'screen', id: CROWDED_SCREEN, name: 'Crowded' },
    createdAt: { seconds: 1 + i },
  },
}))

const DOCS: FakeDoc[] = [...filler, ...busy, ...crowded]

/** Reads a dotted field path the way Firestore does. */
const readPath = (data: Record<string, any>, path: string) =>
  path.split('.').reduce<any>((value, key) => value?.[key], data)

interface Clause {
  kind: 'where' | 'orderBy' | 'limit'
  field?: string
  value?: unknown
  direction?: string
  count?: number
}

/** The listener's verdict, chosen per spec. */
const listener = { status: 'success' as 'success' | 'error' }

/**
 * Evaluate a query descriptor against `DOCS` with Firestore's semantics.
 *
 * The ordering branch is load-bearing: with no `orderBy`, Firestore orders by
 * `__name__` ascending, and it is that default — not any bug in the card's
 * rendering — that hid the entries.
 */
function runQuery(descriptor: { clauses: Clause[] }): Record<string, any>[] {
  const { clauses } = descriptor
  let rows = DOCS.filter((row) =>
    clauses
      .filter((c) => c.kind === 'where')
      .every((c) => readPath(row.data, c.field as string) === c.value),
  )
  const order = clauses.find((c) => c.kind === 'orderBy')
  rows = [...rows].sort((a, b) => {
    if (!order) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    const av = readPath(a.data, order.field as string)?.seconds ?? 0
    const bv = readPath(b.data, order.field as string)?.seconds ?? 0
    return order.direction === 'desc' ? bv - av : av - bv
  })
  const cap = clauses.find((c) => c.kind === 'limit')?.count
  if (cap != null) rows = rows.slice(0, cap)
  return rows.map((row) => ({ ...row.data, $id: row.id }))
}

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  where: (field: string, _op: string, value: unknown) => ({
    kind: 'where',
    field,
    value,
  }),
  orderBy: (field: string, direction = 'asc') => ({
    kind: 'orderBy',
    field,
    direction,
  }),
  limit: (count: number) => ({ kind: 'limit', count }),
  query: (base: unknown, ...clauses: Clause[]) => ({ base, clauses }),
}))

/** Every cap the card asked for, so a read that stopped probing is visible. */
const caps: number[] = []

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: (build: () => any) => {
    const descriptor = build()
    const cap = (descriptor?.clauses ?? []).find(
      (clause: Clause) => clause.kind === 'limit',
    )?.count
    if (typeof cap === 'number') caps.push(cap)
    return {
      data: descriptor && listener.status === 'success' ? runQuery(descriptor) : [],
      status: descriptor ? listener.status : 'loading',
      error: undefined,
      fromCache: false,
      serverDenied: false,
    }
  },
  // Real: the card's probe row is dropped by it, so a stub would decide how
  // many rows this spec's assertions see.
  ceilingedWindow: jest.requireActual('@aglyn/tenant-feature-instance')
    .ceilingedWindow,
}))

jest.mock('next/navigation', () => ({
  useParams: () => ({ orgSlug: 'aglyn', host: 'site' }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
jest.mock('@aglyn/aglyn', () => ({ pluginDocsHelp: () => undefined }))

const EMPTY = /No activity yet/
const UNREADABLE = /Could not read the activity log/

/** Row elements, whichever entries are on the page. */
const renderedActions = () =>
  Array.from(document.querySelectorAll('li')).map(
    (node) => (node.textContent ?? '').trim(),
  )

beforeEach(() => {
  listener.status = 'success'
  caps.length = 0
})

describe('Page Activity — the window it asks for', () => {
  it('shows a screen its OWN entries, from a log far larger than the window', () => {
    render(
      <HostActivityCard
        hostId={HOST_ID}
        targetId={BUSY_SCREEN}
        header="Page Activity"
      />,
    )
    // An entry whose id sorts past a host-wide window's boundary.
    expect(
      screen.getByText('Updated SEO — Press — Entry Template'),
    ).not.toBeNull()
    // All five, newest first — proving the window is spent on the TARGET
    // rather than on the host's other 250 rows.
    const rendered = screen.getAllByText(/— Press — Entry Template$/)
    expect(rendered).toHaveLength(5)
    expect(rendered[0].textContent).toContain('Updated SEO')
    expect(screen.queryByText(EMPTY)).toBeNull()
  })

  it('still says "No activity yet" for a screen that genuinely has none', () => {
    render(<HostActivityCard hostId={HOST_ID} targetId={UNTOUCHED_SCREEN} />)
    expect(screen.getByText(EMPTY)).not.toBeNull()
    // A real empty must not be dressed up as a failure — that is the same
    // dishonesty pointed the other way.
    expect(screen.queryByText(UNREADABLE)).toBeNull()
  })

  it('orders the un-targeted feed newest-first, not by document id', () => {
    render(<HostActivityCard hostId={HOST_ID} />)
    // `YrLePecu…` is the newest row and one of the LAST by id: an id-ordered
    // window of 200 over 255 rows never reaches it.
    expect(
      screen.getByText('Updated SEO — Press — Entry Template'),
    ).not.toBeNull()
  })
})

describe('Page Activity — "could not look" is not "found nothing"', () => {
  it('renders the unreadable state, NOT the empty one, when the read fails', () => {
    listener.status = 'error'
    render(<HostActivityCard hostId={HOST_ID} targetId={BUSY_SCREEN} />)
    expect(screen.getByText(UNREADABLE)).not.toBeNull()
    expect(screen.queryByText(EMPTY)).toBeNull()
    expect(screen.getByRole('button', { name: 'Try again' })).not.toBeNull()
  })

  it('treats a missing hostId as unreadable rather than as an empty history', () => {
    // `strictNullChecks` is off, so this is reachable: an absent id folds to
    // falsy and a query built from it would match nothing.
    render(<HostActivityCard hostId={undefined as never} targetId={BUSY_SCREEN} />)
    expect(screen.getByText(UNREADABLE)).not.toBeNull()
    expect(screen.queryByText(EMPTY)).toBeNull()
  })
})

/**
 * The "Show N more" expander became the shared footer (AGL-693, AGL-2486).
 *
 * It was the console's FOURTH pagination grammar for one act, and it stood
 * beside the guard written to stop exactly that — escaping it on spelling,
 * because the guard demanded the literal `'Load more'`. On its own terms it
 * was the weakest of the four: it only ever grew, offered no size control, and
 * said nothing when the 200-row window bit.
 *
 * These assert the three things the expander could not do, rather than that a
 * footer component is present somewhere on the card.
 */
describe('Page Activity — the expander is the shared footer now', () => {
  it('asks for the window PLUS a probe, on both queries', () => {
    render(<HostActivityCard hostId={HOST_ID} />)
    cleanup()
    render(<HostActivityCard hostId={HOST_ID} targetId={BUSY_SCREEN} />)
    // The SET, not "some read asked for 201". Both queries are the card's own
    // and both must probe; an assertion satisfied by either alone would keep
    // passing if the other stopped bounding itself honestly.
    expect(caps).toEqual([WINDOW + 1, WINDOW + 1])
  })

  it('pages BACKWARD, which is what the expander could never do', () => {
    render(<HostActivityCard hostId={HOST_ID} />)
    const firstPage = renderedActions()
    expect(firstPage).toHaveLength(TABLE_PAGE_SIZE_DEFAULT)
    fireEvent.click(screen.getByLabelText('Go to next page'))
    expect(renderedActions()).not.toEqual(firstPage)
    fireEvent.click(screen.getByLabelText('Go to previous page'))
    expect(renderedActions()).toEqual(firstPage)
  })

  it('offers the shared size menu, which the expander never had', () => {
    render(<HostActivityCard hostId={HOST_ID} />)
    expect(screen.getByText(TABLE_ROWS_PER_PAGE_LABEL)).not.toBeNull()
    // And no growing button survives anywhere on the card.
    expect(screen.queryByText(/Show \d+ more/)).toBeNull()
  })

  it('says when the window bit, and stays quiet when it did not', () => {
    // 255 documents against a 200-row ceiling: the probe finds a 201st.
    render(<HostActivityCard hostId={HOST_ID} />)
    expect(screen.getByText(/There is more history than that/)).not.toBeNull()
    // The busy screen has five entries of its own, so nothing was cut.
    cleanup()
    render(<HostActivityCard hostId={HOST_ID} targetId={BUSY_SCREEN} />)
    expect(screen.queryByText(/It has more/)).toBeNull()
  })

  it('does not call the TARGETED window "most recent" — it has no order', () => {
    // The targeted query carries no `orderBy` on purpose, so its window is a
    // document-id sample. Saying "most recent" over it would be the AGL-2292
    // lie in a caption instead of in a list.
    render(<HostActivityCard hostId={HOST_ID} targetId={CROWDED_SCREEN} />)
    expect(screen.getByText(/these are not necessarily the newest/)).not.toBeNull()
    expect(screen.queryByText(/most recent/)).toBeNull()
  })
})
