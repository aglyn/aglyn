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
 *
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PayPalSettingsCard } from './paypal-settings-card.component'

/**
 * The store-settings card (AGL-3630): nothing at all until the server says
 * PayPal is offered — which it does not until every PAYPAL_* variable is
 * set — then the account's state, with Connect and Disconnect for the
 * owner alone.
 */

const calls: Array<{ url: string; init?: RequestInit }> = []
let answers: Record<string, { status: number; body: unknown }> = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({ useUser: () => ({ data: { uid: 'owner-1' } }) }))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: async (_user: unknown, url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const route = url.replace(/^\/api\//, '').replace(/\?.*$/, '')
    const answer = answers[route] ?? { status: 404, body: { error: 'Not found' } }
    return { ok: answer.status < 400, status: answer.status, json: async () => answer.body }
  },
}))
const navigateTo = jest.fn()
jest.mock('./navigate', () => ({ navigateTo: (url: string) => navigateTo(url) }))
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: jest.fn() }) }))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ header, subheader, HeaderProps, children }: any) => (
    <section>
      <h2>{header}</h2>
      <p>{subheader}</p>
      {HeaderProps?.action}
      {children}
    </section>
  ),
}))

const seller = (status: string, extra: Record<string, unknown> = {}) => ({
  offered: true,
  seller: { status, merchantId: status === 'ready' ? 'SELLER7RXQG3L' : null, actions: [], livemode: false },
  canManage: true,
  ...extra,
})

beforeEach(() => {
  calls.length = 0
  answers = {}
})

describe('PayPalSettingsCard', () => {
  it('draws nothing while the deployment does not offer PayPal', async () => {
    const { container } = render(<PayPalSettingsCard hostId="host-1" orgId="org-1" />)
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(container.textContent).toBe('')
  })

  it('draws nothing when the workspace’s plan does not sell', async () => {
    answers['paypal/seller'] = { status: 200, body: seller('not-connected', { offered: false }) }
    const { container } = render(<PayPalSettingsCard hostId="host-1" orgId="org-1" />)
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(container.textContent).toBe('')
  })

  it('offers the owner Connect PayPal, and sends them to PayPal’s link', async () => {
    answers['paypal/seller'] = { status: 200, body: seller('not-connected') }
    answers['paypal/seller/onboard'] = { status: 200, body: { actionUrl: 'https://www.sandbox.paypal.com/bizsignup/x' } }
    window.history.replaceState(null, '', '/acme/settings?tab=store')
    render(<PayPalSettingsCard hostId="host-1" orgId="org-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect PayPal' }))
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('https://www.sandbox.paypal.com/bizsignup/x'))
    const onboard = calls.find((call) => call.url.startsWith('/api/paypal/seller/onboard'))
    expect(JSON.parse(String(onboard?.init?.body))).toEqual({ returnUrl: 'http://localhost/acme/settings?tab=store' })
  })

  it('shows a connected account, sandbox marked, with Disconnect behind a confirmation', async () => {
    answers['paypal/seller'] = { status: 200, body: seller('ready') }
    answers['paypal/seller/disconnect'] = { status: 200, body: seller('not-connected') }
    render(<PayPalSettingsCard hostId="host-1" orgId="org-1" />)
    expect(await screen.findByText('Accepting PayPal')).toBeTruthy()
    expect(screen.getByText('Sandbox')).toBeTruthy()
    expect(screen.getByText('PayPal merchant ID SELLER7RXQG3L')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(await screen.findByText('Disconnect PayPal?')).toBeTruthy()
    expect(calls.some((call) => call.url.startsWith('/api/paypal/seller/disconnect'))).toBe(false)
    fireEvent.click(screen.getAllByRole('button', { name: 'Disconnect' }).slice(-1)[0])
    await waitFor(() => expect(calls.some((call) => call.url.startsWith('/api/paypal/seller/disconnect'))).toBe(true))
  })

  it('reads the account again when the owner comes back from PayPal, and drops the marker', async () => {
    answers['paypal/seller'] = { status: 200, body: seller('onboarding') }
    answers['paypal/seller/refresh'] = { status: 200, body: { seller: seller('ready').seller, canManage: true } }
    window.history.replaceState(null, '', '/acme/settings?paypal=returned')
    render(<PayPalSettingsCard hostId="host-1" orgId="org-1" />)
    expect(await screen.findByText('Accepting PayPal')).toBeTruthy()
    expect(window.location.search).toBe('')
  })

  it('tells a member who is not the owner who can connect it', async () => {
    answers['paypal/seller'] = { status: 200, body: seller('not-connected', { canManage: false }) }
    render(<PayPalSettingsCard hostId="host-1" orgId="org-1" />)
    expect(await screen.findByText('The workspace owner can connect PayPal.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Connect PayPal' })).toBeNull()
  })

  it('lists what the seller still has to do at PayPal', async () => {
    answers['paypal/seller'] = {
      status: 200,
      body: seller('action-needed', { seller: { status: 'action-needed', merchantId: 'S', actions: ['Confirm your email address with PayPal.'], livemode: true } }),
    }
    render(<PayPalSettingsCard hostId="host-1" orgId="org-1" />)
    expect(await screen.findByText('Confirm your email address with PayPal.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue in PayPal' })).toBeTruthy()
  })
})
