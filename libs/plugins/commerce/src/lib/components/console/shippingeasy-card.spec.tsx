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
 * The ShippingEasy card (AGL-3633): three keys in a dialog, posted once and
 * never shown back; the callback URL to paste; Send open orders with what it
 * did; a status chip that says when something needs attention; a confirm
 * before it disconnects; nothing at all on a deployment that cannot seal a
 * secret.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockFetch = jest.fn()
const mockSnack = jest.fn()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'uid-admin' } }),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockSnack }),
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
  pluginDocsHelp: () => ({ title: 'ShippingEasy', excerpt: '', href: '#' }),
}))
import { describeShippingEasySync, ShippingEasyCard, shippingEasyCallbackUrl } from './shippingeasy-card.component'

const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })
const CONNECTED = { available: true, connected: true, apiKeyEnding: 'b5c4', storeApiKeyEnding: '4eec', createdAtMs: 1 }

beforeEach(() => {
  mockFetch.mockReset()
  mockSnack.mockReset()
})

describe('ShippingEasy card', () => {
  it('reads its own connector’s status', async () => {
    mockFetch.mockResolvedValueOnce(json(200, { available: true, connected: false }))
    render(<ShippingEasyCard hostId="host-1" />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    expect(mockFetch.mock.calls[0][1]).toBe('/api/commerce/shipping-connectors?connector=shippingeasy&hostId=host-1')
    expect(await screen.findByRole('button', { name: 'Connect ShippingEasy' })).toBeTruthy()
  })

  it('posts the three keys from the dialog once all are filled, then shows the connection without them', async () => {
    mockFetch.mockResolvedValueOnce(json(200, { available: true, connected: false })).mockResolvedValueOnce(json(200, CONNECTED))
    render(<ShippingEasyCard hostId="host-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect ShippingEasy' }))
    const save = screen.getByRole('button', { name: 'Connect' })
    expect((save as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/^API key/), { target: { value: 'key-0000001' } })
    fireEvent.change(screen.getByLabelText(/^API secret/), { target: { value: 'secret-00001' } })
    fireEvent.change(screen.getByLabelText(/^Store API key/), { target: { value: 'store-000001' } })
    expect((save as HTMLButtonElement).disabled).toBe(false)
    await act(async () => {
      fireEvent.click(save)
    })
    expect(JSON.parse(mockFetch.mock.calls[1][2].body)).toEqual({
      hostId: 'host-1',
      connector: 'shippingeasy',
      action: 'connect',
      apiKey: 'key-0000001',
      apiSecret: 'secret-00001',
      storeApiKey: 'store-000001',
    })
    expect(await screen.findByText('Ends in b5c4')).toBeTruthy()
    expect(screen.getByDisplayValue(shippingEasyCallbackUrl('host-1'))).toBeTruthy()
    expect(screen.getByTestId('shippingeasy-status').textContent).toBe('Connected')
    expect(screen.queryByText('secret-00001')).toBeNull()
  })

  it('keeps the dialog open with the keys when the server refuses them', async () => {
    mockFetch
      .mockResolvedValueOnce(json(200, { available: true, connected: false }))
      .mockResolvedValueOnce(json(422, { error: 'ShippingEasy did not accept these keys' }))
    render(<ShippingEasyCard hostId="host-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect ShippingEasy' }))
    for (const label of [/^API key/, /^API secret/, /^Store API key/]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: 'value-000001' } })
    }
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    })
    expect(mockSnack).toHaveBeenCalledWith('ShippingEasy did not accept these keys', expect.objectContaining({ variant: 'error' }))
    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy()
  })

  it('says when something needs attention, and why', async () => {
    mockFetch.mockResolvedValueOnce(json(200, { ...CONNECTED, lastError: { message: 'Order 1001 was refused by ShippingEasy: bad zip', atMs: 5 } }))
    render(<ShippingEasyCard hostId="host-1" />)
    expect(await screen.findByText(/Order 1001 was refused/)).toBeTruthy()
    expect(screen.getByTestId('shippingeasy-status').textContent).toBe('Needs attention')
  })

  it('sends open orders and says what it did', async () => {
    mockFetch
      .mockResolvedValueOnce(json(200, CONNECTED))
      .mockResolvedValueOnce(json(200, { ...CONNECTED, sync: { sent: 2, already: 1, failed: 0, more: false } }))
    render(<ShippingEasyCard hostId="host-1" />)
    const send = await screen.findByRole('button', { name: 'Send open orders' })
    await act(async () => {
      fireEvent.click(send)
    })
    expect(JSON.parse(mockFetch.mock.calls[1][2].body)).toEqual({ hostId: 'host-1', connector: 'shippingeasy', action: 'sync' })
    expect(mockSnack).toHaveBeenCalledWith('2 orders sent to ShippingEasy, 1 already there.', expect.objectContaining({ variant: 'success' }))
  })

  it('asks before it disconnects, and only then posts', async () => {
    mockFetch.mockResolvedValueOnce(json(200, CONNECTED)).mockResolvedValueOnce(json(200, { available: true, connected: false }))
    render(<ShippingEasyCard hostId="host-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Disconnect ShippingEasy?')).toBeTruthy()
    const confirm = screen.getAllByRole('button', { name: 'Disconnect' }).pop() as HTMLElement
    await act(async () => {
      fireEvent.click(confirm)
    })
    expect(JSON.parse(mockFetch.mock.calls[1][2].body)).toEqual({ hostId: 'host-1', connector: 'shippingeasy', action: 'disconnect' })
  })

  it('renders nothing on a deployment that cannot seal a secret', async () => {
    mockFetch.mockResolvedValueOnce(json(200, { available: false, connected: false }))
    const { container } = render(<ShippingEasyCard hostId="host-1" />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(container.textContent).toBe(''))
  })

  it('builds the callback on the console’s own origin, and words a send', () => {
    expect(shippingEasyCallbackUrl('h_1', 'https://app.aglyn.com')).toBe('https://app.aglyn.com/api/commerce/shippingeasy/h_1')
    expect(describeShippingEasySync({ sent: 1, already: 0, failed: 2, more: true })).toBe(
      '1 order sent to ShippingEasy, 2 not sent. More open orders are waiting: select Send open orders again.',
    )
  })
})
