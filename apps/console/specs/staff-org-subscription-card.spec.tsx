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
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

/**
 * The Subscription card on the staff org page (AGL-3359).
 *
 * `fetch` is a double throughout; nothing here reaches Stripe. Pinned: the
 * action is in the CARD HEADER and super-gated, nothing posts until a reason
 * is picked AND the workspace slug is typed, the card says "no refund" and
 * "a lift does not restore it" before anyone opens the dialog, and a result
 * that did not verify is shown as such rather than as a success.
 */

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: { uid: 'staff-1', getIdToken: async () => 'tok' } }),
}))

const mockEnqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

// The header's action is rendered in a marked region, so a test can tell a
// header control from one in the body — the house rule is the point.
jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  CardDisplay: ({ children, header, HeaderProps }: any) => (
    <div>
      <div data-testid="card-header">
        <span>{header}</span>
        {HeaderProps?.action}
      </div>
      <div data-testid="card-body">{children}</div>
    </div>
  ),
}))

let mockRole: string | null = 'super'
jest.mock('../hooks/use-is-staff', () => ({
  __esModule: true,
  useStaffRole: () => mockRole,
}))

jest.mock('../constants/docs-links', () => ({
  __esModule: true,
  docsHelp: () => ({}),
}))

import StaffOrgSubscriptionCard, {
  describeRenewal,
} from '../components/staff-org-subscription-card.component'

const LIVE = {
  id: 'sub_live',
  status: 'active',
  plan: 'pro',
  priceId: 'price_pro',
  interval: 'month',
  cancelAtPeriodEnd: false,
  cancelAt: null,
  canceledAt: null,
  currentPeriodEnd: '2026-10-28T00:00:00.000Z',
  cancellationComment: null,
  terminal: false,
}

let postBodies: any[]
let postReply: Record<string, unknown>

beforeEach(() => {
  jest.clearAllMocks()
  mockRole = 'super'
  postBodies = []
  postReply = {
    ok: true,
    confirmed: true,
    readAtMs: Date.now(),
    lookupErrors: [],
    subscriptions: [
      {
        id: 'sub_live',
        outcome: 'canceled',
        error: null,
        confirmed: true,
        verified: { ...LIVE, status: 'canceled', terminal: true },
      },
    ],
  }
  ;(globalThis as any).fetch = jest.fn(async (_url: string, init: any = {}) => {
    if ((init.method ?? 'GET') === 'GET') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          subscriptions: [LIVE],
          lookupErrors: [],
          readAtMs: Date.now(),
        }),
      }
    }
    postBodies.push(JSON.parse(init.body))
    return { ok: true, status: 200, json: async () => postReply }
  })
})

const renderCard = () =>
  render(<StaffOrgSubscriptionCard orgId="org1" orgSlug="acme" />)

const headerButton = () =>
  within(screen.getByTestId('card-header')).getByRole('button', {
    name: 'Cancel subscription…',
  })

async function openDialogAndPickReason() {
  await waitFor(() => expect(headerButton()).toHaveProperty('disabled', false))
  fireEvent.click(headerButton())
  const dialog = await screen.findByRole('dialog')
  fireEvent.mouseDown(within(dialog).getByRole('combobox'))
  fireEvent.click(
    await screen.findByRole('option', {
      name: 'Fraud or a stolen payment method',
    }),
  )
  await waitFor(() =>
    expect(screen.queryByRole('listbox', { hidden: true })).toBeNull(),
  )
  return dialog
}

describe('the Subscription card', () => {
  it('lists the plan, status and next renewal, and says there is no refund', async () => {
    renderCard()
    expect(await screen.findByText('pro (monthly)')).toBeTruthy()
    expect(screen.getByText('active')).toBeTruthy()
    expect(screen.getByText(/^Renews /)).toBeTruthy()
    const body = screen.getByTestId('card-body').textContent ?? ''
    expect(body).toMatch(/never refunds/)
    expect(body).toMatch(/Lifting a lockdown does not bring a cancelled subscription back/)
  })

  it('puts the action in the card header', async () => {
    renderCard()
    await waitFor(() => expect(headerButton()).toBeTruthy())
    expect(
      within(screen.getByTestId('card-body')).queryByRole('button', {
        name: 'Cancel subscription…',
      }),
    ).toBeNull()
  })

  it('disables the action for a role the route refuses', async () => {
    mockRole = 'support'
    renderCard()
    await screen.findByText('pro (monthly)')
    expect(headerButton()).toHaveProperty('disabled', true)
  })

  it('posts nothing until the slug is typed exactly', async () => {
    renderCard()
    const dialog = await openDialogAndPickReason()
    const submit = within(dialog).getByRole('button', {
      name: 'Cancel now, no refund',
    })
    expect(submit).toHaveProperty('disabled', true)
    fireEvent.change(within(dialog).getByLabelText('Type "acme" to confirm'), {
      target: { value: 'acm' },
    })
    expect(submit).toHaveProperty('disabled', true)
    fireEvent.change(within(dialog).getByLabelText('Type "acme" to confirm'), {
      target: { value: 'acme' },
    })
    expect(submit).toHaveProperty('disabled', false)
    fireEvent.click(submit)
    await waitFor(() => expect(postBodies).toHaveLength(1))
    expect(postBodies[0]).toEqual({ orgId: 'org1', when: 'now', reason: 'fraud' })
  })

  it('sends period_end when that is chosen', async () => {
    renderCard()
    const dialog = await openDialogAndPickReason()
    fireEvent.click(within(dialog).getByRole('radio', { name: /At period end/ }))
    fireEvent.change(within(dialog).getByLabelText('Type "acme" to confirm'), {
      target: { value: 'acme' },
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel at period end' }),
    )
    await waitFor(() => expect(postBodies).toHaveLength(1))
    expect(postBodies[0].when).toBe('period_end')
  })

  it('shows an unverified result as NOT confirmed, never as a success', async () => {
    postReply = {
      ...postReply,
      confirmed: false,
      subscriptions: [
        {
          id: 'sub_live',
          outcome: 'failed',
          error: 'Stripe is having a moment',
          confirmed: false,
          verified: LIVE,
        },
      ],
    }
    renderCard()
    const dialog = await openDialogAndPickReason()
    fireEvent.change(within(dialog).getByLabelText('Type "acme" to confirm'), {
      target: { value: 'acme' },
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel now, no refund' }),
    )
    expect(await screen.findByText(/NOT confirmed/)).toBeTruthy()
    expect(screen.getByText(/Stripe is having a moment/)).toBeTruthy()
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
      expect.stringMatching(/did NOT verify/),
      expect.objectContaining({ variant: 'error' }),
    )
  })
})

describe('describeRenewal', () => {
  it('never says "renews" about a subscription that will not', () => {
    expect(describeRenewal({ ...LIVE, cancelAtPeriodEnd: true })).toMatch(
      /^Ends .* — no renewal$/,
    )
    expect(
      describeRenewal({
        ...LIVE,
        status: 'canceled',
        terminal: true,
        canceledAt: '2026-09-28T00:00:00.000Z',
      }),
    ).toMatch(/^Ended /)
  })
})
