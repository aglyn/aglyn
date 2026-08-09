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

/**
 * AGL-1324: the collection delete must run the SHARED cascade helper.
 *
 * `collection-delete-authz.spec.ts` proves the route calls `eraseSubtree`
 * today. This proves the shape can't drift back — and it is a source guard
 * because the failure mode is silent: a hand-rolled `for (const entry of …)
 * deleteDoc(entry)` loop passes every behavioural test, deletes the entries
 * it can see, and orphans the rest. Firestore does not cascade; only the
 * Admin SDK's `recursiveDelete` walks the tree, and `eraseSubtree` is the
 * one place this repo calls it for a resource subtree.
 *
 * The console half matters just as much: a client-side delete of the
 * collection doc is what AGL-947 already forbade in the rules, so a delete
 * added to the Content page with `deleteDoc` would be denied at runtime
 * rather than caught here.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ERASE_ROUTE = join(__dirname, '..', 'app', 'api', 'resources', 'erase', 'route.ts')
const CONTENT_PAGE = join(
  __dirname,
  '..',
  'app',
  '(app)',
  '[orgSlug]',
  'hosts',
  '[host]',
  'content',
  'page.tsx',
)

const read = (path: string) => readFileSync(path, 'utf8')

describe('collection delete runs the shared cascade helper (AGL-1324)', () => {
  it('erases through eraseSubtree, imported from the admin lib', () => {
    const source = read(ERASE_ROUTE)
    expect(source).toContain('eraseSubtree')
    // Named import from the shared server lib, not a local redefinition.
    expect(source).toMatch(
      /import\s*\{[^}]*\beraseSubtree\b[^}]*\}\s*from\s*'@aglyn\/tenant-data-admin'/s,
    )
    expect(source).toMatch(/await\s+eraseSubtree\(/)
  })

  it('never hand-rolls the recursive delete in the route', () => {
    const source = read(ERASE_ROUTE)
    // `recursiveDelete` belongs in `eraseSubtree`; a CALL here (the prose
    // explaining it is everywhere) means the route grew its own walk.
    expect(source).not.toMatch(/\.\s*recursiveDelete\s*\(/)
    // The shapes a hand-rolled cascade takes.
    expect(source).not.toMatch(/\.bulkWriter\(/)
    expect(source).not.toMatch(/\.batch\(/)
    expect(source).not.toMatch(/listDocuments\(/)
    // The one legitimate read of `entries` is the COUNT the guard needs.
    const entryReads = source.match(/collection\('entries'\)/g) ?? []
    expect(entryReads).toHaveLength(1)
    expect(source).toMatch(/collection\('entries'\)\s*\.\s*count\(\)/)
  })

  it('deletes the collection from the console via the erase route', () => {
    const source = read(CONTENT_PAGE)
    expect(source).toContain("'/api/resources/erase'")
    expect(source).toContain("kind: 'collections'")
  })

  it('leaves the console with no client-SDK delete of a collection doc', () => {
    // The rules deny it (AGL-947) and it would orphan `entries` — so the
    // page's only `deleteDoc` must be the single-ENTRY delete.
    const source = read(CONTENT_PAGE)
    const calls = [...source.matchAll(/deleteDoc\(/g)]
    expect(calls).not.toHaveLength(0)
    for (const call of calls) {
      const argument = source.slice(call.index ?? 0, (call.index ?? 0) + 400)
      expect(argument).toContain("'entries'")
    }
  })
})
