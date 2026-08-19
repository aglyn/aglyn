/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored (feedback_jest_environment_pragma_shadowed_by_license).
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
 * The asymmetric-friction confirm gate, DRIVEN (AGL-2233, under AGL-1862 /
 * AGL-1859 §2 — Zach's twice-given directive: upgrading is frictionless,
 * downgrading is deliberate).
 *
 * The SERVER half of "a downgrade waits for the period end" is thoroughly
 * pinned by `subscription-downgrade-schedule.spec.ts`. The CLIENT half —
 * "never one-click from the billing card" — was pinned by nothing at all:
 *
 *  - `billing-plan-cards.component.spec.tsx` asserts the lower card reads
 *    `Downgrade` and not `Upgrade`. A card labelled `Downgrade` whose click
 *    posts `action: 'switch'` straight through passes every line of it.
 *  - No spec mounted the billing page. The whole `preview → confirm → switch`
 *    sequence in `handlePlanSelect` was unasserted, so the friction could be
 *    deleted in one edit — drop the `await confirm(...)` — and the suite
 *    stayed green. The `feedback_verify_control_is_wired` shape exactly.
 *
 * So this file mounts the real page, expands the real lower-tier disclosure,
 * clicks the real Downgrade button, and answers the real
 * `/api/billing/subscription` fetches — asserting on what was POSTED.
 *
 * ⚠️ THE NEGATIVE CONTROL THIS FILE EXISTS TO CARRY: a test that asserts only
 * "the confirm appears" ALSO passes when the downgrade is impossible — when
 * the button is inert, when the switch request 500s, when the handler returns
 * early. "Deliberate" and "broken" are indistinguishable from the confirm
 * alone. Every refusal assertion below is therefore paired with a completion
 * assertion: the downgrade DOES go through once the customer confirms.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockEnqueueSnackbar = jest.fn()

/** A paying Pro org — the only shape for which anything below is a DOWNGRADE. */
const ORG = {
  $id: 'org-1',
  plan: 'pro' as const,
  subscription: { status: 'active' },
}

/** The period end every preview quotes, and the date the confirm must name. */
const PERIOD_END_ISO = '2026-09-30T00:00:00.000Z'

/**
 * The confirm gate, controllable.
 *
 * `useConfirmationContext().confirm` RESOLVES on accept and REJECTS on
 * decline — the page reads it as `.then(() => true).catch(() => false)`, so a
 * double that always resolved would make the decline path untestable and, far
 * worse, would make a deleted gate look identical to a confirmed one.
 */
let confirmCalls: Array<Record<string, any>>
let confirmAnswers: boolean[]
/** POSTs seen at the moment the confirm was raised — the "not yet" evidence. */
let postsAtConfirmTime: number

const mockConfirm = jest.fn(async (options: Record<string, any>) => {
  confirmCalls.push(options)
  postsAtConfirmTime = subscriptionCalls.length
  const accept = confirmAnswers.shift()
  if (accept) return undefined
  throw new Error('declined')
})

jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  useLoading: () => ({ queueLoading: () => () => undefined }),
  useConfirmationContext: () => ({ confirm: mockConfirm }),
}))

// `readGaClientId` waits up to 500 ms for gtag before a checkout POST
// (AGL-1561); resolve it immediately so a driven click is not a timer test.
// `trackEvent` is stubbed rather than removed — AGL-2235 fires from this same
// handler and a missing export would be a closed-world TypeError.
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  ...jest.requireActual('@aglyn/aglyn/app-utils/analytics-events'),
  readGaClientId: async () => null,
  trackEvent: jest.fn(),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'u1', getIdToken: async () => 'token' } }),
}))

// The over-limit summary (AGL-483/2154) runs before every confirm. Counting
// zero of everything keeps the confirm copy about the ASYMMETRY, which is what
// this file measures; the warning wording has its own spec.
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
  getDocsFromServer: async () => ({ docs: [], size: 0 }),
}))

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('../hooks/use-org-scope', () => ({ useOrgSlug: () => 'acme' }))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: ORG, orgId: ORG.$id, ready: true }),
}))
jest.mock('../hooks/use-confirmed-doc', () => ({
  __esModule: true,
  default: () => ({ data: undefined }),
}))
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  default: () => ({
    permissions: { editBilling: true },
    can: () => true,
    loaded: true,
  }),
}))
jest.mock('../hooks/use-org-hosts', () => ({ useOrgHosts: () => ({ hosts: [] }) }))
jest.mock('../hooks/use-release-flags', () => ({
  useReleaseFlag: () => ({ visible: false }),
}))
jest.mock('../utils/fetch-seat-counts', () => ({
  __esModule: true,
  default: async () => ({ managerSeats: 1, collaboratorSeats: 0 }),
}))

