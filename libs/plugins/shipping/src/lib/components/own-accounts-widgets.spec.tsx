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

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SHIPPING_API_ROUTES } from '../constants/api-routes'
import { OWN_ACCOUNT_SERVICES } from '../model/own-accounts'
import { CarrierAccountsCard } from './carrier-accounts-card.component'
import { OwnAccountsCard } from './own-accounts-card.component'

/**
 * The cards for the merchant's own shipping accounts (AGL-3632): the one
 * that connects Easyship, Sendcloud or ShipperHQ, and the carrier-account
 * card's credential form for a provider that names each carrier's fields.
 * Each draws nothing until the deployment offers it.
 */

let availability: Record<string, unknown> = { loading: false, available: false }
const request = jest.fn()
const enqueueSnackbar = jest.fn()

jest.mock('./shipping-api', () => ({
  ...jest.requireActual('./shipping-api'),
  useShippingAvailability: () => availability,
  useShippingFetch: () => request,
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))

beforeEach(() => {
  availability = { loading: false, available: false }
  request.mockReset()
  enqueueSnackbar.mockReset()
})

describe('your shipping accounts', () => {
  it('draws nothing while the deployment offers no service', () => {
    const { container } = render(<OwnAccountsCard hostId="host-1" />)
    expect(container.innerHTML).toBe('')
    expect(request).not.toHaveBeenCalled()
  })

  it('connects a service with the fields it asks for, then lists it with its webhook address', async () => {
    availability = { loading: false, available: false, ownAccounts: true, platform: false }
    const connection = {
      kind: 'sendcloud',
      label: 'Sendcloud',
      role: 'labels',
      accountName: 'Sendcloud integration 4242',
      testMode: false,
      connectedAtMs: 1,
      followsParcels: true,
      webhookUrl: 'https://console.example.com/api/shipping/webhooks/sendcloud?org=org-1',
      settings: {},
    }
    let connected = false
    request.mockImplementation(async (route: string, options: { body?: Record<string, unknown> }) => {
      if (route === SHIPPING_API_ROUTES.ownAccounts) {
        return {
          services: [OWN_ACCOUNT_SERVICES.sendcloud, OWN_ACCOUNT_SERVICES.shipperhq],
          connections: connected ? [connection] : [],
        }
      }
      if (route === SHIPPING_API_ROUTES.ownAccountsConnect) {
        expect(options.body).toEqual({ hostId: 'host-1', kind: 'sendcloud', values: { apiKey: 'pub', apiSecret: 'sec' } })
        connected = true
        return { connection }
      }
      throw new Error(`unexpected ${route}`)
    })
    render(<OwnAccountsCard hostId="host-1" />)
    expect(await screen.findByText('No accounts connected. Connect one to buy labels and get carrier rates.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Connect an account' }))
    const dialog = await screen.findByRole('dialog')
    const submit = within(dialog).getByRole('button', { name: 'Check and connect' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText(/Public key/), { target: { value: 'pub' } })
    fireEvent.change(within(dialog).getByLabelText(/Secret key/), { target: { value: 'sec' } })
    expect((within(dialog).getByLabelText(/Secret key/) as HTMLInputElement).type).toBe('password')
    fireEvent.click(submit)
    expect(await screen.findByText(/Sendcloud integration 4242/)).toBeTruthy()
    expect((screen.getByLabelText('Webhook address') as HTMLInputElement).value).toBe(connection.webhookUrl)
    expect(screen.getByText('Labels and rates')).toBeTruthy()
    expect(enqueueSnackbar).toHaveBeenCalledWith('Sendcloud connected', { variant: 'success' })
  })

  it('shows the service’s refusal in the dialog and keeps it open', async () => {
    availability = { loading: false, available: true, ownAccounts: true, platform: true }
    request.mockImplementation(async (route: string) => {
      if (route === SHIPPING_API_ROUTES.ownAccounts) return { services: [OWN_ACCOUNT_SERVICES.easyship], connections: [] }
      throw new Error('Invalid access token')
    })
    render(<OwnAccountsCard hostId="host-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect an account' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/API access token/), { target: { value: 'bad' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check and connect' }))
    expect(await within(dialog).findByText('Invalid access token')).toBeTruthy()
  })

  it('asks before disconnecting, saying what happens to labels already bought', async () => {
    availability = { loading: false, available: true, ownAccount: true, ownAccounts: true, platform: true }
    request.mockImplementation(async (route: string) =>
      route === SHIPPING_API_ROUTES.ownAccounts
        ? {
            services: [OWN_ACCOUNT_SERVICES.easyship],
            connections: [
              {
                kind: 'easyship',
                label: 'Easyship',
                role: 'labels',
                accountName: 'Candle Co',
                testMode: true,
                connectedAtMs: 1,
                followsParcels: false,
                webhookUrl: 'https://console.example.com/api/shipping/webhooks/easyship?org=org-1',
                settings: {},
              },
            ],
          }
        : { ok: true },
    )
    render(<OwnAccountsCard hostId="host-1" />)
    expect(await screen.findByText('Tracking not set up')).toBeTruthy()
    expect(screen.getByText('Test')).toBeTruthy()
    // One label platform at a time: nothing else to connect.
    expect(screen.queryByRole('button', { name: 'Connect an account' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/New labels and rates use the platform’s carrier accounts/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }))
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(SHIPPING_API_ROUTES.ownAccountsDisconnect, { body: { hostId: 'host-1', kind: 'easyship' } }),
    )
  })
})

describe('carrier accounts, connected with the provider’s own fields', () => {
  it('stays out of the way while the workspace ships through its own Easyship or Sendcloud account', () => {
    availability = { loading: false, available: true, ownAccount: true }
    const { container } = render(<CarrierAccountsCard hostId="host-1" />)
    expect(container.innerHTML).toBe('')
    expect(request).not.toHaveBeenCalled()
  })

  it('asks for the credentials a carrier type names, and no switch where the provider has none', async () => {
    availability = { loading: false, available: true, provider: 'EasyPost' }
    request.mockImplementation(async (route: string, options: { body?: Record<string, unknown> }) => {
      if (route === SHIPPING_API_ROUTES.carrierAccounts) {
        return {
          accounts: [{ id: 'ca_1', carrier: 'usps', carrierName: 'USPS', active: true, platformOwned: true, authorization: 'connected' }],
          canConnect: true,
          canToggle: false,
          connectable: [
            {
              carrier: 'DhlExpressAccount',
              label: 'DHL Express',
              flow: 'credentials',
              fields: [
                { key: 'account_number', label: 'DHL Account Number', secret: false },
                { key: 'password', label: 'Password', secret: true },
              ],
            },
          ],
        }
      }
      expect(options.body).toEqual({
        hostId: 'host-1',
        carrier: 'DhlExpressAccount',
        credentials: { account_number: '12345', password: 'pw' },
      })
      return { carrierAccount: { id: 'ca_dhl' } }
    })
    render(<CarrierAccountsCard hostId="host-1" />)
    expect(await screen.findByText('USPS')).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Connect your own account' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByLabelText('Account number')).toBeNull()
    fireEvent.change(within(dialog).getByLabelText('DHL Account Number'), { target: { value: '12345' } })
    fireEvent.change(within(dialog).getByLabelText('Password'), { target: { value: 'pw' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalledWith('Carrier account connected', { variant: 'success' }))
  })
})
