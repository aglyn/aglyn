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
 * A live subscription's switch carries the offer's code (AGL-4160).
 *
 * A workspace that already subscribes, offered another plan with a code — a
 * Billing link's `?coupon=`, or a change staff proposed to it — used to meet
 * checkout's quote, which refuses a live subscription, and a plan switch
 * that ignored the code. The page now shows the change with its code, and
 * Switch prices it through the switch's own preview with the code, says so in
 * the confirm (and that it replaces the discount held now), and sends the
 * code with the switch.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

let mockOrg: Record<string, unknown>
let mockParams = new URLSearchParams()
/** Every confirm the page raised, as it was asked. */
const mockConfirms: Array<{ description: string; confirmationText: string }> = []

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
// The barrel stays real apart from the two contexts the page needs a host for.
jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  useLoading: () => ({ queueLoading: () => () => undefined }),
  useConfirmationContext: () => ({
    confirm: async (options: unknown) => {
      mockConfirms.push(options as { description: string; confirmationText: string })
    },
  }),
}))
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  ...jest.requireActual('@aglyn/aglyn/app-utils/analytics-events'),
  readGaClientId: async () => null,
  trackEvent: jest.fn(),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'u1', getIdToken: async () => 'token' } }),
}))
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), back: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => mockParams,
  usePathname: () => '/acme/billing',
}))
jest.mock('../hooks/use-org-scope', () => {
  // One object, as in the sibling billing specs: a fresh one per call is
  // what manufactured the AGL-2105 render loop.
  const scope = {
    orgs: [],
    currentOrg: null,
    selectOrg: () => undefined,
    orgSlug: null,
    pathOrgSlug: 'acme',
    loading: false,
    confirmed: true,
    slugExists: true,
    error: false,
    retry: () => undefined,
    hasMoreOrgs: false,
    loadMoreOrgs: () => undefined,
  }
  return {
    __esModule: true,
    useOrgSlug: () => 'acme',
    useOrgScope: () => scope,
    default: () => scope,
  }
})
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: mockOrg, orgId: 'org-1', ready: true }),
}))
// The billing doc has landed and holds a LIVE subscription: Starter, monthly.
const mockBillingDoc = {
  data: { subscription: { status: 'active', interval: 'month' } },
  ready: true,
}
jest.mock('@aglyn/tenant-feature-instance/hooks/use-confirmed-doc', () => ({
  __esModule: true,
  default: () => mockBillingDoc,
}))
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  default: () => ({
    permissions: { editBilling: true },
    can: () => true,
    loaded: true,
  }),
}))
jest.mock('../hooks/use-org-hosts', () => ({
  useOrgHosts: () => ({ hosts: [] }),
}))
jest.mock('../hooks/use-release-flags', () => ({
  useReleaseFlag: () => ({ visible: false }),
  useReleaseFlags: () => ({ ready: true, isStaff: false, flags: {} }),
}))
jest.mock('../utils/fetch-seat-counts', () => ({
  __esModule: true,
  default: async () => ({ managerSeats: 1, collaboratorSeats: 0 }),
}))

const passthrough = {
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}
const nullCard = { __esModule: true, default: () => null }
jest.mock('../components/layouts/dashboard.layout', () => passthrough)
jest.mock('../components/layouts/authenticated.layout', () => passthrough)
jest.mock('../components/layouts/main.layout', () => passthrough)
jest.mock('../components/billing/billing-usage.component', () => nullCard)
jest.mock('../components/billing/billing-metered-estimate.component', () => nullCard)
jest.mock('../components/billing/billing-addons-card.component', () => ({
  __esModule: true,
  default: () => null,
  ADDON_LABELS: {},
}))
jest.mock('../components/billing/billing-storage-overage-card.component', () => nullCard)
jest.mock('../components/billing/billing-usage-budget-card.component', () => nullCard)
jest.mock('../components/org-upgrade-proposal-card.component', () => nullCard)
// The probe: what the page hands the quote is the whole question here. The
// quote's own handling of `initialCoupon` is driven in
// `billing-quote-bundle-addons.spec.tsx`.
jest.mock('../components/billing/billing-plan-quote.component', () => ({
  __esModule: true,
  default: (props: { plan: string; interval: string; initialCoupon?: string | null }) => (
    <div
      data-testid="quote"
      data-plan={props.plan}
      data-interval={props.interval}
      data-coupon={props.initialCoupon ?? ''}
    />
  ),
}))

import BillingPage from '../app/(app)/[orgSlug]/billing/(sections)/page'
import { switchCodeSentence } from '../utils/proration-quote'

/** Bodies the page posted to `/api/billing/subscription`, in order. */
let switchBodies: Array<Record<string, unknown>>
/** What the switch preview answers for a request carrying a code. */
let codeAnswer: { status: number; body: Record<string, unknown> }

const PRICED_WITH_CODE = {
  prorationCents: 35280,
  prorationTaxCents: 0,
  chargesNow: true,
  chargedNowCents: 35280,
  taxComplete: true,
  taxReason: 'not_collecting',
  currency: 'usd',
  periodEnd: '2026-12-01T00:00:00.000Z',
  droppedAddons: [],
  promotionCodeApplied: 'PRO40',
  promotionCodeDuration: 'repeating',
  promotionCodeDurationInMonths: 12,
  promotionCodePercentOff: 40,
  promotionCodeBasePriceOnly: false,
  promotionCodeReplacesDiscount: true,
}
const PRICED_AT_LIST = {
  ...PRICED_WITH_CODE,
  prorationCents: 58800,
  chargedNowCents: 58800,
  promotionCodeApplied: undefined,
  promotionCodeDuration: undefined,
  promotionCodeDurationInMonths: undefined,
  promotionCodePercentOff: undefined,
  promotionCodeReplacesDiscount: undefined,
}

