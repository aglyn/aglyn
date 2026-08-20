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
 * AGL-2438: an add-on the customer PAID for, which the pending plan change
 * will silently drop, says so.
 *
 * `/api/billing/addons` refreshes the subscription schedule's target phase
 * after a purchase. When that refresh throws, the purchase has already
 * succeeded and the card has already been charged — so the route deliberately
 * does not fail the request. It returns `scheduleRefreshFailed: true` and logs
 * that the pending change's item list "is stale and will drop this purchase at
 * the period end", with the comment "loudly, because the consequence is silent
 * and deferred".
 *
 * The card read `applied.quantities` and nothing else. The flag went in the
 * bin, the loud report was a server log nobody reads, and the customer got a
 * green `Manager seats updated` — the single most misleading thing that could
 * be said, because it is the one fact about to stop being true.
 *
 * Weeks later the seat vanishes at the period boundary with no notice at all.
 */

import {
  PLATFORM_BRAND_NAME,
  PLATFORM_SUPPORT_URL,
} from '@aglyn/aglyn/app-utils/platform-brand'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/** See `billing-addons-card.component.spec.tsx` for why this is narrow. */
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

/*
 * EVERY hook return below is a module-level SINGLETON, and that is
 * load-bearing rather than tidy.
 *
 * `sendAddonsRequest` is a `useCallback` over `enqueueSnackbar`, and the load
 * effect depends on it. A mock returning a fresh `{ enqueueSnackbar }` object
 * per render changes that identity every render, so the effect re-runs, calls
 * `setState`, and re-renders — an unbounded `action: 'get'` loop. Observed
 * here as 250+ `get` calls before the first assertion could run.
 *
 * The sibling spec has the same shape and is saved only by its second `get`
 * resolving `undefined`, which drops the card into its failure state and ends
 * the loop. That is the AGL-2365 note on `mockBranding` above, one hook over.
 */
const mockConfirmation = { confirm: () => Promise.resolve() }
const mockLoading = { queueLoading: () => () => undefined }
jest.mock('@aglyn/shared-ui-jsx', () => ({
  useConfirmationContext: () => mockConfirmation,
  useLoading: () => mockLoading,
}))

/**
 * ONE stable spy, unlike the sibling spec's fresh `jest.fn()` per call —
 * the whole question here is what the customer is told.
 */
const mockEnqueueSnackbar = jest.fn()
const mockSnackbar = { enqueueSnackbar: mockEnqueueSnackbar }
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => mockSnackbar,
}))

const mockUser = {
  data: { uid: 'admin-1', getIdToken: async () => 'tok' },
}
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => mockUser,
}))

import BillingAddonsCardComponent from './../components/billing/billing-addons-card.component'

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response

/** A live subscription with one purchasable seat add-on already at 2. */
const liveState = {
  hasSubscription: true,
  quantities: { managers: 2 },
  catalog: {
    managers: { unitUsd: 10, max: 20, upgradeRequired: false, configured: true },
  },
}

/**
 * Loads the card, steps Manager seats from 2 to 3, and applies — the real
 * purchase path, with the `set` response the test supplies.
 */
async function purchaseOneSeat(setResponse: Record<string, unknown>) {
  // Request-AWARE rather than a fixed queue: the card issues a `preview`
  // between load and `set` (it prices the proration before confirming), so a
  // two-deep `mockResolvedValueOnce` chain fed the preview's answer to the
  // purchase and left the load looking failed. Routing on the action is also
  // the honest double — the real route dispatches on exactly this field.
  ;(global.fetch as jest.Mock).mockImplementation(
    async (_url: string, init: any) => {
      const action = JSON.parse(String(init?.body ?? '{}')).action
      if (action === 'set') return jsonResponse(setResponse)
      if (action === 'preview') return jsonResponse({ ok: true, lines: [] })
      return jsonResponse(liveState)
    },
  )
  render(<BillingAddonsCardComponent orgId="org-1" canManage />)
  await screen.findByText('Manager seats — $10/mo each')
  fireEvent.click(screen.getByLabelText('Add one Manager seats'))
  fireEvent.click(await screen.findByRole('button', { name: 'Apply' }))
  await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
}

/** Every message the card has shown, flattened for substring checks. */
const messages = () =>
  mockEnqueueSnackbar.mock.calls.map((call) => String(call[0])).join('\n')

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn() as never
})

describe('AGL-2438 · a purchase the scheduled plan change will drop', () => {
  it('warns instead of claiming the add-on was simply updated', async () => {
    await purchaseOneSeat({
      ok: true,
      quantities: { managers: 3 },
      scheduleRefreshFailed: true,
    })
    // The bare success line must NOT be what the customer sees. This is the
    // exact regression: `Manager seats updated` was shown for a seat that is
    // scheduled to disappear.
    expect(mockEnqueueSnackbar).not.toHaveBeenCalledWith(
      'Manager seats updated',
      expect.anything(),
    )
    expect(messages()).toContain('will be dropped at the end of this billing period')
  })

  it('says the purchase DID happen, so nobody re-buys it', async () => {
    // The money left the account. A warning that read like a failure would
    // send the customer round again and charge them twice.
    await purchaseOneSeat({
      ok: true,
      quantities: { managers: 3 },
      scheduleRefreshFailed: true,
    })
    expect(messages()).toContain('was purchased')
  })

  it('persists the notice — it is the only warning of a deferred change', async () => {
    await purchaseOneSeat({
      ok: true,
      quantities: { managers: 3 },
      scheduleRefreshFailed: true,
    })
    const call = mockEnqueueSnackbar.mock.calls.find((entry) =>
      String(entry[0]).includes('was purchased'),
    )
    expect(call?.[1]).toEqual(
      expect.objectContaining({ variant: 'warning', persist: true }),
    )
  })

  it('still applies the new quantity to the UI', async () => {
    // The purchase succeeded; refusing to reflect it would be a second lie in
    // the other direction.
    await purchaseOneSeat({
      ok: true,
      quantities: { managers: 3 },
      scheduleRefreshFailed: true,
    })
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('NEGATIVE CONTROL: an ordinary purchase still reads as a plain success', async () => {
    // Without this the warning could be unconditional and every test above
    // would still pass — the guard would be asserting a constant.
    await purchaseOneSeat({ ok: true, quantities: { managers: 3 } })
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
      'Manager seats updated',
      expect.objectContaining({ variant: 'success' }),
    )
    expect(messages()).not.toContain('will be dropped')
  })
})
