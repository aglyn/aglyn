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
 * Back from Stripe, and what Stripe still needs (AGL-4245).
 *
 * Stripe's onboarding links return to the Payments section with
 * `?connect=done` (the owner finished or left the form) or `?connect=refresh`
 * (the link had expired). The card shows the result from the live profile,
 * continues an expired link once by itself, and keeps a standing notice while
 * Stripe asks for more before a deadline.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const enqueueSnackbar = jest.fn()
let mockSearch = ''

const profile: { data: unknown; status: string } = {
  data: {},
  status: 'success',
}

const orgPlan = {
  org: { plan: 'business', ownerUid: 'uid-owner' } as unknown,
  ready: true,
}

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useConsoleHostRoute: () => ({ base: null, orgSlug: null, subdomain: null }),
  useFirestore: () => ({}),
  useOrgPlan: () => orgPlan,
  useUser: () => ({
    data: { uid: 'uid-owner', getIdToken: jest.fn().mockResolvedValue('t') },
  }),
  useFirestoreDoc: () => profile,
  useFirestoreCollection: () => ({ data: [] }),
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  doc: () => ({}),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  useConfirmationContext: () => ({ confirm: jest.fn() }),
}))

import PaymentsSettingsCard from './payments-settings-card.component'

const ready = {
  stripeAccountId: 'acct_1',
  stripeChargesEnabled: true,
  stripePayoutsEnabled: true,
  stripeAccountLivemode: true,
  stripeDetailsSubmitted: true,
}

/**
 * jsdom will not navigate, and says so on the console ("Not implemented:
 * navigation"); that report is how a spec sees the card going to Stripe.
 */
let consoleError: jest.SpyInstance
const navigations = () =>
  consoleError.mock.calls.filter((args) =>
    args.some((arg: unknown) => String((arg as Error)?.message ?? arg).includes('navigation')),
  ).length

function answer(body: Record<string, unknown>) {
  ;(globalThis as any).fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  })
}

afterEach(() => consoleError.mockRestore())

beforeEach(() => {
  enqueueSnackbar.mockClear()
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  mockSearch = ''
  profile.data = {}
  profile.status = 'success'
  try {
    window.sessionStorage.clear()
  } catch {
    // no storage in this environment
  }
  answer({ chargesEnabled: false, url: 'https://connect.stripe.com/setup/next' })
})

describe('PaymentsSettingsCard after Stripe (AGL-4245)', () => {
  it('done and ready: says the store is ready', () => {
    mockSearch = 'connect=done'
    profile.data = ready
    render(<PaymentsSettingsCard hostId="host-1" />)
    expect(screen.getByText('Payments are set up. Your store is ready to take payments.')).toBeTruthy()
  })

  it('done part way: still needs a few details, and Continue setup goes back to Stripe', async () => {
    mockSearch = 'connect=done'
    profile.data = { stripeAccountId: 'acct_1', stripeChargesEnabled: false, stripeDetailsSubmitted: false }
    render(<PaymentsSettingsCard hostId="host-1" />)
    expect(
      screen.getByText('Stripe still needs a few details before your store can take payments.'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue setup' }))
    await waitFor(() => expect(navigations()).toBe(1))
  })

  it('refresh: mints a new link and continues by itself, once', async () => {
    mockSearch = 'connect=refresh'
    profile.data = { stripeAccountId: 'acct_1', stripeChargesEnabled: false }
    const { rerender } = render(<PaymentsSettingsCard hostId="host-1" />)
    await waitFor(() => expect(navigations()).toBe(1))
    rerender(<PaymentsSettingsCard hostId="host-1" />)
    expect((globalThis as any).fetch).toHaveBeenCalledTimes(1)
  })

  it('refresh again within the guard: waits for the button instead of looping', async () => {
    mockSearch = 'connect=refresh'
    profile.data = { stripeAccountId: 'acct_1', stripeChargesEnabled: false }
    window.sessionStorage.setItem('aglyn.commerce.connectRefreshAt', String(Date.now()))
    render(<PaymentsSettingsCard hostId="host-1" />)
    expect(screen.getByRole('button', { name: 'Continue setup' })).toBeTruthy()
    expect((globalThis as any).fetch).not.toHaveBeenCalled()
  })

  it('a standing notice while Stripe needs more before a deadline', async () => {
    const deadline = Date.now() + 10 * 24 * 60 * 60 * 1000
    profile.data = { ...ready, stripeRequirementsDueCount: 1, stripeRequirementsDeadlineMs: deadline }
    answer({ chargesEnabled: true, payoutsEnabled: true, needsDetails: true, url: 'https://connect.stripe.com/setup/fix' })
    render(<PaymentsSettingsCard hostId="host-1" />)
    expect(screen.getByText(/^Stripe needs more details by .+ to keep payouts running\.$/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue setup' }))
    await waitFor(() => expect(navigations()).toBe(1))
  })

  it('CONTROL: Refresh status on that account stays a status check', async () => {
    profile.data = { ...ready, stripeRequirementsDueCount: 1 }
    answer({ chargesEnabled: true, payoutsEnabled: true, needsDetails: true, url: 'https://connect.stripe.com/setup/fix' })
    render(<PaymentsSettingsCard hostId="host-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }))
    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(navigations()).toBe(0)
  })

  it('CONTROL: nothing due and no return shows neither', () => {
    profile.data = ready
    render(<PaymentsSettingsCard hostId="host-1" />)
    expect(screen.queryByText(/Stripe needs more details/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continue setup' })).toBeNull()
  })
})
