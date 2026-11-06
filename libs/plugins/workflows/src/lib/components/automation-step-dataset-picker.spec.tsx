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
 * An automation step's Dataset picker tells two of one name apart (AGL-4047):
 * it shows each option's label, where its owner gave one, and stores the id
 * with the plain name beside it, as before.
 */

import { fireEvent, render, screen, within } from '@testing-library/react'
import { AutomationStepFields, defaultStep } from './automation-step-fields.component'

const NONE: never[] = []
const pickers = {
  workflowOptions: NONE,
  overlayOptions: NONE,
  listOptions: NONE,
  campaignOptions: NONE,
  webhookOptions: NONE,
  datasetOptions: [
    { id: 'ds-a', name: 'Services', label: 'Services · All sites' },
    { id: 'ds-b', name: 'Services', label: 'Services · This site only' },
    { id: 'ds-c', name: 'Menu' },
  ],
}

describe('the Dataset picker of a dataset step', () => {
  it('shows each dataset by its label, and stores the id with its name', () => {
    const step = defaultStep('datasetAppend')
    const onSteps = jest.fn()
    render(
      <AutomationStepFields
        step={step}
        index={0}
        kind="datasetAppend"
        kinds={[{ value: 'datasetAppend', label: 'Add a dataset record' }]}
        stepForKind={defaultStep as never}
        pickers={pickers}
        onSteps={onSteps}
      />,
    )
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Dataset' }))
    const listbox = within(screen.getByRole('listbox'))
    expect(listbox.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Services · All sites',
      'Services · This site only',
      'Menu',
    ])
    fireEvent.click(listbox.getByRole('option', { name: 'Services · This site only' }))
    const update = onSteps.mock.calls.at(-1)?.[0] as (steps: unknown[]) => Array<Record<string, unknown>>
    expect(update([step])[0]).toMatchObject({ datasetId: 'ds-b', datasetName: 'Services' })
  })
})
