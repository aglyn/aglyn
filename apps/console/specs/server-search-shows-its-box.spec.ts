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
 * A list that searches on its query shows the search box (AGL-3327).
 *
 * `ListTable` hides the toolbar's search box on a server-filtered grid unless
 * the call site passes `quickFilter`, because a handler that reads only the
 * column filter would otherwise offer a search that does nothing. The media
 * library wired its search words through `useListGridFilter` onto the
 * library's query and never passed the flag, so production shipped a library
 * whose name and embedded-details search had no box to type into.
 *
 * So this reads every console and plugin component that binds a grid through
 * `useListGridFilter` and renders a `ListTable`: when its search is live (the
 * words reach the query, not a `NO_…` constant), the file must pass
 * `quickFilter`.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { code } from './source-text'

const REPO = join(__dirname, '..', '..', '..')

function tsxFilesUnder(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...tsxFilesUnder(path))
      continue
    }
    if (entry.name.endsWith('.tsx') && !entry.name.includes('.spec.')) {
      found.push(path)
    }
  }
  return found
}

function pluginComponentFiles(): string[] {
  const root = join(REPO, 'libs', 'plugins')
  const found: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    try {
      found.push(
        ...tsxFilesUnder(join(root, entry.name, 'src', 'lib', 'components')),
      )
    } catch {
      // A plugin with no components directory.
    }
  }
  return found
}

/** Whether a component searches on its query but never shows the box. */
function hidesALiveSearch(source: string): boolean {
  if (!/\buseListGridFilter\(/.test(source)) return false
  if (!/<ListTable\b/.test(source)) return false
  const passed = [...source.matchAll(/\bsearch:\s*([A-Za-z_$][\w$]*)/g)].map(
    (m) => m[1],
  )
  const live =
    passed.some((name) => !/^NO_[A-Z_]+$/.test(name)) ||
    /\.searchWords\b/.test(source)
  return live && !/\bquickFilter\b/.test(source)
}

describe('a list that searches on its query shows the search box (AGL-3327)', () => {
  it('THE CONTROL: the shape check catches what it is meant to catch', () => {
    const grid = `useListGridFilter({ clauses, search: searchState })\n<ListTable filterMode="server" />`
    expect(hidesALiveSearch(grid)).toBe(true)
    expect(hidesALiveSearch(`${grid}\n<ListTable quickFilter />`)).toBe(false)
    expect(
      hidesALiveSearch(
        `useListGridFilter({ search: NO_WORDS })\n<ListTable filterMode="server" />`,
      ),
    ).toBe(false)
    expect(
      hidesALiveSearch(
        `const f = useListGridFilter({})\nrun(f.searchWords)\n<ListTable filterMode="server" />`,
      ),
    ).toBe(true)
  })

  it('no console page or component hides a search its query serves', () => {
    const files = [
      ...tsxFilesUnder(join(__dirname, '..', 'components')),
      ...tsxFilesUnder(join(__dirname, '..', 'app')),
      ...pluginComponentFiles(),
    ]
    expect(files.length).toBeGreaterThan(100)
    const offenders = files
      .filter((file) =>
        hidesALiveSearch(code(readFileSync(file, 'utf8'), file, 0)),
      )
      .map((file) => relative(REPO, file))
    expect(offenders).toEqual([])
  })
})
