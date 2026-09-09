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
 * AGL-2710 — the overlay chunk is fetched on navigation intent, never on mount.
 *
 * The overlay was moved into its own chunk (AGL-2706) to take MUI's `Modal`
 * stack and the inline platform logo off first paint. A warm-up that then
 * fetched it on a timer, on every page view, gave those bytes straight back:
 * a page metered per view pays the same for a chunk fetched late as for one
 * fetched eagerly, plus a round trip. The saving only exists while a visit
 * that navigates nowhere fetches nothing.
 *
 * These assert both halves — silence on mount is worthless if the chunk never
 * arrives before the click it exists to cover.
 *
 * What is counted is how many times the overlay module was EVALUATED, which a
 * module registry does once and then caches. Each case therefore runs in an
 * isolated registry, and renders with `react-dom/client` taken from that same
 * registry: a component rendered against a second copy of React finds a null
 * hook dispatcher, which is what a top-level testing-library import produces
 * here.
 */

// React's concurrent renderer warns unless updates are known to be wrapped.
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// `mock`-prefixed so jest allows the factory below to close over it.
let mockOverlayImports = 0

jest.mock('./loading-modal-overlay', () => {
  mockOverlayImports++
  return {
    __esModule: true,
    LoadingModalOverlay: () => null,
    default: () => null,
  }
})

/** Long enough for a warm-up on a microtask or a macrotask to have fired. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

const dispatchOn = (testId: string, type: string) => {
  const node = document.querySelector(`[data-testid="${testId}"]`)
  if (!node) throw new Error(`no node for ${testId}: ${document.body.innerHTML}`)
  node.dispatchEvent(new Event(type, { bubbles: true }))
}

/**
 * Mounts the modal over a link — intent is only intent when it lands on one —
 * and hands the case back a settled, freshly counted registry.
 */
async function withMountedModal(run: () => Promise<void> | void) {
  // `resetModules` rather than `isolateModules`: an isolated registry does not
  // carry the `jest.mock` above into it, so the component would import the real
  // overlay and the count would never move. React and the DOM renderer are
  // required from the same reset registry as the component — a component
  // rendered against a second copy of React finds a null hook dispatcher.
  jest.resetModules()
  mockOverlayImports = 0
  const host = document.createElement('div')
  document.body.append(host)
  const React = require('react')
  const { act } = require('react')
  const { createRoot } = require('react-dom/client')
  const LoadingModal = require('./loading-modal').default
  const root = createRoot(host)
  await act(async () => {
    root.render(
      React.createElement(
        LoadingModal,
        null,
        React.createElement(
          'a',
          { href: '/pricing' },
          React.createElement('span', { 'data-testid': 'inside' }, 'Pricing'),
        ),
        React.createElement('p', { 'data-testid': 'not-a-link' }, 'Prose'),
      ),
    )
  })
  try {
    await run()
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
}

describe('overlay warm-up', () => {
  it('fetches nothing on a page view that shows no navigation intent', async () => {
    await withMountedModal(async () => {
      await settle()
      expect(mockOverlayImports).toBe(0)
    })
  })

  it('fetches nothing when the pointer crosses something that is not a link', async () => {
    await withMountedModal(async () => {
      dispatchOn('not-a-link', 'pointerover')
      await settle()
      expect(mockOverlayImports).toBe(0)
    })
  })

  it.each(['pointerover', 'touchstart', 'focusin'])(
    'fetches the overlay when %s reaches a link',
    async (eventName) => {
      await withMountedModal(async () => {
        // From a node INSIDE the anchor: what a visitor points at is the label.
        dispatchOn('inside', eventName)
        await settle()
        expect(mockOverlayImports).toBe(1)
      })
    },
  )

  it('fetches once however many links the visitor crosses', async () => {
    await withMountedModal(async () => {
      for (let i = 0; i < 5; i++) dispatchOn('inside', 'pointerover')
      await settle()
      expect(mockOverlayImports).toBe(1)
    })
  })
})
