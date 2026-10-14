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

import { aiProductsJobInputs } from './ai-products'
import { AI_PRODUCTS_BULK_MAX, aiProductsBulkBrief, aiProductsImportJob, createdProductIdsOf } from './ai-products-bulk'

describe('the copy job a landed product import starts', () => {
  it('reads the products the import created, once each, in the order the results list them', () => {
    expect(
      createdProductIdsOf([
        { outcome: 'created', recordId: 'p1' },
        { outcome: 'updated', recordId: 'p9' },
        { outcome: 'created', recordId: 'p2' },
        { outcome: 'created', recordId: 'p1' },
        { outcome: 'created' },
        { outcome: 'skipped', recordId: 'p3' },
      ]),
    ).toEqual(['p1', 'p2'])
    expect(createdProductIdsOf(undefined)).toEqual([])
  })

  it('asks for the first fifty, under the brief and the inputs the products hub starts it with', () => {
    const rows = Array.from({ length: 60 }, (_, index) => ({ outcome: 'created', recordId: `p${index}` }))
    const job = aiProductsImportJob(rows)
    const ids = rows.slice(0, AI_PRODUCTS_BULK_MAX).map((row) => row.recordId)
    expect(job).toEqual({ brief: aiProductsBulkBrief(50), inputs: aiProductsJobInputs({ target: 'bulk', productIds: ids }) })
    expect(job?.brief).toBe('Write storefront copy for 50 products')
    expect(aiProductsImportJob([{ outcome: 'created', recordId: 'only' }])?.brief).toBe('Write storefront copy for 1 product')
  })

  it('counts the brief before the ids that cannot be read back are dropped, as the hub does', () => {
    const job = aiProductsImportJob([
      { outcome: 'created', recordId: 'has space' },
      { outcome: 'created', recordId: 'ok_2' },
    ])
    expect(job?.brief).toBe('Write storefront copy for 2 products')
    expect(job?.inputs).toEqual({ target: 'bulk', productIds: 'ok_2' })
  })

  it('starts nothing for an import that created no product', () => {
    expect(aiProductsImportJob([{ outcome: 'updated', recordId: 'p1' }])).toBeNull()
    expect(aiProductsImportJob([])).toBeNull()
    expect(aiProductsImportJob(null)).toBeNull()
  })
})
