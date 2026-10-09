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
 * The media library's page read always settles (AGL-3660). The organization
 * Media page sat on "Loading media…" indefinitely because the page read was
 * a bare `getDocs` that a stalled multi-tab client never answers; the
 * library's `useMediaPages` cleared `loading` only when it settled.
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import { FirestoreStallError } from '@aglyn/tenant-feature-instance/hooks/firebase/firestore-bounded-read'
import { settleMediaPageRead } from './media-page-read'
import { useMediaPages } from './use-media-pages'

const page = (ids: string[]) => ({
  empty: ids.length === 0,
  docs: ids.map((id) => ({ id })),
})
type Page = ReturnType<typeof page>

const never = () => new Promise<never>(() => undefined)

describe('settleMediaPageRead', () => {
  it('passes a server-answered page straight through', async () => {
    const result = await settleMediaPageRead(async () => ({
      snapshot: page(['a']),
      stale: false,
    }))
    expect(result).toEqual({ snapshot: page(['a']), stale: false })
  })

  it("takes the server's late answer when it lands within the grace period", async () => {
    const result = await settleMediaPageRead<Page>(
      async () => ({
        snapshot: page([]),
        stale: true,
        fresh: Promise.resolve(page(['a', 'b'])),
      }),
      { graceMs: 50 },
    )
    expect(result).toEqual({ snapshot: page(['a', 'b']), stale: false })
  })

  it("falls back to the cache's rows, marked stale, when the server stays silent", async () => {
    const result = await settleMediaPageRead<Page>(
      async () => ({ snapshot: page(['c']), stale: true, fresh: never() }),
      { graceMs: 10 },
    )
    expect(result).toEqual({ snapshot: page(['c']), stale: true })
  })

  it('REJECTS rather than calling an empty cache an empty library', async () => {
    await expect(
      settleMediaPageRead<Page>(
        async () => ({ snapshot: page([]), stale: true, fresh: never() }),
        { graceMs: 10 },
      ),
    ).rejects.toBeInstanceOf(FirestoreStallError)
  })
})

describe('useMediaPages over a stalled read', () => {
  it('leaves the loading state with an error the Retry notice can show', async () => {
    const fetchPage = jest.fn(async () => {
      const { snapshot } = await settleMediaPageRead<Page>(
        async () => ({ snapshot: page([]), stale: true, fresh: never() }),
        { graceMs: 10 },
      )
      return { docs: snapshot.docs, last: null, more: false }
    })
    const { result } = renderHook(() =>
      useMediaPages({ fetchPage, ready: true }),
    )
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.loadError).toBe('unavailable')
    expect(result.current.docs).toEqual([])
    await act(async () => undefined)
  })
})
