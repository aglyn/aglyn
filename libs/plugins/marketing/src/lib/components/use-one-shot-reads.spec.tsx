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
 *
 * @jest-environment jsdom
 */

/**
 * The org hub's per-site fan-out: each wanted site read ONCE, answers kept
 * across a page turn, forgotten when what is being asked changes — and an
 * answer to a question nobody is asking any more lands nowhere.
 */

import { act, renderHook } from '@testing-library/react'
import { useOneShotRead, useOrgSiteReads } from './use-one-shot-reads'

/** A read the test answers by hand, so ordering is the test's to decide. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('useOrgSiteReads', () => {
  it('reads each wanted site once, and keeps its answer across a page turn', async () => {
    const asked: string[] = []
    const read = (hostId: string) => {
      asked.push(hostId)
      return Promise.resolve(`${hostId}:answer`)
    }
    const { result, rerender } = renderHook(
      ({ sites }) => useOrgSiteReads(sites, read, ['v1']),
      { initialProps: { sites: ['a', 'b'] } },
    )
    await act(async () => undefined)
    expect(asked).toEqual(['a', 'b'])
    expect(result.current.reads.get('a')).toEqual({ value: 'a:answer', status: 'success' })

    rerender({ sites: ['c'] })
    await act(async () => undefined)
    rerender({ sites: ['a', 'b'] })
    await act(async () => undefined)
    // Back to a page already read: nothing asked twice.
    expect(asked).toEqual(['a', 'b', 'c'])
  })

  it('reports each site on its own, so one refusal is one row', async () => {
    const read = (hostId: string) =>
      hostId === 'bad' ? Promise.reject(new Error('denied')) : Promise.resolve(1)
    const { result } = renderHook(() => useOrgSiteReads(['good', 'bad'], read, []))
    await act(async () => undefined)
    expect(result.current.reads.get('good')?.status).toBe('success')
    expect(result.current.reads.get('bad')).toEqual({ value: null, status: 'error' })
  })

  it('forgets every answer when `deps` change, and drops a read from before', async () => {
    const pending = new Map<string, ReturnType<typeof deferred<string>>>()
    const read = (hostId: string) => {
      const next = deferred<string>()
      pending.set(hostId, next)
      return next.promise
    }
    const { result, rerender } = renderHook(
      ({ version }) => useOrgSiteReads(['a'], read, [version]),
      { initialProps: { version: 1 } },
    )
    const first = pending.get('a')!
    rerender({ version: 2 })
    const second = pending.get('a')!
    expect(second).not.toBe(first)

    // The answer to the old question arrives late, and is not the answer.
    await act(async () => first.resolve('stale'))
    expect(result.current.reads.get('a')).toEqual({ value: null, status: 'loading' })
    await act(async () => second.resolve('fresh'))
    expect(result.current.reads.get('a')).toEqual({ value: 'fresh', status: 'success' })
  })

  it('patches one site’s answer in place', async () => {
    const { result } = renderHook(() =>
      useOrgSiteReads(['a'], () => Promise.resolve({ on: true }), []),
    )
    await act(async () => undefined)
    act(() => result.current.patch('a', (value) => ({ ...value, on: false })))
    expect(result.current.reads.get('a')?.value).toEqual({ on: false })
  })
})

describe('useOneShotRead', () => {
  it('holds while the read says “not yet”, and answers once it can', async () => {
    const { result, rerender } = renderHook(
      ({ ready }) => useOneShotRead(() => (ready ? Promise.resolve(42) : null), [ready]),
      { initialProps: { ready: false } },
    )
    await act(async () => undefined)
    expect(result.current).toEqual({ value: null, status: 'loading' })
    rerender({ ready: true })
    await act(async () => undefined)
    expect(result.current).toEqual({ value: 42, status: 'success' })
  })
})
