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
 * The besigner does not read a catalogue it is not showing (AGL-703).
 *
 * `EntityPickerProvider` wraps every besigner surface and opened FOUR
 * listeners the moment it mounted — up to 300 products, 200 catalog
 * collections, 200 product categories and 200 datasets — to fill attribute
 * pickers that only appear for a selected node whose schema declares one.
 * Moving a heading does not need the product list, and most editing sessions
 * never open a picker at all.
 *
 * Same rule set for Used by (*"that will get expensive"*), with one
 * difference worth stating: there is no button here, because a picker
 * APPEARING is already a user action — it takes selecting a node that has
 * one. The demand signal is the panel, not a click.
 *
 * These assert on the QUERY, not on what renders: a provider that opened the
 * listeners and hid the results would look identical on screen and cost
 * exactly what it cost before.
 */
import * as Aglyn from '@aglyn/aglyn'
import { render } from '@testing-library/react'
import { useContext, useEffect } from 'react'
import EntityPickerProvider from '../components/entity-picker-provider.component'

/** Which collections a listener was actually opened on. */
const listening: string[] = []

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => path.join('/'),
  limit: (value: number) => `limit:${value}`,
  query: (path: string) => path,
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'] }),
}))
jest.mock('../hooks/use-firestore-collection', () => ({
  __esModule: true,
  default: (factory: () => unknown) => {
    const built = factory()
    // `null` is the hook's own "do not listen" contract — the same one the
    // dataset query has always used while the org scope is unresolved.
    if (typeof built === 'string') listening.push(built)
    return { data: [] }
  },
}))

/** Renders inside the provider and asks for the given kinds, once. */
function Consumer(props: { kinds: Aglyn.EntityPickerKind[] }) {
  const { request } = useContext(Aglyn.EntityPickerContext)
  useEffect(() => {
    for (const kind of props.kinds) request?.(kind)
  }, [request, props.kinds])
  return null
}

const opened = () => [...new Set(listening)].sort()

beforeEach(() => {
  listening.length = 0
})

describe('entity pickers are read on demand (AGL-703)', () => {
  it('THE COST: mounting the besigner opens no listener at all', () => {
    render(
      <EntityPickerProvider hostId="h1">
        <div />
      </EntityPickerProvider>,
    )
    expect(opened()).toEqual([])
  })

  it('opens ONLY the list a picker asked for', () => {
    render(
      <EntityPickerProvider hostId="h1">
        <Consumer kinds={['products']} />
      </EntityPickerProvider>,
    )
    expect(opened()).toEqual(['hosts/h1/products'])
  })

  it('opens each requested list, and no more', () => {
    render(
      <EntityPickerProvider hostId="h1">
        <Consumer kinds={['categories', 'datasets']} />
      </EntityPickerProvider>,
    )
    expect(opened()).toEqual(['hosts/h1/productCategories', 'orgs/org-1/datasets'])
    // The two nobody asked for stay closed — which is the whole saving.
    expect(opened()).not.toContain('hosts/h1/products')
    expect(opened()).not.toContain('hosts/h1/collections')
  })

  it('THE CONTROL: asking for everything still opens everything', () => {
    // Guard the guard. If `request` silently did nothing, every assertion
    // above would pass on a provider that had simply stopped working.
    render(
      <EntityPickerProvider hostId="h1">
        <Consumer
          kinds={['products', 'collections', 'categories', 'datasets']}
        />
      </EntityPickerProvider>,
    )
    expect(opened()).toEqual([
      'hosts/h1/collections',
      'hosts/h1/productCategories',
      'hosts/h1/products',
      'orgs/org-1/datasets',
    ])
  })
})
