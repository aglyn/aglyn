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

import { componentMapper, FormRenderer } from '@aglyn/shared-ui-jsx-forms'
import { act, fireEvent, render, screen } from '@testing-library/react'
import cloneDeep from 'lodash-es/cloneDeep'

import {
  applyMutedStyles,
  type MutedStyleTarget,
  toggleMutedStyle,
  withStyleMuteControls,
} from '../utils/muted-styles'
import { readStateSlice, stripStateSlices } from '../utils/state-sx'
import type { SxBreakpoint } from '../utils/responsive-sx'
import type { SxState } from '../utils/state-sx'
import {
  buildStyleFieldGroups,
  computeEffectiveStyleValues,
  pickStyleValues,
  styleGroupFieldNames,
} from '../utils/style-field-groups'
import ElementStylesFormTemplate from './element-styles-form-template.component'

/**
 * Switching one declaration off without losing its value (AGL-2486).
 *
 * The only way to see a layout without its `maxWidth` was to delete the value
 * and type it back, which loses the thing being compared against. Driven
 * through the REAL wiring — the shared mapper, the panel's field decoration,
 * the canvas sx transform — rather than the field declarations, because what
 * is worth asserting is that the click stops the declaration painting on the
 * canvas and leaves the DOCUMENT alone.
 */
const NODE = 'card'
const groups = buildStyleFieldGroups(['#123456'])
const group = (id: string) => groups.find((entry) => entry.$id === id)!

interface Harness {
  /** The stored sx. Nothing here may change when a row is muted. */
  sx: Record<string, any>
  mutedStyles: string[]
  /** What the canvas paints, with the mutes applied to a copy. */
  rendered(): Record<string, any>
}

const renderGroup = async (
  groupId: string,
  initialSx: Record<string, any>,
  scope: { state?: SxState | null; breakpoint?: SxBreakpoint | null } = {},
): Promise<Harness> => {
  const state = scope.state ?? null
  const breakpoint = scope.breakpoint ?? null
  const fields = group(groupId)
  const names = styleGroupFieldNames(fields)
  const harness: Harness = {
    sx: initialSx,
    mutedStyles: [],
    rendered: () =>
      applyMutedStyles(
        cloneDeep(harness.sx),
        NODE,
        harness.mutedStyles,
      ) as Record<string, any>,
  }
  const scoped = state
    ? readStateSlice(initialSx, state)
    : stripStateSlices(initialSx)
  const renderResult = render(
    <FormRenderer
      FormTemplate={ElementStylesFormTemplate}
      componentMapper={componentMapper}
      onSubmit={() => undefined}
      initialValues={pickStyleValues(
        names,
        computeEffectiveStyleValues(initialSx, breakpoint, null),
      )}
      schema={{
        fields: withStyleMuteControls(fields.fields, {
          nodeId: NODE,
          state,
          breakpoint,
          scopeValues: computeEffectiveStyleValues(
            (scoped ?? {}) as Record<string, any>,
            breakpoint,
            null,
          ),
          mutedStyles: harness.mutedStyles,
          onToggle: (target: MutedStyleTarget) => {
            harness.mutedStyles = toggleMutedStyle(harness.mutedStyles, target)
            renderResult.rerender(rerenderTree())
          },
        }),
      }}
    />,
  )
  // The mute list is what the flag would hold, so a toggle has to re-render
  // the panel the way a flag change does.
  function rerenderTree() {
    return (
      <FormRenderer
        FormTemplate={ElementStylesFormTemplate}
        componentMapper={componentMapper}
        onSubmit={() => undefined}
        initialValues={pickStyleValues(
          names,
          computeEffectiveStyleValues(harness.sx, breakpoint, null),
        )}
        schema={{
          fields: withStyleMuteControls(fields.fields, {
            nodeId: NODE,
            state,
            breakpoint,
            scopeValues: computeEffectiveStyleValues(
              (state
                ? readStateSlice(harness.sx, state)
                : stripStateSlices(harness.sx)) ?? {},
              breakpoint,
              null,
            ),
            mutedStyles: harness.mutedStyles,
            onToggle: (target: MutedStyleTarget) => {
              harness.mutedStyles = toggleMutedStyle(
                harness.mutedStyles,
                target,
              )
              renderResult.rerender(rerenderTree())
            },
          }),
        }}
      />
    )
  }
  // The field editors are code-split (next/dynamic).
  await act(async () => undefined)
  return harness
}

