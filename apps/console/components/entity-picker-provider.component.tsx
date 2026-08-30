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
  type EntityOption,
  type EntityPickerKind,
  effectiveDatasetModel,
  FORMS_MAX_PER_HOST,
  isHostCollectionKind,
} from '@aglyn/aglyn'
import { collection, limit, orderBy, query } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { useFirestore, useOrgDataScope } from '@aglyn/tenant-feature-instance'
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
 * Feeds the attributes panel's id-based entity pickers (AGL-343/344):
 * products, collections, categories, and datasets listed by current
 * name, persisted by id — the same rename-safe contract as screen links
 * and variable bindings.
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
  const { scope: dataScope } = useOrgDataScope({ hostId })
  const { data: productDocs } = useFirestoreCollection<any>(
    () =>
      requested.has('products')
        ? query(collection(firestore, 'hosts', hostId, 'products'), limit(300))
        : null,
    [firestore, hostId, requested],
    { idField: '$id' },
  )
  const { data: collectionDocs } = useFirestoreCollection<any>(
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
  const { data: categoryDocs } = useFirestoreCollection<any>(
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
  // `FORMS_MAX_PER_HOST` is a read WINDOW, not a cap on the collection: how
  // many forms a site may hold is `formsPerHost`, enforced at the create,
  // and a staff-set per-org override can raise a catalog past this window.
  // A picker fed from here therefore owes the same disclosure the inbox
  // filter carries — a list cut at the window must say it was cut, because
  // "not in the picker" and "does not exist" are otherwise the same answer.
  //
  // Ordered by `__name__` rather than `displayName`: `orderBy` on a data
  // field DROPS every document missing it, and a form saved without a name
  // would then be missing from its own picker.
  const { data: formDocs } = useFirestoreCollection<any>(
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
  const { data: datasetDocs } = useFirestoreCollection<any>(
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
      request,
    }),
    [productDocs, collectionDocs, categoryDocs, datasetDocs, formDocs, request],
  )

  return (
    <EntityPickerContext.Provider value={value}>
      {children}
    </EntityPickerContext.Provider>
  )
}
EntityPickerProvider.displayName = 'EntityPickerProvider'

export default EntityPickerProvider
