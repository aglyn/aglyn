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
 * AGL-2710 — the non-blocking plugins wait for the visitor to reach for a link.
 *
 * AGL-1289 narrowed what a page BLOCKS on; the rest were then fetched straight
 * after hydration, which moved the wait off first render and left every byte
 * on the wire. Measured against a local production server, those bundles were
 * 208.9 KB across 23 requests on a page that used none of them — more than a
 * quarter of everything the page transferred, on a surface billed per view.
 *
 * `blockingPlugins` is computed from the full composed document, withheld
 * lazy-panel subtrees included, so what is held back is needed by a LATER
 * page. Link intent is when a later page stops being hypothetical, and it
 * still precedes the click.
 *
 * Both halves are asserted: a page that never fetched them would be cheap and
 * broken.
 */

import { act, fireEvent, render, waitFor } from '@testing-library/react'
import CatchAllClient from '../app/[host]/[scheme]/[[...slug]]/catch-all-client'
import { sitePluginLoader } from '../utils/site-plugin-loader'

const HOST = { $id: 'intent-host-1' }
const ENABLED = ['mui', 'forms', 'commerce', 'bookings']
const BLOCKING = ['mui']

/** The plugin id lists `ensure` was asked for, in call order. */
const ensuredSets = (spy: jest.SpyInstance) =>
  spy.mock.calls.map(([ids]) => (ids as string[]).join(','))

/**
 * Mounts and lets the suspense above it resolve: the page suspends on
 * `ensure` for the blocking set, so the effect that listens for intent has
 * not attached when `render` returns.
 */
async function renderPage(blockingPlugins?: string[]) {
  // `act` is what flushes the suspense retry: without it the tree stays
  // suspended, nothing commits, and the effect never attaches.
  await act(async () => {
    render(
      <CatchAllClient
        data={{ host: HOST as any }}
        nodes={{}}
        enabledPlugins={ENABLED}
        blockingPlugins={blockingPlugins}
      />,
    )
  })
}

/**
 * An anchor outside the rendered tree, because the listener is delegated on
 * the document — which is the point: anchors a plugin or a hand-built menu
 * renders have to count too.
 */
function anchorInDocument() {
  const link = document.createElement('a')
  link.href = '/pricing'
  link.textContent = 'Pricing'
  document.body.append(link)
  return link
}

let ensure: jest.SpyInstance

beforeEach(() => {
  // One promise per id list, as the real loader returns: `use()` suspends on
  // whatever it is handed, and a fresh promise per render suspends forever.
  const settled = new Map<string, Promise<void>>()
  ensure = jest.spyOn(sitePluginLoader, 'ensure').mockImplementation(((
    ids: string[],
  ) => {
    const key = ids.join(',')
    if (!settled.has(key)) settled.set(key, Promise.resolve())
    return settled.get(key)
  }) as any)
})

afterEach(() => {
  jest.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('non-blocking site plugins', () => {
  it('blocks on the narrowed set and fetches nothing else on arrival', async () => {
    await renderPage(BLOCKING)
    // A suspended tree re-renders, so the blocking set may be asked for more
    // than once; what matters is that the rest were never asked for at all.
    expect(new Set(ensuredSets(ensure))).toEqual(new Set([BLOCKING.join(',')]))
  })

  it('loads the full enabled list once the visitor reaches for a link', async () => {
    await renderPage(BLOCKING)
    const link = anchorInDocument()
    fireEvent.pointerOver(link)
    await waitFor(() =>
      expect(ensuredSets(ensure)).toContain(ENABLED.join(',')),
    )
  })

  it('asks once however many links the visitor crosses', async () => {
    await renderPage(BLOCKING)
    const link = anchorInDocument()
    for (let i = 0; i < 4; i++) fireEvent.pointerOver(link)
    await waitFor(() =>
      expect(ensuredSets(ensure)).toContain(ENABLED.join(',')),
    )
    expect(
      ensuredSets(ensure).filter((ids) => ids === ENABLED.join(',')),
    ).toHaveLength(1)
  })

  it('does not defer when the server narrowed nothing', async () => {
    // No `blockingPlugins` means no narrowing was safe, so the page blocks on
    // the whole list and there is nothing left to hold back.
    await renderPage()
    expect(new Set(ensuredSets(ensure))).toEqual(new Set([ENABLED.join(',')]))
  })
})
