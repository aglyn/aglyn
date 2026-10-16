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
import type { HelpDeskConnectionView, HelpDeskProviderId } from '../model/connections'
import type { HelpDesksApi } from './help-desks-api'
import { HelpDesksCard } from './help-desks-card.component'

jest.mock('./help-desks-api', () => ({ useHelpDesksApi: () => null }))
const mockSnack = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: mockSnack }) }))
const mockConfirm = jest.fn(async () => undefined)
jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  useConfirmationContext: () => ({ confirm: mockConfirm }),
}))

const ALL: HelpDeskProviderId[] = ['gorgias', 'reamaze', 'kustomer', 'gladly', 'richpanel']

const connection = (overrides: Partial<HelpDeskConnectionView> = {}): HelpDeskConnectionView => ({
  id: 'h_reamaze',
  provider: 'reamaze',
  hostId: 'h',
  status: 'active',
  accountName: 'Acme',
  targetId: 'support',
  targets: [
    { id: 'support', name: 'Support' },
    { id: 'chat', name: 'Chat' },
  ],
  syncCustomers: true,
  sendTickets: false,
  backfillDone: true,
  lastRunAtMs: 1,
  lastSuccessAtMs: 1,
  nextRunAtMs: 2,
  lastError: null,
  consecutiveFailures: 0,
  totals: { customersPushed: 12, ordersPushed: 30, ticketsCreated: 0 },
  connectedAtMs: 1,
  ...overrides,
})

function api(overrides: Partial<HelpDesksApi> = {}): HelpDesksApi {
  return {
    list: jest.fn(async () => ({ available: ALL, connections: [] })),
    connect: jest.fn(async () => connection({ provider: 'gorgias', id: 'h_gorgias', targets: [], targetId: null })),
    update: jest.fn(async (_provider, settings) => connection(settings as never)),
    disconnect: jest.fn(async () => undefined),
    syncNow: jest.fn(async () => connection()),
    log: jest.fn(async () => ({ entries: [], nextBefore: null })),
    ...overrides,
  }
}

describe('the help desks card', () => {
  it('draws nothing where the deployment offers no help desk', async () => {
    const routes = api({ list: jest.fn(async () => ({ available: [], connections: [] })) })
    const { container } = render(<HelpDesksCard hostId="h" api={routes} />)
    await waitFor(() => expect(routes.list).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('draws one card with a row per help desk, each with Connect in its header', async () => {
    render(<HelpDesksCard hostId="h" api={api()} />)
    expect(await screen.findByText('Help desks')).toBeTruthy()
    for (const label of ['Gorgias', 'Re:amaze', 'Kustomer', 'Gladly', 'Richpanel']) {
      expect(screen.getByRole('region', { name: label })).toBeTruthy()
    }
    expect(screen.getAllByRole('button', { name: 'Connect' })).toHaveLength(5)
  })

  it('connects with the fields the help desk asks for, and never shows the key again', async () => {
    const routes = api()
    render(<HelpDesksCard hostId="h" api={routes} />)
    const row = await screen.findByRole('region', { name: 'Gorgias' })
    fireEvent.click(within(row).getByRole('button', { name: 'Connect' }))
    const submit = within(row).getByRole('button', { name: 'Check and connect' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(within(row).getByLabelText('Gorgias domain'), { target: { value: 'acme' } })
    fireEvent.change(within(row).getByLabelText('Gorgias username'), { target: { value: 'agent@example.com' } })
    const key = within(row).getByLabelText('Gorgias API key') as HTMLInputElement
    expect(key.type).toBe('password')
    fireEvent.change(key, { target: { value: 'key-123' } })
    fireEvent.click(submit)
    await waitFor(() =>
      expect(routes.connect).toHaveBeenCalledWith('gorgias', { account: 'acme', login: 'agent@example.com', token: 'key-123' }),
    )
    expect(await within(row).findByText('Syncing')).toBeTruthy()
    expect(within(row).queryByLabelText('Gorgias API key')).toBeNull()
  })

  it('keeps contact form messages off until the merchant switches them on', async () => {
    const routes = api({ list: jest.fn(async () => ({ available: ALL, connections: [connection()] })) })
    render(<HelpDesksCard hostId="h" api={routes} />)
    const row = await screen.findByRole('region', { name: 'Re:amaze' })
    const toggle = within(row).getByRole('switch', { name: 'Send contact form messages to Re:amaze' }) as HTMLInputElement
    expect(toggle.checked).toBe(false)
    fireEvent.click(toggle)
    await waitFor(() => expect(routes.update).toHaveBeenCalledWith('reamaze', { sendTickets: true }))
  })

  it('shows what a connection did and what it is waiting on', async () => {
    const routes = api({
      list: jest.fn(async () => ({
        available: ALL,
        connections: [connection({ lastError: 'Choose the Re:amaze channel contact form messages go to, and they start arriving.' })],
      })),
    })
    render(<HelpDesksCard hostId="h" api={routes} />)
    const row = await screen.findByRole('region', { name: 'Re:amaze' })
    expect(within(row).getByText('12 customers sent · 30 orders sent · 0 conversations opened')).toBeTruthy()
    expect(within(row).getByText(/Choose the Re:amaze channel/)).toBeTruthy()
    for (const label of ['Sync now', 'Pause', 'Sync log', 'Disconnect']) {
      expect(within(row).getByRole('button', { name: label })).toBeTruthy()
    }
  })

  it('disconnects once the merchant confirms', async () => {
    const routes = api({ list: jest.fn(async () => ({ available: ALL, connections: [connection()] })) })
    render(<HelpDesksCard hostId="h" api={routes} />)
    const row = await screen.findByRole('region', { name: 'Re:amaze' })
    fireEvent.click(within(row).getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(routes.disconnect).toHaveBeenCalledWith('reamaze'))
    expect(mockConfirm).toHaveBeenCalled()
  })
})
