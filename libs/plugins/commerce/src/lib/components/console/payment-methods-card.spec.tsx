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
 * The payment methods card (AGL-3629): what it lists, what it saves, and who
 * may press what. The route is mocked at `authorizedFetch`; the route itself
 * is pinned in `server/payment-methods.spec.ts`.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const fetchMock = jest.fn()
const enqueueSnackbar = jest.fn()

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => fetchMock(...args),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'uid-admin' } }),
}))
jest.mock('@aglyn/aglyn', () => ({ pluginDocsHelp: () => undefined }))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children, HeaderProps }: { children: ReactNode; HeaderProps?: { action?: ReactNode } }) => (
    <div>
      {HeaderProps?.action}
      {children}
    </div>
  ),
}))

import PaymentMethodsCard, { domainVerdict, visibleMethods } from './payment-methods-card.component'

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  on: true,
  platform: 'on',
  capability: null,
  ...extra,
})

function answer(extra: Record<string, unknown> = {}) {
  return {
    methods: [
      row('apple_pay'),
      row('google_pay'),
      row('link'),
      row('klarna', { capability: 'active' }),
      row('afterpay_clearpay', { capability: 'pending' }),
      row('affirm', { capability: 'inactive' }),
      row('cashapp', { platform: 'unavailable', capability: 'unrequested' }),
      row('amazon_pay', { capability: 'unrequested' }),
      row('crypto', { on: false, platform: null, capability: 'unrequested' }),
    ],
    domains: [
      {
        domain: 'shop.acme.com',
        enabled: true,
        stripeId: 'pmd_1',
        status: { applePay: 'active', googlePay: 'active' },
        lastError: null,
      },
    ],
    accountConnected: true,
    canEdit: true,
    canFinish: true,
    warnings: [],
    ...extra,
  }
}

const reply = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body })

beforeEach(() => {
  fetchMock.mockReset()
  enqueueSnackbar.mockReset()
})

describe('the payment methods card (AGL-3629)', () => {
  it('lists what the platform offers, with each method’s needs, limits and Stripe state', async () => {
    fetchMock.mockReturnValueOnce(reply(answer()))
    render(<PaymentMethodsCard hostId="host-1" />)
    await screen.findByTestId('payment-method-klarna')
    // Not offered by the platform, or crypto with no verdict: not listed.
    expect(screen.queryByTestId('payment-method-cashapp')).toBeNull()
    expect(screen.queryByTestId('payment-method-crypto')).toBeNull()
    expect(screen.getByTestId('payment-method-klarna').textContent).toContain('Ready')
    expect(screen.getByTestId('payment-method-klarna').textContent).toContain('From $10')
    expect(screen.getByTestId('payment-method-afterpay_clearpay').textContent).toContain(
      'Stripe is reviewing',
    )
    expect(screen.getByTestId('payment-method-amazon_pay').textContent).toContain('Save to request')
    expect(screen.getByTestId('payment-domain-shop.acme.com').textContent).toContain('Apple Pay ready')
  })

  it('saves only what changed, then shows Stripe’s answer', async () => {
    fetchMock.mockReturnValueOnce(reply(answer()))
    render(<PaymentMethodsCard hostId="host-1" />)
    await screen.findByTestId('payment-method-klarna')
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)

    fireEvent.click(screen.getByLabelText('Klarna'))
    fireEvent.click(screen.getByLabelText('Affirm'))
    fireEvent.click(screen.getByLabelText('Affirm'))
    fetchMock.mockReturnValueOnce(reply(answer()))
    fireEvent.click(save)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [, path, init] = fetchMock.mock.calls[1]
    expect(path).toBe('/api/commerce/payment-methods')
    expect(JSON.parse(init.body)).toEqual({ hostId: 'host-1', methods: { klarna: false } })
    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith('Payment methods saved', expect.anything()),
    )
  })

  it('offers Finish in Stripe on an on method Stripe needs details for, to the owner', async () => {
    fetchMock.mockReturnValueOnce(reply(answer()))
    render(<PaymentMethodsCard hostId="host-1" />)
    await screen.findByTestId('payment-method-affirm')
    expect(screen.getAllByRole('button', { name: 'Finish in Stripe' })).toHaveLength(1)
  })

  it('is read-only for an editor, and hides Finish from anyone but the owner', async () => {
    fetchMock.mockReturnValueOnce(reply(answer({ canEdit: false, canFinish: false })))
    render(<PaymentMethodsCard hostId="host-1" />)
    await screen.findByTestId('payment-method-klarna')
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Finish in Stripe' })).toBeNull()
    expect((screen.getByLabelText('Klarna') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText(/Only a site admin/)).toBeTruthy()
  })

  it('says so when payments are not configured, and offers a retry on an error', async () => {
    fetchMock.mockReturnValueOnce(reply({}, 501))
    const { unmount } = render(<PaymentMethodsCard hostId="host-1" />)
    await screen.findByText('Payments are not configured on this deployment.')
    unmount()

    fetchMock.mockReturnValueOnce(reply({}, 500))
    render(<PaymentMethodsCard hostId="host-1" />)
    fetchMock.mockReturnValueOnce(reply(answer()))
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    await screen.findByTestId('payment-method-klarna')
  })
})

describe('verdicts', () => {
  it('shows crypto once the platform positively offers it', () => {
    const rows = visibleMethods([
      { id: 'crypto', on: false, platform: 'on', capability: 'unrequested' },
    ])
    expect(rows).toHaveLength(1)
  })

  it('names what a domain can do now', () => {
    const base = { domain: 'a.com', stripeId: null, status: { applePay: null, googlePay: null } }
    expect(domainVerdict({ ...base, enabled: true, lastError: null }).label).toBe('Registered')
    expect(domainVerdict({ ...base, enabled: false, lastError: 'down' }).label).toBe('Retrying')
    expect(domainVerdict({ ...base, enabled: false, lastError: null }).label).toBe(
      'Registers on first checkout',
    )
  })
})
