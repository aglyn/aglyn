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
 * A signed marketplace plugin's element renders on the server, hydrates in a
 * boundary of its own, and stays off every other site's page (AGL-3390).
 *
 * The server registers a realm bundle's components before it renders, into a
 * registry every site's render shares. So the renderer draws a namespaced
 * component (`<identity>.<role>`) as unregistered on a site whose set does not
 * carry its identity. Where the site does run it, the browser registers the
 * component a moment after the document arrives, so the element waits for
 * that inside its own Suspense boundary and React keeps the server's HTML
 * until it can hydrate it.
 */

import * as Aglyn from '@aglyn/aglyn'
import { EnabledPluginsContext } from '@aglyn/aglyn/app-utils/enabled-plugins-context'
import { RealmElementsContext } from '@aglyn/aglyn/app-utils/realm-elements-context'
import { act } from '@testing-library/react'
import { type ReactNode, useEffect, useRef } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import TreeRoot from './tree-root'

const IDENTITY = 'aglyn.calculator'
/** Marks itself once it runs in the browser, which only a hydrated element does. */
const Total = () => {
  const ref = useRef<HTMLOutputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.dataset['hydrated'] = 'yes'
  }, [])
  return (
    <output ref={ref} data-testid="total">
      {'$42.00'}
    </output>
  )
}
const Heading = ({ children }: { children?: ReactNode }) => <h2>{children}</h2>

const node = (id: string, componentId: string, pluginId: string, children: unknown[] = []) => ({
  $id: id,
  componentId,
  pluginId,
  props: {},
  children,
})

const PAGE = () =>
  node('section', 'section', 'mui', [
    node('heading', 'heading', 'mui'),
    node('total', `${IDENTITY}.result`, IDENTITY),
  ])

const registerTotal = () =>
  Aglyn.components.registerComponent(Total as never, {
    $id: `${IDENTITY}.result`,
    pluginId: IDENTITY,
  } as never)

function page(
  enabled: readonly string[],
  loadFor?: (componentId: string) => Promise<void> | undefined,
) {
  return (
    <EnabledPluginsContext.Provider value={enabled}>
      <RealmElementsContext.Provider value={loadFor}>
        <TreeRoot node={PAGE() as never} />
      </RealmElementsContext.Provider>
    </EnabledPluginsContext.Provider>
  )
}

beforeEach(() => {
  Aglyn.components.registerComponent(Heading as never, { $id: 'heading', pluginId: 'mui' } as never)
  Aglyn.components.registerComponent(
    (({ children }: { children?: ReactNode }) => <section>{children}</section>) as never,
    { $id: 'section', pluginId: 'mui' } as never,
  )
})

afterEach(() => {
  for (const id of ['heading', 'section', `${IDENTITY}.result`]) {
    Aglyn.components.unregisterComponent(id)
  }
})

describe('a site that does not run the plugin (AGL-3390)', () => {
  it('draws the element as unregistered, however warm the server is', () => {
    registerTotal()
    const warmServer = renderToString(page(['mui']))
    Aglyn.components.unregisterComponent(`${IDENTITY}.result`)
    const browser = renderToString(page(['mui']))

    expect(warmServer).not.toContain('data-testid="total"')
    expect(warmServer).toBe(browser)
  })
})

describe('a site that runs it', () => {
  const SITE = ['mui', IDENTITY]

  it('renders the element on the server, inside a boundary of its own', () => {
    registerTotal()
    const html = renderToString(page(SITE))

    expect(html).toContain('data-testid="total"')
    // React's markers for a resolved Suspense boundary.
    expect(html).toMatch(/<!--\$-->.*data-testid="total".*<!--\/\$-->/s)
  })

  it('keeps the server HTML until the bundle registers, and then hydrates it', async () => {
    registerTotal()
    const container = document.createElement('div')
    container.innerHTML = renderToString(page(SITE))
    // The browser, before the bundle has run.
    Aglyn.components.unregisterComponent(`${IDENTITY}.result`)
    let finish!: () => void
    const loading = new Promise<void>((resolve) => {
      finish = resolve
    })
    const recoverable: unknown[] = []
    const total = () => container.querySelector<HTMLElement>('[data-testid="total"]')

    let root!: ReturnType<typeof hydrateRoot>
    await act(async () => {
      root = hydrateRoot(
        container,
        page(SITE, (id) => (id.startsWith(`${IDENTITY}.`) ? loading : undefined)),
        { onRecoverableError: (error) => recoverable.push(error) },
      )
    })
    // The server's HTML, still there and not yet hydrated.
    expect(total()?.textContent).toBe('$42.00')
    expect(total()?.dataset['hydrated']).toBeUndefined()

    await act(async () => {
      registerTotal()
      finish()
      await loading
    })

    expect(total()?.dataset['hydrated']).toBe('yes')
    expect(recoverable).toEqual([])
    act(() => root.unmount())
  })

  it('waits in its own boundary on a client render, and the rest of the page does not', async () => {
    let finish!: () => void
    const loading = new Promise<void>((resolve) => {
      finish = resolve
    })
    const container = document.createElement('div')
    const root = createRoot(container)

    // Awaited, so React can retry the boundary once the load settles.
    await act(async () => root.render(page(SITE, () => loading)))
    expect(container.querySelector('h2')).not.toBeNull()
    expect(container.querySelector('[data-testid="total"]')).toBeNull()

    await act(async () => {
      registerTotal()
      finish()
      await loading
    })
    expect(container.querySelector('[data-testid="total"]')).not.toBeNull()
    act(() => root.unmount())
  })
})
