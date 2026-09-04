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
import { FormRenderer, useFormApi } from '../vendor/data-driven-forms'
import DataTableField from './data-table'

/**
 * Pasting a markdown table into a cell imports it (AGL-2568).
 *
 * The element's help string and its `rows` attribute both advertised this
 * import, and no handler existed: grepping the field for `onPaste` returned
 * nothing, so a pasted table flattened into the single cell it landed in.
 * These render the real field and fire a real paste, because the promise is
 * made by the component and the parser alone cannot keep it.
 */
const FormTemplate = ({ formFields }: any) => {
  const { handleSubmit } = useFormApi()
  return (
    <form onSubmit={handleSubmit}>
      {formFields}
      <button type="submit">{'Save'}</button>
    </form>
  )
}

const renderField = (initialValue: string) => {
  const onSubmit = jest.fn()
  render(
    <FormRenderer
      FormTemplate={FormTemplate}
      componentMapper={{ 'data-table': DataTableField }}
      onSubmit={onSubmit}
      initialValues={{ rows: initialValue }}
      schema={{
        fields: [{ component: 'data-table', name: 'rows', label: 'Rows' }],
      }}
    />,
  )
  return onSubmit
}

/** What the form would persist — the node prop is still one string. */
const persisted = (onSubmit: jest.Mock) => {
  fireEvent.click(screen.getByText('Save'))
  return onSubmit.mock.calls[onSubmit.mock.calls.length - 1][0].rows as string
}

const cell = (row: number, column: number) =>
  screen.getByLabelText(`Row ${row} column ${column}`) as HTMLInputElement

/** A paste, as the browser delivers one. */
const paste = (target: HTMLElement, text: string) =>
  fireEvent.paste(target, { clipboardData: { getData: () => text } })

/** The two-row grid an author lands on before importing anything. */
const STARTER = ['Feature | Us | Them', ' | | '].join('\n')

const COMPARISON = [
  '| Feature | Aglyn | Webflow |',
  '| --- | :---: | ---: |',
  '| Team seats | Band included | Core $19 per seat |',
  '| Source available | Apache 2.0 | Proprietary |',
].join('\n')

describe('importing a markdown table by pasting it (AGL-2568)', () => {
  it('fills the grid with the pasted table, rows and columns both', () => {
    renderField(STARTER)
    paste(cell(1, 1), COMPARISON)
    // Three rows where the starter had two, and the header the paste carried.
    expect(cell(1, 3).value).toBe('Webflow')
    expect(cell(2, 1).value).toBe('Team seats')
    expect(cell(3, 3).value).toBe('Proprietary')
    expect(screen.queryByLabelText('Row 4 column 1')).toBeNull()
  })

  it('stores the import in the same one string, with its alignments', () => {
    // The persisted shape does not change: still one pipe-delimited string,
    // with the alignment as a markdown divider row, so nothing downstream
    // has to learn that an import happened.
    const onSubmit = renderField(STARTER)
    paste(cell(1, 1), COMPARISON)
    const stored = persisted(onSubmit)
    expect(stored.split('\n')[0]).toBe('Feature | Aglyn | Webflow')
    expect(stored).toContain('--- | :---: | ---:')
    expect(stored).toContain('Source available | Apache 2.0 | Proprietary')
  })

  it('imports a table pasted into ANY cell, not just the first', () => {
    // The help string says "any cell", and an author reaching for the import
    // has no reason to click the top-left one first.
    const onSubmit = renderField(STARTER)
    paste(cell(2, 2), COMPARISON)
    expect(cell(2, 1).value).toBe('Team seats')
    expect(persisted(onSubmit).split('\n')[0]).toBe('Feature | Aglyn | Webflow')
  })

  it('keeps an escaped pipe inside a cell', () => {
    const onSubmit = renderField(STARTER)
    paste(cell(1, 1), 'Shell | Meaning\na \\| b | either a or b')
    expect(cell(2, 1).value).toBe('a | b')
    // …and it is re-escaped on the way back to the stored string, or the
    // next read would split that cell into two columns.
    expect(persisted(onSubmit)).toContain('a \\| b | either a or b')
  })

  it('leaves an ordinary cell paste to the browser', () => {
    // A one-line paste is a cell VALUE. Taking it over would break every
    // normal paste to serve the rare import, which is the wrong trade.
    const onSubmit = renderField(STARTER)
    const event = createPaste('Pro | Business')
    fireEvent(cell(1, 1), event)
    expect(event.defaultPrevented).toBe(false)
    // The grid is untouched: the browser, not this handler, types it in.
    expect(persisted(onSubmit)).toBe(STARTER)
  })

  it('says the import needs a cell, on the field that has none yet', () => {
    // The empty state offers a button and no cell at all, so the copy that
    // used to read "Or paste a markdown table into any cell" pointed at
    // something that was not there.
    renderField('')
    expect(screen.getByText(/Then paste a markdown table/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Start a table/i })).toBeTruthy()
  })
})

/** A paste event whose `defaultPrevented` can be read back. */
function createPaste(text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: () => text },
  })
  return event
}
