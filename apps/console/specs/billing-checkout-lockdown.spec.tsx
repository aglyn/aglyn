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
 * The billing page's checkout lockdown, DRIVEN (AGL-1557).
 *
 * Three specs already stand around this behaviour and none of them can see
 * the defect it exists to stop:
 *
 *  - `libs/aglyn/src/lib/app-utils/lockdown.spec.ts` pins the parser's copy;
 *  - `apps/console/specs/lockdown-notice-component.spec.tsx` (AGL-1558)
 *    mounts `LockdownNotice` in isolation and pins its rendering contract;
 *  - `apps/console/specs/lockdown-client-notice.spec.ts` pins this page at
 *    its DECLARATION — it greps the source for `parseLockdownRefusal(` and
 *    `<LockdownNotice`.
 *
 * All three pass on a page that parses the refusal, keeps the component
 * import, and then falls through to `Could not start checkout` anyway — the
 * "computed but not wired" shape. That toast is the whole reason the notice
 * exists: it tells a customer mid-upgrade that their PAYMENT failed, so they
 * retry, check their card, and email support about a charge that never
 * happened. The server's 423 body says the opposite in so many words.
 *
 * So this file mounts the real page, clicks the real Upgrade button on the
 * real plan card, and answers the real `/api/billing/checkout` fetch with a
 * real 423 — asserting on the DOM the customer would be looking at.
 *
 * FIXTURES: every 423 body is assembled from `lockdownNotice` the way
 * `lockdownJsonResponse` assembles it and read back through the real
 * `parseLockdownRefusal`. Nothing here hand-types notice copy — a spec that
 * asserts against a transcribed string passes when the wire shape drifts,
 * which is precisely the failure the file is guarding.
 */

import {
  lockdownNotice,
  lockdownRefusalText,
  parseLockdownRefusal,
  SELF_SERVE_PLANS,
  type LockdownRefusalNotice,
  type LockdownState,
} from '@aglyn/aglyn'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockEnqueueSnackbar = jest.fn()

/** The org the page renders for: no subscription, so Upgrade means checkout. */
const ORG = { $id: 'org-1', plan: 'free' as const }

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

/**
 * The barrel is kept REAL apart from the two contexts the page needs a host
 * for. `GridItems` in particular has to be the real one: this spec asserts
 * the notice lands ABOVE the plan cards, and that ordering is `GridItems`
 * rendering the page's `items` array in order. A hand-rolled stand-in would
 * be asserting the stand-in.
 */
jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  useLoading: () => ({ queueLoading: () => () => undefined }),
  useConfirmationContext: () => ({ confirm: async () => undefined }),
}))

// `readGaClientId` waits up to 500 ms for gtag before every checkout POST
// (AGL-1561); resolve it immediately so the driven click is not a timer test.
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
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('../hooks/use-org-scope', () => ({
  useOrgSlug: () => 'acme',
}))
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
jest.mock('../hooks/use-org-hosts', () => ({
  useOrgHosts: () => ({ hosts: [] }),
}))
jest.mock('../hooks/use-release-flags', () => ({
  useReleaseFlag: () => ({ visible: false }),
}))
jest.mock('../utils/fetch-seat-counts', () => ({
  __esModule: true,
  default: async () => ({ managerSeats: 1, collaboratorSeats: 0 }),
}))

/**
 * The chrome and the sibling cards. Each reads its own data and none of them
 * is on the path from an Upgrade click to the notice; the PLAN CARDS are
 * deliberately left real, because the button this spec clicks is theirs.
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
// AGL-1957's card joined the page after this spec was written and was the one
// sibling left real. It reads `/api/billing/storage-overage`, which the
// catch-all below answers with the invoices shape, so its state stays empty and
// it renders its "we couldn't load your storage settings" Alert — a second
// `role="alert"` on the page, which is fatal here: this spec identifies the
// notice BY that role, so every assertion either matched two elements or found
// one where it required none.
jest.mock(
  '../components/billing/billing-storage-overage-card.component',
  () => nullCard,
)
// AGL-1528's budget card is the same shape and the same hazard: it reads
// `/api/billing/usage-budget`, the catch-all below answers with the invoices
// shape, and it renders its own "we couldn't load" Alert — a THIRD
// `role="alert"` on the page. Stubbed for the same reason as its sibling
// above, and it will keep being the reason for every card added here.
jest.mock(
  '../components/billing/billing-usage-budget-card.component',
  () => nullCard,
)
jest.mock('../components/embedded-checkout-dialog.component', () => nullCard)

import BillingPage from '../app/(app)/[orgSlug]/billing/page'

/**
 * The 423 body a chokepoint actually emits, mirroring `lockdownJsonResponse`
 * — which lives in the admin lib and drags the Admin SDK in with it. The body
 * construction is the part that matters, and it is one spread of
 * `lockdownNotice`, the same pure builder the server calls.
 */
