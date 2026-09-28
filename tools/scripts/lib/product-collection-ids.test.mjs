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

// npm run test:product-collection-ids
//
// The script-side smart-collection membership answers the same fixtures the
// commerce library's smart-collection-membership.spec.ts answers (AGL-3321).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { liftForMembership, productCollectionIds } from './product-collection-ids.mjs'

const fixtures = JSON.parse(
  readFileSync(new URL('./product-collection-ids.fixtures.json', import.meta.url), 'utf8'),
)

test('membership matches the fixtures', () => {
  assert.ok(fixtures.cases.length > 0)
  for (const { name, product, expected } of fixtures.cases) {
    assert.deepEqual(
      productCollectionIds(liftForMembership(product), fixtures.collections),
      expected,
      name,
    )
  }
})
