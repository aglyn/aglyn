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
 * The monthly usage budget card (AGL-1528), and what it can now REPORT
 * (AGL-2239).
 *
 * The card had no test of any kind. That mattered more than usual here,
 * because a budget's whole value is what it tells a customer before an
 * invoice does, and every claim on this card is a sentence about money.
 *
 * Three things are guarded:
 *
 * - **The ALERT HISTORY**, added by AGL-2239. The ladder says what we intend
 *   to do; nothing said what we did. It is also the customer-visible half of
 *   AGL-2234 — a budget alert that reached zero email addresses is recorded
 *   only in the cron's output, which no customer reads, and the dedupe guard
 *   is written either way, so that rule then stays silent for the rest of the
 *   month.
 * - **Absence is not zero.** `report-usage` writes the running figure daily;
 *   before the first run of a month there is nothing to read, and "$0.00
 *   spent" would be a claim rather than an absence.
 * - **A budget is not a cap.** The copy has to keep saying so, because a
 *   customer who believes a budget stops things is surprised twice.
 *
 * Every case was forced red before it was kept; each says how.
 */

import { render, screen, waitFor } from '@testing-library/react'

const mockEnqueueSnackbar = jest.fn()

jest.mock('@aglyn/shared-ui-jsx', () => ({
  useConfirmationContext: () => ({ confirm: jest.fn(() => Promise.resolve()) }),
  useLoading: () => ({ queueLoading: () => () => undefined }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

/**
 * ONE stable object across renders. `useUser` returns a stable reference in
 * the app, and the card's load effect depends on `user` — a fresh object per
 * render makes the effect re-run forever and the card sits in `pending`,
 * which is a defect in the double rather than in the card.
 */
const mockUserData = { uid: 'admin-1', getIdToken: async () => 'tok' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: mockUserData }),
}))

import BillingUsageBudgetCardComponent from './billing-usage-budget-card.component'

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response

const MONTH = '2026-08'

/** A $50 budget with the default ladder, $25 spent, and no alert yet. */
const BUDGET_SET = {
  budgetSet: true,
  amountUsd: 50,
  thresholdPcts: [50, 90, 100],
  month: MONTH,
  spend: {
    meteredUsd: 25,
    assistCredits: 0,
    totalUsd: 25,
    assistBilled: false,
    meteredFresh: true,
  },
  lastAlert: null,
  metered: true,
  defaultThresholdPcts: [50, 90, 100],
  minAmountUsd: 1,
  maxAmountUsd: 100_000,
  minThresholdPct: 1,
  maxThresholdPct: 200,
  maxThresholds: 6,
}

function renderCard(payload: Record<string, unknown>) {
  ;(global as any).fetch = jest.fn(async () => jsonResponse(payload))
  return render(
    <BillingUsageBudgetCardComponent orgId="org-1" canManage={true} />,
  )
}

afterEach(() => {
  jest.clearAllMocks()
})

describe('the alert history (AGL-2239)', () => {
  it('names the rule that fired', async () => {
    // Forced red by dropping the `lastAlert` block from the card: the text
    // never appeared and the "no alert yet" line rendered instead.
    renderCard({ ...BUDGET_SET, lastAlert: { month: MONTH, threshold: 90 } })
    await waitFor(() =>
      expect(
        screen.getByText(/alerted your owners and admins at 90%/i),
      ).toBeTruthy(),
    )
  })

  it('says plainly when nothing has fired, and names what will', async () => {
    // THE NEGATIVE CONTROL. Without it the card is satisfied by one that
    // renders the alert line unconditionally, or by one that renders nothing
    // at all — a silent card and a correct one look identical to an assertion
    // that only ever checks the positive case.
    renderCard(BUDGET_SET)
    await waitFor(() =>
      expect(screen.getByText(/No budget alert yet this month/i)).toBeTruthy(),
    )
    expect(screen.queryByText(/alerted your owners and admins/i)).toBeNull()
    // The ladder travels with the sentence, so it answers "then when?".
    expect(
      screen.getByText(/No budget alert yet this month/i).textContent,
    ).toContain('50%, 90%, 100%')
  })

  it('says nothing about alerts when there is no budget', async () => {
    // An org with no budget has no ladder and no events; promising an email
    // it will never send would be the card lying quietly.
    renderCard({
      ...BUDGET_SET,
      budgetSet: false,
      amountUsd: null,
      lastAlert: null,
    })
    await waitFor(() => expect(screen.getByText(/No budget set/i)).toBeTruthy())
    expect(screen.queryByText(/No budget alert yet this month/i)).toBeNull()
    expect(screen.queryByText(/alerted your owners and admins/i)).toBeNull()
  })
})

