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

import * as AglynValues from '@aglyn/aglyn'

import ComponentPropsDialog, {
  cleanComponentProps,
  componentPropErrors,
  describePropertyRule,
  propertyRuleFor,
  propertyRuleOperators,
  readPropertyCondition,
  renameConditionReferences,
  retypeComponentProp,
  writePropertyCondition,
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

/** Picks an option from an MUI select by the select's label. */
const choose = async (label: string, option: string) => {
  fireEvent.mouseDown(await screen.findByRole('combobox', { name: label }))
  fireEvent.click(
    within(await screen.findByRole('listbox')).getByRole('option', {
      name: option,
    }),
  )
}

/** Opens a dropdown drawn by the Attributes panel's select and picks an answer. */
const pickAnswer = async (label: string, option: string) => {
  const input = await screen.findByRole(
    'combobox',
    { name: label },
    { timeout: 10000 },
  )
  const field = input.closest('.MuiAutocomplete-root') as HTMLElement
  fireEvent.click(within(field).getByTitle('Open'))
  fireEvent.click(await screen.findByRole('option', { name: option }))
}

describe('declaring a Choice in the dialog (AGL-2871)', () => {
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

    // The Default is the dropdown a Choice is set with on every page.
    await pickAnswer('Default', 'Magenta')
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save properties' }),
      ).toHaveProperty('disabled', false),
    )
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
  }, 60000)
})

describe('the dialog offers every property kind (AGL-2893)', () => {
  it('lists every kind in the type picker, by group', async () => {
    render(
      <ComponentPropsDialog
        open
        value={[{ name: 'headline', type: 'text' }]}
        onClose={jest.fn()}
        onSave={jest.fn()}
      />,
    )
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Type' }))
    const listbox = await screen.findByRole('listbox')
    const offered = within(listbox)
      .getAllByRole('option')
      // Group headings are shown and cannot be picked.
      .filter((option) => option.getAttribute('aria-disabled') !== 'true')
      .map((option) => option.textContent)
    expect(offered.sort()).toEqual(
      Object.values(AglynValues.REUSABLE_PROP_KINDS)
        .map((kind) => kind.label)
        .sort(),
    )
    expect(
      within(listbox)
        .getAllByRole('option')
        .filter((option) => option.getAttribute('aria-disabled') === 'true')
        .map((option) => option.textContent),
    ).toEqual([...AglynValues.REUSABLE_PROP_KIND_GROUPS])
  }, 60000)

  it('declares a Yes / no default with a switch, saved as a real boolean', async () => {
    const onSave = jest.fn()
    render(
      <ComponentPropsDialog
        open
        value={[{ name: 'hideConsole', type: 'boolean', label: 'Hide Console card' }]}
        onClose={jest.fn()}
        onSave={onSave}
      />,
    )
    fireEvent.click(
      await screen.findByRole('switch', { name: 'Default' }, { timeout: 10000 }),
    )
    // The change is reported after the switch renders its new position.
    await waitFor(() =>
      expect(
        (screen.getByRole('switch', { name: 'Default' }) as HTMLInputElement).checked,
      ).toBe(true),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save properties' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0]).toEqual([
      { name: 'hideConsole', type: 'boolean', label: 'Hide Console card', defaultValue: true },
    ])
  }, 60000)

  it('adds a condition on another property, and saves it as the schema rule', async () => {
    const onSave = jest.fn()
    render(
      <ComponentPropsDialog
        open
        value={[
          { name: 'showCta', type: 'boolean', label: 'Show the call to action' },
          { name: 'ctaLabel', type: 'text', label: 'Call to action label' },
        ]}
        onClose={jest.fn()}
        onSave={onSave}
      />,
    )
    const addButtons = await screen.findAllByRole('button', { name: 'Add condition' })
    // The second property's row.
    fireEvent.click(addButtons[1])
    await waitFor(() =>
      expect(screen.getAllByRole('combobox', { name: 'Property' }).length).toBe(1),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save properties' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0][1]).toEqual({
      name: 'ctaLabel',
      type: 'text',
      label: 'Call to action label',
      condition: { when: 'showCta', is: true },
    })
  }, 60000)

  it("will not save a kind missing the setting it is drawn with", async () => {
    render(
      <ComponentPropsDialog
        open
        value={[{ name: 'weight', type: 'theme-scale' }]}
        onClose={jest.fn()}
        onSave={jest.fn()}
      />,
    )
    expect(await screen.findByText('Choose the scale to offer')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Save properties' }),
    ).toHaveProperty('disabled', true)
  }, 60000)

  it('names the owner a layout property belongs to', async () => {
    render(
      <ComponentPropsDialog
        open
        noun="layout"
        value={[]}
        onClose={jest.fn()}
        onSave={jest.fn()}
      />,
    )
    expect(await screen.findByText('Layout properties')).toBeTruthy()
    expect(screen.getByText(/Each screen that uses it sets its own values/)).toBeTruthy()
  })
})

