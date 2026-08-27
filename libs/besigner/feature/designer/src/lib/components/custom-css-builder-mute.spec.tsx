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

import * as Aglyn from '@aglyn/aglyn'
import { act, fireEvent, render, screen } from '@testing-library/react'

import * as flagHook from '../hooks/use-aglyn-besigner-flag'
import { applyMutedStyles } from '../utils/muted-styles'
import CustomCssForm from './custom-css-form.component'

/**
 * The Builder rows carry the same switch every typed field does (AGL-2486).
 *
 * A row's ✕ deletes the declaration, which is the only thing the tab could
 * do to it: seeing the element without `position: absolute` meant removing it
 * and typing it back. The eye beside the ✕ stops it applying and keeps it.
 *
 * The store lives INSIDE the factory and is re-exported from it — a module
 * factory may not close over anything declared in the test file.
 */
jest.mock('../hooks/use-aglyn-besigner-flag', () => {
  const react = jest.requireActual('react')
  const flags: Record<string, unknown> = {}
  const listeners = new Set<() => void>()
  return {
    __esModule: true,
    __flags: flags,
    default: (flag: string) => {
      const [, force] = react.useReducer((count: number) => count + 1, 0)
      react.useEffect(() => {
        listeners.add(force)
        return () => {
          listeners.delete(force)
        }
      }, [force])
      return [
        flags[flag],
        (next: unknown) => {
          flags[flag] =
            typeof next === 'function' ? (next as any)(flags[flag]) : next
          listeners.forEach((listener) => listener())
        },
      ]
    },
    useAglynBesignerSetFlag: () => () => undefined,
  }
})

const mockFlags = (flagHook as unknown as { __flags: Record<string, unknown> })
  .__flags

const seedNode = (sx: Record<string, any>) => {
  Aglyn.canvas.reset()
  Aglyn.canvas.setNodes({
    root: { $id: 'root', componentId: 'muiStack', nodes: ['panel'] },
    panel: { $id: 'panel', componentId: 'muiStack', parentId: 'root', sx },
  } as never)
  return Aglyn.canvas.getNode('panel') as Aglyn.NodeSchema
}

const storedSx = () =>
  (Aglyn.canvas.getNode('panel') as { sx?: Record<string, any> })?.sx ?? {}

const rendered = () =>
  applyMutedStyles(
    JSON.parse(JSON.stringify(storedSx())),
    'panel',
    mockFlags['mutedStyles'] as string[] | undefined,
  )

const muteButton = (property: string) =>
  screen.queryByRole('button', {
    name: `Stop applying ${property} while designing`,
  })

const unmuteButton = (property: string) =>
  screen.queryByRole('button', { name: `Apply ${property} again` })

describe('custom CSS builder rows (AGL-2486)', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockFlags)) delete mockFlags[key]
  })
  afterEach(() => Aglyn.canvas.reset())

  const renderBuilder = (sx: Record<string, any>) => {
    const node = seedNode(sx)
    render(<CustomCssForm node={node} breakpoint={null} />)
  }

  it('offers the switch on every declaration it lists', () => {
    renderBuilder({ position: 'absolute', top: '100%' })
    expect(muteButton('position')).toBeTruthy()
    expect(muteButton('top')).toBeTruthy()
  })

  it('stops the declaration applying and keeps it on the element', () => {
    renderBuilder({ position: 'absolute', top: '100%' })
    act(() => void fireEvent.click(muteButton('position')!))

    expect(rendered()).toEqual({ top: '100%' })
    expect(storedSx()).toEqual({ position: 'absolute', top: '100%' })
    // Still listed, still holding its value, and marked as switched off.
    expect(unmuteButton('position')).toBeTruthy()
    expect(screen.getByDisplayValue('absolute')).toBeTruthy()
  })

  it('brings it back on the second click, unretyped', () => {
    renderBuilder({ position: 'absolute' })
    act(() => void fireEvent.click(muteButton('position')!))
    expect(rendered()).toEqual({})

    act(() => void fireEvent.click(unmuteButton('position')!))
    expect(rendered()).toEqual({ position: 'absolute' })
    expect(storedSx()).toEqual({ position: 'absolute' })
  })

  // The ✕ beside the eye is still the only thing that removes a declaration.
  it('leaves the remove control doing what it always did', () => {
    renderBuilder({ position: 'absolute', top: '100%' })
    act(
      () =>
        void fireEvent.click(
          screen.getByRole('button', { name: 'Remove position' }),
        ),
    )
    expect(storedSx()).toEqual({ top: '100%' })
  })

  it('switches one row off without touching the others', () => {
    renderBuilder({ position: 'absolute', top: '100%', zIndex: 1300 })
    act(() => void fireEvent.click(muteButton('top')!))

    expect(rendered()).toEqual({ position: 'absolute', zIndex: 1300 })
    expect(muteButton('position')).toBeTruthy()
    expect(muteButton('zIndex')).toBeTruthy()
  })
})
