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

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  PLATFORM_TAX_CODE,
  productsMissingTaxCode,
} from './stripe-tax-code.mjs'

/**
 * Fixtures are the SHAPES STRIPE ACTUALLY RETURNED on 2026-08-19, read-only:
 * live products carry the code as a bare string; the test-mode products carry
 * `tax_code: null`. Inventing a shape here would be the thing this guard is
 * for.
 */
const LIVE_PRODUCT = {
  id: 'prod_Uyf2XI3k1LrU36',
  name: 'Aglyn Agency',
  tax_code: 'txcd_10103001',
}
const TEST_PRODUCT = {
  id: 'prod_UuGHl2nIRosdLG',
  name: 'Aglyn Starter',
  tax_code: null,
}

test('the code is the Texas data-processing SaaS one, spelled once', () => {
  // Pinned as a literal on purpose. This string decides how much sales tax
  // Aglyn collects and remits, it lives in no other file, and a typo in it is
  // a wrong return that nothing else in the system would notice.
  assert.equal(PLATFORM_TAX_CODE, 'txcd_10103001')
})

test('a correctly tagged product is not reported', () => {
  assert.deepEqual(productsMissingTaxCode([LIVE_PRODUCT]), [])
})

test('a product with NO tax code is reported, with its null stated', () => {
  assert.deepEqual(productsMissingTaxCode([TEST_PRODUCT]), [
    { id: 'prod_UuGHl2nIRosdLG', name: 'Aglyn Starter', taxCode: null },
  ])
})

test('a product carrying the WRONG code is reported, not silently accepted', () => {
  // The failure that costs money quietly: a code that IS set, so every
  // "is it configured?" check passes, and it is the wrong base.
  const wrong = { ...LIVE_PRODUCT, tax_code: 'txcd_10000000' }
  assert.deepEqual(productsMissingTaxCode([wrong]), [
    {
      id: 'prod_Uyf2XI3k1LrU36',
      name: 'Aglyn Agency',
      taxCode: 'txcd_10000000',
    },
  ])
})

test('an EXPANDED tax_code object reads the same as the bare id', () => {
  const expanded = { ...LIVE_PRODUCT, tax_code: { id: 'txcd_10103001' } }
  assert.deepEqual(productsMissingTaxCode([expanded]), [])
})

test('reports only the offenders out of a mixed list', () => {
  const found = productsMissingTaxCode([LIVE_PRODUCT, TEST_PRODUCT, LIVE_PRODUCT])
  assert.equal(found.length, 1)
  assert.equal(found[0].id, 'prod_UuGHl2nIRosdLG')
})

test('a malformed list reports nothing rather than throwing', () => {
  // An audit that crashes reports nothing, which reads exactly like a clean
  // account — the worse of the two failure modes.
  for (const input of [null, undefined, 'products', 42, {}]) {
    assert.deepEqual(productsMissingTaxCode(input), [])
  }
  assert.deepEqual(productsMissingTaxCode([null, undefined, 'x']), [])
})
