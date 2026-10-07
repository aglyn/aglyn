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
import type { MarketingConnectionView } from '../model/connections'
import type { MarketingPlatformsApi } from './marketing-platforms-api'
import { MarketingPlatformsCard } from './marketing-platforms-card.component'

jest.mock('./marketing-platforms-api', () => ({ useMarketingPlatformsApi: () => null }))
const mockSnack = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: mockSnack }) }))
const mockConfirm = jest.fn(async () => undefined)
jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  useConfirmationContext: () => ({ confirm: mockConfirm }),
}))

const connection = (overrides: Partial<MarketingConnectionView> = {}): MarketingConnectionView => ({
  id: 'h_klaviyo',
  provider: 'klaviyo',
  hostId: 'h',
  status: 'active',
  authKind: 'api-key',
  accountName: 'Acme',
  listId: 'L1',
  lists: [
    { id: 'L1', name: 'Main' },
    { id: 'L2', name: 'VIP' },
  ],
  tag: 'Aglyn',
  syncContacts: true,
  syncEvents: true,
  backfillDone: true,
  lastRunAtMs: 1,
  lastSuccessAtMs: 1,
  nextRunAtMs: 2,
  lastError: null,
  consecutiveFailures: 0,
  totals: { contactsPushed: 12, consentPulled: 3, eventsSent: 4 },
  connectedAtMs: 1,
  ...overrides,
})

function api(overrides: Partial<MarketingPlatformsApi> = {}): MarketingPlatformsApi {
  return {
    list: jest.fn(async () => ({ available: [], connections: [] })),
    connect: jest.fn(async () => connection()),
    update: jest.fn(async (_provider, settings) => connection(settings as never)),
    disconnect: jest.fn(async () => undefined),
    syncNow: jest.fn(async () => connection()),
    log: jest.fn(async () => ({ entries: [], nextBefore: null })),
    oauthStart: jest.fn(async () => 'https://login.test'),
    ...overrides,
  }
}

describe('the email platforms card', () => {
  it('draws nothing where the deployment offers no platform', async () => {
    const routes = api()
    const { container } = render(<MarketingPlatformsCard hostId="h" api={routes} />)
    await waitFor(() => expect(routes.list).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('connects with the merchant’s own key', async () => {
    const routes = api({
      list: jest.fn(async () => ({ available: [{ id: 'klaviyo' as const, apiKey: true, oauth: false }], connections: [] })),
    })
    render(<MarketingPlatformsCard hostId="h" api={routes} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
    fireEvent.change(screen.getByLabelText('Klaviyo private API key'), { target: { value: 'pk_123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check and connect' }))
    await waitFor(() => expect(routes.connect).toHaveBeenCalledWith('klaviyo', 'pk_123'))
    await waitFor(() =>
      expect(mockSnack).toHaveBeenCalledWith(expect.stringMatching(/Klaviyo is connected/), expect.anything()),
    )
    expect(screen.getByText('Syncing')).toBeTruthy()
  })

  it('offers OAuth only where the deployment registered the app', async () => {
    const routes = api({
      list: jest.fn(async () => ({ available: [{ id: 'mailchimp' as const, apiKey: true, oauth: true }], connections: [] })),
    })
    render(<MarketingPlatformsCard hostId="h" api={routes} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
    expect(screen.getByRole('button', { name: 'Connect with Mailchimp' })).toBeTruthy()
  })

  it('shows a connection with its actions in the header, its list, and what it has done', async () => {
    const routes = api({
      list: jest.fn(async () => ({ available: [{ id: 'klaviyo' as const, apiKey: true, oauth: false }], connections: [connection()] })),
    })
    render(<MarketingPlatformsCard hostId="h" api={routes} />)
    expect(await screen.findByText('12 contacts sent · 3 subscription changes read back · 4 events sent')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(routes.update).toHaveBeenCalledWith('klaviyo', { paused: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    await waitFor(() => expect(routes.syncNow).toHaveBeenCalledWith('klaviyo'))
  })

  it('shows the sync log in the shared list table, a page at a time', async () => {
    const entries = Array.from({ length: 12 }, (_, n) => ({ id: `e${n}`, atMs: 1000 - n, kind: 'run' as const, message: `Run ${n}` }))
    const routes = api({
      list: jest.fn(async () => ({ available: [{ id: 'klaviyo' as const, apiKey: true, oauth: false }], connections: [connection()] })),
      log: jest.fn(async () => ({ entries, nextBefore: null })),
    })
    render(<MarketingPlatformsCard hostId="h" api={routes} />)
    expect(await screen.findByText('Run 0')).toBeTruthy()
    // The shared footer starts on the smallest page size.
    expect(screen.queryByText('Run 11')).toBeNull()
  })

  it('asks before disconnecting, and disconnects only on yes', async () => {
    const routes = api({
      list: jest.fn(async () => ({ available: [{ id: 'klaviyo' as const, apiKey: true, oauth: false }], connections: [connection()] })),
    })
    render(<MarketingPlatformsCard hostId="h" api={routes} />)
    mockConfirm.mockRejectedValueOnce(new Error('cancelled'))
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1))
    expect(routes.disconnect).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(routes.disconnect).toHaveBeenCalledWith('klaviyo'))
  })

  it('says a connection that must be connected again, and its error', async () => {
    const routes = api({
      list: jest.fn(async () => ({
        available: [{ id: 'klaviyo' as const, apiKey: true, oauth: false }],
        connections: [connection({ status: 'reconnect', lastError: 'Klaviyo refused the connection: revoked' })],
      })),
    })
    render(<MarketingPlatformsCard hostId="h" api={routes} />)
    expect(await screen.findByText('Klaviyo refused the connection: revoked')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Connect again' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull()
  })
})
