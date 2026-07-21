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
import { renderHook, waitFor } from '@testing-library/react'
import useHostSubdomains from './use-host-subdomains'

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
}))

const mockGetDoc = jest.fn()
jest.mock('firebase/firestore', () => ({
  doc: (_firestore: unknown, _collection: string, id: string) => ({ id }),
  getDoc: (ref: { id: string }) => mockGetDoc(ref.id),
}))

function indexEntry(subdomain: string | undefined) {
  return { get: () => subdomain }
}

describe('useHostSubdomains (AGL-672)', () => {
  beforeEach(() => {
    mockGetDoc.mockReset()
    mockGetDoc.mockImplementation((id: string) =>
      Promise.resolve(indexEntry(`sub-${id}`)),
    )
  })

  it('resolves subdomains from hostIndex', async () => {
    const { result } = renderHook(() => useHostSubdomains(['h1', 'h2']))
    await waitFor(() => expect(result.current.size).toBe(2))
    expect(result.current.get('h1')).toBe('sub-h1')
    expect(result.current.get('h2')).toBe('sub-h2')
  })

  it('ignores empty ids rather than requesting them', async () => {
    const { result } = renderHook(() =>
      useHostSubdomains(['h1', undefined, null]),
    )
    await waitFor(() => expect(result.current.size).toBe(1))
    expect(mockGetDoc).toHaveBeenCalledTimes(1)
  })

  it('deduplicates repeated ids within one call', async () => {
    renderHook(() => useHostSubdomains(['h1', 'h1', 'h1']))
    await waitFor(() => expect(mockGetDoc).toHaveBeenCalledTimes(1))
  })

  it('does not refetch an id it has already resolved', async () => {
    const { rerender } = renderHook(({ ids }) => useHostSubdomains(ids), {
      initialProps: { ids: ['h1'] as Array<string | undefined | null> },
    })
    await waitFor(() => expect(mockGetDoc).toHaveBeenCalledTimes(1))
    rerender({ ids: ['h1', 'h2'] })
    await waitFor(() => expect(mockGetDoc).toHaveBeenCalledTimes(2))
    expect(mockGetDoc).toHaveBeenNthCalledWith(2, 'h2')
  })

  /**
   * A host with no index entry must stay unresolved so the caller degrades to
   * the stored link. Resolving it to something wrong would send the user to
   * another host's page.
   */
  it('leaves a host without a subdomain unresolved', async () => {
    mockGetDoc.mockImplementation(() => Promise.resolve(indexEntry(undefined)))
    const { result } = renderHook(() => useHostSubdomains(['h1']))
    await waitFor(() => expect(mockGetDoc).toHaveBeenCalled())
    expect(result.current.has('h1')).toBe(false)
  })

  it('survives a read failure without throwing', async () => {
    mockGetDoc.mockImplementation(() => Promise.reject(new Error('denied')))
    const { result } = renderHook(() => useHostSubdomains(['h1']))
    await waitFor(() => expect(mockGetDoc).toHaveBeenCalled())
    expect(result.current.size).toBe(0)
  })
})
