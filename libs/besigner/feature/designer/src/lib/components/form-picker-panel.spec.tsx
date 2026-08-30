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
 * The Form element's Form picker, as the attributes panel actually draws it.
 *
 * `entity-picker-options.spec.ts` pins the option list the picker is built
 * FROM; this pins that the panel builds it. The two are worth separating
 * because the wiring is where the picker was lost: an attribute whose editor
 * type the panel does not recognise is removed by the unknown-editor filter
 * (AGL-584), so the control disappears with nothing left to assert on but an
 * absence — and an absence renders perfectly.
 *
 * The picker's only input is `EntityPickerContext`, which is why a besigner
 * document kind cannot have an answer of its own here. That every kind
 * SUPPLIES the context is the other half, pinned by the console's
 * `entity-picker-on-every-document-kind.spec.ts`.
 */
import * as Aglyn from '@aglyn/aglyn'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'

import ElementPropsForm from './element-props-form.component'

const formAttribute = {
  name: 'formId',
  label: 'Form',
  component: Aglyn.FieldComponentType.FORM_SELECT,
}

const node = (
  props: Record<string, unknown>,
  attributes: Array<Record<string, unknown>> = [formAttribute],
) =>
  ({
    $id: 'formpickernode',
    type: 'node',
    componentId: 'form',
    props,
    componentSchema: { attributes },
    nodes: [],
  }) as never

const mount = (
  context: Aglyn.EntityPickerContextValue | null,
  props: Record<string, unknown> = {},
  attributes?: Array<Record<string, unknown>>,
) => {
  const panel = <ElementPropsForm node={node(props, attributes)} />
  return render(
    context ? (
      <Aglyn.EntityPickerContext.Provider value={context}>
        {panel}
      </Aglyn.EntityPickerContext.Provider>
    ) : (
      panel
    ),
  )
}

const SITE_FORMS: Aglyn.EntityPickerContextValue = {
  request: () => undefined,
  status: { forms: 'ready' },
  forms: [
    { id: 'form-2', label: 'Contact us' },
    { id: 'form-1', label: 'Apply now' },
  ],
}

/** The Form picker's own text box, once the panel has rendered its fields. */
const formPicker = () =>
  screen.findByRole('combobox', { name: 'Form' }, { timeout: 10000 })

/** Every option the Form picker offers, in the order it offers them. */
const offered = async () => {
  const picker = await formPicker()
  const field = picker.closest('.MuiAutocomplete-root') as HTMLElement
  fireEvent.click(within(field).getByTitle('Open'))
  await waitFor(() => expect(screen.getAllByRole('option').length).toBeTruthy())
  return screen.getAllByRole('option').map((option) => option.textContent)
}

describe('the attributes panel draws the Form picker', () => {
  it('offers each of the site forms, by name and in name order', async () => {
    mount(SITE_FORMS)
    expect(await offered()).toEqual(['None', 'Apply now', 'Contact us'])
  })

  it('resolves a stored form id to that form current name', async () => {
    // The end-to-end proof that the node holds an id and not a caption: the
    // only way `form-1` displays as "Apply now" is that `form-1` is what the
    // option carries as its value.
    mount(SITE_FORMS, { formId: 'form-1' })
    expect((await formPicker()).getAttribute('value')).toBe('Apply now')
  })

  it('does not resolve a caption, which is what the id replaced', async () => {
    // A node carrying the old free-text caption where the id belongs matches
    // no option, and the picker shows nothing chosen rather than pretending.
    mount(SITE_FORMS, { formId: 'Apply now' })
    expect((await formPicker()).getAttribute('value')).toBe('')
  })

  it('still draws the control when the site has no forms yet', async () => {
    mount({ request: () => undefined, status: { forms: 'ready' }, forms: [] })
    const options = await offered()
    expect(options).toHaveLength(1)
    expect(options[0]).toMatch(/no forms yet/i)
    expect(options[0]).toMatch(/Forms page/)
  })

  it('still draws the control on a surface with no picker context at all', async () => {
    // The defect: with no context the attribute was not recognised as a
    // picker at all, so the panel dropped it and the author saw no Form
    // setting on that surface — which reads as an element that has none.
    mount(null)
    const options = await offered()
    expect(options).toEqual([expect.stringMatching(/cannot list forms/i)])
  })

  it('THE CONTROL: the panel really does drop an editor it cannot draw', async () => {
    // Guard the guard. Every assertion above would pass vacuously against a
    // panel that renders everything, so pin that dropping is real — it is
    // the mechanism the Form picker used to be lost to.
    mount(SITE_FORMS, {}, [
      formAttribute,
      { name: 'mystery', label: 'Mystery', component: 'no-such-editor' },
    ])
    await formPicker()
    expect(screen.queryByRole('combobox', { name: 'Mystery' })).toBeNull()
  })
})
