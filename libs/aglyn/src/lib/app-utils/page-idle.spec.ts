/**
 * @jest-environment jsdom
 *
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
 * When third-party tags may start (AGL-3581): after `load` and an idle
 * period, each wait capped so a slow image or a busy thread cannot cost a
 * pageview.
 */
import {
  PAGE_IDLE_WAIT_CAP_MS,
  PAGE_LOAD_WAIT_CAP_MS,
  pageIdle,
  resetPageIdleForTests,
  subscribePageIdle,
} from './page-idle'

function setReadyState(state: DocumentReadyState): void {
  Object.defineProperty(document, 'readyState', {
    configurable: true,
    get: () => state,
  })
}

/** jsdom has no idle callback; the cases that need one install a double. */
type IdleWindow = { requestIdleCallback?: unknown }

beforeEach(() => {
  jest.useFakeTimers()
  resetPageIdleForTests()
})

afterEach(() => {
  jest.useRealTimers()
  setReadyState('complete')
  delete (window as unknown as IdleWindow).requestIdleCallback
})

describe('page idle', () => {
  it('waits for the load event, then for an idle period', () => {
    setReadyState('loading')
    const idleCalls: Array<{ cb: () => void; timeout?: number }> = []
    ;(window as unknown as IdleWindow).requestIdleCallback = (
      cb: () => void,
      options?: { timeout: number },
    ) => {
      idleCalls.push({ cb, timeout: options?.timeout })
      return idleCalls.length
    }
    const listener = jest.fn()
    subscribePageIdle(listener)

    expect(idleCalls).toHaveLength(0)
    window.dispatchEvent(new Event('load'))
    expect(idleCalls).toHaveLength(1)
    // The idle wait carries its own ceiling, so a busy thread cannot starve it.
    expect(idleCalls[0].timeout).toBe(PAGE_IDLE_WAIT_CAP_MS)
    expect(pageIdle()).toBe(false)

    idleCalls[0].cb()
    expect(pageIdle()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('moves on without `load` once the load wait is capped', () => {
    setReadyState('interactive')
    subscribePageIdle(() => undefined)

    jest.advanceTimersByTime(PAGE_LOAD_WAIT_CAP_MS - 1)
    expect(pageIdle()).toBe(false)
    jest.advanceTimersByTime(1)
    // No idle callback in this window: the fallback is one macrotask.
    jest.advanceTimersByTime(1)
    expect(pageIdle()).toBe(true)
  })

  it('stays reached for the life of the document', () => {
    subscribePageIdle(() => undefined)
    jest.advanceTimersByTime(1)
    expect(pageIdle()).toBe(true)

    const late = jest.fn()
    subscribePageIdle(late)
    expect(pageIdle()).toBe(true)
    // A subscriber after the fact is not called again: the snapshot answers it.
    expect(late).not.toHaveBeenCalled()
  })
})
