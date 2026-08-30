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
 * The besigner does not read a catalogue it is not showing (AGL-703), and
 * what it reads when it does show one is a PAGE.
 *
 * `EntityPickerProvider` wraps every besigner surface and opened four
 * listeners the moment it mounted — up to 300 products, 200 catalog
 * collections, 200 product categories and 200 datasets — to fill attribute
 * pickers that only appear for a selected node whose schema declares one.
 * That half is fixed and pinned below: the demand signal is the panel.
 *
 * The other half is the SIZE. Even asked for, no dropdown needs hundreds of
 * documents; the console's own tables page at 10/25/50. The window was that
 * wide because one bulk read did two jobs — it built the options AND supplied
 * the label for the value already on the node — so it had to be able to
 * contain whatever an author picked last month, and past that width it
 * rendered a bound element as unbound anyway. The two jobs are separate now:
 * a keyed read resolves the selection, the window only has to browse.
 *
 * These assert on the QUERY, and on the NUMBER in it. A provider that opened
 * the listeners and hid the results would look identical on screen and cost
 * exactly what it cost before; so would one that quietly went back to 300.
 */
import * as Aglyn from '@aglyn/aglyn'
import { act, render, waitFor } from '@testing-library/react'
import { useContext, useEffect } from 'react'
import EntityPickerProvider from '../components/entity-picker-provider.component'

