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
import { SALES_CHANNELS_API_ROUTES } from '../constants/bundle-common'
import { ChannelConnection } from './channel-connection.component'
import type { ConnectionState, SalesChannelsState } from './sales-channels-api'
import { SalesChannelsCard } from './sales-channels-card.component'

/**
 * The channel API connection inside the Google and Meta cards (AGL-3637,
 * phase 2): invisible unless the state route lists the provider, and once
 * listed, connect, choose a target, sync, disconnect and reconnect.
 */

const request = jest.fn()
const enqueueSnackbar = jest.fn()

jest.mock('./sales-channels-api', () => ({
  ...jest.requireActual('./sales-channels-api'),
  useSalesChannelsFetch: () => request,
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))

const DAY = 24 * 60 * 60 * 1000

function cardState(overrides: Partial<SalesChannelsState> = {}): SalesChannelsState {
  return {
    sells: true,
    store: {
      name: 'Candle Co',
      origin: 'https://candles.example.com',
      currency: 'USD',
      productPagesServed: true,
      carrierPricedCountries: [],
    },
    channels: ['google', 'meta', 'tiktok', 'pinterest', 'snapchat', 'microsoft'].map((id) => ({
      id: id as never,
      enabled: false,
      url: null,
      createdAtMs: null,
      rotatedAtMs: null,
      lastFetchAtMs: null,
      lastFetchAgent: null,
    })),
    legacy: { url: null, active: false },
    settings: { defaultBrand: '', defaultCondition: 'new', defaultGoogleCategory: '' },
    ...overrides,
  }
}

function connection(overrides: Partial<ConnectionState> = {}): ConnectionState {
  return {
    provider: 'google',
    targetId: '111',
    targetName: 'Candle Co US',
    targets: [
      { id: '111', name: 'Candle Co US' },
      { id: '222', name: 'Candle Co CA' },
    ],
    connectedAtMs: Date.UTC(2026, 9, 1),
    ...overrides,
  }
}

beforeEach(() => {
  request.mockReset()
  enqueueSnackbar.mockReset()
  window.history.replaceState(null, '', '/acme/sites/host-1/commerce/settings')
})

describe('the card draws a connection only where the deployment configured one', () => {
  it('draws no connection at all when the state names no provider', async () => {
    request.mockResolvedValueOnce(cardState())
    render(<SalesChannelsCard hostId="host-1" />)
    await screen.findByTestId('sales-channels-card')
    expect(screen.queryByTestId('sales-channel-connection-google')).toBeNull()
    expect(screen.queryByTestId('sales-channel-connection-meta')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull()
  })

  it('draws the Google connection inside the Google card and nothing for Meta when only Google is configured', async () => {
    request.mockResolvedValueOnce(cardState({ connect: { providers: [{ provider: 'google', connection: null }] } }))
    render(<SalesChannelsCard hostId="host-1" />)
    await screen.findByTestId('sales-channels-card')
    const google = within(screen.getByTestId('sales-channel-google'))
    expect(google.getByTestId('sales-channel-connection-google')).toBeTruthy()
    expect(google.getByRole('button', { name: 'Connect' })).toBeTruthy()
    expect(screen.queryByTestId('sales-channel-connection-meta')).toBeNull()
  })

  it('renders nothing without an entry', () => {
    const { container } = render(<ChannelConnection hostId="host-1" entry={null} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('ChannelConnection', () => {
  it('starts a connect with the page to come back to', async () => {
    request.mockRejectedValueOnce(new Error('Not permitted'))
    render(<ChannelConnection hostId="host-1" entry={{ provider: 'meta', connection: null }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(SALES_CHANNELS_API_ROUTES.connectStart, {
        body: { hostId: 'host-1', provider: 'meta', returnTo: window.location.href },
      }),
    )
    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalledWith('Not permitted', { variant: 'error' }))
  })

  it('syncs now and shows what the sync did', async () => {
    render(<ChannelConnection hostId="host-1" entry={{ provider: 'google', connection: connection() }} />)
    request.mockResolvedValueOnce({
      result: { sent: 12, failed: 1, errors: ['prod-9: Invalid GTIN'] },
      connection: connection({
        lastSyncAtMs: Date.UTC(2026, 9, 7),
        lastSyncResult: { sent: 12, failed: 1, errors: ['prod-9: Invalid GTIN'], deleted: 2 },
      }),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    await screen.findByText(/12 sent, 2 removed, 1 refused/)
    expect(request).toHaveBeenCalledWith(SALES_CHANNELS_API_ROUTES.sync, { body: { hostId: 'host-1', provider: 'google' } })
    expect(screen.getByText('prod-9: Invalid GTIN')).toBeTruthy()
    expect(enqueueSnackbar).toHaveBeenCalledWith('Sent 12 products; 1 were refused.', { variant: 'warning' })
  })

  it('does not offer a sync before an account is chosen', () => {
    render(
      <ChannelConnection hostId="host-1" entry={{ provider: 'google', connection: connection({ targetId: '', targets: [] }) }} />,
    )
    expect((screen.getByRole('button', { name: 'Sync now' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/reaches no accounts/)).toBeTruthy()
  })

  it('asks for a reconnect when a Meta grant is within a week of expiring', () => {
    render(
      <ChannelConnection
        hostId="host-1"
        entry={{
          provider: 'meta',
          connection: connection({ provider: 'meta', tokenExpiresAtMs: Date.now() + 3 * DAY }),
        }}
      />,
    )
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeTruthy()
    expect(screen.getByText(/Reconnect to keep syncing/)).toBeTruthy()
  })

  it('does not ask for a reconnect while the grant has weeks left', () => {
    render(
      <ChannelConnection
        hostId="host-1"
        entry={{
          provider: 'meta',
          connection: connection({ provider: 'meta', tokenExpiresAtMs: Date.now() + 40 * DAY }),
        }}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull()
  })

  it('disconnects after confirming', async () => {
    render(<ChannelConnection hostId="host-1" entry={{ provider: 'google', connection: connection() }} />)
    request.mockResolvedValueOnce({ connection: null })
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }))
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(SALES_CHANNELS_API_ROUTES.disconnect, {
        body: { hostId: 'host-1', provider: 'google' },
      }),
    )
    await screen.findByRole('button', { name: 'Connect' })
  })

  it('says what the callback did, for its own provider only, and clears it from the address', async () => {
    window.history.replaceState(null, '', '/acme/settings?tab=store&salesChannelsProvider=google&salesChannelsConnect=connected')
    render(
      <>
        <ChannelConnection hostId="host-1" entry={{ provider: 'meta', connection: null }} />
        <ChannelConnection hostId="host-1" entry={{ provider: 'google', connection: connection() }} />
      </>,
    )
    await screen.findByText(/Connected to Google Merchant Center/)
    expect(within(screen.getByTestId('sales-channel-connection-meta')).queryByRole('alert')).toBeNull()
    expect(window.location.search).toBe('?tab=store')
  })
})
