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

import type { ReactNode } from 'react'
import { renderHook } from '@testing-library/react'

import {
  BindingPickerContext,
  type BindingPickerContextValue,
} from '../contexts/binding-picker-context'
import useInsertTokenOptions from './use-insert-token-options'

const wrapper =
  (value: BindingPickerContextValue) =>
  ({ children }: { children: ReactNode }) => (
    <BindingPickerContext.Provider value={value}>
      {children}
    </BindingPickerContext.Provider>
  )

// The `{}` picker offered Site / Entry / Collection but not the component's
// OWN properties, so binding one meant typing `{{prop.name}}` by hand next to
// a button that implied it was pickable (AGL-1335).
describe('useInsertTokenOptions — component properties (AGL-1335)', () => {
  it('lists the declared props as a Properties group', () => {
    const { result } = renderHook(() => useInsertTokenOptions(), {
      wrapper: wrapper({
        componentProps: [
          { name: 'headline', type: 'text', defaultValue: 'Hello' },
          { name: 'secondaryLink', type: 'href', label: 'Secondary link' },
        ],
      }),
    })
    const props = result.current.options.filter(
      (option) => option.group === 'Properties',
    )
    expect(props.map((option) => option.token)).toEqual([
      '{{prop.headline}}',
      '{{prop.secondaryLink}}',
    ])
    // The declared label is what the author named it; the name is the token.
    expect(props[1].label).toBe('Secondary link')
    expect(props[0].preview).toMatch(/Hello/)
  })

  it('never offers a name the graft could not substitute', () => {
    // `hero.title` addresses a nested path final-form would split, so the
    // value would never reach the node — offering it is offering a dead link.
    const { result } = renderHook(() => useInsertTokenOptions(), {
      wrapper: wrapper({
        componentProps: [
          { name: 'hero.title', type: 'text' },
          { name: '2cols', type: 'text' },
          { name: 'ok_name', type: 'text' },
        ],
      }),
    })
    expect(
      result.current.options
        .filter((option) => option.group === 'Properties')
        .map((option) => option.token),
    ).toEqual(['{{prop.ok_name}}'])
  })

  it('negative control: no Properties group outside a component editor', () => {
    // Every other editor surface leaves `componentProps` unset, where the
    // token would resolve to nothing.
    const { result } = renderHook(() => useInsertTokenOptions(), {
      wrapper: wrapper({}),
    })
    expect(
      result.current.options.some((option) => option.group === 'Properties'),
    ).toBe(false)
  })
})
