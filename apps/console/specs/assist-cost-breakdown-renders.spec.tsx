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
 * THE ASSIST COST SPLIT REACHES A SCREEN (AGL-2340).
 *
 * `mineAssistSignals` computed `totals.byTier`, `totals.byModel` and
 * `totals.cacheWriteTokens` on every staff page load, the route serialized
 * all three, and the browser threw them away. They are the two axes any
 * decision about Assist pricing runs along — `byTier` says whether to move
 * the free cap or the paid price, `byModel` says whether a cheaper model on
 * the common path would do — and `cacheWriteTokens` is the dearest token
 * class, sitting invisible beside its cheaper twin `cacheReadRate`, which
 * was displayed.
 *
 * WHAT THIS FILE HAS TO CATCH, and how each assertion is shaped against a
 * false green:
 *
 *  - **Presence is not correctness.** Asserting the string "By model" appears
 *    is satisfied by the heading alone with an empty table under it. So every
 *    figure below is asserted as its OWN row: the response gives each tier
 *    and each model a distinct cost, and each is looked up within its own
 *    `<tr>`. A card that rendered the first bucket's cost on every line — the
 *    single likeliest rendering bug here — looks entirely plausible and dies.
 *  - **Turns and dollars are made to DISAGREE.** `free` is the majority of
 *    turns and a twentieth of the spend. A panel that rendered counts under a
 *    "Cost" header, or that summed the wrong field, reports the opposite of
 *    the truth and cannot pass.
 *  - **A constant must go red.** `does not render a constant` re-renders the
 *    same page against a second response where only the per-bucket costs
 *    moved, and demands the screen move with them. A component ignoring the
 *    payload and printing a fixed figure survives every other assertion here.
 */

import { render, screen, waitFor, within } from '@testing-library/react'

jest.mock('@aglyn/aglyn', () => ({
  __esModule: true,
  PLATFORM_BRAND_NAME: 'Aglyn',
}))

jest.mock('@aglyn/shared-data-enums', () => ({
  __esModule: true,
  ICON_VARIANT_SYMBOL_SECURE: { path: 'M0 0' },
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  Container: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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

jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('../components/staff-only.component', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('../constants/route-links', () => ({
  __esModule: true,
  buildRoute: () => '/admin/assist-signals',
  Route: {
    ADMIN_OVERVIEW: 'ADMIN_OVERVIEW',
    ADMIN_ASSIST_SIGNALS: 'ADMIN_ASSIST_SIGNALS',
  },
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: { getIdToken: async () => 'staff-token' } }),
}))

jest.mock('../hooks/use-is-staff', () => ({
  __esModule: true,
  default: () => true,
}))

import AdminAssistSignals from '../app/(app)/admin/assist-signals/page'

/**
 * A report the way the route serves it.
 *
 * Deliberately built so **turns and dollars point in opposite directions**:
 * `free` is 60% of the traffic and 4.7% of the bill, and the cheap model is
 * the common one. Every rendering mistake worth catching — counts under the
 * cost header, one bucket's figure repeated down the column, the two splits
 * transposed — produces a table that is visibly wrong against this fixture
 * rather than one that happens to look right.
 */
const report = (over: Record<string, unknown> = {}) => ({
  scanned: 5,
  truncated: false,
  totals: {
    messages: 5,
    inputTokens: 500,
    outputTokens: 200,
    cacheReadTokens: 4_500,
    cacheWriteTokens: 8_192,
    estCostUsd: 4.24,
    // Two of the five turns were answered with no model call (AGL-2486).
    deflected: 2,
    deflectionRate: 0.4,
    cacheReadRate: 0.9,
    byTier: {
      entitled: { messages: 2, estCostUsd: 4.04 },
      free: { messages: 3, estCostUsd: 0.2 },
    },
    byModel: {
      'claude-sonnet-5': { messages: 2, estCostUsd: 4.04 },
      'claude-haiku-4-5': { messages: 3, estCostUsd: 0.2 },
    },
    stopReasons: { end_turn: 5 },
    feedback: { up: 1, down: 1, none: 3 },
    ...((over['totals'] as Record<string, unknown>) ?? {}),
  },
  docsGaps: [],
  proseCandidates: [],
  prose: [],
  ungrounded: { questions: 0, down: 0, routes: [] },
  orgs: [],
})

function serve(body: unknown) {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => body,
  })) as unknown as typeof fetch
}

/**
 * The breakdown labels in the order the DOM has them, across both tables.
 *
 * Filtered to the four keys the fixture uses so the header rows and the
 * fleet card's chips cannot contribute — the order under test is the order
 * of the data rows and nothing else.
 */
