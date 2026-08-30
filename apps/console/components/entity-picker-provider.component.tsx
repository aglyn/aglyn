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
'use client'

import {
  EntityPickerContext,
  ENTITY_PICKER_BROWSE_LIMIT,
  ENTITY_PICKER_SEARCH_LIMIT,
  isSearchableQuery,
  nameSearchToken,
  type EntityListState,
  type EntityOption,
  type EntityPickerKind,
  effectiveDatasetModel,
} from '@aglyn/aglyn'
import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  type QueryConstraint,
} from 'firebase/firestore'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DependencyList,
} from 'react'
import {
  useFirestore,
  useOrgDataScope,
  type FirestoreCollectionStatus,
} from '@aglyn/tenant-feature-instance'
import useFirestoreCollection from '../hooks/use-firestore-collection'

export interface EntityPickerProviderProps {
  hostId: string
  children?: JSX.Children
}

/**
 * One document past the browse window, and it is never offered.
 *
 * A window that comes back exactly full says nothing on its own — a site with
 * precisely 25 products and one with 25,000 both fill it. The probe turns that
 * into a fact, which is what the picker's "showing the first 25" sentence is
 * allowed to be built from. One extra document is the whole price of not
 * having to guess.
 */
const BROWSE_PROBE = ENTITY_PICKER_BROWSE_LIMIT + 1

const toOptions = (
  docs: any[] | undefined,
  labelField = 'name',
): EntityOption[] =>
  (docs ?? [])
    .filter((item) => !item.deletedAt)
    .map((item) => ({
      id: item.$id,
      label: String(item[labelField] ?? item.name ?? item.$id),
    }))

/**
 * What a picker may conclude from the list it was handed.
 *
 * Only a SETTLED read makes an empty list the site's own answer. A listener
 * that has not answered yet holds `loading` — which is also what a kind
 * nobody asked for reads as, since its query is null and the hook never
 * leaves `loading` — and a failed one holds `error`, so a picker can say the
 * read broke instead of reporting a catalog that exists as absent.
 */
const toListState = (status: FirestoreCollectionStatus): EntityListState => {
  if (status === 'error') return 'error'
  return status === 'success' ? 'ready' : 'loading'
}

function useDebouncedValue<V>(value: V, ms: number): V {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

/** Long enough that a held key is one query, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 250

export interface UseEntityPickerListOptions {
  /**
   * Collection path segments, or null to read NOTHING.
   *
   * Null is the demand gate and the unresolved-scope hold in one: a kind no
   * picker has asked for and a dataset list whose org has not resolved both
   * pass null, and `useFirestoreCollection` opens no listener for either.
   */
  path: readonly string[] | null
  labelField?: string
  /**
   * Server-side scope, applied to the browse window AND to search alike.
   *
   * Narrowing here rather than after the read is what keeps a small window
   * honest: a client-side filter over 25 documents offers however many happen
   * to survive it, so the window would shrink to nothing on a site whose
   * collection is mostly the other kind.
   */
  scope?: readonly QueryConstraint[]
  /**
   * This collection's documents carry `nameTokens`/`nameLower`, so a typed
   * query can reach past the window on the server.
   */
  serverSearchable?: boolean
  /** What the author typed into this kind's picker. */
  text: string
  /** Stable scope dependencies, like a `useEffect` dep array. */
  deps: DependencyList
}

export interface UseEntityPickerListResult {
  options: EntityOption[]
  /**
   * The raw documents behind {@link options}.
   *
   * Only the dataset list needs them — a dataset's model fields are read off
   * the document, not off its name — and it is the one caller that takes
   * them.
   */
  rows: any[]
  state: EntityListState
  truncated: boolean
}

