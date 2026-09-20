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
import { useState } from 'react'
import { VariableTextField } from './variable-text-field.component'

const VARIABLES = [
  { name: 'page.name', label: 'Page name', description: 'What this page is called.' },
  { name: 'site.separator', label: 'Separator', description: 'Joins the two.' },
  { name: 'site.name', label: 'Site name', description: 'The site title.' },
]

/** Controlled, like every caller: the field never holds its own value. */
function Harness(props: { initial?: string }) {
  const [value, setValue] = useState(props.initial ?? '')
  return (
    <VariableTextField
      label="Title"
      value={value}
      onChange={setValue}
      variables={VARIABLES}
    />
  )
}

const input = () => screen.getByLabelText('Title') as HTMLInputElement

/**
 * Type into the field the way a person does: a value, and where the caret is
 * left afterwards.
 *
 * ⚠️ It must NOT assign `field.value` first. React patches the `value` setter
 * to track what it last saw, so a direct assignment updates that tracker —
 * and `fireEvent.change` setting the same value then looks like no change at
 * all, so `onChange` never fires. The input still SHOWS the new text, because
 * the DOM node was written to directly, which is what makes it look like the
 * component received it.
 */
function typeInto(text: string, caret = text.length) {
  fireEvent.change(input(), { target: { value: text, selectionStart: caret } })
}

describe('inserting a variable from the list', () => {
  it('offers every variable with the name that gets written', () => {
    render(<Harness />)
    fireEvent.click(screen.getByLabelText('Insert a variable'))
    for (const variable of VARIABLES) {
      expect(screen.getByText(variable.label)).toBeTruthy()
      expect(screen.getByText(new RegExp(`\\{\\{${variable.name}\\}\\}`))).toBeTruthy()
    }
  })

  it('writes the token, braces and all', () => {
    render(<Harness />)
    fireEvent.click(screen.getByLabelText('Insert a variable'))
    fireEvent.click(screen.getByText('Site name'))
    expect(input().value).toBe('{{site.name}}')
  })

  it('inserts AT THE CARET, not at the end', () => {
    // The whole reason the caret is read when the menu opens rather than when
    // an item is picked: opening the menu moves focus off the input, so a
    // later read returns 0 and the variable lands at the front of the title.
    render(<Harness initial="Pricing  | Aglyn" />)
    const field = input()
    field.setSelectionRange(8, 8)
    fireEvent.click(screen.getByLabelText('Insert a variable'))
    fireEvent.click(screen.getByText('Page name'))
    expect(input().value).toBe('Pricing {{page.name}} | Aglyn')
  })
})

describe('autocomplete while typing', () => {
  it('opens on `{{` and filters by what follows', () => {
    render(<Harness />)
    typeInto('Pricing {{si')
    expect(screen.getByText('Site name')).toBeTruthy()
    expect(screen.getByText('Separator')).toBeTruthy()
    expect(screen.queryByText('Page name')).toBeNull()
  })

  it('replaces what was typed rather than doubling the braces', () => {
    render(<Harness />)
    typeInto('Pricing {{site.n')
    fireEvent.click(screen.getByText('Site name'))
    expect(input().value).toBe('Pricing {{site.name}}')
  })

  it('reads the caret, so completing mid-title does not jump to the end', () => {
    render(<Harness />)
    typeInto('Pricing {{pa | Aglyn', 12)
    fireEvent.click(screen.getByText('Page name'))
    expect(input().value).toBe('Pricing {{page.name}} | Aglyn')
  })

  it('closes once the braces are complete', () => {
    render(<Harness />)
    typeInto('Pricing {{site.name}}')
    expect(screen.queryByText('Site name')).toBeNull()
  })

  it('stays out of the way of ordinary typing', () => {
    render(<Harness />)
    typeInto('Pricing and plans')
    expect(screen.queryByText('Page name')).toBeNull()
    expect(input().value).toBe('Pricing and plans')
  })
})
