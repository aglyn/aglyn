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

import * as Aglyn from '@aglyn/aglyn'
import { render, screen } from '@testing-library/react'
import {
  CollectionEntries,
  CollectionEntryBody,
  collectionEntriesSchema,
  collectionEntryBodySchema,
  collectionPresets,
} from './collection'

describe('Collection entries block (AGL-551)', () => {
  it('registers under the persisted compose-time component ids', () => {
    expect(collectionEntriesSchema.$id).toBe(
      Aglyn.COLLECTION_ENTRIES_COMPONENT_ID,
    )
    expect(collectionEntryBodySchema.$id).toBe(
      Aglyn.COLLECTION_ENTRY_BODY_COMPONENT_ID,
    )
  })

  it('renders its children as the entry template', () => {
    render(
      <CollectionEntries collectionSlug="blog" entriesLimit={3}>
        <span>{'{{entry.title}}'}</span>
      </CollectionEntries>,
    )
    expect(screen.getByText('{{entry.title}}')).toBeTruthy()
  })

  it('ships a preset with title/date/excerpt/Read-more defaults', () => {
    const preset = collectionPresets.find(
      (item) => item.displayName === 'Collection Entries',
    )
    const json = JSON.stringify(preset?.data)
    for (const token of [
      '{{entry.title}}',
      '{{entry.date}}',
      '{{entry.excerpt}}',
      '{{entry.url}}',
    ]) {
      expect(json).toContain(token)
    }
    expect(json).toContain('Read more')
  })
})

describe('Entry body block (AGL-551)', () => {
  it('renders markdown-lite as themed elements', () => {
    const markdown =
      '## Heading\n\nSome **bold** words and a ' +
      '[link](https://example.com).\n\n- one\n- two'
    const { container } = render(<CollectionEntryBody markdown={markdown} />)
    const heading = container.querySelector('h2')
    expect(heading?.textContent).toBe('Heading')
    expect(container.querySelector('strong')?.textContent).toBe('bold')
    const anchor = container.querySelector('a')
    expect(anchor?.getAttribute('href')).toBe('https://example.com')
    expect(container.querySelectorAll('li')).toHaveLength(2)
  })

  it('renders nothing on the site for an unresolved token', () => {
    const { container } = render(
      <CollectionEntryBody markdown="{{entry.body}}" />,
    )
    expect(container.textContent).toBe('')
  })

  it('shows an editor affordance inside editing surfaces', () => {
    render(
      <Aglyn.ScreenLinkContext.Provider value={{ suppressNavigation: true }}>
        <CollectionEntryBody markdown="{{entry.body}}" />
      </Aglyn.ScreenLinkContext.Provider>,
    )
    expect(
      screen.getByText(/Entry body — the \{\{entry\.body\}\} markdown/),
    ).toBeTruthy()
  })
})
