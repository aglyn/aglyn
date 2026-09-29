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
import { CollectionEntries, CollectionSearch } from './collection'

/**
 * The fuzzy matcher is fetched on a reader's first keystroke, never with the
 * element (AGL-3401): `fuse.js` was 26 KB of the 68 KB every page placing a
 * collection element downloaded, and most of those pages have no search box
 * or a reader who never types in it.
 *
 * The mock stands in for the chunk: its factory runs when the module is first
 * required, which under the test transform is exactly when the `import()`
 * inside the element runs. Its own file, so no other spec has loaded it first.
 */
const fuseModuleLoads = { count: 0 }
jest.mock('@aglyn/shared-util-vendor/fuse', () => {
  fuseModuleLoads.count += 1
  return jest.requireActual('@aglyn/shared-util-vendor/fuse')
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

describe('Collection search loads its matcher on demand (AGL-3401)', () => {
  it('renders the box without fetching the matcher, and fetches it on the first keystroke', async () => {
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
  })

  it('filters an entries block once the matcher arrives, and fetches it once per visit', async () => {
    render(
      <CollectionEntries search searchIndex={index}>
        <article key="a">First card</article>
        <article key="b">Second card</article>
      </CollectionEntries>,
    )
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'besigner' },
    })
    // The previous test loaded it; this box starts with it and answers
    // synchronously, without a second fetch.
    expect(screen.getByText('First card')).toBeTruthy()
    expect(screen.queryByText('Second card')).toBeNull()
    expect(fuseModuleLoads.count).toBe(1)
  })
})
