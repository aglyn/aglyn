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
 * Repeat is offered on every element (AGL-3111).
 *
 * Through the real form, because the thing that was wrong was not a missing
 * function — `expandRepeatables` has always expanded any node — but a missing
 * FIELD: only the MUI Stack declared one, so the capability existed and no
 * author could reach it on anything else.
 */

import * as Aglyn from '@aglyn/aglyn'
import {
  registerRepeatSource,
  type RepeatSource,
} from '@aglyn/aglyn/app-utils/repeat-sources'
import { render, screen } from '@testing-library/react'

import ElementPropsForm, {
  buildRepeatFields,
} from './element-props-form.component'

/**
 * A source with a plain text key field rather than an entity picker: which
 * control draws the key belongs to the source, and this spec is about the
 * section existing at all.
 *
 * Asserted by its LABEL rather than by `getByLabelText`, because the panel
 * rewrites every free-text attribute into the token editor (AGL-586) — a
 * contenteditable div, which a `<label for>` cannot be associated with. The
 * `<label>` elements are counted rather than the matching TEXT, because an
 * outlined MUI field draws its label twice: once as the label and again in
 * the legend that cuts the notch in the outline.
 */
const TEST_SOURCE: RepeatSource = {
  id: 'test-rows',
  label: 'Rows',
  keyProp: 'repeatDataset',
  keyAttribute: {
    component: Aglyn.FieldComponentType.TEXT_FIELD,
    label: 'Repeat over rows',
    description: 'Which rows this element repeats over.',
  },
  useRows: () => ({ status: 'missing' }),
}

/** How many FIELDS the panel drew under this label. */
const labelled = (text: string): number =>
  screen
    .queryAllByText(text)
    .filter((element) => element.tagName === 'LABEL').length

const node = (over: Record<string, unknown>) =>
  ({
    $id: 'node-1',
    type: 'node',
    props: {},
    componentSchema: { attributes: [] },
    ...over,
  }) as any

describe('buildRepeatFields', () => {
  const build = (hasChildren: boolean, sources = [TEST_SOURCE]) =>
    buildRepeatFields({
      sources,
      hasChildren,
      resolveKeyField: (field) => field,
    })

  it('offers nothing at all when no source is registered', () => {
    expect(build(true, [])).toEqual([])
  })

  it('names one key field per source, plus the bounds every repeat shares', () => {
    expect(build(false).map((field) => field['name'])).toEqual([
      'repeatDataset',
      'repeatLimit',
      'repeatFilter',
      'repeatSort',
    ])
  })

  it('offers the scope only where both readings differ', () => {
    // An element with nothing inside it can only repeat itself, and a control
    // whose two options do the same thing is worse than no control.
    expect(build(false).map((field) => field['name'])).not.toContain(
      'repeatSelf',
    )
    expect(build(true).map((field) => field['name'])).toContain('repeatSelf')
  })

  it('shows the bounds only while the element repeats over something', () => {
    for (const field of build(true)) {
      if (field['name'] === 'repeatDataset') {
        expect(field['condition']).toBeUndefined()
        continue
      }
      expect(field['condition']).toEqual({
        when: 'repeatDataset',
        isNotEmpty: true,
      })
    }
  })

  it('asks about every source when more than one is registered', () => {
    const second: RepeatSource = { ...TEST_SOURCE, id: 'other', keyProp: 'repeatFeed' }
    const fields = build(false, [TEST_SOURCE, second])
    expect(fields.map((field) => field['name'])).toEqual([
      'repeatDataset',
      'repeatFeed',
      'repeatLimit',
      'repeatFilter',
      'repeatSort',
    ])
    expect(fields[2]['condition']).toEqual({
      or: [
        { when: 'repeatDataset', isNotEmpty: true },
        { when: 'repeatFeed', isNotEmpty: true },
      ],
    })
  })

  it('gives the scope a default option that can actually persist', () => {
    const scope = build(true).find((field) => field['name'] === 'repeatSelf')
    // `''` cannot persist, so an author who chose "This element" could never
    // choose back (AGL-1451).
    for (const option of scope?.['options'] as Array<{ value: string }>) {
      expect(option.value).not.toBe('')
    }
    expect(scope?.['initialValue']).toBe('false')
  })
})

describe('the Attributes panel offers Repeat on any element (AGL-3111)', () => {
  let unregister: () => void
  let updateNodeProps: jest.SpyInstance

  beforeEach(() => {
    unregister = registerRepeatSource(TEST_SOURCE)
    // Debounced commits flush on unmount; the node under test is not on the
    // real canvas.
    updateNodeProps = jest
      .spyOn(Aglyn.canvas, 'updateNodeProps')
      .mockImplementation((() => undefined) as any)
  })
  afterEach(() => {
    unregister()
    updateNodeProps.mockRestore()
  })

  it('offers it on a leaf that is not a Stack', () => {
    render(
      <ElementPropsForm
        {...({
          node: node({ componentId: 'muiTypography' }),
        } as any)}
      />,
    )
    expect(labelled('Repeat over rows')).toBe(1)
  })

  it('offers it on a component instance', () => {
    render(
      <ElementPropsForm
        {...({
          node: node({
            componentId: Aglyn.REUSABLE_INSTANCE_COMPONENT_ID,
            props: { refId: 'some-component', name: 'Placed component' },
            nodes: [],
          }),
        } as any)}
      />,
    )
    expect(labelled('Repeat over rows')).toBe(1)
  })

  it('offers it on a Stack, which no longer declares one of its own', () => {
    render(
      <ElementPropsForm
        {...({
          node: node({ componentId: 'muiStack', nodes: ['child'] }),
        } as any)}
      />,
    )
    // Exactly one field under that name: declaring it on the Stack as well
    // would put two controls on the form writing the same prop.
    expect(labelled('Repeat over rows')).toBe(1)
  })

  it('says which scope applies once the element repeats', () => {
    const { rerender } = render(
      <ElementPropsForm
        {...({
          node: node({
            componentId: 'muiStack',
            props: { repeatDataset: 'Team' },
            nodes: ['child'],
          }),
        } as any)}
      />,
    )
    expect(
      screen.getByText(/What is inside this element renders once per record/i),
    ).toBeTruthy()

    rerender(
      <ElementPropsForm
        {...({
          node: node({
            componentId: 'muiTypography',
            props: { repeatDataset: 'Team' },
          }),
        } as any)}
      />,
    )
    expect(
      screen.getByText(/This element renders once per record/i),
    ).toBeTruthy()
  })

  it('says nothing about repeating on an element that does not', () => {
    render(
      <ElementPropsForm
        {...({ node: node({ componentId: 'muiTypography' }) } as any)}
      />,
    )
    expect(screen.queryByText(/once per record/i)).toBeNull()
  })
})