beforeEach(() => {
  mockParams = new URLSearchParams('plan=pro&interval=year&coupon=PRO40')
  mockOrg = { $id: 'org-1', plan: 'starter', billingStatus: 'active', discount: { percentOff: 100 } }
  mockConfirms.length = 0
  switchBodies = []
  codeAnswer = { status: 200, body: PRICED_WITH_CODE }
  global.fetch = jest.fn(async (url: unknown, init: any) => {
    if (String(url).includes('/api/billing/subscription')) {
      const body = JSON.parse(String(init?.body ?? '{}'))
      switchBodies.push(body)
      if (body.action === 'preview') {
        const answer = body.promotionCode ? codeAnswer : { status: 200, body: PRICED_AT_LIST }
        return { ok: answer.status < 400, status: answer.status, json: async () => answer.body }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, plan: 'pro' }) }
    }
    return { ok: true, status: 200, json: async () => ({ invoices: [] }) }
  }) as never
})

afterEach(() => {
  jest.restoreAllMocks()
})

const switchButton = () => screen.findByRole('button', { name: 'Switch to Pro' })

describe('AGL-4160 · a live subscription switches with the offer’s code', () => {
  it('shows the change with its code, not checkout’s quote', async () => {
    render(<BillingPage />)
    await switchButton()
    expect(screen.queryByTestId('quote')).toBeNull()
    expect(screen.getByText('Pro, billed yearly, code PRO40')).toBeTruthy()
  })

  it('prices the switch with the code, says so, and sends it with the switch', async () => {
    render(<BillingPage />)
    fireEvent.click(await switchButton())
    await waitFor(() => expect(switchBodies.map((body) => body.action)).toEqual(['preview', 'switch']))
    expect(switchBodies[0]).toMatchObject({
      action: 'preview',
      plan: 'pro',
      interval: 'year',
      promotionCode: 'PRO40',
    })
    // The discounted figure, and what the code is and replaces.
    expect(mockConfirms[0].description).toContain("You'll be charged $352.80 USD now")
    expect(mockConfirms[0].description).toContain(
      'Code PRO40 takes 40% off Pro for the next 12 months, in place of the discount you ' +
        'have now; the amount above already includes it.',
    )
    expect(switchBodies[1]).toMatchObject({ action: 'switch', plan: 'pro', promotionCode: 'PRO40' })
  })

  it('carries a change staff proposed to the subscriber, with no link', async () => {
    mockParams = new URLSearchParams()
    mockOrg = {
      ...mockOrg,
      upgradeProposal: {
        plan: 'pro',
        interval: 'year',
        coupon: 'PRO40',
        proposedBy: 'staff-1',
        proposedAt: 1,
        forSubscriber: true,
      },
    }
    render(<BillingPage />)
    fireEvent.click(await switchButton())
    await waitFor(() => expect(switchBodies).toHaveLength(2))
    expect(switchBodies[0].promotionCode).toBe('PRO40')
    expect(switchBodies[1].promotionCode).toBe('PRO40')
  })

  it('leaves a code the switch refuses off, says why, and switches at the price shown', async () => {
    codeAnswer = {
      status: 400,
      body: { error: 'This code is for the Starter plan.', promotionCodeRefusal: 'plan' },
    }
    render(<BillingPage />)
    fireEvent.click(await switchButton())
    await waitFor(() => expect(switchBodies.map((body) => body.action)).toEqual(['preview', 'preview', 'switch']))
    expect(switchBodies[1].promotionCode).toBeUndefined()
    expect(mockConfirms[0].description).toContain("You'll be charged $588.00 USD now")
    expect(mockConfirms[0].description).toContain(
      'Code PRO40 was left off: This code is for the Starter plan.',
    )
    expect(switchBodies[2].promotionCode).toBeUndefined()
  })
})

describe('switchCodeSentence', () => {
  it('says nothing when the switch carries no code', () => {
    expect(switchCodeSentence({}, 'pro')).toBe('')
  })
  it('names a base-price code’s reach and what still bills', () => {
    expect(
      switchCodeSentence(
        {
          promotionCodeApplied: 'PROBASE',
          promotionCodePercentOff: 100,
          promotionCodeDuration: 'forever',
          promotionCodeBasePriceOnly: true,
        },
        'pro',
      ),
    ).toBe(
      ' Code PROBASE takes 100% off Pro’s base price for as long as you subscribe; the amount ' +
        'above already includes it. Add-ons and usage past the plan’s limits bill as usual.',
    )
  })
  it('states an amount off on the next charge only', () => {
    expect(
      switchCodeSentence(
        { promotionCodeApplied: 'TEN', promotionCodeAmountOffUsd: 10, promotionCodeDuration: 'once' },
        'starter',
      ),
    ).toBe(' Code TEN takes $10.00 off Starter on the next charge only; the amount above already includes it.')
  })
})
