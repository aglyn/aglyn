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

import { createPosBridgeHandlers } from './pos-bridge'
import type { ReaderStatus } from '../terminal/use-pos-terminal'

const READY: ReaderStatus = {
  connected: true,
  kind: 'tapToPay',
  name: 'Tap to Pay',
  connection: 'connected',
  batteryLevel: null,
  updating: false,
  updateProgress: null,
  updateRequired: false,
  updateAvailable: false,
  busy: false,
}

function setup(status: ReaderStatus) {
  const deps = {
    collect: jest.fn(async () => ({ status: 'collected' as const, paymentIntentId: 'pi_1', amountCents: 100, tipCents: 0 })),
    cancel: jest.fn(async () => ({ canceled: true })),
    status: () => status,
    onNeedsReader: jest.fn(),
  }
  return { deps, handlers: createPosBridgeHandlers(deps) }
}

describe('AglynPosBridge handlers', () => {
  it('exposes exactly three methods', () => {
    expect(Object.keys(setup(READY).handlers).sort()).toEqual(['cancel', 'collectCardPayment', 'readerStatus'])
  })

  it('collects through the terminal when a reader is ready', async () => {
    const { deps, handlers } = setup(READY)
    await expect(handlers.collectCardPayment({ paymentIntentId: 'pi_1' })).resolves.toMatchObject({ status: 'collected' })
    expect(deps.collect).toHaveBeenCalledWith({ paymentIntentId: 'pi_1' })
  })

  it('opens the readers panel instead of collecting with no reader', async () => {
    const { deps, handlers } = setup({ ...READY, connected: false })
    await expect(handlers.collectCardPayment({ paymentIntentId: 'pi_1' })).resolves.toEqual({
      status: 'failed',
      paymentIntentId: 'pi_1',
      message: expect.stringMatching(/Connect/),
    })
    expect(deps.onNeedsReader).toHaveBeenCalled()
    expect(deps.collect).not.toHaveBeenCalled()
  })

  it('waits out a reader update', async () => {
    const { deps, handlers } = setup({ ...READY, updateRequired: true })
    await expect(handlers.collectCardPayment({})).resolves.toMatchObject({
      status: 'failed',
      message: expect.stringMatching(/updating/),
    })
    expect(deps.collect).not.toHaveBeenCalled()
  })

  it('answers a malformed request as failed, never a rejection', async () => {
    const { deps, handlers } = setup(READY)
    deps.collect.mockRejectedValueOnce(new Error('The payment to collect is missing.'))
    await expect(handlers.collectCardPayment({})).resolves.toEqual({
      status: 'failed',
      paymentIntentId: '',
      message: 'The payment to collect is missing.',
    })
  })

  it('reports status without internals', async () => {
    await expect(setup(READY).handlers.readerStatus({})).resolves.toEqual({
      connected: true,
      kind: 'tapToPay',
      name: 'Tap to Pay',
      updateRequired: false,
    })
  })
})
