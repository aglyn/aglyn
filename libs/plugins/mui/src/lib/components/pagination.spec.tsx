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
import PaginationElement, { presets, schema } from './pagination'

const selectedPage = (): string | undefined =>
  document.querySelector('.Mui-selected')?.textContent ?? undefined

describe('Pagination element (AGL-1201)', () => {
  it('renders the page count it was given as a string', () => {
    // Number-typed attribute fields round-trip as strings; `count="4"`
    // would otherwise render no page items at all.
    render(<PaginationElement count={'4' as any} />)
    expect(screen.getByRole('button', { name: /page 4/i })).toBeTruthy()
  })

  it('starts on the chosen page', () => {
    render(<PaginationElement count={5} defaultPage={'3' as any} />)
    expect(selectedPage()).toBe('3')
  })

  it('clamps a starting page past the end back into range', () => {
    // Out of range, MUI selects nothing at all — the control renders
    // with no current page highlighted.
    render(<PaginationElement count={3} defaultPage={9} />)
    expect(selectedPage()).toBe('3')
  })

  it('tracks the page a visitor picks', () => {
    render(<PaginationElement count={5} />)
    fireEvent.click(screen.getByRole('button', { name: /page 2/i }))
    expect(selectedPage()).toBe('2')
  })

  it('never receives children, being a self-closing element', () => {
    const { container } = render(
      <PaginationElement count={3}>{'stray'}</PaginationElement>,
    )
    expect(container.textContent).not.toMatch(/stray/)
    expect(schema.flags?.selfClosing).toBeTruthy()
  })
})

describe('Pagination schema', () => {
  it('offers only the sizes MUI accepts here', () => {
    // The shared FIELD_SIZE preset also offers `inherit`, which
    // Pagination does not accept — it would render nothing different.
    const field = schema.attributes.find((a: any) => a.name === 'size') as any
    expect(field.options.map((option: any) => option.value)).toEqual([
      '',
      'small',
      'large',
    ])
  })

  it('leaves the shared size preset unmutated', () => {
    // Narrowing by spreading, not editing: mutating would strip
    // `inherit` from every other element that shares the preset.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { FIELD_SIZE } = require('../constants/field-presets')
    expect(FIELD_SIZE.options.map((option: any) => option.value)).toContain(
      'inherit',
    )
  })

  it('says out loud that it does not navigate by itself', () => {
    // A page picker that looks wired and is not is worse than one that
    // says what it is.
    expect(schema.description).toMatch(/interaction/i)
  })

  it('ships a preset with a page count already set', () => {
    expect((presets[0].data as any).props.count).toBeGreaterThan(1)
  })
})
