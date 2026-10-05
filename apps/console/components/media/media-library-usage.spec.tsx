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
 * The library toolbar's readout and the read behind it (AGL-3470): the files
 * line, the storage line, the meter, and the one request that resolves the
 * org's band. The wording itself is pinned by `media-storage-copy.spec.ts`;
 * this holds what is drawn and when.
 */

import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { MediaLibraryUsage } from './media-library-usage.component'
import { useMediaStorageBand } from './use-media-storage-band'

const MB = 1024 * 1024
/** Lets a settled request's state update land inside `act`. */
const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

const band = (overrides: Partial<Parameters<typeof MediaLibraryUsage>[0]['band']> = {}) => ({
  allowanceMb: 1000,
  usedBytes: 0,
  scopeBytes: 0,
  hardBand: true,
  ...overrides,
})

describe('MediaLibraryUsage', () => {
  it('draws no cap and no meter without a band', () => {
    render(<MediaLibraryUsage libraryCount={17} scopeBytes={4 * MB} band={null} />)
    expect(screen.getByText('17 files')).toBeTruthy()
    expect(screen.getByText('4.0 MB used')).toBeTruthy()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('draws no meter on an unlimited band', () => {
    render(
      <MediaLibraryUsage
        libraryCount={3}
        scopeBytes={4 * MB}
        band={band({ allowanceMb: Number.POSITIVE_INFINITY })}
      />,
    )
    expect(screen.getByText('4.0 MB used · unlimited storage')).toBeTruthy()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('meters the pooled total in the plan tone, warning as it nears the band', () => {
    const { rerender } = render(
      <MediaLibraryUsage
        libraryCount={3}
        scopeBytes={100 * MB}
        band={band({ usedBytes: 100 * MB, scopeBytes: 100 * MB })}
      />,
    )
    const meter = screen.getByRole('progressbar', { name: 'Storage used' })
    expect(meter.getAttribute('aria-valuenow')).toBe('10')
    expect(meter.className).toMatch(/colorPrimary/)

    rerender(
      <MediaLibraryUsage
        libraryCount={3}
        scopeBytes={850 * MB}
        band={band({ usedBytes: 850 * MB, scopeBytes: 850 * MB })}
      />,
    )
    expect(
      screen.getByRole('progressbar', { name: 'Storage used' }).className,
    ).toMatch(/colorWarning/)

    rerender(
      <MediaLibraryUsage
        libraryCount={3}
        scopeBytes={1200 * MB}
        band={band({ usedBytes: 1200 * MB, scopeBytes: 1200 * MB })}
      />,
    )
    const full = screen.getByRole('progressbar', { name: 'Storage used' })
    expect(full.className).toMatch(/colorError/)
    // Past the band the bar is full, not overflowing.
    expect(full.getAttribute('aria-valuenow')).toBe('100')
  })

  it('meters the pool, not this library, when others hold bytes', () => {
    render(
      <MediaLibraryUsage
        libraryCount={3}
        place={{ kind: 'folder', name: 'Project photos', count: 2 }}
        scopeBytes={4 * MB}
        band={band({ usedBytes: 500 * MB, scopeBytes: 4 * MB })}
      />,
    )
    expect(
      screen.getByText('2 files in Project photos · 3 in the library'),
    ).toBeTruthy()
    expect(screen.getByText(/^4\.0 MB here · 500\.0 MB of /)).toBeTruthy()
    expect(
      screen
        .getByRole('progressbar', { name: 'Storage used' })
        .getAttribute('aria-valuenow'),
    ).toBe('50')
  })
})

describe('useMediaStorageBand', () => {
  const answer = (body: unknown, ok = true) =>
    jest.fn(async () => ({ ok, status: ok ? 200 : 403, json: async () => body }))
  const user = { getIdToken: async () => 'token' } as any

  it('reads the band once for the library it is given', async () => {
    const fetcher = answer({
      allowanceMb: 1000,
      unlimited: false,
      usedBytes: 5,
      scopeBytes: 2,
      hardBand: true,
    })
    const { result, rerender } = renderHook(
      (props: { orgId?: string; hostId?: string }) =>
        useMediaStorageBand({ ...props, user, fetcher: fetcher as any }),
      { initialProps: { hostId: 'host-1' } },
    )
    await waitFor(() => expect(result.current?.allowanceMb).toBe(1000))
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(String((fetcher.mock.calls[0] as unknown[])[0])).toBe(
      '/api/media/storage?hostId=host-1',
    )
    // Re-rendering the same library costs nothing.
    rerender({ hostId: 'host-1' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('never hands one library’s answer to the next', async () => {
    let resolveSecond: (value: unknown) => void = () => undefined
    const fetcher = jest
      .fn()
      .mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          allowanceMb: 1000,
          unlimited: false,
          usedBytes: 5,
          scopeBytes: 2,
          hardBand: true,
        }),
      }))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve
          }),
      )
    const { result, rerender } = renderHook(
      (props: { orgId?: string; hostId?: string }) =>
        useMediaStorageBand({ ...props, user, fetcher }),
      { initialProps: { hostId: 'host-1' } as { orgId?: string; hostId?: string } },
    )
    await waitFor(() => expect(result.current).not.toBeNull())
    rerender({ orgId: 'org-1' })
    expect(result.current).toBeNull()
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    expect(String(fetcher.mock.calls[1][0])).toBe('/api/media/storage?orgId=org-1')
    resolveSecond({ ok: false, json: async () => ({}) })
    await flush()
    expect(result.current).toBeNull()
  })

  it('states no band when the read is refused', async () => {
    const fetcher = answer({ error: 'Not a site admin' }, false)
    const { result } = renderHook(() =>
      useMediaStorageBand({ hostId: 'host-1', user, fetcher: fetcher as any }),
    )
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    await flush()
    expect(result.current).toBeNull()
  })

  it('does not read while signed out', () => {
    const fetcher = answer({})
    renderHook(() =>
      useMediaStorageBand({ hostId: 'host-1', user: null, fetcher: fetcher as any }),
    )
    expect(fetcher).not.toHaveBeenCalled()
  })
})
