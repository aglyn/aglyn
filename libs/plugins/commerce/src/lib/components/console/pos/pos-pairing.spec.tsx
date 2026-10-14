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
 * The one pairing flow (AGL-3712) the register and the POS devices card both
 * open: a code for the register asked about, a fresh code of the other kind
 * when the merchant switches to a kiosk, and the server's refusal told back.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { posRegistersSettingsHref, usePosPairing } from './pos-pairing.component'

const calls: any[] = []
let refuse = false

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: async (_user: unknown, url: string, init: any) => {
    const body = JSON.parse(init.body)
    calls.push({ url, body })
    if (refuse) {
      return { ok: false, status: 403, json: async () => ({ error: 'Not permitted' }) }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ code: body.mode === 'kiosk' ? '654321' : '123456', expiresAtMs: 1 }),
    }
  },
}))

function Harness({ onError }: { onError: (message: string) => void }) {
  const flow = usePosPairing({ user: { uid: 'u1' } as any, hostId: 'host-1', onError })
  return (
    <>
      <button type="button" onClick={() => void flow.open('reg-1', 'display', 'Front counter')}>
        {'open'}
      </button>
      {flow.dialog}
    </>
  )
}

beforeEach(() => {
  calls.length = 0
  refuse = false
})

describe('usePosPairing', () => {
  it('shows a code for the register, and a kiosk code when switched', async () => {
    render(<Harness onError={jest.fn()} />)
    fireEvent.click(screen.getByText('open'))
    expect(await screen.findByText('123456')).toBeTruthy()
    expect(screen.getByText('Pair a customer display')).toBeTruthy()
    expect(screen.getByText('For Front counter')).toBeTruthy()
    expect(screen.getByText(/\/kiosk\/commerce\/pos-display$/)).toBeTruthy()
    expect(calls[0]).toMatchObject({
      url: '/api/commerce/pos-display',
      body: { action: 'pairing-code', hostId: 'host-1', registerId: 'reg-1', mode: 'display' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Self-service kiosk' }))
    expect(await screen.findByText('654321')).toBeTruthy()
    expect(screen.getByText('Pair a self-service kiosk')).toBeTruthy()
    expect(screen.getByText(/\/kiosk\/commerce\/pos-kiosk$/)).toBeTruthy()
    expect(calls[1].body).toMatchObject({ registerId: 'reg-1', mode: 'kiosk' })

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByText('654321')).toBeNull())
  })

  it('tells the caller why no code was made', async () => {
    refuse = true
    const onError = jest.fn()
    render(<Harness onError={onError} />)
    fireEvent.click(screen.getByText('open'))
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Not permitted'))
    expect(screen.queryByText('Pair a customer display')).toBeNull()
  })
})

describe('posRegistersSettingsHref', () => {
  it('points from the register page to the POS registers card', () => {
    expect(posRegistersSettingsHref('/acme/hosts/shop/pos')).toBe(
      '/acme/hosts/shop/products/pos#pos-registers',
    )
    expect(posRegistersSettingsHref(undefined)).toBeUndefined()
    expect(posRegistersSettingsHref('/acme/hosts/shop/products')).toBeUndefined()
  })
})
