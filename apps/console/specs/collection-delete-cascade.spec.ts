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

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ERASE_ROUTE = join(__dirname, '..', 'app', 'api', 'resources', 'erase', 'route.ts')
/**
 * EVERY content-surface source file, concatenated.
 *
 * It was one path — `app/(app)/[orgSlug]/hosts/[host]/content/page.tsx` —
 * because the content manager was one 4,200-line component. AGL-2498 split it
 * into a scope provider, a list page and an entry detail page, and a guard
 * that still named the old file read an empty corpus and passed over nothing.
 * The `not.toHaveLength(0)` assertion below is what caught that, which is
 * exactly why it is there.
 *
 * A DIRECTORY rather than three paths, deliberately: the rule is about the
 * content surface, not about three files that happen to hold it today, so
 * splitting a fourth component out of it cannot quietly leave the new one
 * unscanned.
 */
const CONTENT_DIR = join(__dirname, '..', 'components', 'content')
const CONTENT_SOURCES = readdirSync(CONTENT_DIR)
  .filter((name) => name.endsWith('.tsx') || name.endsWith('.ts'))
  .filter((name) => !name.endsWith('.spec.tsx') && !name.endsWith('.spec.ts'))
  .sort()
  .map((name) => readFileSync(join(CONTENT_DIR, name), 'utf8'))
  .join('\n')

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
    const source = CONTENT_SOURCES
    expect(source).toContain("'/api/resources/erase'")
    expect(source).toContain("kind: 'collections'")
  })

  /**
   * Reads one `deleteDoc(...)` call's argument by BALANCING parentheses.
   *
   * This used to be `source.slice(index, index + 400)`, which is not the
   * call — it is the call plus whatever happens to follow it. That made the
   * guard depend on the page's layout: the author delete (AGL-2486) landed
   * with `'entries'` nowhere in its own argument, and passed anyway because
   * the entry-editor code 300 characters further down mentioned it. Adding
   * an unrelated callback between the two pushed the coincidence out of
   * range and the guard finally went red — which is when anyone learned it
   * had stopped reading what it claimed to read.
   */
  const deleteDocArguments = (source: string): string[] => {
    const found: string[] = []
    const token = 'deleteDoc('
    let cursor = source.indexOf(token)
    while (cursor !== -1) {
      let depth = 0
      let index = cursor + token.length - 1
      for (; index < source.length; index += 1) {
        if (source[index] === '(') depth += 1
        else if (source[index] === ')') {
          depth -= 1
          if (depth === 0) break
        }
      }
      found.push(source.slice(cursor, index + 1))
      cursor = source.indexOf(token, index + 1)
    }
    return found
  }

  /**
   * A `…Ref(` helper's own definition, or `null` when there is no such name.
   *
   * AGL-2498 moved the entry path into one `entryRef` builder — which is the
   * right shape (one place constructs it) and invisible to a guard that only
   * reads the `deleteDoc` argument: `deleteDoc(entryRef(id))` names no segment
   * at all. Rather than inline the path back out to keep a source scanner
   * happy, the scanner follows the one indirection.
   */
  const refBuilder = (source: string, name: string): string | null => {
    const token = `const ${name} = `
    const start = source.indexOf(token)
    if (start === -1) return null
    // To the end of the declaration — the next line that starts a new one.
    const end = source.indexOf('\n  const ', start + token.length)
    return source.slice(start, end === -1 ? source.length : end)
  }

  it('leaves the console with no client-SDK delete of a collection doc', () => {
    // The rules deny it (AGL-947) and it would orphan `entries` — so every
    // `deleteDoc` on this surface must name a LEAF it owns. Two do: the
    // single-entry delete (AGL-1324) and the author record (AGL-2486), which
    // has no subcollection of its own and so cascades nothing.
    const source = CONTENT_SOURCES
    const calls = deleteDocArguments(source)
    expect(calls).not.toHaveLength(0)
    for (const argument of calls) {
      const viaHelper = /deleteDoc\(\s*(\w+Ref)\(/.exec(argument)
      // Resolved through the helper when the call uses one, so the assertion
      // is still about the PATH rather than about how it was spelled.
      const subject = viaHelper
        ? refBuilder(source, viaHelper[1])
        : argument
      expect(subject).toBeTruthy()
      expect(subject as string).toMatch(/'entries'|'authors'/)
    }
  })

  it('never deletes the collection document itself', () => {
    // The specific shape AGL-947 forbids: a path that STOPS at the
    // collection. Checked separately from the allow-list above so that
    // adding a third leaf resource cannot quietly re-admit this one.
    const source = CONTENT_SOURCES
    for (const argument of deleteDocArguments(source)) {
      // One path segment after `'collections'` and then the `doc(` closes:
      // that is a handle on the collection itself. The entry delete carries
      // `'entries', entry.$id` after the id, so it does not match.
      expect(argument).not.toMatch(/'collections',\s*[^,()]+,?\s*\)/)
    }
  })
})