describe('conditions, as the dialog edits them (AGL-2893)', () => {
  const declared: Aglyn.ReusableComponentProp[] = [
    { name: 'showCta', type: 'boolean' },
    { name: 'tint', type: 'choice', options: [{ value: 'a' }, { value: 'b' }] },
    { name: 'columns', type: 'slider' },
    { name: 'topics', type: 'dual-list-select', options: [{ value: 'a' }] },
    { name: 'headline', type: 'text' },
  ]
  const target = (name: string) => declared.find((prop) => prop.name === name)

  it('offers only the operators that can describe the property', () => {
    expect(propertyRuleOperators(target('showCta'))).toEqual(['is', 'isNot'])
    expect(propertyRuleOperators(target('tint'))).toEqual(
      expect.arrayContaining(['is', 'isOneOf', 'isNotOneOf', 'isEmpty']),
    )
    expect(propertyRuleOperators(target('columns'))).toEqual(
      expect.arrayContaining(['greaterThan', 'lessThanOrEqualTo']),
    )
    // A list of answers is only ever empty or not.
    expect(propertyRuleOperators(target('topics'))).toEqual(['isNotEmpty', 'isEmpty'])
    expect(propertyRuleOperators(target('headline'))).toEqual(
      expect.arrayContaining(['matches', 'doesNotMatch']),
    )
  })

  it('round-trips every operator through the stored rule', () => {
    const drafts = [
      { when: 'showCta', operator: 'is', operand: true },
      { when: 'tint', operator: 'isNot', operand: 'a' },
      { when: 'tint', operator: 'isOneOf', operand: ['a', 'b'] },
      { when: 'tint', operator: 'isNotOneOf', operand: ['a'] },
      { when: 'headline', operator: 'isEmpty' },
      { when: 'headline', operator: 'isNotEmpty' },
      { when: 'headline', operator: 'matches', operand: '^Build' },
      { when: 'headline', operator: 'doesNotMatch', operand: 'draft' },
      { when: 'columns', operator: 'greaterThan', operand: 2 },
      { when: 'columns', operator: 'greaterThanOrEqualTo', operand: 2 },
      { when: 'columns', operator: 'lessThan', operand: 4 },
      { when: 'columns', operator: 'lessThanOrEqualTo', operand: 4 },
    ] as const
    for (const draft of drafts) {
      expect(describePropertyRule(propertyRuleFor(draft as never))).toEqual(draft)
    }
  })

  it('stores one rule as a rule, all of several as a list, and any as `or`', () => {
    const rules = [
      { when: 'showCta', operator: 'is' as const, operand: true },
      { when: 'tint', operator: 'is' as const, operand: 'a' },
    ]
    expect(writePropertyCondition({ join: 'all', rules: rules.slice(0, 1) })).toEqual({
      when: 'showCta',
      is: true,
    })
    const all = writePropertyCondition({ join: 'all', rules })
    expect(all).toEqual([
      { when: 'showCta', is: true },
      { when: 'tint', is: 'a' },
    ])
    const any = writePropertyCondition({ join: 'any', rules })
    expect(any).toEqual({ or: all })
    expect(readPropertyCondition(any)).toEqual({ join: 'any', rules })
    expect(readPropertyCondition(all)).toEqual({ join: 'all', rules })
    expect(writePropertyCondition({ join: 'all', rules: [] })).toBeUndefined()
  })

  it('leaves a condition it cannot show to be removed, never rewritten', () => {
    expect(
      readPropertyCondition({ not: { when: 'showCta', is: true } }),
    ).toBeNull()
  })

  it('follows a rename, so a condition does not quietly stop applying', () => {
    const renamed = renameConditionReferences(
      [
        { name: 'showCta', type: 'boolean' },
        {
          name: 'ctaLabel',
          type: 'text',
          condition: { or: [{ when: 'showCta', is: true }, { when: 'x', isEmpty: true }] },
        },
      ],
      'showCta',
      'showButton',
    )
    expect(renamed[1].condition).toEqual({
      or: [{ when: 'showButton', is: true }, { when: 'x', isEmpty: true }],
    })
  })

  it('refuses a rule that reads nothing, reads itself, or cannot be compared', () => {
    const errors = componentPropErrors([
      { name: 'a', type: 'text', condition: { when: 'ghost', isEmpty: true } },
      { name: 'b', type: 'text', condition: { when: 'b', isEmpty: true } },
      { name: 'c', type: 'text', condition: { when: 'a', pattern: '(' } },
      { name: 'd', type: 'slider', condition: { when: 'c', greaterThan: Number.NaN } },
    ])
    expect(errors.map((error) => error.condition)).toEqual([
      'A rule reads a property this component does not declare',
      'A property cannot depend on itself',
      '"(" is not a pattern that can be matched',
      'Compare with a number',
    ])
  })
})

