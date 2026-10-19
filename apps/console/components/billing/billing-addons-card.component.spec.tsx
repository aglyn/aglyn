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

jest.mock('@aglyn/shared-ui-jsx', () => ({
  useConfirmationContext: () => ({ confirm: () => Promise.resolve() }),
  useLoading: () => ({ queueLoading: () => () => undefined }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'admin-1', getIdToken: async () => 'tok' } }),
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

    await waitFor(() => expect(screen.queryByText(NOT_CONFIGURED)).toBeNull())
    expect(screen.queryByText('Checking your plan add-ons…')).toBeNull()
    expect(screen.queryByText(/We couldn.t load your plan add-ons/)).toBeNull()
  })
})

/**
 * The Aglyn AI row (AGL-2899, AGL-3965). Three plans, three different rows:
 * Free is pointed at the plan grid, a paid plan gets the TIER PICKER (every
 * tier with its price and credits, the one held marked), Enterprise is told
 * it already has the thing. The catalog marks Free and Enterprise
 * `upgradeRequired` alike, so the row cannot be read off the catalog — which
 * is what the first and last cases pin.
 */
describe('the Aglyn AI row (AGL-2899, AGL-3965)', () => {
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

  const TIERS = [
    { id: 'spark', label: 'Spark', credits: 4000, unitUsd: 9, configured: true },
    { id: 'boost', label: 'Boost', credits: 9000, unitUsd: 19, configured: true },
    { id: 'plus', label: 'Plus', credits: 19000, unitUsd: 39, configured: true },
    { id: 'max', label: 'Max', credits: 34000, unitUsd: 69, configured: true },
    { id: 'ultra', label: 'Ultra', credits: 49000, unitUsd: 99, configured: true },
    { id: 'studio', label: 'Studio', credits: 149000, unitUsd: 299, configured: false },
  ]

  const stateFor = (
    plan: string,
    aiAddon: { unitUsd: number | null; quantity?: number; tier?: string | null },
  ) => ({
    hasSubscription: true,
    plan,
    interval: 'month',
    quantities: { aiAddon: aiAddon.quantity ?? 0 },
    catalog: {
      aiAddon: {
        unitUsd: aiAddon.unitUsd,
        max: 1,
        configured: aiAddon.unitUsd != null,
        upgradeRequired: aiAddon.unitUsd == null,
      },
    },
    aiTier: aiAddon.tier ?? null,
    aiTiers: aiAddon.unitUsd == null ? [] : TIERS,
  })

  /** Open the picker and choose a tier by its visible name. */
  const choose = async (name: RegExp) => {
    fireEvent.mouseDown(await screen.findByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name }))
  }

  it('on a paid plan: a tier picker, one pool, and the plan’s own credits', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(stateFor('pro', { unitUsd: 19 })),
    ) as unknown as typeof fetch

    render(<BillingAddonsCardComponent orgId="org-1" canManage />)

    // The picker, showing no tier held.
    const picker = await screen.findByRole('combobox')
    expect(picker.textContent).toBe('No tier')
    // The row names no per-plan price: each tier is priced in the picker.
    expect(screen.getByText('Aglyn AI')).toBeTruthy()
    expect(screen.queryByText('Aglyn AI — $19/mo')).toBeNull()
    // One pool, and the included figure is the plan's own band (Pro 2,750).
    expect(
      screen.getByText(
        /draw on one pool of AI credits\. Your plan includes 2,750 a month; a tier adds its credits on top\./,
      ),
    ).toBeTruthy()
    // No AI switch any more.
    expect(aiSwitches()).toHaveLength(0)
    expect(screen.queryByText('Upgrade your plan to add Aglyn AI')).toBeNull()
    expect(screen.queryByText('Included in your plan')).toBeNull()
  })

  it('lists every tier with its price and credits, an unconfigured one disabled with the reason', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(stateFor('starter', { unitUsd: 9, quantity: 1, tier: 'boost' })),
    ) as unknown as typeof fetch

    render(<BillingAddonsCardComponent orgId="org-1" canManage />)
    // The tier held, in the field.
    expect((await screen.findByRole('combobox')).textContent).toBe('Boost — $19/mo')
    fireEvent.mouseDown(screen.getByRole('combobox'))
    const options = await screen.findAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      "No tierYour plan's included credits only",
      'Spark — $9/mo+4,000 credits a month',
      'Boost — $19/mo+9,000 credits a monthCurrent',
      'Plus — $39/mo+19,000 credits a month',
      'Max — $69/mo+34,000 credits a month',
      'Ultra — $99/mo+49,000 credits a month',
      'Studio — $299/mo+149,000 credits a month (not configured yet)',
    ])
    expect(options[6].getAttribute('aria-disabled')).toBe('true')
  })

  it('choosing a tier previews it, then sets it, with the tier named', async () => {
    global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      if (body.action === 'preview') {
        return jsonResponse({ prorationCents: 3_900, chargedNowCents: 3_900, currency: 'usd' })
      }
      if (body.action === 'set') {
        return jsonResponse({ quantities: { aiAddon: 1 }, aiTier: 'plus' })
      }
      return jsonResponse(stateFor('pro', { unitUsd: 19 }))
    }) as unknown as typeof fetch

    render(<BillingAddonsCardComponent orgId="org-1" canManage />)
    await choose(/^Plus/)
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() =>
      expect(postedBodies()).toContainEqual({
        orgId: 'org-1',
        action: 'preview',
        kind: 'aiAddon',
        quantity: 1,
        tier: 'plus',
      }),
    )
    // The confirm resolved (mocked), so the set followed with the same shape.
    await waitFor(() =>
      expect(postedBodies()).toContainEqual({
        orgId: 'org-1',
        action: 'set',
        kind: 'aiAddon',
        quantity: 1,
        tier: 'plus',
      }),
    )
    await waitFor(() =>
      expect(screen.getByRole('combobox').textContent).toBe('Plus — $39/mo'),
    )
  })

  it('"No tier" on a held tier removes it, as quantity 0 with no tier', async () => {
    global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      if (body.action === 'preview') {
        return jsonResponse({ defersToPeriodEnd: true, effectiveAt: '2026-11-01T00:00:00.000Z' })
      }
      if (body.action === 'set') {
        return jsonResponse({
          quantities: { aiAddon: 1 },
          pendingAddonChange: { kind: 'aiAddon', quantity: 0, effectiveAt: '2026-11-01T00:00:00.000Z' },
        })
      }
      return jsonResponse(stateFor('pro', { unitUsd: 19, quantity: 1, tier: 'boost' }))
    }) as unknown as typeof fetch

    render(<BillingAddonsCardComponent orgId="org-1" canManage />)
    await choose(/^No tier/)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() =>
      expect(postedBodies()).toContainEqual({
        orgId: 'org-1',
        action: 'set',
        kind: 'aiAddon',
        quantity: 0,
      }),
    )
  })

  it('a manager without billing rights sees the picker disabled, not hidden', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(stateFor('pro', { unitUsd: 19 })),
    ) as unknown as typeof fetch

    render(<BillingAddonsCardComponent orgId="org-1" canManage={false} />)
    const picker = await screen.findByRole('combobox')
    expect(picker.getAttribute('aria-disabled')).toBe('true')
  })

  it('on Free: the row, an upgrade link to the plan grid, and NO picker', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(stateFor('free', { unitUsd: null })),
    ) as unknown as typeof fetch

    render(<BillingAddonsCardComponent orgId="org-1" canManage />)

    expect(await screen.findByText('Aglyn AI')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Upgrade your plan to add Aglyn AI' })
    expect(link.getAttribute('href')).toBe('#plans')
    // No AI control. The one switch on the card is Site Care's, shown off and
    // disabled with its own reason (AGL-3954).
    expect(aiSwitches()).toHaveLength(0)
    expect(screen.queryByRole('combobox')).toBeNull()
    // Free's own 300 credits are the pool; no tier is sold.
    expect(screen.getByText(/Your plan includes 300 a month/)).toBeTruthy()
    // …and NOT the generic upgrade caption, which cannot say where to go.
    expect(screen.queryByText('Upgrade your plan to add these')).toBeNull()
  })

  it('on Enterprise: "included", and NO picker', async () => {
    // Same catalog shape as Free — `unitUsd: null`, `upgradeRequired` — and
    // the opposite sentence, because the plan's AI is in its agreement.
    global.fetch = jest.fn(async () =>
      jsonResponse(stateFor('enterprise', { unitUsd: null })),
    ) as unknown as typeof fetch

    render(<BillingAddonsCardComponent orgId="org-1" canManage />)

    expect(await screen.findByText('Included in your plan')).toBeTruthy()
    expect(aiSwitches()).toHaveLength(0)
    expect(screen.queryByRole('combobox')).toBeNull()
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
