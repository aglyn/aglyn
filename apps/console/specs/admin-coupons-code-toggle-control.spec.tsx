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

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * The activate/deactivate control on /admin/coupons, rendered.
 *
 * `admin-coupons-promotion-code-toggle.spec.ts` pins what the route does with
 * the request. What can only be checked here is whether a staff member can
 * actually reach it, and the ways this page could fail are all silent:
 *
 *  - offering the wrong direction, so a click meant to revive a dead code
 *    kills a live one;
 *  - firing straight off the row, with no chance to read what the click does;
 *  - leaving the row showing the state from before the write, which reads
 *    exactly like a flip that did not take;
 *  - letting a ≥`DISCOUNT_APPROVAL_THRESHOLD_PCT`% code be re-armed with no
 *    sign-off, which the server would then refuse — a dead end rather than a
 *    guardrail.
 *
 * The threshold is the real constant, not a mocked one: a page rendering its
 * own idea of where sign-off starts is the bug this arm exists to catch.
 */

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: { uid: 'staff-1', getIdToken: async () => 'tok' } }),
}))

const mockEnqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  CardDisplay: ({ children }: any) => <div>{children}</div>,
  Container: ({ children }: any) => <div>{children}</div>,
  HelpTip: () => null,
}))

jest.mock(
  '@aglyn/shared-ui-jsx/components/list-pagination.component',
  () => ({
    __esModule: true,
    ListPagination: () => null,
  }),
)

jest.mock('../components/staff-only.component', () => ({
  __esModule: true,
  default: ({ children }: any) => <div>{children}</div>,
}))

jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({ children }: any) => <div>{children}</div>,
}))

jest.mock('../hooks/use-is-staff', () => ({
  __esModule: true,
  useIsStaff: () => true,
  useStaffRole: () => 'super',
}))

jest.mock('../constants/docs-links', () => ({
  __esModule: true,
  docsHelp: () => ({}),
}))

import AdminCoupons from '../app/(app)/admin/coupons/page'

/** Every non-GET body the page sent to `/api/admin/coupons`. */
let writes: any[]

/**
 * One coupon with one promotion code, as `GET /api/admin/coupons` returns it.
 * The list is re-read after a write, so the double flips the code's `active`
 * to whatever the write asked for — a fixture that always answered the same
 * way could not tell a page that re-reads from one that does not.
 */
const mockApi = (coupon: { percentOff: number; active: boolean }) => {
  writes = []
  let active = coupon.active
  ;(globalThis as any).fetch = jest.fn(async (_url: string, init: any = {}) => {
    if ((init.method ?? 'GET') !== 'GET') {
      const body = JSON.parse(init.body)
      writes.push(body)
      active = body.action === 'activate'
      return { ok: true, status: 200, json: async () => ({ code: { active } }) }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        coupons: [
          {
            id: 'cpn_1',
            name: 'Smoke test',
            percentOff: coupon.percentOff,
            amountOffUsd: null,
            duration: 'once',
            durationInMonths: null,
            maxRedemptions: null,
            timesRedeemed: 0,
            redeemBy: null,
            valid: true,
            codes: [
              {
                id: 'promo_1',
                code: 'AGLYNSMOKELIVE',
                active,
                timesRedeemed: 0,
              },
            ],
          },
        ],
      }),
    }
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockApi({ percentOff: 10, active: false })
})

describe('/admin/coupons promotion code activate/deactivate', () => {
  it('offers Activate on an inactive code', async () => {
    render(<AdminCoupons />)
    expect(await screen.findByText('AGLYNSMOKELIVE')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Activate' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Deactivate' })).toBeNull()
  })

  it('offers Deactivate on a live code', async () => {
    mockApi({ percentOff: 10, active: true })
    render(<AdminCoupons />)
    expect(await screen.findByText('AGLYNSMOKELIVE')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull()
  })

  it('confirms before writing — the row click alone sends nothing', async () => {
    render(<AdminCoupons />)
    await screen.findByText('AGLYNSMOKELIVE')
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))

    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(writes).toEqual([])
  })

  it('sends the activate action for the code the row names', async () => {
    render(<AdminCoupons />)
    await screen.findByText('AGLYNSMOKELIVE')
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog, 'Activate'))

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toMatchObject({
      action: 'activate',
      promotionCodeId: 'promo_1',
    })
  })

  it('sends the deactivate action from a live code', async () => {
    mockApi({ percentOff: 10, active: true })
    render(<AdminCoupons />)
    await screen.findByText('AGLYNSMOKELIVE')
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog, 'Deactivate'))

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toMatchObject({
      action: 'deactivate',
      promotionCodeId: 'promo_1',
    })
  })

  it('re-reads the list, so the row shows the state that was written', async () => {
    render(<AdminCoupons />)
    await screen.findByText('AGLYNSMOKELIVE')
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog, 'Activate'))

    // The control flips to the opposite direction only because the page went
    // back to the server; nothing here reloads the document.
    expect(
      await screen.findByRole('button', { name: 'Deactivate' }),
    ).toBeTruthy()
  })

  it('will not re-arm a deep discount without the sign-off', async () => {
    mockApi({ percentOff: 60, active: false })
    render(<AdminCoupons />)
    await screen.findByText('AGLYNSMOKELIVE')
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog, 'Activate').hasAttribute('disabled')).toBe(true)
    fireEvent.click(dialog.querySelector('input[type="checkbox"]')!)
    expect(within(dialog, 'Activate').hasAttribute('disabled')).toBe(false)

    fireEvent.click(within(dialog, 'Activate'))
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0].confirmHighDiscount).toBe(true)
  })

  it('asks for no sign-off to pull a deep discount', async () => {
    // The gate is on the direction that commits revenue. A confirm box in
    // front of the repair would slow down the only urgent one of the two.
    mockApi({ percentOff: 60, active: true })
    render(<AdminCoupons />)
    await screen.findByText('AGLYNSMOKELIVE')
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }))
    const dialog = await screen.findByRole('dialog')

    expect(dialog.querySelector('input[type="checkbox"]')).toBeNull()
    expect(within(dialog, 'Deactivate').hasAttribute('disabled')).toBe(false)
  })
})

/** The dialog's own button with this label, not the row button behind it. */
function within(dialog: HTMLElement, label: string): HTMLElement {
  const match = [...dialog.querySelectorAll('button')].find(
    (button) => button.textContent === label,
  )
  if (!match) throw new Error(`No "${label}" button in the dialog`)
  return match as HTMLElement
}
