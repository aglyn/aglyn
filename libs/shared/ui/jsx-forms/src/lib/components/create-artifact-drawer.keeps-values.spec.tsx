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

// The drawer's mapper loads its fields through next/dynamic, which renders
// nothing under jest; this is the one the name field needs.
jest.mock('../constants/dynamic-fields', () => ({
  ...jest.requireActual('../constants/dynamic-fields'),
  FieldTextField: jest.requireActual('../mapper/text-field').default,
}))

import { act, fireEvent, render, screen } from '@testing-library/react'
import { useFieldApi } from '../vendor/data-driven-forms'
import { CreateArtifactDrawer } from './create-artifact-drawer.component'

/**
 * A FIELD KEEPS ITS VALUE WHEN THE PAGE AROUND THE DRAWER DRAWS AGAIN (AGL-4047).
 *
 * Callers build their fields on every draw, so an object or array
 * `initialValue` is a new one each time. The form library took that as a new
 * field and put it back on its initial value: a refused create, which draws
 * the page again to say why, dropped what had been picked (production check
 * 11/10: a campaign's "Shared with" went back to All sites).
 */
function PickField(props: Record<string, unknown>) {
  const { input, label } = useFieldApi(props as never) as unknown as {
    input: { value: string[]; onChange: (next: string[]) => void }
    label: string
  }
  return (
    <div>
      <span>{`${label}: ${(input.value ?? []).join(',') || 'none'}`}</span>
      <button
        type="button"
        onClick={() => input.onChange([...(input.value ?? []), 'b'])}
      >
        {'Pick b'}
      </button>
    </div>
  )
}

function Page(props: {
  draws?: number
  initial?: string[]
  onSubmit: (values: Record<string, unknown>) => void
}) {
  return (
    <CreateArtifactDrawer
      open
      onClose={() => undefined}
      title={`Create (${props.draws ?? 0})`}
      submitLabel="Create"
      includeDescription={false}
      onSubmit={props.onSubmit}
      componentMapper={{ pick: PickField }}
      // A new array on every draw, as callers build them.
      extraFields={[
        {
          component: 'pick',
          name: 'picked',
          label: 'Picked',
          initialValue: [...(props.initial ?? [])],
        },
      ]}
    />
  )
}

describe('the create drawer across a draw of the page around it', () => {
  it('keeps a value picked over an array initial value', async () => {
    const onSubmit = jest.fn()
    const view = render(<Page onSubmit={onSubmit} />)
    expect(screen.getByText('Picked: none')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Pick b' }))
    expect(screen.getByText('Picked: b')).toBeTruthy()

    view.rerender(<Page onSubmit={onSubmit} draws={1} />)
    expect(screen.getByText('Create (1)')).toBeTruthy()
    expect(screen.getByText('Picked: b')).toBeTruthy()

    await act(async () => {
      fireEvent.change(screen.getByRole('textbox', { name: /name/i }), {
        target: { value: 'Spring' },
      })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    })
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      displayName: 'Spring',
      picked: ['b'],
    })
  })

  it('still starts a field on a changed initial value', () => {
    const view = render(<Page onSubmit={jest.fn()} initial={['a']} />)
    expect(screen.getByText('Picked: a')).toBeTruthy()
    view.rerender(<Page onSubmit={jest.fn()} initial={['c']} />)
    expect(screen.getByText('Picked: c')).toBeTruthy()
  })
})