/**
 * One kind's picker list: a bounded browse, plus the reach past it.
 *
 * This side answers ONE question — what may an author pick from here — and it
 * is bounded because that is all it answers. Naming the value already on the
 * node is a keyed read (`resolve` on the provider below), so nothing forces
 * this window wide enough to contain whatever was picked last month. A window
 * that carried both jobs would have to be, and would still fail past its own
 * width by rendering a bound element as unbound.
 *
 * Ordered by `documentId()`, which no document can be missing. Ordering a
 * bounded read by a data field drops every document that lacks it — the trap
 * the forms query was already written around, since a form saved without a
 * name would otherwise vanish from its own picker — and here the consequence
 * would be an entity that lists on its own console page and cannot be placed.
 *
 * The search read is spent only when it can find something the window did not:
 * the collection carries the search keys, the query is worth a read, AND the
 * probe proved there is something beyond the window. A partial window is proof
 * there is nothing past it, so a small site pays for typing exactly nothing.
 */
export function useEntityPickerList(
  options: UseEntityPickerListOptions,
): UseEntityPickerListResult {
  const {
    path,
    labelField = 'name',
    scope,
    serverSearchable = false,
    text,
    deps,
  } = options
  const firestore = useFirestore()
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const pathRef = useRef(path)
  pathRef.current = path
  /**
   * The scope as one string, and the ONLY thing the search read re-runs on.
   *
   * The path array and the Firestore handle are both rebuilt every render, so
   * an effect that depended on either would re-run every render — and this
   * one clears its results, which is a render, which is the loop.
   */
  const pathKey = path ? path.join('/') : ''

  const { data, status } = useFirestoreCollection<any>(
    () => {
      if (!path) return null
      return query(
        collection(firestore, path[0], ...path.slice(1)),
        ...(scopeRef.current ?? []),
        orderBy(documentId()),
        limit(BROWSE_PROBE),
      )
    },
    deps,
    { idField: '$id' },
  )

  const truncated = (data?.length ?? 0) > ENTITY_PICKER_BROWSE_LIMIT
  const browsed = useMemo(
    () => (data ?? []).slice(0, ENTITY_PICKER_BROWSE_LIMIT),
    [data],
  )

  const debounced = useDebouncedValue(text.trim(), SEARCH_DEBOUNCE_MS)
  const [found, setFound] = useState<any[]>([])
  const canSearch =
    Boolean(path) &&
    serverSearchable &&
    truncated &&
    isSearchableQuery(debounced)
  const token = canSearch ? nameSearchToken(debounced) : ''

  useEffect(() => {
    // Functionally, and only when there is something to clear: an
    // unconditional `setFound([])` writes a new array every time this effect
    // runs, and a state write is a render.
    setFound((previous) => (previous.length === 0 ? previous : []))
    const current = pathRef.current
    if (!current || !token) return
    let cancelled = false
    getDocs(
      query(
        collection(firestore, current[0], ...current.slice(1)),
        ...(scopeRef.current ?? []),
        // Word-prefix tokens, so "cof" finds "Acme Coffee" — a prefix range
        // over the whole name would only ever find it from "acme".
        where('nameTokens', 'array-contains', token),
        // Safe here and nowhere else in this file: `array-contains` has
        // already excluded every document without the search keys, so
        // ordering by one of them drops nothing the query could return.
        orderBy('nameLower'),
        limit(ENTITY_PICKER_SEARCH_LIMIT),
      ),
    )
      .then((snapshot) => {
        if (cancelled) return
        setFound(
          snapshot.docs.map((docSnap) => ({
            ...docSnap.data(),
            $id: docSnap.id,
          })),
        )
      })
      .catch(() => {
        // Fall back to the window, which is a narrower answer and not a wrong
        // one — the rows it holds still match. Blanking the list would turn a
        // failed WIDENING into "this site has nothing called that", which is
        // the one answer a picker must never get wrong.
        if (!cancelled) setFound([])
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathKey, token])

  const rows = useMemo(() => {
    if (found.length === 0) return browsed
    const seen = new Set(browsed.map((row: any) => row.$id))
    return [...browsed, ...found.filter((row: any) => !seen.has(row.$id))]
  }, [browsed, found])
  const offered = useMemo(
    () => toOptions(rows, labelField),
    [rows, labelField],
  )

  return { options: offered, rows, state: toListState(status), truncated }
}

/**
 * Feeds the attributes panel's id-based entity pickers (AGL-343/344):
 * products, collections, categories, datasets and forms listed by current
 * name, persisted by id — the same rename-safe contract as screen links
 * and variable bindings.
 *
 * Mounted on every besigner surface, and cheap enough to be: no list is read
 * until a selected node's schema declares the picker that would show it, the
 * org lookup datasets need waits on the same signal, and what a list costs
 * when it IS read is a page of the size the console's own tables use.
 */
export function EntityPickerProvider(props: EntityPickerProviderProps) {
  const { hostId, children } = props
  const firestore = useFirestore()
  /**
   * WHICH lists something on screen has actually asked for (AGL-703).
   *
   * All four listeners used to open the moment the besigner mounted — up to
   * 300 products, 200 catalog collections, 200 categories and 200 datasets,
   * every time, on a site with a real catalog. The attributes panel reads
   * them, and only for a node whose schema declares that kind of picker, so
   * the overwhelming majority of editing sessions paid for four collections
   * they never looked at and held four listeners open on them.
   *
   * Same shape as the "Used by" scan (AGL-703): the surface that would show
   * the answer is the ask. A picker appearing IS a user action — it takes
   * selecting a node that has one — so nothing here waits for a click.
   *
   * A `Set` in state, added to idempotently: `request` is called from a
   * render-driven effect, and re-setting state for a kind already present
   * would loop.
   */
  const [requested, setRequested] = useState<ReadonlySet<EntityPickerKind>>(
    () => new Set(),
  )
  const request = useCallback((kind: EntityPickerKind) => {
    setRequested((previous) => {
      if (previous.has(kind)) return previous
      const next = new Set(previous)
      next.add(kind)
      return next
    })
  }, [])

  /** What the author has typed into each kind's picker, if anything. */
  const [queries, setQueries] = useState<
    Readonly<Partial<Record<EntityPickerKind, string>>>
  >({})
  const search = useCallback((kind: EntityPickerKind, text: string) => {
    setQueries((previous) => {
      const next = text ?? ''
      // Identity is load-bearing: this is called from the dropdown's every
      // keystroke, including the ones that re-emit the same text when a
      // value is picked, and a new object each time would re-run every
      // consumer's effects.
      if ((previous[kind] ?? '') === next) return previous
      return { ...previous, [kind]: next }
    })
  }, [])

  // Datasets are org-scoped (AGL-240). `dataScope` is null until the org
  // lookup settles (AGL-1061) and for any host without one, so the picker
  // shows an empty dataset list for a beat rather than listing a host path
  // that no longer exists (AGL-1050). Read-only, so that flash is the
  // entire cost.
  //
  // The host is withheld until a dataset picker asks, which is what keeps
  // MOUNTING this provider free: with no host to resolve the lookup settles
  // without a read (AGL-1061), so a besigner surface that never opens a
  // dataset picker makes no `hostIndex` call either. Same demand rule as the
  // five lists below, applied to their one prerequisite.
  const wantsDatasets = requested.has('datasets')
  const { scope: dataScope } = useOrgDataScope({
    hostId: wantsDatasets ? hostId : undefined,
  })

  /**
   * Where each kind lives, or null when nothing may read it yet.
   *
   * One table, because the browse listener, the search query and the keyed
   * resolution of a stored value all have to agree about which collection a
   * kind means. Two of the three disagreeing is silent: the picker would list
   * one collection and resolve selections against another, so every stored
   * value would render as unavailable on a site where every one of them is
   * fine.
   */
  const paths = useMemo(
    (): Readonly<Record<EntityPickerKind, readonly string[] | null>> => ({
      products: requested.has('products')
        ? ['hosts', hostId, 'products']
        : null,
      collections: requested.has('collections')
        ? ['hosts', hostId, 'collections']
        : null,
      categories: requested.has('categories')
        ? ['hosts', hostId, 'productCategories']
        : null,
      // Host-scoped, unlike datasets: a form renders on one site's pages and
      // its submissions already live under that host.
      forms: requested.has('forms') ? ['hosts', hostId, 'forms'] : null,
      datasets:
        dataScope && requested.has('datasets')
          ? [dataScope[0], dataScope[1], 'datasets']
          : null,
    }),
    [hostId, dataScope, requested],
  )

  /**
   * COLLECTION_SELECT is the commerce product-grid picker, and content
   * collections share the same Firestore path (AGL-954) — offering them here
   * would bind a product grid to a blog.
   *
   * On the server, and not after the read. A client-side kind filter over a
   * 25-document window offers however many catalog collections happen to fall
   * inside it, so a site with thirty content collections and two catalog ones
   * would show an empty product-grid picker while both of its collections
   * exist.
   *
   * Exactly as strict as `isHostCollectionKind`, not more: a document that
   * does not say what it is counts as content, and `where` drops precisely
   * those.
   */
  const catalogOnly = useMemo(() => [where('kind', '==', 'catalog')], [])

  const products = useEntityPickerList({
    path: paths.products,
    text: queries.products ?? '',
    // The one kind whose documents carry `nameTokens`/`nameLower`: the
    // catalog's own write path stamps them, and the shared resource route
    // deliberately does not stamp them on the other four.
    serverSearchable: true,
    deps: [firestore, paths.products?.join('/') ?? ''],
  })
  const collections = useEntityPickerList({
    path: paths.collections,
    scope: catalogOnly,
    text: queries.collections ?? '',
    deps: [firestore, paths.collections?.join('/') ?? ''],
  })
  const categories = useEntityPickerList({
    path: paths.categories,
    text: queries.categories ?? '',
    deps: [firestore, paths.categories?.join('/') ?? ''],
  })
  // Console-created forms store the human name as `displayName`.
  const forms = useEntityPickerList({
    path: paths.forms,
    labelField: 'displayName',
    text: queries.forms ?? '',
    deps: [firestore, paths.forms?.join('/') ?? ''],
  })
  // Console-created datasets store the human name as `displayName`
  // (AGL-536); `name` covers pre-migration docs, via the label fallback.
  const datasets = useEntityPickerList({
    path: paths.datasets,
    labelField: 'displayName',
    text: queries.datasets ?? '',
    deps: [firestore, paths.datasets?.join('/') ?? ''],
  })

  /**
   * Dataset documents fetched by {@link resolve}, kept whole.
   *
   * A dataset is the one kind whose picker is not the end of the story: a
   * form bound to it then offers ITS model fields (AGL-556), and those are
   * read off the document. Keeping only the resolved NAME would leave a form
   * bound to a dataset outside the browse window with an empty "Maps to
   * schema field" picker — the same defect as an unresolved selection, one
   * level down.
   */
  const [resolvedDatasetDocs, setResolvedDatasetDocs] = useState<
    Readonly<Record<string, any>>
  >({})

  /**
   * Resolved labels for stored ids, keyed by kind and then by id.
   *
   * `null` means the read settled and found no such document. An absent key
   * means the resolution is still in flight, and it must not render as
   * missing — see the contract on `EntityPickerContextValue.resolved`.
   */
  const [resolved, setResolved] = useState<
    Partial<Record<EntityPickerKind, Readonly<Record<string, EntityOption | null>>>>
  >({})
  /**
   * Every id a read has already been spent on, so one is never spent twice.
   *
   * A ref rather than state, and read before `resolved` is written: `resolve`
   * is called from a render-driven effect that re-runs whenever the node or
   * the context changes, and a guard that waited for the state write would
   * let the same id go out several times before the first answer landed.
   */
  const resolvingRef = useRef<Set<string>>(new Set())
  const labelFields: Readonly<Record<EntityPickerKind, string>> = useMemo(
    () => ({
      products: 'name',
      collections: 'name',
      categories: 'name',
      forms: 'displayName',
      datasets: 'displayName',
    }),
    [],
  )
  // The paths a resolution needs, read at CALL time rather than captured:
  // `resolve` is handed to consumers through the context and must stay
  // identity-stable, or the effect that calls it re-runs on every render.
  const pathsRef = useRef(paths)
  pathsRef.current = paths
  const labelFieldsRef = useRef(labelFields)
  labelFieldsRef.current = labelFields

  const resolve = useCallback((kind: EntityPickerKind, id: string) => {
    const path = pathsRef.current[kind]
    // No path yet — the org lookup a dataset needs has not settled. Left
    // unmarked deliberately, so the next call after it does resolves rather
    // than being swallowed by a guard that thinks this id was handled.
    if (!path || !id) return
    const key = `${path.join('/')}/${id}`
    if (resolvingRef.current.has(key)) return
    resolvingRef.current.add(key)
    const labelField = labelFieldsRef.current[kind]
    getDoc(doc(firestore, path[0], ...path.slice(1), id))
      .then((snapshot) => {
        const data = snapshot.exists() ? (snapshot.data() as any) : null
        const option: EntityOption | null =
          data && !data.deletedAt
            ? { id, label: String(data[labelField] ?? data.name ?? id) }
            : null
        setResolved((previous) => ({
          ...previous,
          [kind]: { ...(previous[kind] ?? {}), [id]: option },
        }))
        if (kind === 'datasets' && option) {
          setResolvedDatasetDocs((previous) => ({
            ...previous,
            [id]: { ...data, $id: id },
          }))
        }
      })
      .catch(() => {
        // A failed read is not evidence the entity is gone, and recording it
        // as `null` would label a live reference "unavailable". Drop the
        // guard instead, so reopening the panel tries again.
        resolvingRef.current.delete(key)
      })
  }, [firestore])

  const value = useMemo(() => {
    /**
     * The chosen dataset's model, wherever the document came from.
     *
     * A resolution counts here exactly as a browsed document does, which is
     * what keeps a form bound to a dataset outside the window able to map its
     * fields. Browsed rows win on a collision — they are live, and the
     * resolution was taken once.
     */
    const datasetModels = Object.fromEntries(
      [...Object.values(resolvedDatasetDocs), ...datasets.rows]
        .filter((dataset) => !dataset.deletedAt)
        .map((dataset) => {
          const model = effectiveDatasetModel(dataset)
          return [
            dataset.$id,
            model.order
              .filter((fieldId) => model.fields[fieldId])
              .map((fieldId) => ({
                id: fieldId,
                label: model.fields[fieldId].name || fieldId,
              })),
          ]
        }),
    )
    return {
      products: products.options,
      collections: collections.options,
      categories: categories.options,
      forms: forms.options,
      datasets: datasets.options,
      datasetFields: datasetModels,
      // Why each list is the length it is, so a picker showing nothing can
      // say which kind of nothing it is.
      //
      // `datasets` reports its listener's state and not the org lookup's:
      // a host with no owning org leaves `dataScope` null forever, the query
      // is never built, and the hook sits on `loading` — which is the honest
      // answer, since no dataset list is coming.
      status: {
        products: products.state,
        collections: collections.state,
        categories: categories.state,
        datasets: datasets.state,
        forms: forms.state,
      },
      truncated: {
        products: products.truncated,
        collections: collections.truncated,
        categories: categories.truncated,
        datasets: datasets.truncated,
        forms: forms.truncated,
      },
      // Only the catalog carries the name-search keys, so only the catalog's
      // picker may claim its search reaches the whole collection.
      searchable: {
        products: true,
        collections: false,
        categories: false,
        datasets: false,
        forms: false,
      },
      resolved,
      request,
      search,
      resolve,
    }
  }, [
    products,
    collections,
    categories,
    datasets,
    forms,
    resolved,
    resolvedDatasetDocs,
    request,
    search,
    resolve,
  ])

  return (
    <EntityPickerContext.Provider value={value}>
      {children}
    </EntityPickerContext.Provider>
  )
}
EntityPickerProvider.displayName = 'EntityPickerProvider'

export default EntityPickerProvider