function refusalBody(state: LockdownState): Record<string, unknown> {
  const notice = lockdownNotice(state)
  return {
    error: 'locked',
    scope: state.scope,
    ...(state.feature ? { feature: state.feature } : {}),
    reason: state.reason,
    title: notice.title,
    message: notice.body,
    ...(notice.contact ? { contact: notice.contact } : {}),
    ...(typeof state.untilMs === 'number' ? { untilMs: state.untilMs } : {}),
  }
}

function parsed(state: LockdownState): LockdownRefusalNotice {
  const notice = parseLockdownRefusal(423, refusalBody(state))
  if (!notice) throw new Error('a 423 must always parse to a notice')
  return notice
}

const CHECKOUT_LOCK: LockdownState = {
  scope: 'feature',
  feature: 'checkout',
  reason: 'manual',
}

/** Queued `/api/billing/checkout` answers, consumed one per click. */
let checkoutAnswers: Array<{ status: number; payload: unknown }>
let checkoutCalls: Array<Record<string, unknown>>

function answerCheckout(...answers: Array<{ status: number; payload: unknown }>) {
  checkoutAnswers = answers
}

beforeEach(() => {
  mockEnqueueSnackbar.mockClear()
  checkoutAnswers = []
  checkoutCalls = []
  global.fetch = jest.fn(async (input: any, init?: any) => {
    const url = String(input)
    if (url.startsWith('/api/billing/checkout')) {
      checkoutCalls.push(JSON.parse(String(init?.body ?? '{}')))
      const answer = checkoutAnswers.shift()
      if (!answer) throw new Error(`unqueued checkout call: ${url}`)
      return {
        ok: answer.status >= 200 && answer.status < 300,
        status: answer.status,
        json: async () => answer.payload,
      }
    }
    // Invoices and anything else the page reaches for on mount.
    return { ok: true, status: 200, json: async () => ({ invoices: [] }) }
  }) as any
})

afterEach(() => {
  jest.restoreAllMocks()
})

/** The first self-serve tier above Free — the one whose Upgrade is clicked. */
const TARGET_PLAN = SELF_SERVE_PLANS.filter((plan) => plan !== 'free')[0]

async function clickUpgrade() {
  render(<BillingPage />)
  const upgrades = await screen.findAllByRole('button', { name: 'Upgrade' })
  fireEvent.click(upgrades[0])
  await waitFor(() => {
    expect(checkoutCalls.length).toBeGreaterThan(0)
  })
}

/** The refusal is answered by the CHECKOUT route, not by some other fetch. */
function expectCheckoutAttempt() {
  expect(checkoutCalls[0]).toMatchObject({ plan: TARGET_PLAN, orgId: ORG.$id })
}

