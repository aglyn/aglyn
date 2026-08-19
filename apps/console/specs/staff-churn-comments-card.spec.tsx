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
 * THE PROSE REACHES A SCREEN (AGL-2294).
 *
 * A route that returns free text nobody renders is the same dead data one
 * layer along — which is exactly how `churnSurveyDetails` came to have a
 * writer, a 365-day TTL and no reader. `admin-churn-report.spec.ts` proves the
 * route serves the sentences; this file proves the console shows them.
 *
 * Every assertion reads rendered TEXT, not a prop or a class name. The
 * load-bearing one is that two comments with different reasons render their
 * OWN reason — a card that showed the first row's context beside every
 * sentence would look right in a screenshot and mislabel every answer but one.
 */

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  CardDisplay: ({
    header,
    children,
  }: {
    header: React.ReactNode
    children: React.ReactNode
  }) => (
    <section>
      <h2>{header}</h2>
      {children}
    </section>
  ),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: { uid: 'staff-1', getIdToken: async () => 'tok' } }),
}))

jest.mock('../constants/docs-links', () => ({
  __esModule: true,
  docsHelp: () => undefined,
}))

import StaffChurnReportCard from '../components/staff-churn-report-card.component'

/** The body `/api/admin/churn-report` returns, as the card receives it. */
const REPORT = {
  byReason: { too_expensive: 1, missing_feature: 1 },
  bySurface: { cancel: 2 },
  byPlan: { pro: 1, business: 1 },
  surveys: 2,
  cancels: { total: 2, funnelSkipped: 0 },
  winbacks: { reserved: 0, applied: 0 },
  scanned: 2,
  capped: false,
  comments: [
    {
      id: 'c-1',
      detail: 'Moving to an in-house build.',
      atMs: 1_760_000_000_000,
      reason: 'missing_feature',
      surface: 'cancel',
      plan: 'business',
    },
    {
      id: 'c-2',
      detail: 'Too expensive for one site.',
      atMs: 1_750_000_000_000,
      reason: 'too_expensive',
      surface: 'cancel',
      plan: 'pro',
    },
  ],
  commentsCapped: false,
}

function serve(body: Record<string, unknown>) {
  ;(global as any).fetch = jest.fn(async () => ({
    ok: true,
    json: async () => body,
  }))
}

afterEach(() => {
  delete (global as any).fetch
})

describe('the staff churn card shows what people wrote', () => {
  it('renders each comment’s own sentence and its own reason', async () => {
    serve(REPORT)
    render(<StaffChurnReportCard />)
    // Collapsed by default — the counts are what a rate report is for.
    await waitFor(() =>
      expect(screen.getByText('What they wrote (2)')).toBeTruthy(),
    )
    fireEvent.click(screen.getByText('What they wrote (2)'))

    expect(screen.getByText('Moving to an in-house build.')).toBeTruthy()
    expect(screen.getByText('Too expensive for one site.')).toBeTruthy()

    /*
      THE ASSERTION, scoped INSIDE the disclosure. The counts list above
      already prints both reason labels, so an unscoped query would pass
      against a card that rendered no chips at all — the false green this file
      exists to avoid. The retention notice is the disclosure's own first
      child, so its parent is the comment stack and nothing else.
    */
    const comments = screen.getByText(/deleted 365 days after it was written/)
      .parentElement as HTMLElement
    // Each row carries its OWN reason. A card reusing the first row's context
    // beside every sentence renders one label twice and the other never.
    expect(within(comments).getByText('Missing feature')).toBeTruthy()
    expect(within(comments).getByText('Too expensive')).toBeTruthy()
    // And each sentence sits beside its own reason, not merely somewhere on
    // the page: `business`/`pro` came off the same two rows.
    expect(within(comments).getByText(/business/)).toBeTruthy()
    expect(within(comments).getByText(/pro/)).toBeTruthy()
  })

  it('says the text is personal data with a deletion period', async () => {
    serve(REPORT)
    render(<StaffChurnReportCard />)
    await waitFor(() =>
      expect(screen.getByText('What they wrote (2)')).toBeTruthy(),
    )
    fireEvent.click(screen.getByText('What they wrote (2)'))
    expect(screen.getByText(/deleted 365 days after it was written/)).toBeTruthy()
  })

  it('an unjoinable comment says so rather than implying no reason was given', async () => {
    serve({
      ...REPORT,
      comments: [
        {
          id: 'orphan',
          detail: 'Nobody ever replied to my ticket.',
          atMs: null,
          reason: null,
          surface: null,
          plan: null,
        },
      ],
    })
    render(<StaffChurnReportCard />)
    await waitFor(() =>
      expect(screen.getByText('What they wrote (1)')).toBeTruthy(),
    )
    fireEvent.click(screen.getByText('What they wrote (1)'))
    expect(screen.getByText('Nobody ever replied to my ticket.')).toBeTruthy()
    expect(screen.getByText('Reason not in this window')).toBeTruthy()
  })

  it('NEGATIVE CONTROL: no comments renders no disclosure at all', async () => {
    // An empty "What they wrote (0)" would advertise a section that answers
    // nothing — the phantom-facet shape, one card over.
    serve({ ...REPORT, comments: [], commentsCapped: false })
    render(<StaffChurnReportCard />)
    await waitFor(() => expect(screen.getByText('Too expensive')).toBeTruthy())
    expect(screen.queryByText(/What they wrote/)).toBeNull()
  })

  it('says when more free text exists than was scanned', async () => {
    serve({ ...REPORT, commentsCapped: true })
    render(<StaffChurnReportCard />)
    await waitFor(() =>
      expect(screen.getByText('What they wrote (2)')).toBeTruthy(),
    )
    fireEvent.click(screen.getByText('What they wrote (2)'))
    expect(
      screen.getByText('More free-text answers exist than were scanned.'),
    ).toBeTruthy()
  })
})
