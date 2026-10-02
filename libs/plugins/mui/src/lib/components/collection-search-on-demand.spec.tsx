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

import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { act, createElement } from 'react'
import { hydrateRoot } from 'react-dom/client'
import {
  CollectionEntries,
  CollectionSearch,
  ENTRIES_SEARCH_ATTRIBUTE,
  loadEntriesSearch,
  prepareEntriesSearch,
} from './collection'

/**
 * The fuzzy matcher is fetched on a reader's first keystroke, never with the
 * element (AGL-3401): `fuse.js` was 26 KB of the 68 KB every page placing a
 * collection element downloaded, and most of those pages have no search box
 * or a reader who never types in it. The entries block's search box — MUI's
 * InputBase, TextareaAutosize and Chip — is fetched only by a block that
 * turns search on (AGL-3438), which aglyn.com/press's does not.
 *
 * Each mock stands in for a chunk: its factory runs when the module is first
 * required, which under the test transform is exactly when the `import()`
 * inside the element runs. Its own file, so no other spec has loaded them
 * first — and the tests below run in order, each relying on what the one
 * before it fetched.
 */
const fuseModuleLoads = { count: 0 }
jest.mock('@aglyn/shared-util-vendor/fuse', () => {
  fuseModuleLoads.count += 1
  return jest.requireActual('@aglyn/shared-util-vendor/fuse')
})
const searchModuleLoads = { count: 0 }
jest.mock('./collection-entries-search', () => {
  searchModuleLoads.count += 1
  return jest.requireActual('./collection-entries-search')
})

const index = [
  {
    title: 'Design it live',
    excerpt: 'how besigner renders the page',
    url: '/blog/design-it-live',
  },
  {
    title: 'One platform, not a stack',
    excerpt: 'commerce forms media',
    url: '/blog/one-platform',
  },
]

const cards = [
  <article key="a">First card</article>,
  <article key="b">Second card</article>,
]

/**
 * A searching block's server HTML, rendered by a module registry of its own
 * that has the box loaded — as the server always has — while this file's
 * registry still has not.
 */
async function serverHtml(): Promise<string> {
  let html = ''
  await jest.isolateModulesAsync(async () => {
    const React = await import('react')
    const { renderToString } = await import('react-dom/server')
    const collection = await import('./collection')
    // What `prepareEntriesSearch` does where there is no `document`; jsdom
    // always has one, so the server case is `collection-entries-ssr.spec`'s.
    await collection.loadEntriesSearch()
    html = renderToString(
      React.createElement(
        collection.CollectionEntries,
        { search: true, searchIndex: index },
        ...cards,
      ),
    )
  })
  return html
}

describe('Collection search loads its parts on demand (AGL-3401, AGL-3438)', () => {
  let errors: string[]
  let spy: jest.SpyInstance
  beforeEach(() => {
    errors = []
    spy = jest
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => {
        errors.push(args.map(String).join(' '))
      })
  })
  afterEach(() => spy.mockRestore())
  /** Containers a test mounted by hand, which RTL's cleanup does not know. */
  const mounted: HTMLElement[] = []
  afterEach(() => {
    for (const container of mounted.splice(0)) container.remove()
  })

  it('renders an entries block with search off without fetching the box', () => {
    render(<CollectionEntries>{cards}</CollectionEntries>)
    expect(screen.getByText('First card')).toBeTruthy()
    expect(screen.queryByRole('search')).toBeNull()
    // Nothing on this page carries a searching block, so the browser does not
    // fetch the box ahead of hydration either.
    expect(prepareEntriesSearch(false)).toBeUndefined()
    expect(searchModuleLoads.count).toBe(0)
  })

  it('renders the standalone box without fetching the matcher, and fetches it on the first keystroke', async () => {
    render(<CollectionSearch searchIndex={index} />)
    // The field is on the page — it has to be, for the keystroke that loads
    // the matcher — and nothing has been fetched for it.
    const input = screen.getByRole('textbox', { name: 'Search entries' })
    expect(fuseModuleLoads.count).toBe(0)

    fireEvent.change(input, { target: { value: 'platfrom' } })
    // The same answer the static import gave, typo tolerance included, once
    // the fetch lands — and no "No matches" panel in the moment before it.
    expect(screen.queryByText(/No matches/)).toBeNull()
    expect(
      await screen.findByText('One platform, not a stack'),
    ).toBeTruthy()
    expect(screen.queryByText('Design it live')).toBeNull()
    expect(fuseModuleLoads.count).toBe(1)
    // The standalone box is its own element; it never needed the entries
    // block's searching variant.
    expect(searchModuleLoads.count).toBe(0)
  })

  it('hydrates a searching block’s server HTML untouched while its box is still loading', async () => {
    const html = await serverHtml()
    const serverLoads = searchModuleLoads.count
    expect(html).toContain(ENTRIES_SEARCH_ATTRIBUTE)
    expect(html).toContain('role="search"')

    const container = document.createElement('div')
    container.innerHTML = html
    // Production hoists emotion's server styles to <head>; so does this.
    for (const style of Array.from(
      container.querySelectorAll('style[data-emotion]'),
    )) {
      document.head.appendChild(style)
    }
    document.body.appendChild(container)
    mounted.push(container)
    const markup = container.innerHTML

    // The server HTML says a searching block is about to hydrate, so the
    // browser fetches the box with the element instead of after it.
    const prepared = prepareEntriesSearch(false)
    expect(prepared).toBeInstanceOf(Promise)

    const recovered: string[] = []
    const client: ReactElement = createElement(
      CollectionEntries,
      { search: true, searchIndex: index },
      ...cards,
    )
    await act(async () => {
      hydrateRoot(container, client, {
        onRecoverableError: (error) =>
          recovered.push(String((error as Error)?.message ?? error)),
      })
    })
    await act(async () => {
      await prepared
    })
    expect(searchModuleLoads.count).toBe(serverLoads + 1)

    // Not one node changed, and React reported no mismatch through either
    // of its channels: the box hydrated into the markup the server drew.
    expect(container.innerHTML).toBe(markup)
    expect(recovered).toEqual([])
    expect(errors.filter((text) => /hydrat|did not match|#418/i.test(text))).toEqual([])

    // And it is live: a keystroke filters the cards in place.
    const input = container.querySelector('input') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { value: 'besigner' } })
    })
    expect(container.textContent).toContain('First card')
    expect(container.textContent).not.toContain('Second card')
  })

  it('filters an entries block once the box is here, and fetches each part once per visit', async () => {
    const loads = searchModuleLoads.count
    render(
      <CollectionEntries search searchIndex={index}>
        {cards}
      </CollectionEntries>,
    )
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'besigner' },
    })
    // Both parts are here from the tests above; this box starts with them and
    // answers synchronously, without a second fetch of either.
    expect(screen.getByText('First card')).toBeTruthy()
    expect(screen.queryByText('Second card')).toBeNull()
    expect(fuseModuleLoads.count).toBe(1)
    expect(searchModuleLoads.count).toBe(loads)
  })

  it('loads the box wherever the whole library is loading', async () => {
    // The console and the besigner, where an author can turn search on.
    await expect(prepareEntriesSearch(true)).resolves.toBeDefined()
    await expect(loadEntriesSearch()).resolves.toHaveProperty(
      'SearchingEntries',
    )
  })
})
