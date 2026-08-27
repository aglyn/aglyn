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
import { stripMutedClasses } from '../utils/muted-classes'
import ElementClassesField from './element-classes-field.component'

/**
 * A class can be switched off without being removed (AGL-2486), and the one
 * class the hierarchy's visibility eye already owns is not given a second
 * switch of its own (AGL-592).
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

const HIDDEN = Aglyn.ELEMENT_HIDDEN_CLASS

const seedNode = (className: string) => {
  Aglyn.canvas.reset()
  Aglyn.canvas.setNodes({
    root: { $id: 'root', componentId: 'muiStack', nodes: ['panel'] },
    panel: {
      $id: 'panel',
      componentId: 'muiStack',
      parentId: 'root',
      props: { className },
    },
  } as never)
  return Aglyn.canvas.getNode('panel') as Aglyn.NodeSchema
}

const storedClasses = () =>
  (Aglyn.canvas.getNode('panel') as { props?: Record<string, unknown> })
    ?.props?.['className']

/** The class list the canvas would paint. */
const renderedClasses = () =>
  (
    stripMutedClasses(
      { $id: 'panel', props: { className: storedClasses() } },
      'panel',
      mockFlags['mutedClasses'] as string[] | undefined,
    ) as { props: Record<string, unknown> }
  ).props['className']

const offButton = (name: string) =>
  screen.queryByRole('button', {
    name: `Stop applying ${name} while designing`,
  })

const onButton = (name: string) =>
  screen.queryByRole('button', { name: `Apply ${name} again` })

const click = (el: HTMLElement) => act(() => void fireEvent.click(el))

describe('class chips carry a canvas switch (AGL-2486)', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockFlags)) delete mockFlags[key]
  })
  afterEach(() => Aglyn.canvas.reset())

  it('stops the class applying and keeps it on the element', () => {
    render(<ElementClassesField node={seedNode('promo site-drawer')} />)
    click(offButton('promo')!)

    expect(mockFlags['mutedClasses']).toEqual(['panel|promo'])
    expect(renderedClasses()).toBe('site-drawer')
    // The chips are the class list that ships, always.
    expect(storedClasses()).toBe('promo site-drawer')
    expect(screen.getByText('promo')).toBeTruthy()
  })

  it('brings it back on the second click', () => {
    render(<ElementClassesField node={seedNode('promo')} />)
    click(offButton('promo')!)
    expect(renderedClasses()).toBeUndefined()

    click(onButton('promo')!)
    expect(mockFlags['mutedClasses']).toEqual([])
    expect(renderedClasses()).toBe('promo')
  })

  it('switches one chip off and leaves the others applying', () => {
    render(<ElementClassesField node={seedNode('promo site-drawer wide')} />)
    click(offButton('site-drawer')!)

    expect(renderedClasses()).toBe('promo wide')
    expect(offButton('promo')).toBeTruthy()
    expect(offButton('wide')).toBeTruthy()
  })
})

describe('the hidden class keeps one switch, not two (AGL-592)', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockFlags)) delete mockFlags[key]
  })
  afterEach(() => Aglyn.canvas.reset())

  it('drives the element visibility state rather than a class mute', () => {
    render(<ElementClassesField node={seedNode(`${HIDDEN} promo`)} />)
    click(
      screen.getByRole('button', { name: 'Show this element on the canvas' }),
    )

    expect(mockFlags['revealedNodeIds']).toEqual(['panel'])
    expect(mockFlags['mutedClasses']).toBeUndefined()
    // The class the published site reads is still on the element.
    expect(storedClasses()).toBe(`${HIDDEN} promo`)
  })

  it('reads back the state the hierarchy toggle set', () => {
    mockFlags['revealedNodeIds'] = ['panel']
    render(<ElementClassesField node={seedNode(HIDDEN)} />)
    expect(
      screen.queryByRole('button', {
        name: 'Stop showing this element on the canvas',
      }),
    ).toBeTruthy()
  })
})
