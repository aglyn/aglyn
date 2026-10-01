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

import { within } from '@testing-library/dom'
import {
  type FiberRenderCounter,
  installFiberRenderCounter,
} from '@aglyn/shared-ui-jsx/testing/fiber-render-counter'

// The drawer's mapper loads its fields through next/dynamic, which renders
// nothing under jest; these are the components it loads.
jest.mock('../constants/dynamic-fields', () => ({
  ...jest.requireActual('../constants/dynamic-fields'),
  FieldSelect: jest.requireActual('../mapper/select').default,
  FieldTextField: jest.requireActual('../mapper/text-field').default,
  FieldTextarea: jest.requireActual('../mapper/textarea').default,
  FieldSwitch: jest.requireActual('../mapper/switch').default,
  FieldSubForm: jest.requireActual('../mapper/sub-form').default,
}))

/**
 * The campaign drawer's fields: two multi-selects holding chips, two dates
 * and a single select, under the name every create drawer asks for.
 */
const CAMPAIGN_FIELDS = [
  {
    component: 'select',
    name: 'siteIds',
    label: 'Sites',
    multiple: true,
    initialValue: ['main'],
    disableDefaultOption: true,
    options: [
      { value: 'main', label: 'Main site' },
      { value: 'shop', label: 'Shop' },
    ],
  },
  { component: 'text-field', name: 'startAt', label: 'Starts', type: 'date' },
  { component: 'text-field', name: 'endAt', label: 'Ends', type: 'date' },
  {
    component: 'select',
    name: 'listIds',
    label: 'Lists',
    multiple: true,
    initialValue: ['customers'],
    disableDefaultOption: true,
    options: [
      { value: 'customers', label: 'Customers' },
      { value: 'leads', label: 'Leads' },
    ],
  },
  {
    component: 'select',
    name: 'topicId',
    label: 'Topic',
    disableDefaultOption: true,
    options: [{ value: 'news', label: 'News' }],
  },
  {
    component: 'text-field',
    name: 'code',
    label: 'Spring code',
    condition: { when: 'displayName', is: 'Spring' },
  },
]

/**
 * What one keystroke costs in a create drawer (AGL-3423).
 *
 * The drawer's form used to subscribe to its values, so a letter typed in the
 * name drew every field again — the dates, and both chip selects — and a
 * keystroke that costs that much lets typed input queue, which is what turns
 * a chip field's per-commit update into React #185 (see
 * `../mapper/select-typing.spec.tsx`). It now draws the field typed into.
 * Counted off React's own commits, so the budget is what actually rendered.
 *
 * The form drawing nothing on its own is safe only while nothing reads the
 * form's state as a whole, so the conditions and the submit — the two that
 * could — are driven here too.
 */
describe('one keystroke in the create drawer (AGL-3423)', () => {
  let counter: FiberRenderCounter
  let react: typeof import('react')
  let unmount: () => Promise<void>
  let onSubmit: jest.Mock

  // Each test loads React and MUI afresh, in a registry of its own: the
  // setup is given the time a cold load takes.
  beforeEach(async () => {
    counter = installFiberRenderCounter()
    jest.resetModules()
    react = jest.requireActual<typeof import('react')>('react')
    const client = jest.requireActual<typeof import('react-dom/client')>('react-dom/client')
    const { CreateArtifactDrawer } = jest.requireActual<
      typeof import('./create-artifact-drawer.component')
    >('./create-artifact-drawer.component')
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    onSubmit = jest.fn()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = client.createRoot(host)
    await react.act(async () => {
      root.render(
        react.createElement(CreateArtifactDrawer, {
          open: true,
          onClose: () => undefined,
          title: 'Create campaign',
          submitLabel: 'Create campaign',
          onSubmit,
          extraFields: CAMPAIGN_FIELDS,
        }),
      )
    })
    unmount = async () => {
      await react.act(async () => root.unmount())
      host.remove()
    }
  }, 60000)

  afterEach(async () => {
    await unmount()
    counter.uninstall()
    jest.restoreAllMocks()
  })

  const drawer = () => within(document.body.querySelector('[role="dialog"]') as HTMLElement)

  async function type(label: string, text: string) {
    const box = drawer().getByRole('textbox', { name: label }) as
      | HTMLInputElement
      | HTMLTextAreaElement
    const prototype = Object.getPrototypeOf(box) as object
    const setValue = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    counter.reset()
    await react.act(async () => {
      setValue?.call(box, text)
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(box.value).toBe(text)
  }

  it('draws only the name for its first letter, and never the chips', async () => {
    expect(drawer().getByText('Main site')).toBeTruthy()
    // The first letter also makes the form dirty and the required name
    // valid: two changes of the form's own state.
    await type('Display name', 'S')
    expect(counter.rendered('Autocomplete')).toBe(0)
    expect(counter.rendered('InternalSelect')).toBe(0)
    // The name, drawn again as MUI marks it filled.
    expect(counter.rendered('InputBase')).toBeLessThanOrEqual(2)
  }, 60000)

  it('draws only the name for each letter after it', async () => {
    await type('Display name', 'S')
    await type('Display name', 'Sp')
    expect(counter.rendered('Autocomplete')).toBe(0)
    expect(counter.rendered('InternalSelect')).toBe(0)
    expect(counter.rendered('InputBase')).toBeLessThanOrEqual(1)
  }, 60000)

  it('still shows a field whose condition names the field typed in', async () => {
    expect(drawer().queryByRole('textbox', { name: 'Spring code' })).toBeNull()
    await type('Display name', 'Spring')
    expect(drawer().getByRole('textbox', { name: 'Spring code' })).toBeTruthy()
  }, 60000)

  it('still refuses an empty name, and submits what was typed and picked', async () => {
    const submit = drawer().getByRole('button', { name: 'Create campaign' })
    await react.act(async () => submit.click())
    expect(onSubmit).not.toHaveBeenCalled()
    expect(drawer().getByText('Provide a display name')).toBeTruthy()
    await type('Display name', 'Autumn')
    await react.act(async () => submit.click())
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      displayName: 'Autumn',
      siteIds: ['main'],
      listIds: ['customers'],
    })
  }, 60000)
})