describe('saving the new kinds (AGL-2893)', () => {
  it("keeps a kind's declared settings, as numbers where the field reads numbers", () => {
    expect(
      cleanComponentProps([
        {
          name: 'columns',
          type: 'slider',
          settings: { min: '1' as never, max: 6, step: '', stray: 'x' },
          defaultValue: 0,
        },
      ]),
    ).toEqual([
      { name: 'columns', type: 'slider', settings: { min: 1, max: 6 }, defaultValue: 0 },
    ])
  })

  it('keeps a default of no and of zero, and the help and condition', () => {
    expect(
      cleanComponentProps([
        {
          name: 'dense',
          type: 'checkbox',
          defaultValue: false,
          description: ' Tighter rows ',
          condition: { when: 'x', isNotEmpty: true },
        },
      ]),
    ).toEqual([
      {
        name: 'dense',
        type: 'checkbox',
        defaultValue: false,
        description: 'Tighter rows',
        condition: { when: 'x', isNotEmpty: true },
      },
    ])
  })

  it('keeps only the answers a list default still names', () => {
    expect(
      cleanComponentProps([
        {
          name: 'topics',
          type: 'dual-list-select',
          options: [{ value: 'crm' }, { value: 'dam' }],
          defaultValue: ['crm', 'gone'],
        },
      ]),
    ).toEqual([
      {
        name: 'topics',
        type: 'dual-list-select',
        options: [{ value: 'crm' }, { value: 'dam' }],
        defaultValue: ['crm'],
      },
    ])
  })

  it('needs the settings a kind is drawn with', () => {
    const [scale, preset, plugin, slider] = componentPropErrors([
      { name: 'weight', type: 'theme-scale' },
      { name: 'radius', type: 'preset-choice' },
      { name: 'settings', type: 'plugin-settings', settings: { pluginProperty: 'ghost' } },
      { name: 'columns', type: 'slider', settings: { min: 5, max: 2 } },
    ])
    expect(scale.settings).toBe('Choose the scale to offer')
    expect(preset.settings).toBe('Choose the presets to offer')
    expect(plugin.settings).toBe(
      'Choose the Plugin property whose plugin these settings are for',
    )
    expect(slider.settings).toBe('The highest value must be above the lowest')
  })

  it('keeps answers on a kind that takes them, and a condition through a retype', () => {
    const condition = { when: 'x', isNotEmpty: true }
    expect(
      retypeComponentProp(
        { name: 'size', type: 'choice', options: [{ value: 'sm' }], condition },
        'toggle-button',
      ),
    ).toMatchObject({ type: 'toggle-button', options: [{ value: 'sm' }] })
    expect(
      retypeComponentProp(
        { name: 'size', type: 'slider', settings: { min: 1 }, condition },
        'number',
      ),
    ).toMatchObject({ type: 'number', settings: undefined })
  })
})
