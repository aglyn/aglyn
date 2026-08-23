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

// A stand-in catalog: the real one loads ~6,600 icons asynchronously and
// none of this is about the catalog. Everything else — CardListItem, the
// grid, the control itself — is the real implementation.
const CATALOG = [
  { id: 'mdiLaptop', name: 'Laptop', path: 'M1 1h1z', tags: [] },
  { id: 'mdiCellphone', name: 'Cellphone', path: 'M2 2h1z', tags: [] },
  { id: 'mdiTablet', name: 'Tablet', path: 'M3 3h1z', tags: [] },
]

// Mocked at the SUBPATH, not the barrel (AGL-2486). The hook left
// `@aglyn/shared-ui-jsx`'s barrel because reaching it from there dragged
// `fuse.js` into the eager graph of every published customer page; this
// component is its only consumer and imports it directly now. A barrel
// override would silently stop intercepting and hand the component the real
// hook — which is exactly how this spec failed when the import moved.
jest.mock('@aglyn/shared-ui-jsx/hooks/mdi-icon/use-mdi-icons-fuzzy', () => ({
  useMdiIconsFuzzy: () => [CATALOG, CATALOG, jest.fn(), jest.fn()],
}))

// The grid is virtualized (react-virtuoso), which renders nothing in a
// zero-height jsdom container. Only the windowing is replaced; the cards it
// is handed are the real `CardListItem`.
jest.mock('@aglyn/shared-ui-jsx/components/grid-list', () => ({
  GridList: ({ items, renderItemContent }: any) => (
    <div>{items.map((item: any, i: number) => renderItemContent(item, i))}</div>
  ),
}))

import { IconSelectControl } from './icon-select.component'

/** The grid card for an icon, by its tooltip/label name. */
const cardFor = (name: string) => {
  const index = CATALOG.findIndex((icon) => icon.name === name)
  return document.querySelectorAll('.MuiCard-root')[index] as HTMLElement
}

/** The current-icon link, which opens and closes the collapse. */
const openPicker = () => {
  fireEvent.click(document.querySelector('.MuiLink-root') as HTMLElement)
}

describe('IconSelectControl two-step pick (AGL-2486)', () => {
  it('shows an unmistakable selected state on the clicked icon', () => {
    render(<IconSelectControl value="" onChange={jest.fn()} />)
    openPicker()

    const laptop = cardFor('Laptop')
    expect(laptop.getAttribute('aria-pressed')).toBe('false')
    expect(laptop.querySelector('[data-aglyn-icon-selected]')).toBeNull()

    fireEvent.click(laptop)

    expect(laptop.getAttribute('aria-pressed')).toBe('true')
    // A check badge, not just a tint: the report was that clicking looked
    // like nothing happened.
    expect(laptop.querySelector('[data-aglyn-icon-selected]')).not.toBeNull()
    expect(cardFor('Tablet').getAttribute('aria-pressed')).toBe('false')
  })

  it('does not apply the pick until Choose is pressed', () => {
    const onChange = jest.fn()
    render(<IconSelectControl value="" onChange={onChange} />)
    openPicker()

    fireEvent.click(cardFor('Laptop'))
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Choose' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('mdiLaptop')
  })

  it('leaves the value untouched when the pick is cancelled', () => {
    const onChange = jest.fn()
    render(<IconSelectControl value="mdiTablet" onChange={onChange} />)
    openPicker()

    fireEvent.click(cardFor('Laptop'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onChange).not.toHaveBeenCalled()

    // Re-opening must not carry the abandoned pick: pressing Choose now
    // would otherwise apply an icon the user walked away from.
    openPicker()
    expect(cardFor('Laptop').getAttribute('aria-pressed')).toBe('false')
    expect(cardFor('Tablet').getAttribute('aria-pressed')).toBe('true')
  })

  it('offers nothing to confirm until something new is picked', () => {
    render(<IconSelectControl value="mdiTablet" onChange={jest.fn()} />)
    openPicker()

    expect(
      (screen.getByRole('button', { name: 'Choose' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)

    fireEvent.click(cardFor('Laptop'))
    expect(
      (screen.getByRole('button', { name: 'Choose' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })
})
