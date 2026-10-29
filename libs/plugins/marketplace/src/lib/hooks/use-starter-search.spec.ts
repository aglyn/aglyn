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

import { act, renderHook, waitFor } from '@testing-library/react'

/**
 * The starter search as "Choose your starter" asks it (AGL-4049): with the
 * person's own token, once typing settles, again for a new mode or filter,
 * and never letting a slow answer to an old search replace a newer one.
 */

const USER = { uid: 'member-1', getIdToken: async () => 'token' }
const mockFetch = jest.fn()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: USER }),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))

import { STARTER_SEARCH_SETTLE_MS, useStarterSearch, type StarterSearchInput } from './use-starter-search'

const ROW = {
  listingId: 'fp-starter-restaurant-base',
  displayName: 'Corner bistro',
  description: '',
  authorName: 'Aglyn',
  official: true,
  priceUsd: 0,
  previewImageUrl: null,
  facets: { kind: 'restaurant', base: 'starter', fonts: null, pages: 4, mode: 'base' },
  category: 'Restaurant & café',
}

const respond = (status: number, body: unknown) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body })

/** The URL of the n-th request, as a path and its parameters. */
const asked = (index: number) => {
  const url = new URL(String(mockFetch.mock.calls[index][1]), 'https://console.example')
  return { path: url.pathname, params: Object.fromEntries(url.searchParams.entries()) }
}

const BASE: StarterSearchInput = { orgId: 'org-1', mode: 'base', word: '' }

beforeEach(() => {
  mockFetch.mockReset().mockImplementation(() =>
    respond(200, { rows: [ROW], labels: { base: { starter: 'Starter' }, fonts: {} } }),
  )
})

afterEach(() => {
  jest.useRealTimers()
})

describe('useStarterSearch', () => {
  it('asks the starters route with the person’s token and reads the answer', async () => {
    const { result } = renderHook(() => useStarterSearch(BASE))
    expect(result.current.settled).toBe(false)
    await waitFor(() => expect(result.current.settled).toBe(true))
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][0]).toBe(USER)
    expect(asked(0)).toEqual({
      path: '/api/marketplace/starters',
      params: { orgId: 'org-1', mode: 'base', limit: '50' },
    })
    expect(result.current.rows).toEqual([ROW])
    expect(result.current.labels).toEqual({ base: { starter: 'Starter' }, fonts: {} })
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('asks nothing while the workspace resolves', async () => {
    const { result } = renderHook(() => useStarterSearch({ ...BASE, orgId: undefined }))
    await act(async () => undefined)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(result.current.settled).toBe(false)
  })

  it('waits for typing to settle, and asks once for the words that settled', async () => {
    jest.useFakeTimers()
    const { result, rerender } = renderHook((input: StarterSearchInput) => useStarterSearch(input), {
      initialProps: BASE,
    })
    await act(async () => undefined)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    rerender({ ...BASE, word: 'bis' })
    rerender({ ...BASE, word: 'bistro' })
    await act(async () => {
      jest.advanceTimersByTime(STARTER_SEARCH_SETTLE_MS - 1)
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    await act(async () => {
      jest.advanceTimersByTime(1)
    })
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(asked(1).params.q).toBe('bistro')
    expect(result.current.settled).toBe(true)
  })

  it('asks again at once for a new mode or filter, and for refresh', async () => {
    const { result, rerender } = renderHook((input: StarterSearchInput) => useStarterSearch(input), {
      initialProps: BASE,
    })
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    rerender({ ...BASE, mode: 'ai', filter: { kind: 'restaurant' } })
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
    expect(asked(1).params).toMatchObject({ mode: 'ai', kind: 'restaurant' })
    act(() => result.current.refresh())
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3))
    expect(asked(2)).toEqual(asked(1))
  })

  it('does not ask again for a filter that is the same search in a new object', async () => {
    const { rerender } = renderHook((input: StarterSearchInput) => useStarterSearch(input), {
      initialProps: { ...BASE, filter: { kind: 'restaurant' } },
    })
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    rerender({ ...BASE, filter: { kind: 'restaurant' } })
    await act(async () => undefined)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('keeps the newest answer when an older one arrives after it', async () => {
    let releaseOld: (value: unknown) => void = () => undefined
    mockFetch
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseOld = resolve
          }),
      )
      .mockImplementationOnce(() =>
        respond(200, { rows: [{ ...ROW, listingId: 'new' }], labels: {} }),
      )
    const { result, rerender } = renderHook((input: StarterSearchInput) => useStarterSearch(input), {
      initialProps: BASE,
    })
    rerender({ ...BASE, mode: 'ai' })
    await waitFor(() => expect(result.current.rows.map((row) => row.listingId)).toEqual(['new']))
    await act(async () => {
      releaseOld(await respond(200, { rows: [{ ...ROW, listingId: 'old' }], labels: {} }))
    })
    expect(result.current.rows.map((row) => row.listingId)).toEqual(['new'])
  })

  it('says why a search was refused, with the status that said so', async () => {
    mockFetch.mockImplementation(() =>
      respond(403, { error: 'Site starters are not available for this workspace yet' }),
    )
    const { result } = renderHook(() => useStarterSearch(BASE))
    await waitFor(() => expect(result.current.settled).toBe(true))
    expect(result.current.error).toEqual({
      message: 'Site starters are not available for this workspace yet',
      status: 403,
    })
    expect(result.current.rows).toEqual([])
  })

  it('names a lockdown for what it is, not as a broken search', async () => {
    mockFetch.mockImplementation(() =>
      respond(423, {
        error: 'locked',
        scope: 'feature',
        feature: 'marketplace-installs',
        reason: 'security',
        title: 'Marketplace installs are paused',
        message: 'Installing from the marketplace is temporarily disabled.',
        contact: 'support@aglyn.com',
      }),
    )
    const { result } = renderHook(() => useStarterSearch(BASE))
    await waitFor(() => expect(result.current.settled).toBe(true))
    expect(result.current.error?.status).toBe(423)
    expect(result.current.error?.message).not.toBe('locked')
    expect(result.current.error?.message).toContain('temporarily disabled')
  })

  it('says a request that never came back failed, with no status', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')))
    const { result } = renderHook(() => useStarterSearch(BASE))
    await waitFor(() => expect(result.current.settled).toBe(true))
    expect(result.current.error).toEqual({
      message: 'Starters could not be loaded. Check your connection and try again.',
      status: 0,
    })
  })
})
