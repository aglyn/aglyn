/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 *
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
 * A proposal's code is not spent before the quote can be sent.
 *
 * On Billing opened from the menu, the "What you will pay" card can mount
 * before the signed-in user has loaded. Its first quote then returned without
 * a request, the proposal's code was used up on that empty call, and the
 * effect never ran again: the card showed the list price ($25.00/mo for a
 * Starter whose base price a partner code makes free), and every later quote
 * (the Yearly / Monthly toggle) went out with no code.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'

jest.mock('@aglyn/shared-ui-jsx', () => ({
  useLoading: () => ({ queueLoading: () => () => undefined }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
let mockUser: { uid: string; getIdToken: () => Promise<string> } | null = null
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: mockUser }),
}))
jest.mock('@aglyn/aglyn', () => ({
  parseLockdownRefusal: () => null,
}))
jest.mock('../components/lockdown-notice.component', () => ({
  __esModule: true,
  default: () => null,
}))

import BillingPlanQuoteComponent from '../components/billing/billing-plan-quote.component'

let posted: Array<Record<string, any>>

const BASE_FREE = {
  needsBillingDetails: true,
  promotionCodeApplied: 'PARTNER',
  promotionCodeDuration: 'forever',
  promotionCodeDurationInMonths: null,
  promotionCodePercentOff: 100,
  promotionCodeAmountOffUsd: null,
  promotionCodeBasePriceOnly: true,
}

beforeEach(() => {
  posted = []
  mockUser = null
  global.fetch = jest.fn(async (_url: unknown, init: any) => {
    const body = JSON.parse(String(init?.body ?? '{}'))
    posted.push(body)
    return {
      ok: true,
      status: 200,
      json: async () =>
        body.promotionCode === 'PARTNER' ? BASE_FREE : { needsBillingDetails: true },
    }
  }) as never
})

afterEach(() => jest.restoreAllMocks())

function Billing({ coupon }: { coupon: string | null }) {
  const [appliedCode, setAppliedCode] = useState('')
  return (
    <>
      <output data-testid="held-code">{appliedCode}</output>
      <BillingPlanQuoteComponent
        orgId="org-1"
        plan="starter"
        interval="month"
        canManage
        appliedCode={appliedCode}
        onAppliedCodeChange={setAppliedCode}
        initialCoupon={coupon}
      />
    </>
  )
}

describe('the proposal code on a card that mounts before the user', () => {
  it('sends no quote until the user loads, then quotes with the code', async () => {
    const view = render(<Billing coupon="PARTNER" />)
    // Nothing can be sent yet, and nothing was spent.
    await new Promise((r) => setTimeout(r, 0))
    expect(posted).toHaveLength(0)

    mockUser = { uid: 'u-1', getIdToken: async () => 'tok' }
    view.rerender(<Billing coupon="PARTNER" />)

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].promotionCode).toBe('PARTNER')
    await waitFor(() => expect(screen.getByTestId('held-code').textContent).toBe('PARTNER'))
    // The base price is free, so the total is $0.00, not the list price.
    expect(screen.getByText('$0.00/mo')).toBeTruthy()
  })

  it('tries a code that arrives after the card mounted', async () => {
    mockUser = { uid: 'u-1', getIdToken: async () => 'tok' }
    const view = render(<Billing coupon={null} />)
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].promotionCode).toBe('')

    view.rerender(<Billing coupon="PARTNER" />)
    await waitFor(() => expect(posted).toHaveLength(2))
    expect(posted[1].promotionCode).toBe('PARTNER')
    await waitFor(() => expect(screen.getByTestId('held-code').textContent).toBe('PARTNER'))
  })
})
