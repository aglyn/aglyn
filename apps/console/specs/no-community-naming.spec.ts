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

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * "Community" belongs to the forum, not the marketplace (AGL-975).
 *
 * The marketplace was called `community` throughout the code long after the
 * product renamed it, and a public community forum is planned — so every
 * leftover would have been a name collision waiting to be resolved by
 * whoever built the forum, under deadline, in someone else's code.
 *
 * The rename went all the way down: Firestore collections, the nx project,
 * route constants, identifiers, comments and docs. This keeps it there.
 *
 * The exemptions below are the WHOLE list, and each is a deliberate use —
 * either the forum's own meaning, or a compatibility contract that has to
 * keep the old word. Adding to it means asserting the same.
 */
const ALLOWED = new Map<string, string>([
  [
    'app/api/[...pluginApi]/route.ts',
    'The /api/community/* alias. Published plugin bundles in the field call ' +
      'those URLs and cannot be redeployed with us.',
  ],
  [
    'constants/docs-help.generated.ts',
    'Generated from the docs, and the entry is the support/community FORUM ' +
      'page — the meaning the word is being freed for.',
  ],
  [
    'app/api/support/forum/route.ts',
    'THE forum. This is the meaning the rename exists to protect, not a ' +
      'leftover — AGL-142, categories/threads/replies for paid plans.',
  ],
  [
    'app/(app)/[orgSlug]/support/page.tsx',
    'Links to the community forum and its docs anchor. Same meaning as ' +
      'above; the marketplace has nothing to do with this page.',
  ],
])

const ROOTS = ['app', 'components', 'constants', 'hooks', 'utils']

function* sourceFiles(dir: string): Generator<string> {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next') continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* sourceFiles(path)
    else if (/\.(tsx?|json)$/.test(path)) yield path
  }
}

describe('the marketplace no longer calls itself community (AGL-975)', () => {
  it('has no stray "community" left in the console', () => {
    const offenders: string[] = []
    const consoleRoot = join(__dirname, '..')
    for (const root of ROOTS) {
      for (const file of sourceFiles(join(consoleRoot, root))) {
        const rel = file.slice(consoleRoot.length + 1)
        if (ALLOWED.has(rel)) continue
        if (/community/i.test(readFileSync(file, 'utf8'))) offenders.push(rel)
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps every exemption honest', () => {
    // A stale exemption is worse than none: it silently permits the word in
    // a file that no longer has a reason to use it.
    const consoleRoot = join(__dirname, '..')
    for (const [rel] of ALLOWED) {
      const source = readFileSync(join(consoleRoot, rel), 'utf8')
      expect(`${rel}: ${/community/i.test(source)}`).toBe(`${rel}: true`)
    }
  })

  it('has no route path carrying the word', () => {
    // The collision that matters most: a marketplace URL squatting on
    // /community would take the path the forum wants.
    const routes = readFileSync(
      join(__dirname, '..', '..', '..', 'libs/aglyn/src/lib/app-utils/console-routes.ts'),
      'utf8',
    )
    expect(routes).not.toMatch(/community/i)
  })
})
