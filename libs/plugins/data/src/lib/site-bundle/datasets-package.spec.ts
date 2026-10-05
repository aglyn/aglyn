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

import { listDeclaredSiteBundleSections } from '@aglyn/aglyn/plugin-manager/plugin-site-bundle'
import {
  DATASET_PACKAGE_KIND,
  datasetPackageDependencies,
  remapDatasetPackageIds,
} from './datasets-package'

/** A dataset whose `brand` column points into another dataset, and whose `name` is text. */
const DATASET = {
  $id: 'ds-products',
  displayName: 'Products',
  model: {
    fields: {
      name: { name: 'Name', type: 'text' },
      brand: { name: 'Brand', type: 'reference', reference: { datasetId: 'ds-brands', displayFieldId: 'title' } },
      self: { name: 'Related', type: 'reference', reference: { datasetId: 'ds-products', multiple: true } },
    },
    order: ['name', 'brand', 'self'],
  },
  records: [{ $id: 'r-1', values: { name: 'Mug', brand: 'b-1' } }],
}

describe('a dataset as site package items (AGL-3533)', () => {
  it('is the kind the plugin declares for its section', () => {
    const section = listDeclaredSiteBundleSections().find((one) => one.key === 'datasets')
    expect(section?.package.kind).toBe(DATASET_PACKAGE_KIND)
  })

  it('depends on each dataset its reference columns point into, never on itself', () => {
    expect(datasetPackageDependencies(DATASET)).toEqual([{ kind: 'dataset', id: 'ds-brands' }])
  })

  it('moves a reference to its target’s new id, and leaves the records alone', () => {
    const moved = remapDatasetPackageIds(DATASET, new Map([['dataset/ds-brands', 'ds-brands-copy']]))
    expect(moved['model'].fields.brand.reference).toEqual({ datasetId: 'ds-brands-copy', displayFieldId: 'title' })
    expect(moved['model'].fields.self).toBe(DATASET.model.fields.self)
    expect(moved['records']).toBe(DATASET.records)
  })

  it('turns a dropped reference into a text column, keeping every value readable', () => {
    const dropped = remapDatasetPackageIds(DATASET, new Map([['dataset/ds-brands', null]]))
    expect(dropped['model'].fields.brand).toEqual({ name: 'Brand', type: 'text' })
  })

  it('returns the item itself when nothing it names moved', () => {
    expect(remapDatasetPackageIds(DATASET, new Map([['page/p-1', 'p-2']]))).toBe(DATASET)
  })
})
