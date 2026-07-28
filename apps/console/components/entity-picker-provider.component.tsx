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
  effectiveDatasetModel,
  isHostCollectionKind,
} from '@aglyn/aglyn'
import { collection, limit, query } from 'firebase/firestore'
import { useMemo } from 'react'
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
  // Datasets are org-scoped (AGL-240); resolve the owning org and fall
  // back to the host path only for pre-migration hosts. Read-only, so the
  // AGL-1061 window costs a flash of an empty picker rather than a lost
  // write — but `scopeReady` still suppresses the query, since listing the
  // host path is a request that can only ever return nothing.
  const {
    scope: dataScope,
    orgId,
    ready: scopeReady,
  } = useOrgDataScope({ hostId })
  const { data: productDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'products'), limit(300)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: collectionDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'collections'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: categoryDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'productCategories'),
        limit(200),
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: datasetDocs } = useFirestoreCollection<any>(
    () =>
      scopeReady
        ? query(
            collection(firestore, dataScope[0], dataScope[1], 'datasets'),
            limit(200),
          )
        : null,
    [firestore, dataScope[0], dataScope[1], scopeReady],
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
    }),
    [productDocs, collectionDocs, categoryDocs, datasetDocs],
  )

  return (
    <EntityPickerContext.Provider value={value}>
      {children}
    </EntityPickerContext.Provider>
  )
}
EntityPickerProvider.displayName = 'EntityPickerProvider'

export default EntityPickerProvider
