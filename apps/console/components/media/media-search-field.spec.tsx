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
 * AGL-1460 #1 and #2, driven rather than reasoned about.
 *
 * The reported symptom was that changing the search text does not update the
 * results until you click **Load more**. The harness below is the real path
 * the library uses — the real field, the real matcher, the real state — with
 * only Firestore left out, and the assertion is the literal complaint:
 * type, and the list changes with NO other interaction.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { useMemo, useState } from 'react'

import { MediaSearchField } from './media-search-field.component'
import { parseMediaQuery, searchMedia } from './media-search'

const LIBRARY = [
  { $id: 'a', fileName: 'mock-hero-noshadow.png', tags: ['hero'] },
  { $id: 'b', fileName: 'mock-card-noshadow.png', tags: [] },
  { $id: 'c', fileName: 'mock-card-shadow.png', tags: [] },
  { $id: 'd', fileName: 'logo.svg', tags: ['brand'] },
]

/** The library's own wiring: text -> query -> visible cards, undebounced. */
function Harness() {
  const [search, setSearch] = useState('')
  const result = useMemo(
    () => searchMedia(LIBRARY, parseMediaQuery(search)),
    [search],
  )
  return (
    <div>
      <MediaSearchField
        value={search}
        onChange={setSearch}
        loaded={LIBRARY.length}
        total={LIBRARY.length}
        complete
        completing={false}
        truncated={false}
        mode={result.mode}
        matches={result.items.length}
      />
      <ul data-testid="grid">
        {result.items.map((item: any) => (
          <li key={item.$id}>{item.fileName}</li>
        ))}
      </ul>
    </div>
  )
}

const names = () =>
  Array.from(screen.getByTestId('grid').querySelectorAll('li')).map(
    (node) => node.textContent,
  )

const field = () => screen.getByLabelText('Search') as HTMLInputElement

describe('changing the text updates the results, with no other interaction (AGL-1460 #1)', () => {
  it('re-searches on every change of the box', () => {
    render(<Harness />)
    expect(names()).toHaveLength(4)

    fireEvent.change(field(), { target: { value: 'noshadow' } })
    expect(names()).toEqual([
      'mock-hero-noshadow.png',
      'mock-card-noshadow.png',
    ])

    // The reported bug: this second edit is the one that did not take.
    fireEvent.change(field(), { target: { value: 'logo' } })
    expect(names()).toEqual(['logo.svg'])

    fireEvent.change(field(), { target: { value: 'tag:hero' } })
    expect(names()).toEqual(['mock-hero-noshadow.png'])
  })

  it('restores the full set when the text is deleted', () => {
    render(<Harness />)
    fireEvent.change(field(), { target: { value: 'logo' } })
    expect(names()).toHaveLength(1)
    fireEvent.change(field(), { target: { value: '' } })
    expect(names()).toHaveLength(4)
  })
})

describe('the clear button (AGL-1460 #2)', () => {
  it('is absent while the box is empty', () => {
    render(<Harness />)
    expect(screen.queryByLabelText('Clear search')).toBeNull()
  })

  it('appears once there is something to clear, and clears it', () => {
    render(<Harness />)
    fireEvent.change(field(), { target: { value: 'logo' } })
    expect(names()).toHaveLength(1)

    fireEvent.click(screen.getByLabelText('Clear search'))

    expect(field().value).toBe('')
    expect(names()).toHaveLength(4)
    expect(screen.queryByLabelText('Clear search')).toBeNull()
  })
})

describe('the field reports the true scope of the search (AGL-1460)', () => {
  const props = {
    value: 'hero',
    onChange: () => undefined,
    loaded: 60,
    total: 174,
    complete: false,
    completing: false,
    truncated: false,
    mode: 'exact' as const,
    matches: 1,
  }

  it('names the partial window instead of "Searches loaded files"', () => {
    render(<MediaSearchField {...props} />)
    expect(screen.getByText('Searching 60 of 174 loaded files')).toBeTruthy()
  })

  it('claims the whole library only when it holds it', () => {
    render(<MediaSearchField {...props} loaded={174} complete />)
    expect(screen.getByText('Searched all 174 files')).toBeTruthy()
  })
})