const muteButton = (label: string) =>
  screen.queryByRole('button', {
    name: `Stop applying ${label} while designing`,
  })

const unmuteButton = (label: string) =>
  screen.queryByRole('button', { name: `Apply ${label} again` })

const click = (button: HTMLElement) => act(() => void fireEvent.click(button))

describe('styles panel mute affordance (AGL-2486)', () => {
  it('offers the control only where the scope declares something', async () => {
    await renderGroup('sizing', { maxWidth: '600px' })
    expect(muteButton('Max Width')).toBeTruthy()
    // Width is unset on this element, so there is nothing to switch off.
    expect(muteButton('Width')).toBeNull()
  })

  it('stops the declaration painting and leaves the document alone', async () => {
    const harness = await renderGroup('sizing', {
      maxWidth: '600px',
      minWidth: '200px',
    })
    click(muteButton('Max Width')!)

    expect(harness.rendered()).toEqual({ minWidth: '200px' })
    // The half that makes this a comparison rather than a deletion.
    expect(harness.sx).toEqual({ maxWidth: '600px', minWidth: '200px' })
  })

  it('reads as switched off rather than unset', async () => {
    await renderGroup('sizing', { maxWidth: '600px' })
    click(muteButton('Max Width')!)

    const control = unmuteButton('Max Width')
    expect(control).toBeTruthy()
    expect(control!.getAttribute('aria-pressed')).toBe('true')
    // The row is marked so it dims and strikes its value — a switched-off
    // style must never read as one that was never set.
    expect(document.querySelector('.FormFieldGrid-muted')).toBeTruthy()
    // The value is still in the box for the author to compare against.
    expect((screen.getByDisplayValue('600') as HTMLInputElement).value).toBe(
      '600',
    )
  })

  it('brings the value back on the second click, unretyped', async () => {
    const harness = await renderGroup('sizing', { maxWidth: '600px' })
    click(muteButton('Max Width')!)
    expect(harness.rendered()).toEqual({})

    click(unmuteButton('Max Width')!)
    expect(harness.mutedStyles).toEqual([])
    expect(harness.rendered()).toEqual({ maxWidth: '600px' })
  })

  it('mutes a state slice without touching the default one', async () => {
    const harness = await renderGroup(
      'colors',
      {
        color: 'text.primary',
        '&:hover': { color: 'primary.main' },
      },
      { state: 'hover' },
    )
    click(muteButton('Text Color')!)

    expect(harness.rendered()).toEqual({ color: 'text.primary' })
    expect(harness.sx).toEqual({
      color: 'text.primary',
      '&:hover': { color: 'primary.main' },
    })
  })

  it('mutes one breakpoint and leaves the others painting', async () => {
    const harness = await renderGroup(
      'sizing',
      { maxWidth: { xs: '100%', md: '600px' } },
      { breakpoint: 'md' },
    )
    click(muteButton('Max Width')!)

    expect(harness.rendered()).toEqual({ maxWidth: '100%' })
  })

  // Nothing about a mute is written down, so a publish has nothing to carry.
  it('leaves the stored styles byte-identical however many rows are muted', async () => {
    const stored = {
      maxWidth: '600px',
      minWidth: '200px',
      height: '400px',
    }
    const harness = await renderGroup('sizing', stored)
    const before = JSON.stringify(harness.sx)

    click(muteButton('Max Width')!)
    click(muteButton('Min Width')!)

    expect(harness.mutedStyles).toHaveLength(2)
    expect(JSON.stringify(harness.sx)).toBe(before)
    expect(harness.rendered()).toEqual({ height: '400px' })
  })
})
