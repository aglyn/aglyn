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
import { LOYALTY_PROGRAM_DEFAULTS } from '../model/loyalty-program'
import { LoyaltyConnectionCard } from './loyalty-connection-card.component'
import { LoyaltyProgramCard } from './loyalty-program-card.component'

/**
 * The Rewards account card (AGL-3677): nothing at all on a deployment that
 * cannot seal a key; connect with the vendor's own fields and Connect in the
 * header; the built-in points it would replace asked about first; and, once
 * connected, what is waiting with Send again and Disconnect in the header.
 * The routes are a recorded mock.
 */

const request = jest.fn()
const enqueueSnackbar = jest.fn()

jest.mock('./loyalty-api', () => ({
  ...jest.requireActual('./loyalty-api'),
  useLoyaltyFetch: () => request,
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))

const CONNECTED = {
  configured: true,
  connection: {
    provider: 'yotpo',
    label: 'Yotpo Loyalty',
    accountLabel: null,
    keyLast4: '5678',
    connectedAtMs: 1,
    lastError: null,
    lastSyncedAtMs: null,
  },
  attention: [
    {
      id: 'host-1__earn__order-1',
      status: 'retry',
      points: 450,
      shortfallPoints: 0,
      kind: 'earn',
      orderId: 'order-12345678',
      email: 'pat@example.com',
      error: 'Yotpo is busy (503); it will be sent again.',
      attempts: 1,
      atMs: 1,
    },
  ],
  builtInPoints: null,
}

beforeEach(() => {
  request.mockReset()
  enqueueSnackbar.mockReset()
})

describe('LoyaltyConnectionCard', () => {
  it('draws nothing when the deployment cannot connect an account', async () => {
    request.mockResolvedValueOnce({ configured: false, connection: null, attention: [], builtInPoints: null })
    const { container } = render(<LoyaltyConnectionCard hostId="host-1" />)
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    expect(container.textContent).toBe('')
  })

  it('connects Yotpo with its GUID and API key from the header', async () => {
    request.mockResolvedValueOnce({ configured: true, connection: null, attention: [], builtInPoints: 0 })
    const onChanged = jest.fn()
    render(<LoyaltyConnectionCard hostId="host-1" onChanged={onChanged} />)
    fireEvent.change(await screen.findByTestId('loyalty-connector-provider'), { target: { value: 'yotpo' } })
    fireEvent.change(screen.getByTestId('loyalty-connector-guid'), { target: { value: 'guid-1' } })
    fireEvent.change(screen.getByTestId('loyalty-connector-apiKey'), { target: { value: 'key-1' } })
    request.mockResolvedValueOnce(CONNECTED)
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() =>
      expect(request).toHaveBeenLastCalledWith('loyalty/connection', {
        body: {
          hostId: 'host-1',
          action: 'connect',
          provider: 'yotpo',
          credentials: { guid: 'guid-1', apiKey: 'key-1' },
          replaceBalances: false,
        },
      }),
    )
    expect(await screen.findByText('Rewards account: Yotpo Loyalty')).toBeTruthy()
    expect(onChanged).toHaveBeenCalled()
    expect(screen.getByText(/API key ending 5678/)).toBeTruthy()
  })

  it('asks before replacing built-in points members hold', async () => {
    request.mockResolvedValueOnce({ configured: true, connection: null, attention: [], builtInPoints: 2_500 })
    render(<LoyaltyConnectionCard hostId="host-1" />)
    const connect = (await screen.findByRole('button', { name: 'Connect' })) as HTMLButtonElement
    expect(connect.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText(/The 2,500 built-in points members hold are set aside/))
    expect(connect.disabled).toBe(false)
  })

  it('lists what is waiting, sends it again and disconnects from the header', async () => {
    request.mockResolvedValueOnce(CONNECTED)
    render(<LoyaltyConnectionCard hostId="host-1" />)
    expect(await screen.findByText('+450 points for pat@example.com · order 12345678')).toBeTruthy()
    expect(screen.getByText(/Not sent yet · Yotpo is busy/)).toBeTruthy()
    request.mockResolvedValueOnce({ ...CONNECTED, attention: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Send again' }))
    await waitFor(() =>
      expect(request).toHaveBeenLastCalledWith('loyalty/connection', { body: { hostId: 'host-1', action: 'retry' } }),
    )
    expect(await screen.findByText('Everything has been sent.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    // A confirm step says what happens before anything is sent.
    expect(await screen.findByText(/built-in points go back to exactly what they were/)).toBeTruthy()
    expect(request).toHaveBeenCalledTimes(2)
    request.mockResolvedValueOnce({ configured: true, connection: null, attention: [], builtInPoints: 0 })
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }))
    await waitFor(() =>
      expect(request).toHaveBeenLastCalledWith('loyalty/connection', {
        body: { hostId: 'host-1', action: 'disconnect', confirm: true },
      }),
    )
    expect(await screen.findByText('Rewards account')).toBeTruthy()
  })
})

describe('LoyaltyProgramCard with a connected account', () => {
  it('names the account, hides the built-in-only offers and never sends which account owns the points', async () => {
    const program = { ...LOYALTY_PROGRAM_DEFAULTS, enabled: true, connected: 'smile' as const }
    const totals = { members: 1, outstandingPoints: 100, outstandingPointsCents: 100, outstandingCreditCents: 0 }
    request.mockResolvedValueOnce({ program, totals })
    render(<LoyaltyProgramCard hostId="host-1" />)
    expect(await screen.findByText(/kept in your Smile.io account/)).toBeTruthy()
    expect(screen.queryByLabelText('Members can refer friends')).toBeNull()
    expect(screen.queryByTestId('loyalty-welcomePoints')).toBeNull()
    fireEvent.change(screen.getByTestId('loyalty-earnPointsPerDollar'), { target: { value: '3' } })
    request.mockResolvedValueOnce({ program: { ...program, earnPointsPerDollar: 3 }, totals })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    expect(request.mock.calls[1][1].body.program).not.toHaveProperty('connected')
  })
})
