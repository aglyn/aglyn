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
 * AGL-1380: "Plan add-ons appear here once billing is configured" is a claim
 * about THIS org's billing, and `state === null` made it in three different
 * situations at once — nothing has come back yet, the deployment really has
 * no Stripe keys (HTTP 501), and the request failed. `addonsRequest`
 * collapsed the last two to the same `null`, and the effect only ever called
 * `setState` on success, so a 500 parked a paying org on "your billing does
 * not exist" permanently, with no retry.
 *
 * The MIDDLE case is the split that did not exist before: 501 keeps the old
 * sentence because the route actually told us, and everything else becomes a
 * failure with a Retry.
 */

import {
  PLATFORM_BRAND_NAME,
  PLATFORM_SUPPORT_URL,
} from '@aglyn/aglyn/app-utils/platform-brand'
import { PLAN_ENTITLEMENTS } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

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

jest.mock('../../hooks/use-branding', () => ({
  __esModule: true,
  useBranding: () => mockBranding,
  default: () => mockBranding,
}))

/** The confirm every change opens, resolved so the change goes through. */
const mockConfirm = jest.fn((_options: { title?: string; description?: string }) =>
  Promise.resolve(),
)

jest.mock('@aglyn/shared-ui-jsx', () => ({
  useConfirmationContext: () => ({ confirm: mockConfirm }),
  useLoading: () => ({ queueLoading: () => () => undefined }),
}))

/**
 * One snackbar function for every render: a fresh one per render would change
 * the card's request callback on every render and re-run its load, so a
 * change's own answer would be overwritten by the next load.
 */
const mockEnqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

/** One signed-in user for every render, for the snackbar's reason above. */
const mockUser = { data: { uid: 'admin-1', getIdToken: async () => 'tok' } }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => mockUser,
}))

import BillingAddonsCardComponent from './billing-addons-card.component'

/** See the same helper in `org-sso-card.component.spec.tsx` for why. */
const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response

const NOT_CONFIGURED = 'Plan add-ons appear here once billing is configured.'

/** A live subscription with one purchasable add-on. */
const liveState = {
  hasSubscription: true,
  quantities: { seats: 2 },
  catalog: {
    seats: { unitUsd: 10, upgradeRequired: false, configured: true },
  },
}

describe('BillingAddonsCard billing claims (AGL-1380)', () => {
  it('claims nothing while the add-ons request is still in flight', async () => {
    global.fetch = jest.fn(
      () => new Promise<Response>(() => undefined),
    ) as unknown as typeof fetch

    render(<BillingAddonsCardComponent orgId="org-1" canManage />)

    expect(await screen.findByText('Checking your plan add-ons…')).toBeTruthy()
    expect(screen.queryByText(NOT_CONFIGURED)).toBeNull()
  })

  it('reports a failed request as a failure, not as unconfigured billing', async () => {
    // THE MIDDLE CASE. A 500 used to leave `state` null forever, which reads
    // exactly like a deployment with no Stripe keys.
    global.fetch = jest.fn(async () =>
      jsonResponse({ error: 'Plan add-on request failed' }, 500),
    ) as unknown as typeof fetch

    render(<BillingAddonsCardComponent orgId="org-1" canManage />)

    await screen.findByText(/We couldn.t load your plan add-ons/)
    expect(screen.queryByText(NOT_CONFIGURED)).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('reports a rejected request the same way', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch

    render(<BillingAddonsCardComponent orgId="org-1" canManage />)

    await screen.findByText(/We couldn.t load your plan add-ons/)
    expect(screen.queryByText(NOT_CONFIGURED)).toBeNull()
  })

  it('recovers through Retry once the request answers', async () => {
    let failNext = true
    global.fetch = jest.fn(async () => {
      if (failNext) {
        failNext = false
        return jsonResponse({ error: 'nope' }, 500)
      }
      return jsonResponse(liveState)
    }) as unknown as typeof fetch

    render(<BillingAddonsCardComponent orgId="org-1" canManage />)
    await screen.findByText(/We couldn.t load your plan add-ons/)

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() =>
      expect(screen.queryByText(/We couldn.t load your plan add-ons/)).toBeNull(),
    )
  })

  it('still says billing is unconfigured when the route says so', async () => {
    // 501 is the one answer that earns the sentence — the deployment told us.
    global.fetch = jest.fn(async () =>
      jsonResponse({ error: 'Stripe is not configured' }, 501),
    ) as unknown as typeof fetch

    render(<BillingAddonsCardComponent orgId="org-1" canManage />)

    expect(await screen.findByText(NOT_CONFIGURED)).toBeTruthy()
    expect(screen.queryByText(/We couldn.t load your plan add-ons/)).toBeNull()
  })

  it('renders the add-on rows on a successful load', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(liveState),
    ) as unknown as typeof fetch

    render(<BillingAddonsCardComponent orgId="org-1" canManage />)

    await waitFor(() =>
      expect(screen.queryByText('Checking your plan add-ons…')).toBeNull(),
    )
    expect(screen.queryByText(NOT_CONFIGURED)).toBeNull()
    expect(screen.queryByText(/We couldn.t load your plan add-ons/)).toBeNull()
  })
})

