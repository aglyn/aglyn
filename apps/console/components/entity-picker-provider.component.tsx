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
  type EntityListState,
  type EntityOption,
  type EntityPickerKind,
  effectiveDatasetModel,
  FORMS_MAX_PER_HOST,
  isHostCollectionKind,
} from '@aglyn/aglyn'
import { collection, limit, orderBy, query } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
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

/**
 * Feeds the attributes panel's id-based entity pickers (AGL-343/344):
 * products, collections, categories, datasets and forms listed by current
 * name, persisted by id — the same rename-safe contract as screen links
 * and variable bindings.
 *
 * Mounted on every besigner surface, and cheap enough to be: no list is read
 * until a selected node's schema declares the picker that would show it, and
 * the org lookup datasets need waits on the same signal.
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
  // four listeners below, applied to their one prerequisite.
  const wantsDatasets = requested.has('datasets')
  const { scope: dataScope } = useOrgDataScope({
    hostId: wantsDatasets ? hostId : undefined,
  })
  const { data: productDocs, status: productsStatus } =
    useFirestoreCollection<any>(
      () =>
        requested.has('products')
          ? query(
              collection(firestore, 'hosts', hostId, 'products'),
              limit(300),
            )
          : null,
      [firestore, hostId, requested],
      { idField: '$id' },
    )
  const { data: collectionDocs, status: collectionsStatus } =
    useFirestoreCollection<any>(
      () =>
        requested.has('collections')
          ? query(
              collection(firestore, 'hosts', hostId, 'collections'),
              limit(200),
            )
          : null,
      [firestore, hostId, requested],
      { idField: '$id' },
    )
  const { data: categoryDocs, status: categoriesStatus } =
    useFirestoreCollection<any>(
      () =>
        requested.has('categories')
          ? query(
              collection(firestore, 'hosts', hostId, 'productCategories'),
              limit(200),
            )
          : null,
      [firestore, hostId, requested],
      { idField: '$id' },
    )
  // The site's form entities (`docs/specs/reusable-forms.md` §2c). Host-
  // scoped, unlike datasets, because a form renders on one site's pages and
  // its submissions already live under that host.
  //
  // Bounded by `FORMS_MAX_PER_HOST`, so the whole collection is one small
  // page. Ordered by `__name__` rather than `displayName`: `orderBy` on a
  // data field DROPS every document missing it, and a form saved without a
  // name would then be missing from its own picker.
  const { data: formDocs, status: formsStatus } = useFirestoreCollection<any>(
    () =>
      requested.has('forms')
        ? query(
            collection(firestore, 'hosts', hostId, 'forms'),
            orderBy('__name__'),
            limit(FORMS_MAX_PER_HOST),
          )
        : null,
    [firestore, hostId, requested],
    { idField: '$id' },
  )
  const { data: datasetDocs, status: datasetsStatus } =
    useFirestoreCollection<any>(
      () =>
        dataScope && requested.has('datasets')
          ? query(
              collection(firestore, dataScope[0], dataScope[1], 'datasets'),
              limit(200),
            )
          : null,
      [firestore, dataScope, requested],
      { idField: '$id' },
    )

  const value = useMemo(
    () => ({
      products: toOptions(productDocs),
      // COLLECTION_SELECT is the commerce product-grid picker, and content
      // collections share the same Firestore path (AGL-954) — offering them
      // here would bind a product grid to a blog.
      collections: toOptions(
        (collectionDocs ?? []).filter(isHostCollectionKind('catalog')),
      ),
      categories: toOptions(categoryDocs),
      // Console-created forms store the human name as `displayName`.
      forms: toOptions(formDocs, 'displayName'),
      // Console-created datasets store the human name as `displayName`
      // (AGL-536); `name` covers pre-migration docs.
      datasets: toOptions(datasetDocs, 'displayName'),
      // Per-dataset model fields (AGL-556) for "Maps to schema field"
      // pickers: stable fieldId + current display name, in model order.
      datasetFields: Object.fromEntries(
        (datasetDocs ?? [])
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
      ),
      // Why each list is the length it is, so a picker showing nothing can
      // say which kind of nothing it is.
      //
      // `datasets` reports its listener's state and not the org lookup's:
      // a host with no owning org leaves `dataScope` null forever, the query
      // is never built, and the hook sits on `loading` — which is the honest
      // answer, since no dataset list is coming.
      status: {
        products: toListState(productsStatus),
        collections: toListState(collectionsStatus),
        categories: toListState(categoriesStatus),
        datasets: toListState(datasetsStatus),
        forms: toListState(formsStatus),
      },
      request,
    }),
    [
      productDocs,
      collectionDocs,
      categoryDocs,
      datasetDocs,
      formDocs,
      productsStatus,
      collectionsStatus,
      categoriesStatus,
      datasetsStatus,
      formsStatus,
      request,
    ],
  )

  return (
    <EntityPickerContext.Provider value={value}>
      {children}
    </EntityPickerContext.Provider>
  )
}
EntityPickerProvider.displayName = 'EntityPickerProvider'

export default EntityPickerProvider