/**
 * Chrome and sibling cards. The PLAN CARDS stay real — the button this spec
 * clicks is theirs, and a stand-in would be asserting the stand-in. Every
 * sibling below reads its own endpoint and renders a "couldn't load" Alert
 * against the catch-all fetch, which is noise this file does not want.
 */
const passthrough = {
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}
const nullCard = { __esModule: true, default: () => null }
jest.mock('../components/layouts/dashboard.layout', () => passthrough)
jest.mock('../components/layouts/authenticated.layout', () => passthrough)
jest.mock('../components/layouts/main.layout', () => passthrough)
jest.mock('../components/billing/billing-usage.component', () => nullCard)
jest.mock(
  '../components/billing/billing-metered-estimate.component',
  () => nullCard,
)
jest.mock('../components/billing/billing-addons-card.component', () => ({
  __esModule: true,
  default: () => null,
  ADDON_LABELS: {},
}))
jest.mock(
  '../components/billing/billing-storage-overage-card.component',
  () => nullCard,
)
jest.mock(
  '../components/billing/billing-usage-budget-card.component',
  () => nullCard,
)
jest.mock(
  '../components/billing/billing-register-allocations-card.component',
  () => nullCard,
)
jest.mock('../components/embedded-checkout-dialog.component', () => nullCard)
jest.mock('../components/billing/retention-funnel.dialog', () => ({
  __esModule: true,
  RetentionFunnelDialog: () => null,
}))

import BillingPage from '../app/(app)/[orgSlug]/billing/page'

/** Every `/api/billing/subscription` body, in order. */
let subscriptionCalls: Array<Record<string, any>>
/** Per-action answers; `switch` is queued so a failure can be modelled. */
let switchAnswers: Array<{ status: number; payload: unknown }>

