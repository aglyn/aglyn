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

import { act, fireEvent, render, screen } from '@testing-library/react'

import { BoxStyler } from '../box-styler'
import { ToggleButtonFormControl } from '../form-fields'
import { buildStyleMute, toggleMutedStyle } from '../utils/muted-styles'

/**
 * The panel's hand-rendered controls carry the same switch its typed fields
 * do (AGL-2486).
 *
 * The alignment toggles and the box editor's sides are not grid-wrapped form
 * fields, so they do not inherit the affordance from the shared field
 * wrapper. They are the surfaces where "every field" is a claim that can
 * quietly stop being true, which is what these assert.
 */
const NODE = 'card'

/** A mute bound to a tiny in-memory flag, as the panel binds the real one. */
function muteHarness(scopeValues: Record<string, unknown>) {
  const state = { mutedStyles: [] as string[] }
  const build = (name: string, label?: unknown) =>
    buildStyleMute(name, label, {
      nodeId: NODE,
      state: null,
      breakpoint: null,
      scopeValues,
      mutedStyles: state.mutedStyles,
      onToggle: (target) => {
        state.mutedStyles = toggleMutedStyle(state.mutedStyles, target)
      },
    })
  return { state, build }
}

const click = (button: HTMLElement) => act(() => void fireEvent.click(button))

describe('alignment toggle rows carry the switch', () => {
  const schema = {
    name: 'alignItems',
    label: 'Align Items',
    options: [
      { value: 'center', label: 'Center' },
      { value: 'flex-start', label: 'Start' },
    ],
  }

  it('offers it on a row with a value and writes the mute', () => {
    const { state, build } = muteHarness({ alignItems: 'center' })
    render(
      <ToggleButtonFormControl
        schema={schema}
        value="center"
        mute={build('alignItems', 'Align Items')}
      />,
    )
    const control = screen.getByRole('button', {
      name: 'Stop applying Align Items while designing',
    })
    click(control)
    expect(state.mutedStyles).toEqual(['card|base|base|alignItems'])
  })

  it('offers nothing on a row with no value', () => {
    const { build } = muteHarness({})
    render(
      <ToggleButtonFormControl
        schema={schema}
        value=""
        mute={build('alignItems', 'Align Items')}
      />,
    )
    expect(
      screen.queryByRole('button', {
        name: 'Stop applying Align Items while designing',
      }),
    ).toBeNull()
  })
})

describe('the box editor carries the switch per side', () => {
  const measurements = { marginTop: '16px', paddingLeft: '8px' }

  const openSide = (label: string) =>
    click(screen.getAllByRole('button', { name: label })[0])

  it('resolves the switch for the side being edited', () => {
    const { state, build } = muteHarness({
      marginTop: '16px',
      paddingLeft: '8px',
    })
    render(
      <BoxStyler
        measurements={measurements as never}
        spacingSteps={[]}
        muteForSide={build}
      />,
    )
    openSide('Space outside — top')

    const control = screen.getByRole('button', {
      name: 'Stop applying Space outside — top while designing',
    })
    click(control)
    expect(state.mutedStyles).toEqual(['card|base|base|marginTop'])
  })

  it('offers nothing for a side with no value', () => {
    const { build } = muteHarness({ marginTop: '16px' })
    render(
      <BoxStyler
        measurements={measurements as never}
        spacingSteps={[]}
        muteForSide={build}
      />,
    )
    openSide('Space outside — bottom')
    expect(
      screen.queryByRole('button', {
        name: 'Stop applying Space outside — bottom while designing',
      }),
    ).toBeNull()
  })
})
