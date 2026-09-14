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
 * The Aglyn AI row (AGL-2899). Three plans, three different rows: Free is
 * pointed at the plan grid, a paid tier gets the switch with its price and
 * its band, Enterprise is told it already has the thing. The catalog marks
 * Free and Enterprise `upgradeRequired` alike, so the row cannot be read off
 * the catalog — which is what the first and third cases pin.
 */
describe('the Aglyn AI row (AGL-2899)', () => {
  /** Every body the card posted, in order. */
  const postedBodies = () =>
    (global.fetch as jest.Mock).mock.calls.map(([, init]) =>
      JSON.parse(String((init as RequestInit).body)),
    )

  const stateFor = (
    plan: string,
    aiAddon: { unitUsd: number | null; quantity?: number },
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
  })

  it('on a paid plan: a switch, the price, what it unlocks and the band it adds', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(stateFor('pro', { unitUsd: 19 })),
    ) as unknown as typeof fetch

    render(<BillingAddonsCardComponent orgId="org-1" canManage />)

    expect(await screen.findByText('Aglyn AI — $19/mo')).toBeTruthy()
    // The band is the figure the resolver folds into the meter, not a
    // hand-typed one: 9,000 is `AI_ADDON_CREDITS_PER_MONTH.pro`.
    expect(
      screen.getByText(
        /Generate pages, components, emails, campaigns, products and more, then edit anything\. Adds 9,000 AI credits a month/,
      ),
    ).toBeTruthy()
    const toggles = screen.getAllByRole('switch') as HTMLInputElement[]
    // One switch row in the catalog (Event Calendar has no entry, so it is
    // "Not configured" and renders no switch): the AI switch, off.
    expect(toggles).toHaveLength(1)
    expect(toggles[0].checked).toBe(false)
    expect(toggles[0].disabled).toBe(false)
    expect(screen.queryByText('Upgrade your plan to add Aglyn AI')).toBeNull()
    expect(screen.queryByText('Included in your plan')).toBeNull()
  })

  it('flipping the switch previews `aiAddon` at quantity 1, exactly as the other kinds', async () => {
    // FORCED RED by posting `quantity: true`: the route reads the number.
    global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      if (body.action === 'preview') {
        return jsonResponse({ prorationCents: 1_900, chargedNowCents: 1_900, currency: 'usd' })
      }
      if (body.action === 'set') {
        return jsonResponse({ quantities: { aiAddon: 1 } })
      }
      return jsonResponse(stateFor('pro', { unitUsd: 19 }))
    }) as unknown as typeof fetch

    render(<BillingAddonsCardComponent orgId="org-1" canManage />)
    fireEvent.click(await screen.findByRole('switch'))

    await waitFor(() =>
      expect(postedBodies()).toContainEqual({
        orgId: 'org-1',
        action: 'preview',
        kind: 'aiAddon',
        quantity: 1,
      }),
    )
    // The confirm resolved (mocked), so the set followed with the same shape.
    await waitFor(() =>
      expect(postedBodies()).toContainEqual({
        orgId: 'org-1',
        action: 'set',
        kind: 'aiAddon',
        quantity: 1,
      }),
    )
  })

  it('on Free: the row, an upgrade link to the plan grid, and NO switch', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(stateFor('free', { unitUsd: null })),
    ) as unknown as typeof fetch

    render(<BillingAddonsCardComponent orgId="org-1" canManage />)

    expect(await screen.findByText('Aglyn AI')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Upgrade your plan to add Aglyn AI' })
    expect(link.getAttribute('href')).toBe('#plans')
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
    // Free sells no band, so the sentence names what it unlocks and no figure.
    expect(screen.queryByText(/Adds .* AI credits a month/)).toBeNull()
    // …and NOT the generic upgrade caption, which cannot say where to go.
    expect(screen.queryByText('Upgrade your plan to add these')).toBeNull()
  })

  it('on Enterprise: "included", and NO switch', async () => {
    // Same catalog shape as Free — `unitUsd: null`, `upgradeRequired` — and
    // the opposite sentence, because the plan carries `aiGenerative`.
    global.fetch = jest.fn(async () =>
      jsonResponse(stateFor('enterprise', { unitUsd: null })),
    ) as unknown as typeof fetch

    render(<BillingAddonsCardComponent orgId="org-1" canManage />)

    expect(await screen.findByText('Included in your plan')).toBeTruthy()
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
    expect(screen.queryByText('Upgrade your plan to add Aglyn AI')).toBeNull()
  })
})
