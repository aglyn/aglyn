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

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

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
