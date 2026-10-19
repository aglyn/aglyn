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
 * "Connect automatically" on the Custom domain card (AGL-3963).
 *
 * The widget's first duty is to be ABSENT: for a partial domain, for a
 * domain whose DNS provider cannot apply our template, and while the
 * discovery is out, it renders nothing at all, so the card is exactly the
 * card. Only a provider that can apply the records gets a button.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }
const mockEnqueue = jest.fn()
const mockFetch = jest.fn()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueue }),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))

import ConnectAutomatically, { domainConnectFailureMessage } from './connect-automatically.component'

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

/** Answers each route by its path, and records every call. */
function routes(answers: Record<string, unknown>) {
  mockFetch.mockImplementation(async (_user: unknown, url: string) => {
    const path = Object.keys(answers).find((key) => url.includes(key))
    return path ? json(answers[path]) : json({ error: 'nope' }, 404)
  })
}

const discoverCalls = () =>
  mockFetch.mock.calls.filter(([, url]) => String(url).includes('domain-connect/discover'))

beforeEach(() => {
  mockFetch.mockReset()
  mockEnqueue.mockReset()
  window.sessionStorage.clear()
})

describe('it draws nothing it cannot back', () => {
  it('renders nothing for a domain whose provider cannot apply our records', async () => {
    routes({ 'domain-connect/discover': { supported: false } })
    const { container } = render(<ConnectAutomatically hostId="host-1" domain="example.com" onConnected={jest.fn()} />)
    await waitFor(() => expect(discoverCalls()).toHaveLength(1), { timeout: 2000 })
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing and asks nothing for a domain still being typed', async () => {
    routes({ 'domain-connect/discover': { supported: true, providerName: 'Provider DNS' } })
    const { container } = render(<ConnectAutomatically hostId="host-1" domain="example.c" onConnected={jest.fn()} />)
    await act(() => new Promise((resolve) => setTimeout(resolve, 800)))
    expect(discoverCalls()).toHaveLength(0)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when discovery fails outright', async () => {
    mockFetch.mockRejectedValue(new Error('offline'))
    const { container } = render(<ConnectAutomatically hostId="host-1" domain="example.com" onConnected={jest.fn()} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled(), { timeout: 2000 })
    expect(container.innerHTML).toBe('')
  })

  it('asks once per pause in typing, not per keystroke', async () => {
    routes({ 'domain-connect/discover': { supported: false } })
    const { rerender } = render(<ConnectAutomatically hostId="host-1" domain="exampl" onConnected={jest.fn()} />)
    rerender(<ConnectAutomatically hostId="host-1" domain="example.co" onConnected={jest.fn()} />)
    rerender(<ConnectAutomatically hostId="host-1" domain="example.com" onConnected={jest.fn()} />)
    await waitFor(() => expect(discoverCalls()).toHaveLength(1), { timeout: 2000 })
    expect(String(discoverCalls()[0][1])).toContain('domain=example.com')
  })
})

describe('when the provider can apply the records', () => {
  it('offers one button that names the provider, and says what happens next', async () => {
    routes({ 'domain-connect/discover': { supported: true, providerName: 'Provider DNS' } })
    render(<ConnectAutomatically hostId="host-1" domain="example.com" onConnected={jest.fn()} />)
    expect(
      await screen.findByRole('button', { name: 'Connect automatically with Provider DNS' }, { timeout: 2000 }),
    ).toBeTruthy()
    expect(
      screen.getByText('Provider DNS will ask you to sign in and approve the change. No records to copy.'),
    ).toBeTruthy()
  })

  it('opens the provider in a popup, and connects when the return page says it is done', async () => {
    routes({
      'domain-connect/discover': { supported: true, providerName: 'Provider DNS' },
      'domain-connect/start': {
        url: 'https://dash.provider.example/apply?x=1',
        width: 640,
        height: 700,
        state: 'S'.repeat(43),
        providerName: 'Provider DNS',
      },
      'domain-connect/finish': { status: 'connected', code: null, providerName: 'Provider DNS', domain: 'example.com' },
    })
    const popup = { closed: false, location: { href: '' }, resizeTo: jest.fn(), moveTo: jest.fn(), close: jest.fn() }
    const open = jest.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    const onConnected = jest.fn()
    render(<ConnectAutomatically hostId="host-1" domain="example.com" onConnected={onConnected} />)
    fireEvent.click(await screen.findByRole('button', { name: /Connect automatically/ }, { timeout: 2000 }))
    await waitFor(() => expect(popup.location.href).toBe('https://dash.provider.example/apply?x=1'))
    expect(open).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Waiting for Provider DNS…')).toBeTruthy()
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { source: 'aglyn-domain-connect', outcome: 'applied' },
          origin: window.location.origin,
        }),
      )
    })
    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1))
    expect(mockEnqueue).toHaveBeenCalledWith('"example.com" connected', expect.objectContaining({ variant: 'success' }))
    const finish = mockFetch.mock.calls.find(([, url]) => String(url).includes('domain-connect/finish'))
    expect(JSON.parse(String(finish?.[2]?.body))).toEqual({ hostId: 'host-1', state: 'S'.repeat(43) })
    open.mockRestore()
  })

  it('says why in plain words when the start is refused, and leaves the records', async () => {
    mockFetch.mockImplementation(async (_user: unknown, url: string) =>
      String(url).includes('discover')
        ? json({ supported: true, providerName: 'Provider DNS' })
        : json({ error: 'That domain is already connected to another site', code: 'taken' }, 409),
    )
    const popup = { closed: false, location: { href: '' }, close: jest.fn() }
    const open = jest.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    render(<ConnectAutomatically hostId="host-1" domain="example.com" onConnected={jest.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /Connect automatically/ }, { timeout: 2000 }))
    expect(await screen.findByText('That domain is already connected to another site')).toBeTruthy()
    expect(popup.close).toHaveBeenCalled()
    open.mockRestore()
  })
})

describe('what a session that did not connect says', () => {
  it('speaks plainly, in American spelling, with no codes', () => {
    expect(domainConnectFailureMessage({ status: 'cancelled', code: 'access_denied', providerName: 'Provider DNS' })).toBe(
      'You canceled at Provider DNS, so nothing was changed.',
    )
    expect(domainConnectFailureMessage({ status: 'failed', code: 'provider:server_error', providerName: 'Provider DNS' })).toBe(
      'Provider DNS could not make the change. Try again, or add the records above.',
    )
    expect(domainConnectFailureMessage({ status: 'expired', code: 'dns-not-pointed', providerName: 'Provider DNS' })).toMatch(
      /48 hours/,
    )
  })
})
