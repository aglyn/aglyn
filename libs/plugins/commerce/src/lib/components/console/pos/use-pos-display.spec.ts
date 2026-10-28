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

import { customerDisplayHost } from '@aglyn/aglyn/plugin-manager/plugin-customer-display'
import { act, renderHook } from '@testing-library/react'
import { posDisplayCall } from './pos-api'
import { posDisplayTipCents, usePosDisplay } from './use-pos-display'

jest.mock('./pos-api', () => ({
  ...jest.requireActual('./pos-api'),
  posDisplayCall: jest.fn(),
}))

describe('the tip the customer display shows (AGL-3608)', () => {
  const open = { status: 'pending', tipCents: 0 }

  it('adds a tip chosen for the next payment to the ones already taken', () => {
    expect(posDisplayTipCents(open, 146)).toBe(146)
    expect(posDisplayTipCents({ status: 'pending', tipCents: 200 }, 146)).toBe(346)
  })

  it('shows only the ledger once the sale is paid, and nothing before a sale', () => {
    expect(posDisplayTipCents({ status: 'paid', tipCents: 200 }, 146)).toBe(200)
    expect(posDisplayTipCents(null, 146)).toBe(0)
  })

  it('never shows a negative or fractional tip', () => {
    expect(posDisplayTipCents(open, -50)).toBe(0)
    expect(posDisplayTipCents(open, 99.6)).toBe(100)
  })
})

describe('the register offers its display to other plugins (AGL-4042)', () => {
  const call = posDisplayCall as jest.Mock
  const user = { uid: 'uid-1' }

  it('offers it through core’s seam while connected, and puts a plugin’s screen on it with a fresh prompt', async () => {
    call.mockImplementation(async (_user: unknown, body: { action: string }) =>
      body.action === 'state' ? { connected: true } : { ok: true },
    )
    const { unmount } = renderHook(() => usePosDisplay(user as never, 'host-1', 'reg-1'))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    const host = customerDisplayHost()
    expect(host).not.toBeNull()
    const screen = { pluginId: 'acme-forms', path: '/display-fill', params: { grant: 'g.1' } }
    expect(await host?.show(screen)).toBe(true)
    const push = call.mock.calls.find(([, body]) => body.action === 'push')?.[1]
    expect(push).toMatchObject({ action: 'push', hostId: 'host-1', registerId: 'reg-1', state: { mode: 'screen', screen } })
    expect(push.state.promptId).toMatch(/\S{8,}/)
    // Staff close it: the register is asked to take that plugin's screen off.
    expect(await host?.close?.('acme-forms')).toBe(true)
    expect(call.mock.calls.find(([, body]) => body.action === 'close-screen')?.[1]).toEqual({
      action: 'close-screen',
      hostId: 'host-1',
      registerId: 'reg-1',
      pluginId: 'acme-forms',
    })
    unmount()
    expect(customerDisplayHost()).toBeNull()
  })

  it('offers nothing while no display is connected', async () => {
    call.mockReset()
    call.mockResolvedValue({ connected: false })
    renderHook(() => usePosDisplay(user as never, 'host-1', 'reg-1'))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(customerDisplayHost()).toBeNull()
  })
})
