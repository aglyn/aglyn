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

import type * as Aglyn from '@aglyn/aglyn'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'

import ComponentPropsDialog, {
  cleanComponentProps,
  componentPropErrors,
  retypeComponentProp,
} from './component-props-dialog.component'

/**
 * The Component properties dialog declares what each field inside a component
 * can be bound to (AGL-2871): a Yes / no, a Choice with the answers a page
 * picks from, and the text-shaped kinds it had before.
 *
 * The rules that decide what is saved are pure and pinned first; the dialog
 * is then driven once end to end, because a Choice is the one kind whose
 * default depends on a list the author builds in the same dialog.
 */

describe('retypeComponentProp', () => {
  it('keeps a default across text-shaped kinds', () => {
    expect(
      retypeComponentProp({ name: 'cta', type: 'text', defaultValue: '/pricing' }, 'href'),
    ).toEqual({ type: 'href', options: undefined })
  })

  it('drops a default that would mean something else in the new kind', () => {
    // "Headline" as a Yes / no default would read as Yes, which nobody chose.
    expect(
      retypeComponentProp(
        { name: 'flag', type: 'text', defaultValue: 'Headline' },
        'boolean',
      ),
    ).toMatchObject({ type: 'boolean', defaultValue: undefined })
    expect(
      retypeComponentProp(
        { name: 'flag', type: 'boolean', defaultValue: 'true' },
        'choice',
      ),
    ).toMatchObject({ type: 'choice', defaultValue: undefined, options: [] })
  })

  it("drops a Choice's answers when it stops being one", () => {
    expect(
      retypeComponentProp(
        { name: 'tint', type: 'choice', options: [{ value: 'primary' }] },
        'text',
      ),
    ).toMatchObject({ type: 'text', options: undefined })
  })
})

describe('componentPropErrors', () => {
  it('names the problem with a name, and repeats', () => {
    const errors = componentPropErrors([
      { name: '', type: 'text' },
      { name: 'hero.title', type: 'text' },
      { name: 'tint', type: 'text' },
      { name: 'tint', type: 'text' },
    ])
    expect(errors.map((error) => error.name)).toEqual([
      'A name is required',
      'Letters, numbers and underscores only, not starting with a number',
      '',
      'Already used by another property',
    ])
  })

  it('needs a Choice to have answers, each with a value of its own', () => {
    const choice = (options: Aglyn.ReusableComponentPropOption[]) =>
      componentPropErrors([{ name: 'tint', type: 'choice', options }])[0]
        .choices
    expect(choice([])).toBe('Add at least one choice')
    expect(choice([{ value: 'primary' }, { value: ' ', label: 'Blank' }])).toBe(
      'Every choice needs a value',
    )
    expect(choice([{ value: 'primary' }, { value: 'primary ' }])).toBe(
      'Two choices share the value "primary"',
    )
    expect(choice([{ value: 'primary', label: 'Blue' }, { value: 'default' }])).toBe(
      '',
    )
  })

  it('asks nothing of the answers of a property that is not a Choice', () => {
    expect(componentPropErrors([{ name: 'cta', type: 'text' }])[0].choices).toBe(
      '',
    )
  })
})