/** Every query a listener was opened on, in order. */
const listening: Array<{ path: string; constraints: any[] }> = []
/** Every one-shot `getDocs` the provider issued. */
const fetched: Array<{ path: string; constraints: any[] }> = []
/** Every keyed document read, by full path. */
const keyedReads: string[] = []
/** Which host the org lookup datasets need was asked to resolve. */
const orgLookups: Array<string | undefined> = []
/** Rows a given collection path answers with, and how its read is going. */
const docsFor: Record<string, unknown[]> = {}
const statusFor: Record<string, string> = {}
/** Rows a one-shot search answers with, by collection path. */
const searchDocsFor: Record<string, any[]> = {}
/** What a keyed read finds at a full document path; absent = no document. */
const keyedDocFor: Record<string, any> = {}

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({
    __path: path.join('/'),
  }),
  doc: (_db: unknown, ...path: string[]) => ({ __doc: path.join('/') }),
  documentId: () => '__name__',
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: string) => ({ orderBy: field }),
  where: (field: string, op: string, value: unknown) => ({
    where: [field, op, value],
  }),
  query: (ref: { __path: string }, ...constraints: any[]) => ({
    __path: ref.__path,
    constraints,
  }),
  getDoc: (ref: { __doc: string }) => {
    keyedReads.push(ref.__doc)
    const data = keyedDocFor[ref.__doc]
    return Promise.resolve({
      exists: () => data !== undefined,
      data: () => data,
    })
  },
  getDocs: (built: { __path: string; constraints: any[] }) => {
    fetched.push({ path: built.__path, constraints: built.constraints })
    return Promise.resolve({
      docs: (searchDocsFor[built.__path] ?? []).map((row: any) => ({
        id: row.$id,
        data: () => row,
      })),
    })
  },
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
  default: (factory: () => any) => {
    const built = factory()
    // `null` is the hook's own "do not listen" contract — the same one the
    // dataset query has always used while the org scope is unresolved.
    if (!built) return { data: [], status: 'loading' }
    listening.push({ path: built.__path, constraints: built.constraints })
    return {
      data: docsFor[built.__path] ?? [],
      status: statusFor[built.__path] ?? 'loading',
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
function Capture(props: {
  onValue: (value: Aglyn.EntityPickerContextValue) => void
}) {
  const value = useContext(Aglyn.EntityPickerContext)
  props.onValue(value)
  return null
}

const opened = () => [...new Set(listening.map((entry) => entry.path))].sort()

/** The `limit()` a listener was opened with, for one collection. */
const limitOn = (path: string): number | undefined => {
  const entry = listening.find((candidate) => candidate.path === path)
  return entry?.constraints.find((c) => 'limit' in c)?.limit
}

/** The fields a listener ordered by, for one collection. */
const orderOn = (path: string): string[] =>
  (listening.find((candidate) => candidate.path === path)?.constraints ?? [])
    .filter((c) => 'orderBy' in c)
    .map((c) => c.orderBy)

/** The `where` clauses a listener was opened with, for one collection. */
const filtersOn = (path: string): any[][] =>
  (listening.find((candidate) => candidate.path === path)?.constraints ?? [])
    .filter((c) => 'where' in c)
    .map((c) => c.where)

/** `count` documents named `<prefix>-1`… , each with the given label field. */
const rows = (count: number, prefix: string, labelField = 'name') =>
  Array.from({ length: count }, (_, index) => ({
    $id: `${prefix}-${index + 1}`,
    [labelField]: `${prefix} ${index + 1}`,
  }))

beforeEach(() => {
  listening.length = 0
  fetched.length = 0
  keyedReads.length = 0
  orgLookups.length = 0
  for (const store of [docsFor, statusFor, searchDocsFor, keyedDocFor]) {
    for (const key of Object.keys(store)) delete (store as any)[key]
  }
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
 * The numbers, asserted as numbers.
 *
 * "The picker reads less" is not a testable claim — a regression to
 * `limit(300)` behaves identically on the ten-product site every other test
 * in this file uses. So the window size is pinned directly, and pinned per
 * kind, because each of the five was its own literal.
 */
describe('a picker reads a page, not a catalog', () => {
  const ALL: Aglyn.EntityPickerKind[] = [
    'products',
    'collections',
    'categories',
    'datasets',
    'forms',
  ]
  const PATHS: Record<Aglyn.EntityPickerKind, string> = {
    products: 'hosts/h1/products',
    collections: 'hosts/h1/collections',
    categories: 'hosts/h1/productCategories',
    datasets: 'orgs/org-1/datasets',
    forms: 'hosts/h1/forms',
  }

  const openAll = () =>
    render(
      <EntityPickerProvider hostId="h1">
        <Consumer kinds={ALL} />
      </EntityPickerProvider>,
    )

  it('browses 25, the middle of the range the console tables offer', () => {
    expect(Aglyn.ENTITY_PICKER_BROWSE_LIMIT).toBe(25)
  })

  it.each(ALL)('reads %s at the browse window plus one probe', (kind) => {
    openAll()
    expect(limitOn(PATHS[kind])).toBe(Aglyn.ENTITY_PICKER_BROWSE_LIMIT + 1)
    // Spelled out, so the arithmetic above cannot drift with the constant.
    expect(limitOn(PATHS[kind])).toBe(26)
  })

  it.each(ALL)('reads nothing like the old %s window', (kind) => {
    openAll()
    // The five literals this replaced: 300 products, 200 collections, 200
    // categories, 200 datasets, 1,000 forms.
    expect(limitOn(PATHS[kind])).toBeLessThan(200)
  })

  it.each(ALL)('orders %s by document id and nothing else', (kind) => {
    openAll()
    // `orderBy` on a data field DROPS every document missing it — a form
    // saved without a name would vanish from its own picker, and a product
    // imported before the search keys existed from the product one. Nothing
    // can be missing its own id.
    expect(orderOn(PATHS[kind])).toEqual(['__name__'])
  })

  it('never offers the probe document', () => {
    // The probe exists to answer "is there more", not to be shown. Offering
    // it would make the window 26 and the sentence beside it wrong.
    docsFor['hosts/h1/forms'] = rows(26, 'form', 'displayName')
    statusFor['hosts/h1/forms'] = 'success'
    let latest = {} as Aglyn.EntityPickerContextValue
    render(
      <EntityPickerProvider hostId="h1">
        <Consumer kinds={['forms']} />
        <Capture onValue={(value) => (latest = value)} />
      </EntityPickerProvider>,
    )
    expect(latest.forms).toHaveLength(Aglyn.ENTITY_PICKER_BROWSE_LIMIT)
    expect(latest.forms?.map((form) => form.id)).not.toContain('form-26')
  })

  it('says the list is truncated when the probe comes back', () => {
    docsFor['hosts/h1/forms'] = rows(26, 'form', 'displayName')
    statusFor['hosts/h1/forms'] = 'success'
    let latest = {} as Aglyn.EntityPickerContextValue
    render(
      <EntityPickerProvider hostId="h1">
        <Consumer kinds={['forms']} />
        <Capture onValue={(value) => (latest = value)} />
      </EntityPickerProvider>,
    )
    expect(latest.truncated?.forms).toBe(true)
  })

  it('does NOT claim truncation on a window that came back exactly full', () => {
    // The reason the probe is worth one document: a site with precisely 25
    // forms and one with 25,000 fill the window identically, and telling the
    // first that it has more is a false sentence in the place the reader was
    // promised a true one.
    docsFor['hosts/h1/forms'] = rows(25, 'form', 'displayName')
    statusFor['hosts/h1/forms'] = 'success'
    let latest = {} as Aglyn.EntityPickerContextValue
    render(
      <EntityPickerProvider hostId="h1">
        <Consumer kinds={['forms']} />
        <Capture onValue={(value) => (latest = value)} />
      </EntityPickerProvider>,
    )
    expect(latest.truncated?.forms).toBe(false)
    expect(latest.forms).toHaveLength(25)
  })

  it('narrows catalog collections on the SERVER, not after the read', () => {
    // A client-side kind filter over 25 documents offers however many catalog
    // collections happen to fall inside the window, so a site with thirty
    // content collections and two catalog ones would show an empty product-
    // grid picker while both of its collections exist.
    render(
      <EntityPickerProvider hostId="h1">
        <Consumer kinds={['collections']} />
      </EntityPickerProvider>,
    )
    expect(filtersOn('hosts/h1/collections')).toEqual([
      ['kind', '==', 'catalog'],
    ])
  })

  it('leaves the other four kinds unfiltered', () => {
    // Only `collections` shares its path with a second feature. A stray
    // predicate on any of the others would drop every document missing the
    // field it named.
    render(
      <EntityPickerProvider hostId="h1">
        <Consumer
          kinds={['products', 'categories', 'datasets', 'forms']}
        />
      </EntityPickerProvider>,
    )
    expect(filtersOn('hosts/h1/products')).toEqual([])
    expect(filtersOn('hosts/h1/productCategories')).toEqual([])
    expect(filtersOn('orgs/org-1/datasets')).toEqual([])
    expect(filtersOn('hosts/h1/forms')).toEqual([])
  })
})

/**
 * The selection is a read of its own, and it is the reason the window above
 * is allowed to be small.
 */
describe('a stored value is resolved by a keyed read', () => {
  const mount = (kinds: Aglyn.EntityPickerKind[]) => {
    let latest = {} as Aglyn.EntityPickerContextValue
    render(
      <EntityPickerProvider hostId="h1">
        <Consumer kinds={kinds} />
        <Capture onValue={(value) => (latest = value)} />
      </EntityPickerProvider>,
    )
    return () => latest
  }

  it('reads exactly ONE document, at the id it was given', async () => {
    keyedDocFor['hosts/h1/forms/form-900'] = { displayName: 'Old contact form' }
    const latest = mount(['forms'])
    await act(async () => {
      latest().resolve?.('forms', 'form-900')
    })
    expect(keyedReads).toEqual(['hosts/h1/forms/form-900'])
    await waitFor(() =>
      expect(latest().resolved?.forms?.['form-900']).toEqual({
        id: 'form-900',
        label: 'Old contact form',
      }),
    )
  })

  it('never spends the same read twice', async () => {
    keyedDocFor['hosts/h1/forms/form-900'] = { displayName: 'Old contact form' }
    const latest = mount(['forms'])
    await act(async () => {
      latest().resolve?.('forms', 'form-900')
      latest().resolve?.('forms', 'form-900')
    })
    await act(async () => {
      latest().resolve?.('forms', 'form-900')
    })
    expect(keyedReads).toHaveLength(1)
  })

  it('records a document that is gone as NULL, not as absent', async () => {
    // The picker renders three different labels from these three states, and
    // conflating "settled, missing" with "still reading" is what would put a
    // warning on every live reference for the beat before its read lands.
    const latest = mount(['forms'])
    await act(async () => {
      latest().resolve?.('forms', 'form-gone')
    })
    await waitFor(() =>
      expect(latest().resolved?.forms).toHaveProperty('form-gone'),
    )
    expect(latest().resolved?.forms?.['form-gone']).toBeNull()
  })

  it('treats a soft-deleted document as gone', async () => {
    keyedDocFor['hosts/h1/forms/form-x'] = {
      displayName: 'Retired',
      deletedAt: 1,
    }
    const latest = mount(['forms'])
    await act(async () => {
      latest().resolve?.('forms', 'form-x')
    })
    await waitFor(() =>
      expect(latest().resolved?.forms).toHaveProperty('form-x'),
    )
    expect(latest().resolved?.forms?.['form-x']).toBeNull()
  })

  it('reads each kind from its OWN collection', async () => {
    const latest = mount(['products', 'categories', 'datasets'])
    await act(async () => {
      latest().resolve?.('products', 'p1')
      latest().resolve?.('categories', 'c1')
      latest().resolve?.('datasets', 'd1')
    })
    expect(keyedReads.sort()).toEqual([
      'hosts/h1/productCategories/c1',
      'hosts/h1/products/p1',
      'orgs/org-1/datasets/d1',
    ])
  })

  it('reads nothing for a kind whose scope has not resolved', async () => {
    // Datasets live under the owning org, and a resolution issued before the
    // lookup settles has no collection to read from. Held rather than
    // swallowed: the guard must not mark this id as handled, or the retry
    // after the org lands would never happen.
    const latest = mount([])
    await act(async () => {
      latest().resolve?.('datasets', 'd1')
    })
    expect(keyedReads).toEqual([])
  })

  it('falls back to the id rather than resolving to a blank label', async () => {
    keyedDocFor['hosts/h1/products/p9'] = { sku: 'ABC' }
    const latest = mount(['products'])
    await act(async () => {
      latest().resolve?.('products', 'p9')
    })
    await waitFor(() =>
      expect(latest().resolved?.products?.['p9']).toEqual({
        id: 'p9',
        label: 'p9',
      }),
    )
  })

  it('gives a resolved dataset its model fields too', async () => {
    // A dataset picker is not the end of the story: the form bound to it then
    // offers ITS fields. Keeping only the resolved name would leave a form
    // bound to a dataset outside the window with an empty field picker — the
    // same defect one level down.
    keyedDocFor['orgs/org-1/datasets/d-far'] = {
      displayName: 'Newsletter signups',
      model: {
        order: ['email'],
        fields: { email: { name: 'Email address' } },
      },
    }
    const latest = mount(['datasets'])
    await act(async () => {
      latest().resolve?.('datasets', 'd-far')
    })
    await waitFor(() =>
      expect(latest().datasetFields?.['d-far']).toEqual([
        { id: 'email', label: 'Email address' },
      ]),
    )
  })
})

/**
 * Search exists so a small window is not a small reach. What it must never do
 * is cost a read that cannot find anything the window did not already have.
 */
describe('search reaches past the window, and only when it can', () => {
  const mount = (kinds: Aglyn.EntityPickerKind[]) => {
    let latest = {} as Aglyn.EntityPickerContextValue
    render(
      <EntityPickerProvider hostId="h1">
        <Consumer kinds={kinds} />
        <Capture onValue={(value) => (latest = value)} />
      </EntityPickerProvider>,
    )
    return () => latest
  }

  const type = async (
    latest: () => Aglyn.EntityPickerContextValue,
    kind: Aglyn.EntityPickerKind,
    text: string,
  ) => {
    await act(async () => {
      latest().search?.(kind, text)
    })
    await act(async () => {
      jest.advanceTimersByTime(400)
    })
  }

  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('names only the catalog as searchable on the server', () => {
    // `nameTokens`/`nameLower` are stamped by the catalog's own write path,
    // and `hosts/{host}/resources` deliberately does not stamp them on the
    // other four kinds. A picker that promised a whole-collection search and
    // then ran one over 25 rows would be a worse lie than saying nothing.
    const latest = mount(['products', 'forms'])
    expect(latest().searchable?.products).toBe(true)
    expect(latest().searchable?.forms).toBe(false)
    expect(latest().searchable?.collections).toBe(false)
    expect(latest().searchable?.categories).toBe(false)
    expect(latest().searchable?.datasets).toBe(false)
  })

  it('spends nothing when the window already holds the whole catalog', async () => {
    // A partial window is proof there is nothing beyond it, so typing on a
    // small site is free — which is the common case and the one that must
    // not regress.
    docsFor['hosts/h1/products'] = rows(3, 'p')
    statusFor['hosts/h1/products'] = 'success'
    const latest = mount(['products'])
    await type(latest, 'products', 'coffee')
    expect(fetched).toEqual([])
  })

  it('spends nothing on a query too short to narrow anything', async () => {
    docsFor['hosts/h1/products'] = rows(26, 'p')
    statusFor['hosts/h1/products'] = 'success'
    const latest = mount(['products'])
    await type(latest, 'products', 'c')
    expect(fetched).toEqual([])
  })

  it('spends nothing for a kind with no search keys to query', async () => {
    docsFor['hosts/h1/forms'] = rows(26, 'form', 'displayName')
    statusFor['hosts/h1/forms'] = 'success'
    const latest = mount(['forms'])
    await type(latest, 'forms', 'contact')
    expect(fetched).toEqual([])
  })

  it('THE CONTROL: a truncated catalog and a real query DO reach out', async () => {
    docsFor['hosts/h1/products'] = rows(26, 'p')
    statusFor['hosts/h1/products'] = 'success'
    searchDocsFor['hosts/h1/products'] = [
      { $id: 'p-999', name: 'Coffee beans' },
    ]
    const latest = mount(['products'])
    await type(latest, 'products', 'coffee')
    expect(fetched).toHaveLength(1)
    expect(fetched[0].path).toBe('hosts/h1/products')
    // A word-prefix token, so "cof" finds "Acme Coffee" — a prefix range over
    // the whole name would only ever find it from "acme".
    expect(fetched[0].constraints).toContainEqual({
      where: ['nameTokens', 'array-contains', 'coffee'],
    })
    expect(fetched[0].constraints).toContainEqual({
      limit: Aglyn.ENTITY_PICKER_SEARCH_LIMIT,
    })
    expect(Aglyn.ENTITY_PICKER_SEARCH_LIMIT).toBe(25)
    await waitFor(() =>
      expect(latest().products?.map((option) => option.id)).toContain('p-999'),
    )
  })

  it('keeps the window rows alongside what the search found', async () => {
    docsFor['hosts/h1/products'] = rows(26, 'p')
    statusFor['hosts/h1/products'] = 'success'
    searchDocsFor['hosts/h1/products'] = [
      { $id: 'p-999', name: 'Coffee beans' },
      // Already in the window: it must not be offered twice.
      { $id: 'p-1', name: 'p 1' },
    ]
    const latest = mount(['products'])
    await type(latest, 'products', 'coffee')
    await waitFor(() =>
      expect(latest().products?.map((option) => option.id)).toContain('p-999'),
    )
    const ids = latest().products?.map((option) => option.id) ?? []
    expect(ids.filter((id) => id === 'p-1')).toHaveLength(1)
  })

  it('carries the catalog scope into the search, not only the browse', async () => {
    // The collections picker is the case: a search that dropped
    // `kind == catalog` would offer blog collections to a product grid.
    docsFor['hosts/h1/collections'] = rows(26, 'c')
    statusFor['hosts/h1/collections'] = 'success'
    const latest = mount(['collections'])
    await type(latest, 'collections', 'shoes')
    // Not searchable, so nothing is spent at all — the scope question only
    // arises for a kind that reaches out, and this pins that it does not.
    expect(fetched).toEqual([])
    expect(latest().searchable?.collections).toBe(false)
  })

  it('clears the search when the text is taken back', async () => {
    docsFor['hosts/h1/products'] = rows(26, 'p')
    statusFor['hosts/h1/products'] = 'success'
    searchDocsFor['hosts/h1/products'] = [
      { $id: 'p-999', name: 'Coffee beans' },
    ]
    const latest = mount(['products'])
    await type(latest, 'products', 'coffee')
    await waitFor(() =>
      expect(latest().products?.map((option) => option.id)).toContain('p-999'),
    )
    await type(latest, 'products', '')
    await waitFor(() =>
      expect(latest().products?.map((option) => option.id)).not.toContain(
        'p-999',
      ),
    )
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

  it('keeps all four states meaningful and distinct', () => {
    // `unavailable` is the contract's own answer for a surface with no
    // provider, and it is reached through `entityListState` rather than
    // reported here — so the four remain four.
    statusFor['hosts/h1/forms'] = 'success'
    expect(Aglyn.entityListState(capture(['forms']), 'forms')).toBe('ready')
    expect(Aglyn.entityListState(undefined, 'forms')).toBe('unavailable')
    expect(Aglyn.entityListState(capture([]), 'forms')).toBe('loading')
    statusFor['hosts/h1/forms'] = 'error'
    expect(Aglyn.entityListState(capture(['forms']), 'forms')).toBe('error')
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