/**
 * The Aglyn AI row (AGL-2899, AGL-4144). Three plans, three different rows:
 * Free is pointed at the plan grid, a paid plan gets the BLOCK STEPPER (0 to
 * 30 blocks of 5,000 credits at $10 a month each, with the credits the count
 * comes to), Enterprise is told it already has the thing. The catalog marks
 * Free and Enterprise `upgradeRequired` alike, so the row cannot be read off
 * the catalog — which is what the last two cases pin.
 */
describe('the Aglyn AI row (AGL-2899, AGL-4144)', () => {
  /** Every body the card posted, in order. */
  const postedBodies = () =>
    (global.fetch as jest.Mock).mock.calls.map(([, init]) =>
      JSON.parse(String((init as RequestInit).body)),
    )

  /** Every switch except Site Care's, which every plan's card renders. */
  const aiSwitches = () =>
    screen
      .queryAllByRole('switch')
      .filter((element) => element.getAttribute('aria-label') !== 'Site Care')

  const addOne = () => screen.getByRole('button', { name: 'Add one block of Aglyn AI credits' })
  const removeOne = () =>
    screen.getByRole('button', { name: 'Remove one block of Aglyn AI credits' })

  /** "2,750", read off the plan table so a band move does not need this file. */
  const band = (plan: keyof typeof PLAN_ENTITLEMENTS) =>
    PLAN_ENTITLEMENTS[plan].assistCreditsPerMonth
  const credits = (value: number) => value.toLocaleString()

  /** The add-ons route's answer: a block sold at $10, up to 30, where it is sold. */
  const stateFor = (plan: string, blocks: { sold: boolean; quantity?: number }) => ({
    hasSubscription: true,
    plan,
    interval: 'month',
    quantities: { aiAddon: blocks.quantity ?? 0 },
    catalog: {
      aiAddon: blocks.sold
        ? { unitUsd: 10, max: 30, configured: true, upgradeRequired: false, credits: 5000 }
        : { unitUsd: null, max: 0, configured: false, upgradeRequired: true },
    },
  })

  beforeEach(() => mockConfirm.mockClear())

  it('on a paid plan: a stepper from 0, the block terms, one pool and the plan’s own credits', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(stateFor('pro', { sold: true })),
    ) as unknown as typeof fetch

    render(<BillingAddonsCardComponent orgId="org-1" canManage />)

    expect(await screen.findByText('Aglyn AI credits')).toBeTruthy()
    // One pool, the plan's own band, and the block's terms with its ceiling.
    expect(
      screen.getByText(
        `Questions, copy, generated pages, emails, campaigns and products all draw on one ` +
          `pool of AI credits. Your plan includes ${credits(band('pro'))} a month. Add blocks ` +
          'on top: 5,000 credits each, $10 a month per block, up to 30.',
      ),
    ).toBeTruthy()
    // The count the stepper comes to: none bought, the plan's own credits.
    expect(
      screen.getByText(`With no blocks: ${credits(band('pro'))} AI credits a month, your plan's own.`),
    ).toBeTruthy()
    // At the floor: nothing to remove, one to add, nothing to apply.
    expect(removeOne().hasAttribute('disabled')).toBe(true)
    expect(addOne().hasAttribute('disabled')).toBe(false)
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
    // No switch and no tier picker any more.
    expect(aiSwitches()).toHaveLength(0)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByText('Upgrade your plan to add Aglyn AI')).toBeNull()
    expect(screen.queryByText('Included in your plan')).toBeNull()
  })

  it('the credits line moves with the count before anything is applied', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(stateFor('pro', { sold: true })),
    ) as unknown as typeof fetch

    render(<BillingAddonsCardComponent orgId="org-1" canManage />)
    await screen.findByText('Aglyn AI credits')

    fireEvent.click(addOne())
    expect(
      screen.getByText(`With 1 block: ${credits(band('pro') + 5_000)} AI credits a month in all.`),
    ).toBeTruthy()
    fireEvent.click(addOne())
    fireEvent.click(addOne())
    expect(
      screen.getByText(`With 3 blocks: ${credits(band('pro') + 15_000)} AI credits a month in all.`),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy()
    // Nothing is posted until Apply.
    expect(postedBodies().every((body) => body.action === 'get')).toBe(true)
  })

  it('stops at 30 blocks: Add is disabled at the ceiling the route sells', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(stateFor('starter', { sold: true, quantity: 29 })),
    ) as unknown as typeof fetch

    render(<BillingAddonsCardComponent orgId="org-1" canManage />)
    await screen.findByText('Aglyn AI credits')

    expect(addOne().hasAttribute('disabled')).toBe(false)
    fireEvent.click(addOne())
    expect(
      screen.getByText(`With 30 blocks: ${credits(band('starter') + 150_000)} AI credits a month in all.`),
    ).toBeTruthy()
    expect(addOne().hasAttribute('disabled')).toBe(true)
    expect(removeOne().hasAttribute('disabled')).toBe(false)
  })

  it('Apply previews the count, confirms it in blocks and credits, then sets it — never a tier', async () => {
    global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      if (body.action === 'preview') {
        return jsonResponse({ prorationCents: 3_000, chargedNowCents: 3_000, currency: 'usd' })
      }
      if (body.action === 'set') {
        return jsonResponse({ ok: true, quantities: { aiAddon: 3 } })
      }
      return jsonResponse(stateFor('pro', { sold: true }))
    }) as unknown as typeof fetch

    render(<BillingAddonsCardComponent orgId="org-1" canManage />)
    await screen.findByText('Aglyn AI credits')
    fireEvent.click(addOne())
    fireEvent.click(addOne())
    fireEvent.click(addOne())
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() =>
      expect(postedBodies()).toContainEqual({
        orgId: 'org-1',
        action: 'set',
        kind: 'aiAddon',
        quantity: 3,
      }),
    )
    expect(postedBodies()).toContainEqual({
      orgId: 'org-1',
      action: 'preview',
      kind: 'aiAddon',
      quantity: 3,
    })
    expect(postedBodies().some((body) => 'tier' in body)).toBe(false)
    // The confirm names the blocks, what they cost and the credits they add.
    expect(mockConfirm).toHaveBeenCalledTimes(1)
    const asked = mockConfirm.mock.calls[0][0]
    expect(asked.title).toBe('Aglyn AI credits: 3 blocks?')
    expect(asked.description).toContain('$30.00 USD will be charged to your card now')
    expect(asked.description).toContain(
      "$30/mo, adding 15,000 AI credits a month on top of your plan's.",
    )
    // The applied count is now the held one: nothing left to apply.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull())
    expect(
      screen.getByText(`With 3 blocks: ${credits(band('pro') + 15_000)} AI credits a month in all.`),
    ).toBeTruthy()
  })

  it('fewer blocks wait for the period end: nothing charged, the smaller count from then', async () => {
    global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      if (body.action === 'preview') {
        return jsonResponse({ defersToPeriodEnd: true, effectiveAt: '2026-12-01T00:00:00.000Z' })
      }
      if (body.action === 'set') {
        return jsonResponse({
          ok: true,
          quantities: { aiAddon: 3 },
          pendingAddonChange: { kind: 'aiAddon', quantity: 1, effectiveAt: '2026-12-01T00:00:00.000Z' },
        })
      }
      return jsonResponse(stateFor('pro', { sold: true, quantity: 3 }))
    }) as unknown as typeof fetch

    render(<BillingAddonsCardComponent orgId="org-1" canManage />)
    await screen.findByText('Aglyn AI credits')
    fireEvent.click(removeOne())
    fireEvent.click(removeOne())
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() =>
      expect(postedBodies()).toContainEqual({
        orgId: 'org-1',
        action: 'set',
        kind: 'aiAddon',
        quantity: 1,
      }),
    )
    const asked = mockConfirm.mock.calls[0][0]
    expect(asked.title).toBe('Aglyn AI credits: 1 block?')
    expect(asked.description).toContain('Nothing is charged and nothing is refunded.')
    expect(asked.description).toContain(
      "$10/mo, adding 5,000 AI credits a month on top of your plan's.",
    )
  })

  it('a manager without billing rights sees the stepper disabled, not hidden', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(stateFor('pro', { sold: true, quantity: 2 })),
    ) as unknown as typeof fetch

    render(<BillingAddonsCardComponent orgId="org-1" canManage={false} />)
    await screen.findByText('Aglyn AI credits')
    expect(addOne().hasAttribute('disabled')).toBe(true)
    expect(removeOne().hasAttribute('disabled')).toBe(true)
    expect(
      screen.getByText(`With 2 blocks: ${credits(band('pro') + 10_000)} AI credits a month in all.`),
    ).toBeTruthy()
  })

  it('on Free: the row, an upgrade link to the plan grid, and NO stepper', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(stateFor('free', { sold: false })),
    ) as unknown as typeof fetch

    render(<BillingAddonsCardComponent orgId="org-1" canManage />)

    expect(await screen.findByText('Aglyn AI credits')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Upgrade your plan to add Aglyn AI' })
    expect(link.getAttribute('href')).toBe('#plans')
    // No AI control. The one switch on the card is Site Care's, shown off and
    // disabled with its own reason (AGL-3954).
    expect(aiSwitches()).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Add one block of Aglyn AI credits' })).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    // Free's own credits are the pool; no block is sold, so no count line.
    expect(screen.getByText(new RegExp(`Your plan includes ${credits(band('free'))} a month`))).toBeTruthy()
    expect(screen.queryByText(/^With (no blocks|\d+ blocks?):/)).toBeNull()
    // …and NOT the generic upgrade caption, which cannot say where to go.
    expect(screen.queryByText('Upgrade your plan to add these')).toBeNull()
  })

  it('on Enterprise: "included", and NO stepper', async () => {
    // Same catalog shape as Free — `unitUsd: null`, `upgradeRequired` — and
    // the opposite sentence, because the plan's AI is in its agreement.
    global.fetch = jest.fn(async () =>
      jsonResponse(stateFor('enterprise', { sold: false })),
    ) as unknown as typeof fetch

    render(<BillingAddonsCardComponent orgId="org-1" canManage />)

    expect(await screen.findByText('Included in your plan')).toBeTruthy()
    expect(aiSwitches()).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Add one block of Aglyn AI credits' })).toBeNull()
    expect(screen.queryByText('Upgrade your plan to add Aglyn AI')).toBeNull()
  })
})

