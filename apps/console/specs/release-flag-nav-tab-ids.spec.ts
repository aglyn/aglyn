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
 * Every `navTabId` in `RELEASE_FLAGS` must name a nav item that exists
 * (AGL-1654).
 *
 * `gateNavTabItems` matches flags to tabs BY ID. A `navTabId` that resolves to
 * nothing therefore fails silently and in the safe direction — the tab simply
 * stays visible — which is the worst way for it to fail: staff flip the flag,
 * watch the tab stay put, and conclude the flag is broken. `release_marketplace`
 * declared `nav-tab-marketplace` while the real tab has always been
 * `nav-tab-org-marketplace`, so its nav mapping had never once matched.
 *
 * This is the durable half of that fix. The id itself was one line; a rename on
 * either side would put it straight back, and nothing else in the tree would
 * notice — the registry does not import the nav constants and the nav constants
 * do not import the registry.
 *
 * Scanned from SOURCE rather than imported. Nav items come from two unrelated
 * places — the console's own constants and each plugin's `navItems` — and
 * importing every plugin manifest into a console spec would drag in their
 * component graphs to answer a question about strings. Spec files are excluded
 * so a fixture id can never satisfy the guard: the whole failure mode here is a
 * string that matches no real declaration.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { RELEASE_FLAGS } from '@aglyn/aglyn'

const REPO_ROOT = resolve(__dirname, '../../..')

/** Where a nav item can legitimately be declared. */
const SOURCE_ROOTS = [
  join(REPO_ROOT, 'apps/console/constants'),
  join(REPO_ROOT, 'libs/plugins'),
]

const SOURCE_EXTENSIONS = ['.ts', '.tsx']

function sourceFiles(directory: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(directory)
  } catch {
    return []
  }
  return entries.flatMap((entry) => {
    if (entry === 'node_modules' || entry.startsWith('.')) return []
    const full = join(directory, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    if (entry.includes('.spec.')) return []
    if (!SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension))) {
      return []
    }
    return [full]
  })
}

/**
 * Nav item ids that a real nav item declares.
 *
 * TWO key shapes, because there are two kinds of nav item. The console's own
 * constants write `id:` directly; a plugin writes `navTabId:` on its `navItems`
 * entry, and `host-nav-tabs.ts` turns that into the rendered tab's `id`
 * (`id: item.navTabId ?? …`) — which is what `gateNavTabItems` then matches on.
 * Accepting only `id:` would call every plugin-supplied tab missing.
 */
function declaredNavTabIds(): Set<string> {
  const ids = new Set<string>()
  const pattern = /\b(?:id|navTabId):\s*'(nav-tab-[a-z0-9-]+)'/g
  for (const root of SOURCE_ROOTS) {
    for (const file of sourceFiles(root)) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(pattern)) ids.add(match[1])
    }
  }
  return ids
}

describe('release-flag nav tab mappings resolve', () => {
  const declared = declaredNavTabIds()

  it('finds the nav items at all', () => {
    // Guards the guard. If the scan roots or the key shapes ever move, this
    // spec would otherwise pass by finding nothing to contradict.
    expect(declared.size).toBeGreaterThan(15)
    expect(declared).toContain('nav-tab-org-marketplace')
    expect(declared).toContain('nav-tab-dashboard')
    // A plugin-supplied tab, so the `navTabId:` half of the pattern is
    // covered too and cannot rot into a console-constants-only scan.
    expect(declared).toContain('nav-tab-bookings')
  })

  it('does not scan the registry it is checking', () => {
    // The registry declares `navTabId:` too. If it were ever inside a scan
    // root, every flag would satisfy this guard with its own typo.
    const scanned = SOURCE_ROOTS.flatMap(sourceFiles)
    expect(
      scanned.filter((file) => file.endsWith('app-utils/release-flags.ts')),
    ).toEqual([])
  })

  const mapped = RELEASE_FLAGS.filter((definition) => definition.navTabId)

  it('has flags that actually declare a navTabId', () => {
    // Same reason: a registry that stopped declaring any would vacuously pass
    // the per-flag assertions below.
    expect(mapped.length).toBeGreaterThan(5)
  })

  it.each(mapped.map((definition) => [definition.key, definition.navTabId]))(
    '%s → %s exists',
    (_key, navTabId) => {
      expect([...declared]).toContain(navTabId)
    },
  )
})