beforeEach(() => {
  mockEnqueueSnackbar.mockClear()
  mockConfirm.mockClear()
  confirmCalls = []
  confirmAnswers = []
  subscriptionCalls = []
  switchAnswers = []
  postsAtConfirmTime = -1
  global.fetch = jest.fn(async (input: any, init?: any) => {
    const url = String(input)
    if (url.startsWith('/api/billing/subscription')) {
      const body = JSON.parse(String(init?.body ?? '{}'))
      subscriptionCalls.push(body)
      if (body.action === 'preview') {
        // The server's own downgrade preview shape: $0 today, lands at the
        // period end (`subscription-downgrade-schedule.spec.ts` pins it).
        const downgrade = body.plan === 'starter'
        return {
          ok: true,
          status: 200,
          json: async () => ({
            downgrade,
            amountDueCents: downgrade ? 0 : 4200,
            currency: 'usd',
            periodEnd: PERIOD_END_ISO,
          }),
        }
      }
      if (body.action === 'switch') {
        const answer = switchAnswers.shift() ?? {
          status: 200,
          payload:
            body.plan === 'starter'
              ? {
                  ok: true,
                  scheduled: true,
                  pendingPlan: 'starter',
                  effectiveAt: PERIOD_END_ISO,
                }
              : { ok: true, scheduled: false },
        }
        return {
          ok: answer.status >= 200 && answer.status < 300,
          status: answer.status,
          json: async () => answer.payload,
        }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    }
    // Invoices and anything else the page reaches for on mount.
    return { ok: true, status: 200, json: async () => ({ invoices: [] }) }
  }) as any
})

afterEach(() => {
  jest.restoreAllMocks()
})

/** POSTs that actually changed the subscription, as opposed to priced it. */
const switches = () => subscriptionCalls.filter((c) => c.action === 'switch')
const previews = () => subscriptionCalls.filter((c) => c.action === 'preview')

/**
 * Reveal the collapsed lower tiers and press the target's control.
 *
 * The disclosure click is part of the friction, not test scaffolding: lower
 * tiers are collapsed for a subscriber (AGL-1864), so reaching a downgrade
 * costs a deliberate act before the button even exists. Asserted below.
 */
async function press(label: 'Downgrade' | 'Upgrade') {
  render(<BillingPage />)
  if (label === 'Downgrade') {
    const disclosure = await screen.findByRole('button', {
      name: /Show \d+ lower plans?/,
    })
    fireEvent.click(disclosure)
  }
  const buttons = await screen.findAllByRole('button', { name: label })
  fireEvent.click(buttons[0])
}

describe('a downgrade is never one-click from the billing card (AGL-1859 §2)', () => {
  it('the lower tiers are not even ON SCREEN until the customer asks', async () => {
    render(<BillingPage />)
    // The disclosure exists, and the Downgrade button behind it does not.
    await screen.findByRole('button', { name: /Show \d+ lower plans?/ })
    expect(screen.queryByRole('button', { name: 'Downgrade' })).toBeNull()
  })

  it('the click PRICES the move and changes nothing — the confirm comes first', async () => {
    confirmAnswers = [false]
    await press('Downgrade')
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled())

    // The whole point: at the instant the customer was asked, the server had
    // been asked to PRICE the move and never to make it.
    expect(postsAtConfirmTime).toBe(1)
    expect(previews()).toHaveLength(1)
    expect(previews()[0]).toMatchObject({ action: 'preview', plan: 'starter' })
    expect(switches()).toHaveLength(0)
  })

  it('the confirm states the end-of-cycle terms, not just a yes/no', async () => {
    confirmAnswers = [false]
    await press('Downgrade')
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled())

    const options = confirmCalls[0]
    const said = `${options.title} ${options.description}`
    // Nothing is charged today…
    expect(said).toMatch(/[Nn]othing is charged today/)
    // …the plan they paid for is kept…
    expect(said).toContain('pro')
    // …until a REAL date, read off the server's periodEnd rather than guessed.
    expect(said).toContain(new Date(PERIOD_END_ISO).toLocaleDateString())
    // …and the control is named for what it does, not "OK".
    expect(String(options.confirmationText)).toMatch(/move down/i)
  })

  it('DECLINING sends no switch at all — the friction is real', async () => {
    confirmAnswers = [false]
    await press('Downgrade')
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
    // Settle anything the handler might still have queued behind the confirm.
    await waitFor(() => expect(previews()).toHaveLength(1))
    expect(switches()).toHaveLength(0)
    // And it says nothing reassuring about a move that did not happen.
    expect(mockEnqueueSnackbar).not.toHaveBeenCalled()
  })

  /**
   * ⚠️ NEGATIVE CONTROL — the required one.
   *
   * Every assertion above passes just as happily if the downgrade is
   * IMPOSSIBLE: an inert button, a handler that returns early, a switch route
   * that always 500s. "Deliberate" would then be indistinguishable from
   * "broken", and the suite would defend a feature that does not work.
   */
  it('NEGATIVE CONTROL: confirming COMPLETES the downgrade', async () => {
    confirmAnswers = [true]
    await press('Downgrade')
    await waitFor(() => expect(switches()).toHaveLength(1))

    expect(switches()[0]).toMatchObject({
      action: 'switch',
      plan: 'starter',
      orgId: ORG.$id,
    })
    // Ordering, not just presence: priced, asked, THEN switched.
    expect(subscriptionCalls.map((c) => c.action)).toEqual([
      'preview',
      'switch',
    ])
    // And the customer is told it is SCHEDULED, with the date — the
    // difference between understanding the next invoice and opening a ticket.
    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    const said = String(mockEnqueueSnackbar.mock.calls[0][0])
    expect(said).toContain('starter')
    expect(said).toContain(new Date(PERIOD_END_ISO).toLocaleDateString())
    expect(said).toMatch(/keep your current plan until then/i)
  })

  it('NEGATIVE CONTROL: a REFUSED switch is not reported as a scheduled move', async () => {
    // The other way "deliberate" can hide "broken": the confirm is honoured,
    // the request goes out, the server refuses, and the page congratulates the
    // customer anyway.
    confirmAnswers = [true]
    switchAnswers = [{ status: 409, payload: { error: 'Schedule failed' } }]
    await press('Downgrade')
    await waitFor(() => expect(switches()).toHaveLength(1))
    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    const said = String(mockEnqueueSnackbar.mock.calls[0][0])
    expect(said).toBe('Schedule failed')
    expect(said).not.toMatch(/Moving to/)
  })
})

describe('an upgrade is the frictionless direction (AGL-1859 §2)', () => {
  it('is reachable WITHOUT a disclosure — it is on screen already', async () => {
    render(<BillingPage />)
    const upgrades = await screen.findAllByRole('button', { name: 'Upgrade' })
    expect(upgrades.length).toBeGreaterThan(0)
  })

  it('quotes the prorated charge and applies immediately — not end-of-cycle', async () => {
    confirmAnswers = [true]
    await press('Upgrade')
    await waitFor(() => expect(switches()).toHaveLength(1))

    const said = `${confirmCalls[0].title} ${confirmCalls[0].description}`
    // The asymmetry, stated in the two confirms' own words: an upgrade quotes
    // money today; a downgrade quotes a date.
    expect(said).toMatch(/Prorated charge today: \$42\.00 USD/)
    expect(said).not.toMatch(/[Nn]othing is charged today/)
    expect(String(confirmCalls[0].confirmationText)).toBe('Switch plan')

    // And it lands now, so the page says switched rather than moving.
    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(String(mockEnqueueSnackbar.mock.calls[0][0])).toMatch(
      /^Plan switched to /,
    )
  })
})
