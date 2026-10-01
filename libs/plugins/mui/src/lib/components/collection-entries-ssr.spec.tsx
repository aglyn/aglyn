/**
 * @jest-environment node
 */

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
 * A searching entries block on the SERVER (AGL-3438).
 *
 * The block's search box is its own module, fetched on demand. On the server
 * that fetch has to have landed before the page renders: a render that
 * suspended there would hold the streamed shell, and a cold one would do it
 * on a page the ISR cache keeps. `@jest-environment node` is the point of the
 * file — `prepareEntriesSearch` tells the server from a browser by the
 * missing `document`, which jsdom always has — and it must stay the first
 * docblock or jest never reads it.
 *
 * `renderToString` throws on a component that suspends with no boundary
 * above it, which is exactly the render this file proves never happens.
 */

import { renderToString } from 'react-dom/server'
import { loadMuiBundle } from '../plugin'
import { ENTRIES_SEARCH_ATTRIBUTE } from './collection-entries'

const index = [
  { title: 'Design it live', excerpt: 'how besigner renders the page' },
  { title: 'One platform, not a stack', excerpt: 'commerce forms media' },
]

describe('a searching entries block renders on the server (AGL-3438)', () => {
  it('has the box by the time the element is registered, so the render never waits', async () => {
    expect(typeof document).toBe('undefined')
    // What a published page's server render goes through: the elements it
    // places, by id, and nothing else.
    const [entries] = await loadMuiBundle(['collectionEntries'])
    const CollectionEntries = entries?.component
    const markup = renderToString(
      <CollectionEntries search searchIndex={index}>
        <article>First card</article>
        <article>Second card</article>
      </CollectionEntries>,
    )
    expect(markup).toContain(ENTRIES_SEARCH_ATTRIBUTE)
    expect(markup).toContain('role="search"')
    expect(markup).toContain('placeholder="Search posts…"')
    expect(markup).toContain('First card')
  })

  it('renders a block with search off as the plain stack', async () => {
    const [entries] = await loadMuiBundle(['collectionEntries'])
    const CollectionEntries = entries?.component
    const markup = renderToString(
      <CollectionEntries collectionSlug="blog" entriesLimit={3}>
        <article>Only card</article>
      </CollectionEntries>,
    )
    expect(markup).not.toContain(ENTRIES_SEARCH_ATTRIBUTE)
    expect(markup).not.toContain('role="search"')
    // Compose-time attributes never reach the DOM.
    expect(markup).not.toMatch(/collectionslug|entrieslimit/i)
    expect(markup).toContain('Only card')
  })
})
