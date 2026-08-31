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
 * AGL-1859 §2 — the twice-given directive: upgrading is frictionless,
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
 * So this file mounts the real page, opens the real comparison grid, expands
 * the real lower-tier disclosure, clicks the real Downgrade button, and
 * answers the real `/api/billing/subscription` fetches — asserting on what was
 * POSTED.
 *
 * ⚠️ THE FRICTION THAT MATTERS IS THE CONFIRM, NOT THE TWO CLICKS. The clicks
 * are real friction and are asserted, but a page that dropped them and kept
 * the confirm would still be honest, where one that kept them and dropped the
 * confirm would post a plan change nobody agreed to. That is why every case
 * below drives the confirm rather than counting clicks.
 *
 * ⚠️ THE NEGATIVE CONTROL THIS FILE EXISTS TO CARRY: a test that asserts only
 * "the confirm appears" ALSO passes when the downgrade is impossible — when
 * the button is inert, when the switch request 500s, when the handler returns
 * early. "Deliberate" and "broken" are indistinguishable from the confirm
 * alone. Every refusal assertion below is therefore paired with a completion
 * assertion: the downgrade DOES go through once the customer confirms.
 */

import {
  PLATFORM_BRAND_NAME,
  PLATFORM_SUPPORT_URL,
} from '@aglyn/aglyn/app-utils/platform-brand'
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

/**
 * `trackEvent` is CAPTURED, not merely stubbed (AGL-2235).
 *
 * Under jsdom the real `trackEvent` finds no transport and no `window.gtag`,
 * so it no-ops — which is exactly why the funnel's four events could be
 * deleted silently before AGL-1865 pinned them. The same hole would swallow
 * these two, so the double is asserted against.
 */
const mockTrackEvent = jest.fn()
// `readGaClientId` waits up to 500 ms for gtag before a checkout POST
// (AGL-1561); resolve it immediately so a driven click is not a timer test.
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  ...jest.requireActual('@aglyn/aglyn/app-utils/analytics-events'),
  readGaClientId: async () => null,
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
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

/**
 * `useBranding` (AGL-2319 gave this surface its brand-aware copy). Mocked
 * NARROWLY — the module's one default export and one named export — for the
 * reason `white-label-tab-title.spec.tsx` states: the real hook reaches
 * `use-secondary-nav`, which pulls in the console plugin gate, the Firebase
 * services provider and `next/navigation`, a module graph a card's unit test
 * has no business loading. The value is `PLATFORM_BRANDING_PROFILE` rebuilt
 * from its own two constants — literally what `resolveBrandingProfile` returns
 * for an org that is not white-label — and it is a module-level singleton, so
 * a consumer memoizing on the object cannot be made to loop (AGL-2365).
 */
const mockBranding = {
  branding: {
    productName: PLATFORM_BRAND_NAME,
    logoUrl: null,
    faviconUrl: null,
    primaryColor: null,
    supportUrl: PLATFORM_SUPPORT_URL,
    fromName: PLATFORM_BRAND_NAME,
    emailLogoUrl: null,
    customConsoleDomain: null,
  },
  whiteLabel: false,
  ready: true,
}

