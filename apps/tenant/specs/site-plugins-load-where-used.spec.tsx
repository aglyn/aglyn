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
 * A published page loads the site plugins it uses, and no others (AGL-3116).
 *
 * `blockingPlugins` is computed from the full composed document, withheld
 * lazy-panel subtrees included, so it is every plugin this page uses. The rest
 * used to be fetched as soon as the visitor reached for a link (AGL-2710), for
 * a later page that mostly never opened — every enabled plugin on any visit
 * that hovered a link. A later page names its own plugins in its props, and
 * `ensure` holds that navigation until they have registered.
 *
 * Both halves are asserted: a page that never fetched what it uses would be
 * cheap and broken.
 */

import { act, fireEvent, render } from '@testing-library/react'
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

describe('site plugins a page does not use', () => {
  it('blocks on the narrowed set and fetches nothing else on arrival', async () => {
    await renderPage(BLOCKING)
    // A suspended tree re-renders, so the blocking set may be asked for more
    // than once; what matters is that the rest were never asked for at all.
    expect(new Set(ensuredSets(ensure))).toEqual(new Set([BLOCKING.join(',')]))
  })

  it('are not fetched when the visitor reaches for a link', async () => {
    await renderPage(BLOCKING)
    const link = anchorInDocument()
    fireEvent.pointerOver(link)
    fireEvent.pointerDown(link)
    fireEvent.focus(link)
    // Give any listener that would fetch them the turn it needs to run.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(new Set(ensuredSets(ensure))).toEqual(new Set([BLOCKING.join(',')]))
  })

  it('does not defer when the server narrowed nothing', async () => {
    // No `blockingPlugins` means no narrowing was safe, so the page blocks on
    // the whole list and there is nothing left to hold back.
    await renderPage()
    expect(new Set(ensuredSets(ensure))).toEqual(new Set([ENABLED.join(',')]))
  })
})
