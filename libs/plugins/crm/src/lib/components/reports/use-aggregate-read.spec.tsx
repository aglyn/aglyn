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
 * A report answer is remembered for a minute and forgotten on Refresh
 * (AGL-2614).
 *
 * The section reads up to 3,500 documents to draw its windows, and it used
 * to read them again on every arrival. These assert the shape that stops
 * it: a keyed read asked twice within the TTL costs one read, a different
 * key costs its own, an invalidated prefix costs a fresh one, and a refusal
 * is never served from memory.
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import {
  invalidateAggregateReads,
  resetAggregateReadCache,
  useAggregateRead,
} from './use-aggregate-read'

jest.mock('firebase/firestore', () => ({
  getDocs: jest.fn(),
}))

beforeEach(() => {
  resetAggregateReadCache()
})

describe('useAggregateRead with a cache key', () => {
  it('answers the same question from memory within the TTL', async () => {
    const read = jest.fn(async () => 42)

    const first = renderHook(() =>
      useAggregateRead(read, ['a'], { cacheKey: 'org-1|30d|count' }),
    )
    await waitFor(() => expect(first.result.current.status).toBe('success'))
    expect(first.result.current.value).toBe(42)
    first.unmount()

    // The section reopened: a new mount, the same key.
    const second = renderHook(() =>
      useAggregateRead(read, ['a'], { cacheKey: 'org-1|30d|count' }),
    )
    await waitFor(() => expect(second.result.current.status).toBe('success'))
    expect(second.result.current.value).toBe(42)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('reads again for a different key, and after its prefix is forgotten', async () => {
    const read = jest.fn(async () => 7)

    const a = renderHook(() =>
      useAggregateRead(read, ['a'], { cacheKey: 'org-1|30d|count' }),
    )
    await waitFor(() => expect(a.result.current.status).toBe('success'))
    a.unmount()

    // A different period is a different question.
    const b = renderHook(() =>
      useAggregateRead(read, ['b'], { cacheKey: 'org-1|90d|count' }),
    )
    await waitFor(() => expect(b.result.current.status).toBe('success'))
    b.unmount()
    expect(read).toHaveBeenCalledTimes(2)

    // Refresh: everything under this org's prefix is forgotten.
    act(() => invalidateAggregateReads('org-1|'))
    const c = renderHook(() =>
      useAggregateRead(read, ['a'], { cacheKey: 'org-1|30d|count' }),
    )
    await waitFor(() => expect(c.result.current.status).toBe('success'))
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('never remembers a refusal', async () => {
    const read = jest
      .fn<Promise<number>, []>()
      .mockRejectedValueOnce(new Error('permission-denied'))
      .mockResolvedValueOnce(9)

    const denied = renderHook(() =>
      useAggregateRead(read, ['a'], { cacheKey: 'org-1|30d|count' }),
    )
    await waitFor(() => expect(denied.result.current.status).toBe('error'))
    denied.unmount()

    const retried = renderHook(() =>
      useAggregateRead(read, ['a'], { cacheKey: 'org-1|30d|count' }),
    )
    await waitFor(() => expect(retried.result.current.status).toBe('success'))
    expect(retried.result.current.value).toBe(9)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('joins a read already in the air for the same key, so two cards cost one read (AGL-2620)', async () => {
    let settle: (value: number) => void = () => undefined
    const read = jest.fn(
      () =>
        new Promise<number>((resolve) => {
          settle = resolve
        }),
    )
    // Two cards mounted together — the pipeline card and the forecast card
    // over the same window — before either answer has landed.
    const first = renderHook(() => useAggregateRead(read, ['a'], { cacheKey: 'org-1|30d|deals' }))
    const second = renderHook(() => useAggregateRead(read, ['a'], { cacheKey: 'org-1|30d|deals' }))
    expect(read).toHaveBeenCalledTimes(1)
    expect(first.result.current.status).toBe('loading')
    expect(second.result.current.status).toBe('loading')
    act(() => settle(1000))
    await waitFor(() => expect(first.result.current.value).toBe(1000))
    await waitFor(() => expect(second.result.current.value).toBe(1000))
    expect(read).toHaveBeenCalledTimes(1)
    // Settled, the read is out of the air: a later miss reads afresh.
    act(() => invalidateAggregateReads('org-1|'))
    const third = renderHook(() => useAggregateRead(read, ['a'], { cacheKey: 'org-1|30d|deals' }))
    expect(read).toHaveBeenCalledTimes(2)
    act(() => settle(7))
    await waitFor(() => expect(third.result.current.value).toBe(7))
  })

  it('THE CONTROL: an unkeyed read reads on every mount', async () => {
    const read = jest.fn(async () => 1)
    const first = renderHook(() => useAggregateRead(read, ['a']))
    await waitFor(() => expect(first.result.current.status).toBe('success'))
    first.unmount()
    const second = renderHook(() => useAggregateRead(read, ['a']))
    await waitFor(() => expect(second.result.current.status).toBe('success'))
    expect(read).toHaveBeenCalledTimes(2)
  })
})
