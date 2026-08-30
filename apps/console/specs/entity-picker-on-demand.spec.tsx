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
/** Which host the org lookup datasets need was asked to resolve. */
const orgLookups: Array<string | undefined> = []
/** Rows a given collection path answers with, and how its read is going. */
const docsFor: Record<string, unknown[]> = {}
const statusFor: Record<string, string> = {}

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => path.join('/'),
  limit: (value: number) => `limit:${value}`,
  orderBy: (field: string) => `orderBy:${field}`,
  query: (path: string) => path,
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useOrgDataScope: (options: { hostId?: string }) => {
    orgLookups.push(options?.hostId)
    // The real hook resolves nothing without a host (AGL-1061), so the
    // scope has to follow the host it was actually handed.
    return options?.hostId
      ? { scope: ['orgs', 'org-1'], orgId: 'org-1', ready: true }
      : { scope: null, orgId: null, ready: true }
  },
}))
jest.mock('../hooks/use-firestore-collection', () => ({
  __esModule: true,
  default: (factory: () => unknown) => {
    const built = factory()
    // `null` is the hook's own "do not listen" contract — the same one the
    // dataset query has always used while the org scope is unresolved.
    if (typeof built !== 'string') return { data: [], status: 'loading' }
    listening.push(built)
    return {
      data: docsFor[built] ?? [],
      status: statusFor[built] ?? 'loading',
    }
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

/** Captures the context value the provider hands down, on every render. */
function Capture(props: { onValue: (value: Aglyn.EntityPickerContextValue) => void }) {
  const value = useContext(Aglyn.EntityPickerContext)
  props.onValue(value)
  return null
}

const opened = () => [...new Set(listening)].sort()

beforeEach(() => {
  listening.length = 0
  orgLookups.length = 0
  for (const key of Object.keys(docsFor)) delete docsFor[key]
  for (const key of Object.keys(statusFor)) delete statusFor[key]
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

  it('opens the site forms list, and only when a form picker asks', () => {
    render(
      <EntityPickerProvider hostId="h1">
        <Consumer kinds={['forms']} />
      </EntityPickerProvider>,
    )
    // Host-scoped, unlike datasets: a form renders on one site's pages and
    // its submissions already live under that host.
    expect(opened()).toEqual(['hosts/h1/forms'])
  })

  it('resolves the org only once a DATASET picker asks', () => {
    // The lookup datasets need is a read of its own, and it is what would
    // otherwise make mounting this provider on a surface that never opens a
    // picker cost something.
    render(
      <EntityPickerProvider hostId="h1">
        <Consumer kinds={['forms']} />
      </EntityPickerProvider>,
    )
    expect(orgLookups.filter(Boolean)).toEqual([])
  })

  it('THE CONTROL: a dataset picker does resolve the org', () => {
    render(
      <EntityPickerProvider hostId="h1">
        <Consumer kinds={['datasets']} />
      </EntityPickerProvider>,
    )
    expect(orgLookups).toContain('h1')
    expect(opened()).toEqual(['orgs/org-1/datasets'])
  })
})

/**
 * An empty dropdown and a broken one look identical, so the provider has to
 * say which it is handing over. Only a SETTLED read makes an empty list the
 * site's own answer about itself.
 */
describe('the picker context says why a list is empty', () => {
  const capture = (
    kinds: Aglyn.EntityPickerKind[],
  ): Aglyn.EntityPickerContextValue => {
    let latest = {} as Aglyn.EntityPickerContextValue
    render(
      <EntityPickerProvider hostId="h1">
        <Consumer kinds={kinds} />
        <Capture
          onValue={(value) => {
            latest = value
          }}
        />
      </EntityPickerProvider>,
    )
    return latest
  }

  it('holds a list nobody asked for at loading, never at ready', () => {
    expect(capture([]).status?.forms).toBe('loading')
  })

  it('reports ready once the forms read has settled', () => {
    statusFor['hosts/h1/forms'] = 'success'
    const value = capture(['forms'])
    expect(value.status?.forms).toBe('ready')
    // Settled AND empty is the site's answer: it has no forms yet.
    expect(value.forms).toEqual([])
  })

  it('reports error when the read failed, so nothing claims "no forms"', () => {
    statusFor['hosts/h1/forms'] = 'error'
    expect(capture(['forms']).status?.forms).toBe('error')
  })

  it('offers each form by ID, labelled with its current name', () => {
    statusFor['hosts/h1/forms'] = 'success'
    docsFor['hosts/h1/forms'] = [
      { $id: 'form-1', displayName: 'Contact us' },
      { $id: 'form-2', displayName: 'Apply now' },
      { $id: 'form-3', displayName: 'Old form', deletedAt: 1 },
    ]
    const value = capture(['forms'])
    // The id is the reference; the name is resolved fresh at edit time, so a
    // rename never splits a form's submission history.
    expect(value.forms).toEqual([
      { id: 'form-1', label: 'Contact us' },
      { id: 'form-2', label: 'Apply now' },
    ])
  })

  it('falls back to the id rather than hiding a form with no name', () => {
    statusFor['hosts/h1/forms'] = 'success'
    docsFor['hosts/h1/forms'] = [{ $id: 'form-9' }]
    expect(capture(['forms']).forms).toEqual([
      { id: 'form-9', label: 'form-9' },
    ])
  })
})