describe('a plan with nothing to meter (AGL-2250)', () => {
  it('says so, and stops promising an email that cannot be sent', async () => {
    // The free tier is a hard cap that never bills (AGL-2135), so
    // `billedCents` is 0 every month and a budget set here can never fire.
    // The card used to render the ladder and the "we'll email you at 50%,
    // 90%, 100%" promise identically for a Free org and a metered one.
    //
    // Forced red by hardcoding `metered` to true in the card: the notice never
    // rendered and the promise came back.
    renderCard({ ...BUDGET_SET, metered: false })
    await waitFor(() =>
      expect(screen.getByText(/no metered usage/i)).toBeTruthy(),
    )
    expect(screen.queryByText(/No budget alert yet this month/i)).toBeNull()
  })

  it('still lets the org set one ahead of an upgrade', async () => {
    // Removing the control would be a worse answer than an honest sentence:
    // an org about to upgrade may reasonably set its budget first.
    renderCard({ ...BUDGET_SET, metered: false })
    await waitFor(() =>
      expect(screen.getByLabelText(/Monthly budget \(USD\)/i)).toBeTruthy(),
    )
    expect(
      (screen.getByLabelText(/Monthly budget \(USD\)/i) as HTMLInputElement)
        .disabled,
    ).toBe(false)
  })

  it('does NOT show the notice on a metered plan', async () => {
    // The negative control: a notice that renders for everyone says nothing.
    renderCard(BUDGET_SET)
    await waitFor(() =>
      expect(screen.getByText(/No budget alert yet this month/i)).toBeTruthy(),
    )
    expect(screen.queryByText(/no metered usage/i)).toBeNull()
  })
})

describe('the spend figure', () => {
  it('shows the month total against the budget', async () => {
    renderCard(BUDGET_SET)
    await waitFor(() => expect(screen.getByText(/\$25\.00/)).toBeTruthy())
    expect(screen.getByText(/of your \$50 budget/)).toBeTruthy()
  })

  it('reports an ABSENT month rather than $0.00', async () => {
    // `report-usage` writes the running figure daily; before the first run of
    // a month there is nothing to read. "$0.00 spent" would be a claim rather
    // than an absence — three outcomes, not two.
    //
    // Forced red by rendering the `meteredFresh` branch unconditionally: the
    // card showed "$0.00 of metered usage" for a month it had not totalled.
    renderCard({
      ...BUDGET_SET,
      spend: { ...BUDGET_SET.spend, totalUsd: 0, meteredUsd: 0, meteredFresh: false },
    })
    await waitFor(() =>
      expect(screen.getByText(/haven’t totalled 2026-08 yet/i)).toBeTruthy(),
    )
    expect(screen.queryByText(/\$0\.00/)).toBeNull()
  })

  /*
   * ASSIST CONSUMPTION IS SHOWN, AND IT IS SHOWN IN CREDITS.
   *
   * The figure behind a credit is `assistUsage/{month}.estCostUsd` — our
   * provider bill at the serving model's list rates. This card used to print
   * it in dollars, which put our unit cost, and with it our margin, on a
   * customer's billing page. What a customer consumed is theirs to see; what
   * it cost us is not.
   */
  it('renders Assist consumption in credits, and no dollar figure for it', async () => {
    renderCard({
      ...BUDGET_SET,
      spend: { ...BUDGET_SET.spend, assistCredits: 2300 },
    })
    await waitFor(() =>
      expect(screen.getByText(/2,300 Assist credits used/i)).toBeTruthy(),
    )
    // The provider bill behind 2,300 credits is $2.30. It must appear nowhere.
    expect(screen.queryByText(/\$2\.30/)).toBeNull()
    expect(screen.queryByText(/Assist/)?.textContent).not.toMatch(/\$/)
  })

  it('says nothing about Assist when none was consumed', async () => {
    // Zero credits is not a fact worth a line, and a "0 Assist credits" row on
    // every plan that has no Assist band would be noise standing where a real
    // reading goes.
    renderCard(BUDGET_SET)
    await waitFor(() => expect(screen.getByText(/\$25\.00/)).toBeTruthy())
    expect(screen.queryByText(/Assist credits used/i)).toBeNull()
  })
})

describe('a budget is not a cap, and the copy keeps saying so', () => {
  it('states that nothing stops', async () => {
    renderCard(BUDGET_SET)
    await waitFor(() =>
      expect(screen.getByText(/heads-up, not a limit/i)).toBeTruthy(),
    )
    expect(screen.getByText(/Nothing stops and no upload is refused/i)).toBeTruthy()
  })
})

describe('view-only members', () => {
  it('cannot edit, and is told why', async () => {
    ;(global as any).fetch = jest.fn(async () => jsonResponse(BUDGET_SET))
    render(<BillingUsageBudgetCardComponent orgId="org-1" canManage={false} />)
    await waitFor(() =>
      expect(
        screen.getByText(/need the Manage billing permission/i),
      ).toBeTruthy(),
    )
    expect(
      (screen.getByLabelText(/Monthly budget \(USD\)/i) as HTMLInputElement)
        .disabled,
    ).toBe(true)
  })
})