function labelOrder(): string[] {
  const keys = new Set([
    'entitled',
    'free',
    'claude-sonnet-5',
    'claude-haiku-4-5',
  ])
  return screen
    .getAllByRole('row')
    .map((row) => row.querySelector('td')?.textContent?.trim() ?? '')
    .filter((label) => keys.has(label))
}

/** The `<tr>` whose first cell is `label` — so a figure is read in its own row. */
async function rowFor(label: string) {
  const cell = await screen.findByRole('cell', { name: label })
  const row = cell.closest('tr')
  if (!row) throw new Error(`no row for ${label}`)
  return within(row)
}

describe('the Assist cost breakdown reaches the screen (AGL-2340)', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('renders each tier and model with its OWN cost, not the first bucket everywhere', async () => {
    serve(report())
    render(<AdminAssistSignals />)

    // Each figure asserted INSIDE its own row. `entitled` and
    // `claude-sonnet-5` share a cost by construction — they are the same
    // turns seen down two axes — so `free` and `claude-haiku-4-5` carrying
    // $0.2000 is what proves the column is not one repeated value.
    expect(await (await rowFor('entitled')).findByText('$4.04')).toBeTruthy()
    expect((await rowFor('free')).getByText('$0.2000')).toBeTruthy()
    expect(
      (await rowFor('claude-sonnet-5')).getByText('$4.04'),
    ).toBeTruthy()
    expect(
      (await rowFor('claude-haiku-4-5')).getByText('$0.2000'),
    ).toBeTruthy()

    // Turns and cost are BOTH present and disagree: free is the majority of
    // the traffic and a rounding error of the bill. A panel showing counts
    // under the cost header cannot satisfy both cells of this row.
    const free = await rowFor('free')
    expect(free.getByText('3')).toBeTruthy()
    expect(free.getByText('5%')).toBeTruthy()
    const entitled = await rowFor('entitled')
    expect(entitled.getByText('2')).toBeTruthy()
    expect(entitled.getByText('95%')).toBeTruthy()
  })

  it('puts the dearest line at the top of each breakdown', async () => {
    serve(report())
    render(<AdminAssistSignals />)
    await screen.findByText('entitled')

    // Read the order out of the TABLE ROWS, not out of the page text. The
    // surrounding prose contains the word "free" — a `textContent.indexOf`
    // check finds that sentence and reports an ordering the table does not
    // have, which is the false red that first ran here.
    //
    // The two axes disagree with alphabetical order: on tier it happens to
    // match ('entitled' < 'free'), on model it is the reverse — the cheap
    // 'claude-haiku-4-5' sorts before the dear 'claude-sonnet-5'. So a table
    // left in alphabetical or insertion order passes the first line here and
    // fails the second, which is why both are asserted.
    expect(labelOrder()).toEqual([
      'entitled',
      'free',
      'claude-sonnet-5',
      'claude-haiku-4-5',
    ])
  })

  it('shows cache writes beside cache reads, the premium class beside the cheap one', async () => {
    serve(report())
    render(<AdminAssistSignals />)
    expect(await screen.findByText('cache reads 90%')).toBeTruthy()
    expect(await screen.findByText('cache writes 8,192')).toBeTruthy()
  })

  /*==========================================
   * THE CONSTANT TEST.
   *
   * Serves a SECOND response in which only the per-bucket costs moved, and
   * requires the screen to move with them. This is the assertion a card that
   * ignores the payload — or an aggregator that records a fixed figure
   * instead of the measured sum — cannot survive, and the one every
   * "does the label appear" check above would happily pass without.
   *=========================================*/
  it('moves when the measured cost moves, so a constant cannot pass', async () => {
    serve(report())
    const first = render(<AdminAssistSignals />)
    expect(await (await rowFor('entitled')).findByText('$4.04')).toBeTruthy()
    first.unmount()

    serve(
      report({
        totals: {
          estCostUsd: 12.5,
          byTier: {
            entitled: { messages: 2, estCostUsd: 1.5 },
            free: { messages: 3, estCostUsd: 11.0 },
          },
          byModel: {
            'claude-sonnet-5': { messages: 2, estCostUsd: 1.5 },
            'claude-haiku-4-5': { messages: 3, estCostUsd: 11.0 },
          },
        },
      }),
    )
    render(<AdminAssistSignals />)

    // The tiers have swapped which one is expensive. Both the figures and
    // the ORDER must follow the data.
    const free = await rowFor('free')
    expect(free.getByText('$11.00')).toBeTruthy()
    expect(free.getByText('88%')).toBeTruthy()
    await waitFor(() => {
      expect(labelOrder()).toEqual([
        'free',
        'entitled',
        'claude-haiku-4-5',
        'claude-sonnet-5',
      ])
    })
    expect(screen.queryByText('$4.04')).toBeNull()
  })
})
