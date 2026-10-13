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

import { fireEvent, render, screen, within } from '@testing-library/react'
import { FormulaBuilderButton } from './formula-builder.component'
import { StructuredValueEditor } from './structured-value-editor.component'

/** Picks `option` from the MUI select labelled `label`. */
function choose(label: RegExp, option: string, container: HTMLElement = document.body) {
  fireEvent.mouseDown(within(container).getByRole('combobox', { name: label }))
  fireEvent.click(screen.getByRole('option', { name: option }))
}

describe('the dictionary editor writes JSON nobody typed (AGL-3757)', () => {
  it('adds a typed entry and stores the dictionary', () => {
    const onChange = jest.fn()
    render(
      <StructuredValueEditor
        shape="dictionary"
        value='{"name":"Pro"}'
        onChange={onChange}
      />,
    )
    expect(screen.getByDisplayValue('Pro')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }))
    const names = screen.getAllByLabelText('Entry name')
    fireEvent.change(names[1], { target: { value: 'annual' } })
    const types = screen.getAllByRole('combobox', { name: /Type/ })
    fireEvent.mouseDown(types[1])
    fireEvent.click(screen.getByRole('option', { name: 'Number' }))
    fireEvent.change(screen.getAllByLabelText('Value')[1], {
      target: { value: '39' },
    })
    expect(onChange).toHaveBeenLastCalledWith('{"name":"Pro","annual":39}')
  })

  it('edits a list item by item', () => {
    const onChange = jest.fn()
    render(
      <StructuredValueEditor shape="collection" value='["a","b"]' onChange={onChange} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove item 1' }))
    expect(onChange).toHaveBeenLastCalledWith('["b"]')
  })
})

describe('the formula builder fills the box (AGL-3757)', () => {
  it('builds money formatting from picked values', () => {
    const onUse = jest.fn()
    const onOpen = jest.fn()
    render(
      <FormulaBuilderButton
        current=""
        names={[{ value: 'price', label: 'price', group: 'Parameters' }]}
        onUse={onUse}
        onOpen={onOpen}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Build formula' }))
    expect(onOpen).toHaveBeenCalled()
    const dialog = screen.getByRole('dialog')
    choose(/Work out/, 'Format as money', dialog)
    choose(/Which/, 'price', dialog)
    expect(within(dialog).getByText("The box will read: '$' + format(price, 2)")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use formula' }))
    expect(onUse).toHaveBeenCalledWith("'$' + format(price, 2)")
  })

  it('layers on what the box held', () => {
    const onUse = jest.fn()
    render(<FormulaBuilderButton current="P1 + P2" names={[]} onUse={onUse} />)
    fireEvent.click(screen.getByRole('button', { name: 'Build formula' }))
    const dialog = screen.getByRole('dialog')
    choose(/Work out/, 'Round up', dialog)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use formula' }))
    expect(onUse).toHaveBeenCalledWith('ceil(P1 + P2)')
  })
})
