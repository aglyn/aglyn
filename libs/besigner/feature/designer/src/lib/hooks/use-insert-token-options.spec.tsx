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

import * as Aglyn from '@aglyn/aglyn'
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

/** Both contexts, for the dataset cases below. */
const datasetWrapper =
  (entities: Aglyn.EntityPickerContextValue) =>
  ({ children }: { children: ReactNode }) => (
    <BindingPickerContext.Provider value={{}}>
      <Aglyn.EntityPickerContext.Provider value={entities}>
        {children}
      </Aglyn.EntityPickerContext.Provider>
    </BindingPickerContext.Provider>
  )

/** A field inside a repeat bound to `datasetId`. */
const seedRepeat = (datasetId: string) =>
  jest.spyOn(Aglyn.canvas, 'toJSON').mockReturnValue({
    nodes: {
      field: { $id: 'field', props: {}, parentId: 'repeat' },
      repeat: { $id: 'repeat', props: { repeatDataset: datasetId } },
    },
  } as never)

const FIELD_NODE = { $id: 'field' } as never

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


/**
 * A repeat's dataset is a STORED VALUE, and the dataset list is a page.
 *
 * The token menu names the repeat's dataset and offers its model fields, and
 * it found both by scanning the browse list. Bounded to a console page, that
 * list stops containing the dataset on exactly the orgs with enough datasets
 * to need this menu — and the failure is silent, because a menu with no
 * Dataset group looks the same as a node that is not in a repeat.
 */
describe('useInsertTokenOptions — a dataset outside the browse window', () => {
  afterEach(() => jest.restoreAllMocks())

  it('asks for a keyed read when the settled list does not hold it', () => {
    seedRepeat('ds-900')
    const asked: Array<[string, string]> = []
    renderHook(() => useInsertTokenOptions(FIELD_NODE), {
      wrapper: datasetWrapper({
        request: () => undefined,
        resolve: (kind, id) => asked.push([kind, id]),
        datasets: [{ id: 'ds-1', label: 'Signups' }],
        status: { datasets: 'ready' },
      }),
    })
    expect(asked).toEqual([['datasets', 'ds-900']])
  })

  it('names it and offers its fields once the read has answered', () => {
    seedRepeat('ds-900')
    const { result } = renderHook(() => useInsertTokenOptions(FIELD_NODE), {
      wrapper: datasetWrapper({
        request: () => undefined,
        resolve: () => undefined,
        datasets: [{ id: 'ds-1', label: 'Signups' }],
        status: { datasets: 'ready' },
        resolved: {
          datasets: { 'ds-900': { id: 'ds-900', label: 'Newsletter' } },
        },
        datasetFields: {
          'ds-900': [{ id: 'email', label: 'Email address' }],
        },
      }),
    })
    const items = result.current.options.filter(
      (option) => option.group === 'Dataset item',
    )
    expect(items.map((option) => option.label)).toEqual(['Email address'])
    // The group says WHICH dataset, which is the half that needed the name.
    expect(items[0].groupHint).toBe('From dataset "Newsletter"')
    expect(result.current.labelContext.datasetFields).toEqual([
      { id: 'email', label: 'Email address' },
    ])
  })

  it('spends no keyed read for a legacy repeat keyed by NAME', () => {
    // `repeatDataset` may hold a display name rather than an id. The window
    // answers that by label, and reading a document AT that name would be a
    // read that could only ever miss.
    seedRepeat('Signups')
    const asked: Array<[string, string]> = []
    renderHook(() => useInsertTokenOptions(FIELD_NODE), {
      wrapper: datasetWrapper({
        request: () => undefined,
        resolve: (kind, id) => asked.push([kind, id]),
        datasets: [{ id: 'ds-1', label: 'Signups' }],
        status: { datasets: 'ready' },
      }),
    })
    expect(asked).toEqual([])
  })

  it('spends no keyed read when the window already holds it', () => {
    // The common case, and the one that must stay free.
    seedRepeat('ds-1')
    const asked: Array<[string, string]> = []
    renderHook(() => useInsertTokenOptions(FIELD_NODE), {
      wrapper: datasetWrapper({
        request: () => undefined,
        resolve: (kind, id) => asked.push([kind, id]),
        datasets: [{ id: 'ds-1', label: 'Signups' }],
        status: { datasets: 'ready' },
      }),
    })
    expect(asked).toEqual([])
  })

  it('spends nothing at all outside a repeat', () => {
    // The demand rule: a node with no repeat above it needs no dataset list
    // and no keyed read, and this hook runs on EVERY selection.
    jest.spyOn(Aglyn.canvas, 'toJSON').mockReturnValue({
      nodes: { field: { $id: 'field', props: {} } },
    } as never)
    const askedFor: string[] = []
    const resolved: string[] = []
    renderHook(() => useInsertTokenOptions(FIELD_NODE), {
      wrapper: datasetWrapper({
        request: (kind) => askedFor.push(kind),
        resolve: (_kind, id) => resolved.push(id),
        datasets: [],
        status: { datasets: 'ready' },
      }),
    })
    expect(askedFor).toEqual([])
    expect(resolved).toEqual([])
  })
})