describe('cleanComponentProps', () => {
  it('saves a Choice trimmed, with its default only while an answer holds it', () => {
    expect(
      cleanComponentProps([
        {
          name: ' tint ',
          type: 'choice',
          label: ' Chip tint ',
          options: [
            { value: ' primary ', label: ' Blue ' },
            { value: 'default', label: '' },
          ],
          defaultValue: 'default',
        },
        {
          name: 'style',
          type: 'choice',
          options: [{ value: 'outlined' }],
          // No answer holds this any more.
          defaultValue: 'pill',
        },
      ]),
    ).toEqual([
      {
        name: 'tint',
        type: 'choice',
        label: 'Chip tint',
        defaultValue: 'default',
        options: [{ value: 'primary', label: 'Blue' }, { value: 'default' }],
      },
      { name: 'style', type: 'choice', options: [{ value: 'outlined' }] },
    ])
  })

  it('keeps a Yes / no default of No, which is a real answer', () => {
    expect(
      cleanComponentProps([
        { name: 'flag', type: 'boolean', defaultValue: 'false' },
      ]),
    ).toEqual([{ name: 'flag', type: 'boolean', defaultValue: 'false' }])
  })

  it('saves no answers on a property that is not a Choice', () => {
    expect(
      cleanComponentProps([
        { name: 'cta', type: 'text', options: [{ value: 'stale' }] },
      ]),
    ).toEqual([{ name: 'cta', type: 'text' }])
  })

  it("saves an Icon's default with the path a published page draws, and only with it", () => {
    expect(
      cleanComponentProps([
        {
          name: 'productIcon',
          type: 'icon',
          defaultValue: 'mdiDatabase',
          defaultIconPath: 'M12,3C7.58,3',
        },
        // A path with no icon to belong to is not saved.
        { name: 'emptyIcon', type: 'icon', defaultIconPath: 'M0' },
        // Nor one a property kept after it stopped being an Icon.
        { name: 'cta', type: 'text', defaultValue: 'Go', defaultIconPath: 'M0' },
      ]),
    ).toEqual([
      {
        name: 'productIcon',
        type: 'icon',
        defaultValue: 'mdiDatabase',
        defaultIconPath: 'M12,3C7.58,3',
      },
      { name: 'emptyIcon', type: 'icon' },
      { name: 'cta', type: 'text', defaultValue: 'Go' },
    ])
  })
})

describe("an Icon property's type changes", () => {
  it('drops the default icon and its path together', () => {
    expect(
      retypeComponentProp(
        {
          name: 'productIcon',
          type: 'icon',
          defaultValue: 'mdiDatabase',
          defaultIconPath: 'M12,3C7.58,3',
        },
        'text',
      ),
    ).toMatchObject({
      type: 'text',
      defaultValue: undefined,
      defaultIconPath: undefined,
    })
  })
})

describe('declaring a Choice in the dialog (AGL-2871)', () => {
  /** Picks an option from an MUI select by the select's label. */
  const choose = async (label: string, option: string) => {
    fireEvent.mouseDown(screen.getByRole('combobox', { name: label }))
    fireEvent.click(
      within(await screen.findByRole('listbox')).getByRole('option', {
        name: option,
      }),
    )
  }

  it('saves the answers the author built, and a default picked from them', async () => {
    const onSave = jest.fn()
    render(
      <ComponentPropsDialog
        open
        value={[{ name: 'tint', type: 'text' }]}
        onClose={jest.fn()}
        onSave={onSave}
      />,
    )

    await choose('Type', 'Choice')
    // An empty Choice cannot be saved, and says why.
    expect(screen.getByText('Add at least one choice')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Save properties' }),
    ).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByRole('button', { name: 'Add choice' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add choice' }))
    const values = screen.getAllByRole('textbox', { name: 'Value' })
    const labels = screen
      .getAllByRole('textbox', { name: 'Label' })
      // The property's own Label field comes first.
      .slice(1)
    fireEvent.change(labels[0], { target: { value: 'Blue' } })
    fireEvent.change(values[0], { target: { value: 'primary' } })
    fireEvent.change(labels[1], { target: { value: 'Magenta' } })
    fireEvent.change(values[1], { target: { value: 'secondary' } })

    await choose('Default', 'Magenta')
    fireEvent.click(screen.getByRole('button', { name: 'Save properties' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0]).toEqual([
      {
        name: 'tint',
        type: 'choice',
        defaultValue: 'secondary',
        options: [
          { value: 'primary', label: 'Blue' },
          { value: 'secondary', label: 'Magenta' },
        ],
      },
    ])
  })
})