/**
 * The Site Care row (AGL-3954). Sold flat on every paid plan, so a paid plan
 * gets the switch, the price and both sentences; Free and Enterprise keep the
 * row and a switch that is off and disabled, with the reason beside it —
 * a prerequisite shown, never hidden.
 */
describe('the Site Care row (AGL-3954)', () => {
  const postedBodies = () =>
    (global.fetch as jest.Mock).mock.calls.map(([, init]) =>
      JSON.parse(String((init as RequestInit).body)),
    )

  const stateFor = (
    plan: string,
    options: { interval?: 'month' | 'year'; sold?: boolean } = {},
  ) => {
    const sold = options.sold ?? true
    return {
      hasSubscription: plan !== 'free',
      plan,
      interval: options.interval ?? 'month',
      quantities: { siteCare: 0 },
      catalog: {
        siteCare: {
          unitUsd: 49,
          max: sold ? 1 : 0,
          configured: true,
          upgradeRequired: !sold,
        },
      },
    }
  }

  const siteCareSwitch = () =>
    screen.getByRole('switch', { name: 'Site Care' }) as HTMLInputElement

  it('on a paid plan: the price, what it covers, what it does not, and a switch', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(stateFor('starter')),
    ) as unknown as typeof fetch

    render(<BillingAddonsCardComponent orgId="org-1" canManage />)

    expect(await screen.findByText('Site Care — $49/mo')).toBeTruthy()
    expect(screen.getByText(/We make your site changes for you/)).toBeTruthy()
    expect(screen.getByText(/done within 2 business days/)).toBeTruthy()
    expect(screen.getByText(/What it does not cover: plan limits/)).toBeTruthy()
    const toggle = siteCareSwitch()
    expect(toggle.checked).toBe(false)
    expect(toggle.disabled).toBe(false)
    expect(screen.queryByRole('link', { name: 'Choose a paid plan' })).toBeNull()
  })

  it('quotes the yearly charge on an annual plan', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(stateFor('pro', { interval: 'year' })),
    ) as unknown as typeof fetch

    render(<BillingAddonsCardComponent orgId="org-1" canManage />)

    expect(await screen.findByText('Site Care — $588/yr')).toBeTruthy()
  })

  it('flipping the switch previews `siteCare` at quantity 1', async () => {
    global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      if (body.action === 'preview') {
        return jsonResponse({ prorationCents: 4_900, chargedNowCents: 4_900, currency: 'usd' })
      }
      if (body.action === 'set') {
        return jsonResponse({ quantities: { siteCare: 1 } })
      }
      return jsonResponse(stateFor('business'))
    }) as unknown as typeof fetch

    render(<BillingAddonsCardComponent orgId="org-1" canManage />)
    await screen.findByText('Site Care — $49/mo')
    fireEvent.click(siteCareSwitch())

    await waitFor(() =>
      expect(postedBodies()).toContainEqual({
        orgId: 'org-1',
        action: 'preview',
        kind: 'siteCare',
        quantity: 1,
      }),
    )
  })

  it('on Free: the row, a disabled switch, the reason, and a link to the plans', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(stateFor('free', { sold: false })),
    ) as unknown as typeof fetch

    render(<BillingAddonsCardComponent orgId="org-1" canManage />)

    await screen.findByText(/Site Care is added to a paid plan/)
    const toggle = siteCareSwitch()
    expect(toggle.checked).toBe(false)
    expect(toggle.disabled).toBe(true)
    const link = screen.getByRole('link', { name: 'Choose a paid plan' })
    expect(link.getAttribute('href')).toBe('#plans')
    expect(screen.getByText(/What it does not cover/)).toBeTruthy()
  })

  it('on Enterprise: a disabled switch and the agreement, with no plan link', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(stateFor('enterprise', { sold: false })),
    ) as unknown as typeof fetch

    render(<BillingAddonsCardComponent orgId="org-1" canManage />)

    await screen.findByText(/Arranged in your Enterprise agreement/)
    expect(siteCareSwitch().disabled).toBe(true)
    expect(screen.queryByRole('link', { name: 'Choose a paid plan' })).toBeNull()
  })
})
