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

// AGL-2014 — the TTL policy list vs. its documented source of truth.
//
// `docs/FIRESTORE_MANUAL_CONFIG.md` is explicitly "the source of truth for that
// config so it stays reproducible". `set-firestore-ttl.mjs` is the only thing
// that reproduces it. They disagreed — five documented, one implemented — and
// nothing noticed, because the script authenticates at import time and so no
// test could import it.
//
//   node --test tools/scripts/lib/ttl-policies.test.mjs
//   npm run test:ttl-policies

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { TTL_POLICIES } from './ttl-policies.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const DOC = join(REPO_ROOT, 'docs', 'FIRESTORE_MANUAL_CONFIG.md')

/**
 * The `| collectionGroup | field | why |` table under the TTL heading.
 *
 * Scoped to that one table deliberately: the doc carries other pipe tables, and
 * a whole-file row scrape would pass by matching something else entirely.
 */
function documentedPolicies() {
  const markdown = readFileSync(DOC, 'utf8')
  const heading = markdown.indexOf('### 1. TTL policies')
  assert.notEqual(
    heading,
    -1,
    'The "### 1. TTL policies" heading moved — this guard is reading the wrong section of ' +
      'FIRESTORE_MANUAL_CONFIG.md and must be re-pointed, not deleted.',
  )
  const header = markdown.indexOf('| collectionGroup | field | why |', heading)
  assert.notEqual(header, -1, 'TTL table header not found after the heading')

  const rows = []
  const lines = markdown.slice(header).split('\n')
  // Skip the header row and the `|---|---|---|` separator.
  for (const line of lines.slice(2)) {
    if (!line.startsWith('|')) break // the table ended
    const cells = line.split('|').slice(1, -1)
    if (cells.length < 2) break
    const collection = cells[0].trim().replace(/^`|`$/g, '')
    const field = cells[1].trim().replace(/^`|`$/g, '')
    rows.push({ collection, field })
  }
  return rows
}

test('every documented TTL policy is one the script actually applies', () => {
  const documented = documentedPolicies()

  // Guard the guard: if the scrape silently matched nothing, every
  // "documented ⊆ implemented" assertion below would pass vacuously.
  assert.ok(
    documented.length >= 5,
    `Parsed only ${documented.length} rows from the TTL table — the scrape broke, ` +
      'and an empty expectation set would make this whole suite pass by proving nothing.',
  )

  const implemented = new Set(
    TTL_POLICIES.map((p) => `${p.collection}.${p.field}`),
  )
  const missing = documented
    .map((p) => `${p.collection}.${p.field}`)
    .filter((key) => !implemented.has(key))

  assert.deepEqual(
    missing,
    [],
    `Documented as live, but set-firestore-ttl.mjs would never create them: ${missing.join(', ')}. ` +
      'On aglyn-main these already exist (applied by hand), so nothing looks wrong — but a ' +
      'self-host install gets only the policies this list carries, and these collections would ' +
      'grow forever.',
  )
})

test('the script applies nothing the doc does not record', () => {
  const documented = new Set(
    documentedPolicies().map((p) => `${p.collection}.${p.field}`),
  )
  const undocumented = TTL_POLICIES.map(
    (p) => `${p.collection}.${p.field}`,
  ).filter((key) => !documented.has(key))

  assert.deepEqual(
    undocumented,
    [],
    `Applied by the script but absent from FIRESTORE_MANUAL_CONFIG.md: ${undocumented.join(', ')}. ` +
      'The doc is the source of truth; a policy that only exists in code is the same invisible ' +
      'drift in the other direction. Add the row.',
  )
})

test('a TTL field is a real field, and the list has no duplicates', () => {
  for (const { collection, field } of TTL_POLICIES) {
    assert.match(
      collection,
      /^[A-Za-z][A-Za-z0-9]*$/,
      `Suspicious collection id: ${collection}`,
    )
    // Every policy the platform has expires on `expiresAt`; a different field
    // is not forbidden, but it is worth a deliberate edit to this guard.
    assert.equal(
      field,
      'expiresAt',
      `${collection} expires on "${field}", not "expiresAt" — intended? Update this guard if so.`,
    )
  }
  const keys = TTL_POLICIES.map((p) => `${p.collection}.${p.field}`)
  assert.equal(new Set(keys).size, keys.length, 'duplicate TTL policy entry')
})