jest.mock('../hooks/use-branding', () => ({
  __esModule: true,
  useBranding: () => mockBranding,
  default: () => mockBranding,
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
jest.mock('../components/billing/retention-funnel.dialog', () => ({
  __esModule: true,
  RetentionFunnelDialog: () => null,
}))

import BillingPage from '../app/(app)/[orgSlug]/billing/(sections)/page'

/** Every `/api/billing/subscription` body, in order. */
let subscriptionCalls: Array<Record<string, any>>
/** Per-action answers; `switch` is queued so a failure can be modelled. */
let switchAnswers: Array<{ status: number; payload: unknown }>

beforeEach(() => {
  mockEnqueueSnackbar.mockClear()
  mockConfirm.mockClear()
  mockTrackEvent.mockClear()
  confirmCalls = []
  confirmAnswers = []
  subscriptionCalls = []
  switchAnswers = []
  postsAtConfirmTime = -1
  global.fetch = jest.fn(async (input: any, init?: any) => {
    const url = String(input)
    // The billing profile the plan grid gates on (AGL-2501 follow-up): a paid
    // upgrade needs a stored card AND a billing address, because subscribing
    // charges the one against the other. Without this the grid correctly
    // DISABLES every Upgrade button and no confirm can ever open — which is
    // the gate working, not the page failing.
    if (url.startsWith('/api/billing/profile')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          configured: true,
          customer: {
            email: 'owner@example.com',
            name: 'Acme',
            address: { line1: '1 Example St', line2: '', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
          },
          taxIds: [],
          paymentMethods: [
            { id: 'pm_1', type: 'card', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030, email: null, isDefault: true },
          ],
        }),
      }
    }
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
            // BOTH fields, as the route really answers since AGL-535.
            // `prorationCents` is the cost of the change; `amountDueCents` is
            // the whole upcoming invoice, and quoting THAT was the bug the
            // confirm carried for a release after the preview was fixed.
            prorationCents: downgrade ? 0 : 4200,
            amountDueCents: downgrade ? 0 : 12900,
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
 * TWO deliberate acts, and neither is scaffolding: the page opens on the
 * current plan and the step up (AGL-1859 §1), so the grid has to be asked for
 * before the disclosure holding the lower tiers even exists, and the
 * disclosure has to be opened before any control that moves a customer DOWN
 * does. Both are asserted below.
 */
async function press(label: 'Downgrade' | 'Upgrade') {
  render(<BillingPage />)
  if (label === 'Downgrade') {
    fireEvent.click(await screen.findByRole('button', { name: /Compare all/ }))
    fireEvent.click(
      await screen.findByRole('button', { name: /Show \d+ lower plans?/ }),
    )
  }
  const buttons = await screen.findAllByRole('button', {
    // The focused view names its destination ("Upgrade to Pro"); the grid
    // says just "Upgrade". Anchored so `Downgrade` can never satisfy a
    // search for `Upgrade`.
    name: label === 'Downgrade' ? /^Downgrade/ : /^Upgrade/,
  })
  fireEvent.click(buttons[0])
}

describe('a downgrade is never one-click from the billing card (AGL-1859 §2)', () => {
  it('the lower tiers are not even ON SCREEN until the customer asks', async () => {
    render(<BillingPage />)
    // Not the disclosure, and not the tiers behind it: the page opens on the
    // current plan and the step up, so a downgrade is two asks away.
    await screen.findByRole('button', { name: /Compare all/ })
    expect(
      screen.queryByRole('button', { name: /Show \d+ lower plans?/ }),
    ).toBeNull()
    expect(screen.queryByRole('button', { name: /^Downgrade/ })).toBeNull()
  })

  it('and the collapse is still there once the grid is asked for', async () => {
    render(<BillingPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Compare all/ }))
    // The AGL-1864 collapse is the grid's arrival state: the lower tiers are
    // folded, never removed, so the downsell stays reachable and named.
    await screen.findByRole('button', { name: /Show \d+ lower plans?/ })
    expect(screen.queryByRole('button', { name: /^Downgrade/ })).toBeNull()
  })

  /**
   * ⚠️ REACHABLE IS NOT THE SAME AS LOUD.
   *
   * Two clicks in, the control exists — and it is still the quiet one. A
   * grid that answered "there is no way down" by promoting the downgrade to
   * a contained button beside the upgrade would be the dark pattern pointed
   * the other way.
   */
  it('a revealed Downgrade is still a quiet control, never the loud one', async () => {
    render(<BillingPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Compare all/ }))
    fireEvent.click(
      await screen.findByRole('button', { name: /Show \d+ lower plans?/ }),
    )
    const downgrade = (
      await screen.findAllByRole('button', { name: /^Downgrade/ })
    )[0]
    expect(downgrade.className).toMatch(/MuiButton-text/)
    expect(downgrade.className).not.toMatch(/MuiButton-contained/)
    const upgrade = screen.getAllByRole('button', { name: /^Upgrade/ })[0]
    expect(upgrade.className).toMatch(/MuiButton-contained/)
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
    const upgrades = await screen.findAllByRole('button', { name: /^Upgrade/ })
    expect(upgrades.length).toBeGreaterThan(0)
  })

  it('quotes the PRORATION on the next invoice, and applies immediately', async () => {
    confirmAnswers = [true]
    await press('Upgrade')
    await waitFor(() => expect(switches()).toHaveLength(1))

    const said = `${confirmCalls[0].title} ${confirmCalls[0].description}`
    // The asymmetry, stated in the two confirms' own words: an upgrade quotes
    // money, a downgrade quotes a date. What changed in AGL-535 part two is
    // WHICH money and WHEN — the proration, on the next invoice, because
    // `create_prorations` takes nothing at the switch.
    expect(said).toMatch(/\$42\.00 USD/)
    expect(said).toMatch(/next invoice/)
    // The upcoming-invoice total must not appear: that was the overstatement.
    expect(said).not.toMatch(/129\.00/)
    expect(said).not.toMatch(/charge today/)
    expect(said).not.toMatch(/[Nn]othing is charged today/)
    expect(String(confirmCalls[0].confirmationText)).toBe('Switch plan')

    // And it lands now, so the page says switched rather than moving.
    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(String(mockEnqueueSnackbar.mock.calls[0][0])).toMatch(
      /^Plan switched to /,
    )
  })
})

/**
 * The grid's half of the funnel instrumentation (AGL-2235, AGL-1859 §4).
 *
 * `downsell_accepted` and friends fire from `retention-funnel.dialog.tsx`
 * only. The identical move made from the plan card reported nothing, so the
 * downsell number read as a total while being a fraction — and a save rate
 * computed against it errs in the flattering direction.
 */
describe('a plan change from the grid is reported to GA4 (AGL-2235)', () => {
  /** The `[name, params]` pairs, so an assertion can name the event. */
  const events = () =>
    mockTrackEvent.mock.calls.map(
      ([name, params]) => [name, params] as [string, Record<string, unknown>],
    )
  const eventNamed = (name: string) =>
    events().find(([sent]) => sent === name)?.[1]

  it('a scheduled downgrade names BOTH tiers and WHEN it lands', async () => {
    confirmAnswers = [true]
    await press('Downgrade')
    await waitFor(() => expect(mockTrackEvent).toHaveBeenCalled())

    expect(eventNamed('plan_downgrade_scheduled')).toEqual({
      from_plan: 'pro',
      to_plan: 'starter',
      interval: 'month',
      // The SERVER's date, which is the difference between a decision and an
      // effect — and the window in which "keep my plan" can still save them.
      effective_at: PERIOD_END_ISO,
    })
    // Never reported as an upgrade as well; they are opposite facts.
    expect(eventNamed('plan_upgraded')).toBeUndefined()
  })

  it('an in-place upgrade is reported too — expansion revenue was dark', async () => {
    // `purchase` only covers the Checkout path, so a subscriber moving UP
    // minted no event at all before this.
    confirmAnswers = [true]
    await press('Upgrade')
    await waitFor(() => expect(mockTrackEvent).toHaveBeenCalled())

    const params = eventNamed('plan_upgraded')
    expect(params).toMatchObject({ from_plan: 'pro', interval: 'month' })
    expect(String(params?.to_plan)).not.toBe('pro')
    // An upgrade lands now, so it carries no effective date to explain away.
    expect(params).not.toHaveProperty('effective_at')
    expect(eventNamed('plan_downgrade_scheduled')).toBeUndefined()
  })

  it('the names are in the shared taxonomy — an unregistered event is dropped', () => {
    // Registration is not decoration: `trackEvent` sanitizes against
    // `ANALYTICS_EVENT_NAMES`, so a name that is emitted but unregistered
    // reports nothing while every call site looks correct.
    const {
      ANALYTICS_EVENT_NAMES,
    } = jest.requireActual('@aglyn/aglyn/app-utils/analytics-events')
    expect(ANALYTICS_EVENT_NAMES).toContain('plan_downgrade_scheduled')
    expect(ANALYTICS_EVENT_NAMES).toContain('plan_upgraded')
    // `app_upgrade` is GA4-RESERVED — a hit using it is DROPPED, which is
    // silence rather than pollution and therefore the harder failure to spot.
    expect(ANALYTICS_EVENT_NAMES).not.toContain('app_upgrade')
  })

  it('NEGATIVE CONTROL: a DECLINED downgrade reports nothing', async () => {
    // The event has to mean "this happened", not "this was considered".
    confirmAnswers = [false]
    await press('Downgrade')
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
    await waitFor(() => expect(previews()).toHaveLength(1))
    expect(eventNamed('plan_downgrade_scheduled')).toBeUndefined()
  })

  it('NEGATIVE CONTROL: a switch the SERVER refused reports nothing', async () => {
    confirmAnswers = [true]
    switchAnswers = [{ status: 409, payload: { error: 'Schedule failed' } }]
    await press('Downgrade')
    await waitFor(() => expect(switches()).toHaveLength(1))
    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(eventNamed('plan_downgrade_scheduled')).toBeUndefined()
    expect(eventNamed('plan_upgraded')).toBeUndefined()
  })
})

/**
 * A paid upgrade ANNOUNCES what it will ask for. It does not refuse.
 *
 * Subscribing is a server-side call against a stored payment method and a
 * stored billing address, and `/api/billing/checkout` refuses without either.
 * That refusal is the enforcement and it is untouched — what changed is what
 * the grid does with the same facts. It used to disable Upgrade and name two
 * cards on another screen; now the button stays live and opens a flow that
 * collects the missing pieces, so this caption is a heads-up about the next
 * screen rather than homework.
 *
 * These assertions are on RENDERED TEXT because the caption is the whole
 * feature here. The behaviour that matters — that the click subscribes, that
 * the collected card is stored, that the server still refuses — is asserted
 * against calls and state in `billing-upgrade-collects-in-flow.spec.tsx`.
 */
describe('the plan grid announces what an upgrade will collect', () => {
  /** Re-mount with a billing profile that is missing something. */
  function renderWithProfile(profile: Record<string, unknown>) {
    const real = global.fetch as any
    global.fetch = jest.fn(async (input: any, init?: any) => {
      if (String(input).startsWith('/api/billing/profile')) {
        return { ok: true, status: 200, json: async () => profile }
      }
      return real(input, init)
    }) as any
    render(<BillingPage />)
  }

  const CARD = {
    id: 'pm_1',
    type: 'card',
    brand: 'visa',
    last4: '4242',
    expMonth: 12,
    expYear: 2030,
    email: null,
    isDefault: true,
  }
  const ADDRESS = {
    line1: '1 Example St',
    line2: '',
    city: 'Austin',
    state: 'TX',
    postalCode: '78701',
    country: 'US',
  }

  it('names BOTH when neither is on file', async () => {
    renderWithProfile({
      configured: true,
      customer: { email: 'a@b.c', name: 'Acme', address: null },
      taxIds: [],
      paymentMethods: [],
    })
    // On every upgradeable tier, which is the point: the sentence belongs
    // beside each button it disables, not once at the top where a reader
    // scrolling the grid never meets it.
    expect(
      (await screen.findAllByText(/a payment method and a billing address/i))
        .length,
    ).toBeGreaterThan(0)
  })

  it('names the CARD when only the address is on file', async () => {
    renderWithProfile({
      configured: true,
      customer: { email: 'a@b.c', name: 'Acme', address: ADDRESS },
      taxIds: [],
      paymentMethods: [],
    })
    const said = (await screen.findAllByText(/ask for a payment method as you go/i))[0]
    expect(said).toBeTruthy()
    expect(said.textContent).not.toMatch(/billing address/i)
  })

  it('names the ADDRESS when only the card is on file, and says why', async () => {
    // The address is a TAX input, and saying so is what stops it reading as
    // bureaucracy.
    renderWithProfile({
      configured: true,
      customer: { email: 'a@b.c', name: 'Acme', address: null },
      taxIds: [],
      paymentMethods: [CARD],
    })
    const said = (await screen.findAllByText(/ask for a billing address as you go/i))[0]
    expect(said.textContent).toMatch(/sales tax is calculated from it/i)
  })

  it('leaves the paid button LIVE with nothing on file', async () => {
    // The reversal, stated as a test. The old assertion here was that the
    // button was disabled; a customer who wants to buy is now taken through
    // the missing pieces instead of being turned away at the button.
    renderWithProfile({
      configured: true,
      customer: { email: 'a@b.c', name: 'Acme', address: null },
      taxIds: [],
      paymentMethods: [],
    })
    await screen.findAllByText(/a payment method and a billing address/i)
    const upgrades = await screen.findAllByRole('button', { name: /^Upgrade/ })
    expect(upgrades[0].hasAttribute('disabled')).toBe(false)
  })

  it('CONTROL — a workspace with both is told nothing at all', async () => {
    // Without this, a grid that printed the caption unconditionally would
    // satisfy every assertion above.
    renderWithProfile({
      configured: true,
      customer: { email: 'a@b.c', name: 'Acme', address: ADDRESS },
      taxIds: [],
      paymentMethods: [CARD],
    })
    const upgrades = await screen.findAllByRole('button', { name: /^Upgrade/ })
    expect(upgrades[0].hasAttribute('disabled')).toBe(false)
    expect(screen.queryByText(/as you go/i)).toBeNull()
  })
})
