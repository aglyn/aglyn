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

// `resource-uid.mjs` restates the platform's id shape because a `.mjs` under
// `tools/` cannot import the TypeScript that owns it. A restatement is a thing
// that drifts, so these assertions read the OWNING SOURCE and fail here the
// moment it moves — which is the only reason the restatement is defensible.

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { createResourceUid, RESOURCE_ID_LENGTH } from './resource-uid.mjs'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8')

test('RESOURCE_ID_LENGTH matches the constant that owns it', () => {
  const owner = read('libs/aglyn/src/lib/foundation/constants/app.ts')
  const match = owner.match(/export const RESOURCE_ID_LENGTH = (\d+)/)
  assert.ok(match, 'RESOURCE_ID_LENGTH is no longer declared where this expects it')
  assert.equal(
    Number(match[1]),
    RESOURCE_ID_LENGTH,
    'the platform changed RESOURCE_ID_LENGTH — update resource-uid.mjs to match',
  )
})

test('createResourceUid is still createUid(RESOURCE_ID_LENGTH)', () => {
  const owner = read('libs/aglyn/src/lib/app-utils/create-resource-uid.ts')
  assert.match(
    owner,
    /createUid\(RESOURCE_ID_LENGTH\)/,
    'createResourceUid() no longer mints createUid(RESOURCE_ID_LENGTH) — resource-uid.mjs is now wrong',
  )
})

test('createUid is still nanoid', () => {
  // `resource-uid.mjs` calls nanoid directly, which is only correct while the
  // vendor lib maps createUid onto it.
  const vendor = read('libs/shared/util/vendor/README.md')
  assert.match(
    vendor,
    /`createUid`[^|]*\|\s*`nanoid`/,
    'the vendor lib no longer maps createUid onto nanoid — resource-uid.mjs mints the wrong alphabet',
  )
})

test('it mints an id of the right shape', () => {
  const id = createResourceUid()
  assert.equal(typeof id, 'string')
  assert.equal(id.length, RESOURCE_ID_LENGTH)
  // nanoid's default alphabet: A-Za-z0-9_-
  assert.match(id, /^[A-Za-z0-9_-]+$/)
})

test('it does not repeat itself', () => {
  const seen = new Set()
  for (let i = 0; i < 2000; i += 1) seen.add(createResourceUid())
  assert.equal(seen.size, 2000, 'minted a duplicate id in 2000 draws')
})
