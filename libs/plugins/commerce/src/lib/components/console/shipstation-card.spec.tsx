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
 * The ShipStation card (AGL-3613): the URL, username and status names to
 * paste into ShipStation; a password only in an answer that carries one (a
 * connect, a new password, or Show); a confirm before it disconnects; and
 * nothing at all on a deployment that cannot keep a password.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockFetch = jest.fn()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'uid-admin' } }),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children, header, HeaderProps }: any) => (
    <section>
      <h2>{header}</h2>
      <div data-testid="card-header-action">{HeaderProps?.action}</div>
      {children}
    </section>
  ),
}))
jest.mock('@aglyn/aglyn', () => ({
  pluginDocsHelp: () => ({ title: 'ShipStation', excerpt: '', href: '#' }),
}))
import { ShipStationCard, shipStationEndpoint } from './shipstation-card.component'

const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })

beforeEach(() => {
  mockFetch.mockReset()
})

describe('ShipStation card', () => {
  it('offers Connect in the header when the site is not connected', async () => {
    mockFetch.mockResolvedValueOnce(json(200, { available: true, connected: false }))
    render(<ShipStationCard hostId="host-1" />)
    const header = screen.getByTestId('card-header-action')
    await waitFor(() => expect(header.textContent).toContain('Connect ShipStation'))
    expect(screen.queryByText('Username')).toBeNull()
  })

  it('shows the password from the answer that made it, beside the URL and username', async () => {
    mockFetch
      .mockResolvedValueOnce(json(200, { connected: false }))
      .mockResolvedValueOnce(json(200, { connected: true, username: 'aglyn-abc', password: 'secret-once', createdAtMs: 1 }))
    render(<ShipStationCard hostId="host-1" />)
    const connect = await screen.findByRole('button', { name: 'Connect ShipStation' })
    await act(async () => {
      fireEvent.click(connect)
    })
    expect(mockFetch.mock.calls[1][2]).toMatchObject({ method: 'POST' })
    expect(JSON.parse(mockFetch.mock.calls[1][2].body)).toEqual({ hostId: 'host-1', action: 'connect' })
    expect(await screen.findByText('secret-once')).toBeTruthy()
    expect(screen.getByText('aglyn-abc')).toBeTruthy()
    expect(screen.getByText(shipStationEndpoint('host-1'))).toBeTruthy()
    expect(screen.getByText('Paste these into ShipStation')).toBeTruthy()
    for (const name of ['unpaid', 'paid', 'shipped', 'canceled', 'on_hold']) {
      expect(screen.getByText(name)).toBeTruthy()
    }
  })

  it('hides the password of a connection read back until Show asks the server for it', async () => {
    mockFetch
      .mockResolvedValueOnce(json(200, { available: true, connected: true, username: 'aglyn-abc', createdAtMs: 1 }))
      .mockResolvedValueOnce(json(200, { available: true, connected: true, username: 'aglyn-abc', createdAtMs: 1, password: 'kept-sealed' }))
    render(<ShipStationCard hostId="host-1" />)
    expect(await screen.findByText(/Only a site admin can show it/)).toBeTruthy()
    expect(screen.queryByText('kept-sealed')).toBeNull()
    expect(screen.getByRole('button', { name: 'New password' })).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    })
    expect(JSON.parse(mockFetch.mock.calls[1][2].body)).toEqual({ hostId: 'host-1', action: 'reveal' })
    expect(await screen.findByText('kept-sealed')).toBeTruthy()
  })

  it('renders nothing on a deployment that cannot keep a password', async () => {
    mockFetch.mockResolvedValueOnce(json(200, { available: false, connected: false }))
    const { container } = render(<ShipStationCard hostId="host-1" />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(container.textContent).toBe(''))
  })

  it('asks before it disconnects, and only then posts', async () => {
    mockFetch
      .mockResolvedValueOnce(json(200, { connected: true, username: 'aglyn-abc', createdAtMs: 1 }))
      .mockResolvedValueOnce(json(200, { connected: false }))
    render(<ShipStationCard hostId="host-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Disconnect ShipStation?')).toBeTruthy()
    const confirm = screen.getAllByRole('button', { name: 'Disconnect' }).pop() as HTMLElement
    await act(async () => {
      fireEvent.click(confirm)
    })
    expect(JSON.parse(mockFetch.mock.calls[1][2].body)).toEqual({ hostId: 'host-1', action: 'disconnect' })
  })

  it('builds the endpoint on the console’s own origin', () => {
    expect(shipStationEndpoint('h_1', 'https://app.aglyn.com')).toBe('https://app.aglyn.com/api/commerce/shipstation/h_1')
  })
})
