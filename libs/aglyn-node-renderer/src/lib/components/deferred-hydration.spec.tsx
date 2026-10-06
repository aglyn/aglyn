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
 * Static subtrees keep their server HTML through hydration (AGL-3581),
 * asserted through the real renderer, a REAL server render and a REAL
 * `hydrateRoot`. What each case reads is what a visitor could tell apart: is
 * the server's content on screen, and has its component run in the browser.
 */
import * as Aglyn from '@aglyn/aglyn'
import { act } from '@testing-library/react'
import { type ReactNode, useEffect, useRef } from 'react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { resetDeferredHydrationForTests } from './deferred-hydration'
import TreeRoot from './tree-root'

/** Records what the observer was given and lets a case say "it is near now". */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  readonly observed = new Set<Element>()
  constructor(readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this)
  }
  observe(element: Element): void {
    this.observed.add(element)
  }
  unobserve(element: Element): void {
    this.observed.delete(element)
  }
  disconnect(): void {
    this.observed.clear()
  }
  enter(element: Element): void {
    this.callback(
      [{ target: element, isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
  }
}

const STATIC = {
  lazyHydration: Aglyn.FEATURE_FLAG.ENABLED,
}
const STATIC_ROOT = {
  lazyHydration: Aglyn.FEATURE_FLAG.ENABLED,
  childrenInRoot: Aglyn.FEATURE_FLAG.ENABLED,
}

/** A plain container: everything it is given lands on its root element. */
function Box({ children, sx: _sx, ...rest }: Record<string, any>): ReactNode {
  return <div {...rest}>{children}</div>
}

/** Marks itself once it has run in the browser, which only a live element does. */
function Copy({ children, sx: _sx, ...rest }: Record<string, any>): ReactNode {
  const ref = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.dataset['live'] = 'yes'
  }, [])
  return (
    <p {...rest} ref={ref}>
      {'Every page, one place'}
      {children}
    </p>
  )
}

const node = (id: string, componentId: string, children: unknown[] = []) => ({
  $id: id,
  componentId,
  pluginId: 'test',
  props: {},
  children,
})

const PAGE = (inner = 'copy') =>
  node('root', 'box', [node('section', 'box', [node('text', inner)])])

let container: HTMLDivElement
let root: Root | undefined
let recoverable: unknown[]

/** Server render, place the HTML, hydrate — the published page's first load. */
async function load(
  tree: () => ReactNode,
  { belowTheFold = true } = {},
): Promise<void> {
  container.innerHTML = renderToString(tree())
  if (belowTheFold) {
    // jsdom lays nothing out, so every rect is zero-sized at the top, which
    // reads as "in view". The page root stays in view; the rest is far down.
    jest
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: Element) {
        return (
          this.getAttribute('data-aglyn') === 'leaf:root'
            ? { top: 0, bottom: 5600 }
            : { top: 5000, bottom: 5600 }
        ) as DOMRect
      })
  }
  await act(async () => {
    root = hydrateRoot(container, tree(), {
      onRecoverableError: (error) => recoverable.push(error),
    })
  })
}

const site = (page = PAGE()) => <TreeRoot node={page as never} deferHydration />
const text = () => container.querySelector<HTMLElement>('[data-aglyn="leaf:text"]')
const section = () =>
  container.querySelector<HTMLElement>('[data-aglyn="leaf:section"]')

beforeEach(() => {
  recoverable = []
  resetDeferredHydrationForTests()
  FakeIntersectionObserver.instances = []
  ;(globalThis as any).IntersectionObserver = FakeIntersectionObserver
  Aglyn.components.registerComponent(Box as never, {
    $id: 'box',
    pluginId: 'test',
    flags: STATIC_ROOT,
  } as never)
  Aglyn.components.registerComponent(Copy as never, {
    $id: 'copy',
    pluginId: 'test',
    flags: STATIC,
  } as never)
  // Interactive: declares nothing.
  Aglyn.components.registerComponent(Copy as never, {
    $id: 'toggle',
    pluginId: 'test',
  } as never)
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  container.remove()
  jest.restoreAllMocks()
  delete (globalThis as any).IntersectionObserver
  for (const id of ['box', 'copy', 'toggle']) {
    Aglyn.components.unregisterComponent(id)
  }
})

describe('a static subtree far from the viewport', () => {
  it('keeps its server HTML, unhydrated, until the visitor nears it', async () => {
    await load(site)

    // On screen exactly as the server sent it — and not live.
    expect(text()?.textContent).toBe('Every page, one place')
    expect(text()?.dataset['live']).toBeUndefined()
    expect(recoverable).toEqual([])

    const io = FakeIntersectionObserver.instances[0]
    expect(io.observed.has(section()!)).toBe(true)
    await act(async () => io.enter(section()!))

    // Rendered in place: the same content, now live.
    expect(text()?.textContent).toBe('Every page, one place')
    expect(text()?.dataset['live']).toBe('yes')
    expect(recoverable).toEqual([])
  })

  it('hydrates at once when it is already near the viewport', async () => {
    await load(site, { belowTheFold: false })
    expect(text()?.dataset['live']).toBe('yes')
    expect(FakeIntersectionObserver.instances[0]?.observed.size ?? 0).toBe(0)
  })

  it('hydrates at once when anything in it is interactive', async () => {
    await load(() => site(PAGE('toggle')))
    expect(text()?.dataset['live']).toBe('yes')
  })

  it('fails open: no observer in this browser means hydrate now', async () => {
    delete (globalThis as any).IntersectionObserver
    await load(site)
    expect(text()?.dataset['live']).toBe('yes')
  })
})

describe('where it never holds', () => {
  it('a tree that did not ask — the editor canvas and the previews', async () => {
    await load(() => <TreeRoot node={PAGE() as never} />)
    expect(text()?.dataset['live']).toBe('yes')
    expect(FakeIntersectionObserver.instances).toHaveLength(0)
  })

  it('a subtree mounted after the hydration, which has no server HTML to keep', async () => {
    await load(() => site(node('root', 'box', []) as never))
    // A client-side navigation brings a page whose content was never sent.
    await act(async () => root!.render(site()))
    expect(text()?.textContent).toBe('Every page, one place')
    expect(text()?.dataset['live']).toBe('yes')
  })
})
