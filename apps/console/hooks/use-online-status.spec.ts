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

import { act, renderHook } from '@testing-library/react'
import { StrictMode } from 'react'

import { useOnlineStatus } from './use-online-status'

/** jsdom defines `onLine` on the prototype; override it per case. */
function setOnLine(value: boolean | undefined) {
  Object.defineProperty(window.navigator, 'onLine', {
    value,
    configurable: true,
  })
}

/** Every listener currently bound, as `target:type` pairs. */
function trackListeners() {
  const bound: string[] = []
  const targets: [string, EventTarget][] = [
    ['window', window],
    ['document', document],
  ]
  const restore: (() => void)[] = []
  for (const [name, target] of targets) {
    const add = target.addEventListener.bind(target)
    const remove = target.removeEventListener.bind(target)
    const addSpy = jest
      .spyOn(target, 'addEventListener')
      .mockImplementation((type: any, listener: any, options?: any) => {
        bound.push(`${name}:${type}`)
        add(type, listener, options)
      })
    const removeSpy = jest
      .spyOn(target, 'removeEventListener')
      .mockImplementation((type: any, listener: any, options?: any) => {
        const at = bound.indexOf(`${name}:${type}`)
        if (at >= 0) bound.splice(at, 1)
        remove(type, listener, options)
      })
    restore.push(() => {
      addSpy.mockRestore()
      removeSpy.mockRestore()
    })
  }
  return { bound, restore: () => restore.forEach((fn) => fn()) }
}

afterEach(() => {
  setOnLine(true)
})

describe('useOnlineStatus', () => {
  it('reads the real connection on mount rather than assuming online', () => {
    // The trap: seeding state to `true` and correcting it in an effect. A tab
    // opened while already offline would render the healthy chrome first.
    setOnLine(false)
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(false)
  })

  it('reports online when the browser says so', () => {
    setOnLine(true)
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(true)
  })

  it('follows the connection dropping and coming back', () => {
    setOnLine(true)
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(true)

    act(() => {
      setOnLine(false)
      window.dispatchEvent(new Event('offline'))
    })
    expect(result.current).toBe(false)

    act(() => {
      setOnLine(true)
      window.dispatchEvent(new Event('online'))
    })
    expect(result.current).toBe(true)
  })

  it('re-reads when a backgrounded tab comes back', () => {
    // A machine that slept on one network and woke on another can miss the
    // online/offline pair entirely; visibility is the second chance.
    setOnLine(true)
    const { result } = renderHook(() => useOnlineStatus())

    act(() => {
      setOnLine(false)
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current).toBe(false)
  })

  it('never claims offline on a browser that does not report it', () => {
    // `undefined` is "no evidence", not "disconnected".
    setOnLine(undefined)
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(true)
  })

  it('removes exactly what it added, including under StrictMode', () => {
    // StrictMode mounts, tears down and remounts every subscription. An
    // asymmetric cleanup leaks one listener set per mount and leaves a stale
    // callback bound — the shape this repo has been bitten by before.
    const tracker = trackListeners()
    try {
      const { unmount } = renderHook(() => useOnlineStatus(), {
        wrapper: StrictMode,
      })
      expect(tracker.bound.sort()).toEqual([
        'document:visibilitychange',
        'window:offline',
        'window:online',
      ])
      unmount()
      expect(tracker.bound).toEqual([])
    } finally {
      tracker.restore()
    }
  })

  it('still updates after a StrictMode remount', () => {
    // The failure the symmetry protects: the surviving listener belongs to a
    // torn-down render and the second subscription never took, so the tab
    // keeps rendering the state it mounted with.
    setOnLine(true)
    const { result } = renderHook(() => useOnlineStatus(), {
      wrapper: StrictMode,
    })

    act(() => {
      setOnLine(false)
      window.dispatchEvent(new Event('offline'))
    })
    expect(result.current).toBe(false)
  })
})