describe('AGL-1557 · a 423 from /api/billing/checkout renders the notice in the page', () => {
  it('puts the whole notice in the DOM, not a toast', async () => {
    const notice = parsed(CHECKOUT_LOCK)
    answerCheckout({ status: 423, payload: refusalBody(CHECKOUT_LOCK) })
    await clickUpgrade()
    expectCheckoutAttempt()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(notice.title)
    expect(alert.textContent).toContain(notice.message)

    // The failure this whole affordance exists to prevent: the customer is
    // told their PAYMENT failed by a page that was just told otherwise.
    const said = mockEnqueueSnackbar.mock.calls.map((call) => String(call[0]))
    expect(said).not.toContain('Could not start checkout')
    // …and not as a snackbar in any wording, either — this surface renders it.
    expect(said).not.toContain(lockdownRefusalText(notice))
    expect(said).toEqual([])
  })

  it('carries the mailto: contact the one-line flattener drops', async () => {
    const notice = parsed(CHECKOUT_LOCK)
    // The premise, restated where it is being fixed: the flattener every
    // snackbar surface uses loses the support address entirely.
    expect(notice.contact).toBeTruthy()
    expect(lockdownRefusalText(notice)).not.toContain(notice.contact as string)

    answerCheckout({ status: 423, payload: refusalBody(CHECKOUT_LOCK) })
    await clickUpgrade()

    const link = await screen.findByRole('link', {
      name: notice.contact as string,
    })
    expect(link.getAttribute('href')).toBe(`mailto:${notice.contact}`)
  })

  it('carries the expected-back line, on the reader’s own clock', async () => {
    const untilMs = Date.parse('2026-09-01T12:00:00Z')
    const locked = { ...CHECKOUT_LOCK, untilMs }
    const notice = parsed(locked)
    expect(notice.until).toMatch(/^Expected back around /)

    answerCheckout({ status: 423, payload: refusalBody(locked) })
    await clickUpgrade()

    expect(await screen.findByText(notice.until as string)).toBeTruthy()
    // Never the server's UTC blob, which is what the parser strips it for.
    expect(
      screen.queryByText(new Date(untilMs).toUTCString(), { exact: false }),
    ).toBeNull()
  })

  it('lands ABOVE the plan cards — where the button they just pressed is', async () => {
    answerCheckout({ status: 423, payload: refusalBody(CHECKOUT_LOCK) })
    await clickUpgrade()

    const alert = await screen.findByRole('alert')
    // `id="plans"` is the plan-card grid's own anchor.
    const plans = document.getElementById('plans')
    expect(plans).toBeTruthy()
    // A notice rendered below four plan cards is off-screen for the person
    // who just clicked one of them.
    expect(
      alert.compareDocumentPosition(plans as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('a staff-typed message still reaches the page whole', async () => {
    // `message` is the only field staff can type; `title` and `contact` are
    // per-reason constants precisely so a hurried staff member cannot strip
    // the support address. Verified through the real page, not the component.
    const locked = {
      ...CHECKOUT_LOCK,
      message: 'Back once the payment provider incident clears.',
    }
    const notice = parsed(locked)
    answerCheckout({ status: 423, payload: refusalBody(locked) })
    await clickUpgrade()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(
      'Back once the payment provider incident clears.',
    )
    expect(alert.textContent).toContain(notice.title)
    expect(
      screen.getByRole('link', { name: notice.contact as string }),
    ).toBeTruthy()
  })
})

describe('AGL-1557 · the notice appears only when the server refuses', () => {
  it('a 200 checkout renders no notice at all', async () => {
    // The negative control. Without it every assertion above passes against a
    // page that renders the notice unconditionally.
    answerCheckout({ status: 200, payload: { clientSecret: 'cs_test_123' } })
    await clickUpgrade()
    await waitFor(() => {
      expect(checkoutCalls.length).toBe(1)
    })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/temporarily unavailable/i)).toBeNull()
  })

  it('a 500 keeps the generic toast — a notice must not swallow real failures', async () => {
    answerCheckout({ status: 500, payload: { error: 'boom' } })
    await clickUpgrade()
    await waitFor(() => {
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        'Could not start checkout',
        expect.objectContaining({ variant: 'error' }),
      )
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('the next attempt clears a stale notice before it starts', async () => {
    // A "checkout is paused" still sitting above the cards after the lock
    // lifted is its own lie — and the one a customer would act on.
    answerCheckout(
      { status: 423, payload: refusalBody(CHECKOUT_LOCK) },
      { status: 200, payload: { clientSecret: 'cs_test_123' } },
    )
    await clickUpgrade()
    expect(await screen.findByRole('alert')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'Upgrade' })[0])
    await waitFor(() => {
      expect(checkoutCalls.length).toBe(2)
    })
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull()
    })
  })

  it('the reader can dismiss it', async () => {
    answerCheckout({ status: 423, payload: refusalBody(CHECKOUT_LOCK) })
    await clickUpgrade()
    expect(await screen.findByRole('alert')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull()
    })
  })
})
