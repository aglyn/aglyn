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
 * The console chrome must not reach the root not-found chunk group
 * (AGL-2706).
 *
 * `app/not-found.tsx` is a `'use client'` module, so Next treats it as a
 * client entry and Turbopack builds it a chunk group separate from the
 * `(app)` layout's. While it composed `AuthenticatedLayout > MainLayout`
 * directly, both — and their dependency stacks, `@popperjs/core`,
 * `@simplewebauthn/browser` and roughly 100 KB of `@mui/material` — sat in
 * that group as private copies of what the page group already carried.
 *
 * A not-found boundary is mounted into every successful response, so those
 * copies were fetched on ordinary console pages rather than on 404s.
 *
 * A source assertion rather than a render test, for the same reason
 * `stripe-stays-lazy.spec.ts` is one: the defect is which modules a bundler
 * puts in a chunk group, and rendering does not observe that. A render test
 * passes happily while the chrome ships twice.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')

const BOUNDARY = 'app/not-found.tsx'
const CHROME = 'components/not-found-chrome.component.tsx'

/**
 * Static VALUE imports — `import x from 's'` — and deliberately not
 * `import type { … } from 's'`, which the compiler erases and which therefore
 * cannot pull a module into a chunk group. Comments are stripped first so the
 * prose above, which names these modules repeatedly, is not read as code.
 */
function staticValueImportSpecifiers(source: string): string[] {
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const withoutLineComments = withoutBlockComments.replace(/^\s*\/\/.*$/gm, '')
  return [
    ...withoutLineComments.matchAll(
      /^\s*import\s+(?!type\s)[^;]*?from\s*['"]([^'"]+)['"]/gm,
    ),
  ].map((match) => match[1])
}

describe('the console chrome stays out of the root not-found chunk group', () => {
  it('reaches the chrome only through a dynamic import', () => {
    const source = read(BOUNDARY)
    // It still has to reach it, or this passes by the boundary having lost
    // its chrome rather than by the import having been deferred.
    expect(source).toMatch(
      /lazy\(\s*\(\)\s*=>\s*import\(\s*'\.\.\/components\/not-found-chrome\.component'\s*\)\s*,?\s*\)/,
    )
    expect(staticValueImportSpecifiers(source)).not.toContain(
      '../components/not-found-chrome.component',
    )
  })

  it('keeps the layouts out of the boundary entirely', () => {
    // Importing either layout here would put it back in this group whether or
    // not the chrome module is lazy — a static and a dynamic import of one
    // module resolve to one module, and the static one wins.
    const specifiers = staticValueImportSpecifiers(read(BOUNDARY))
    expect(specifiers.filter((one) => one.includes('layouts/'))).toEqual([])
    expect(
      specifiers.filter((one) => one.includes('not-found-content')),
    ).toEqual([])
  })

  it('suspends around the lazy chrome', () => {
    expect(read(BOUNDARY)).toMatch(/<Suspense fallback=\{null\}>/)
  })

  it('composes the same three pieces it used to compose inline', () => {
    // The move must not have dropped a layer: the root boundary adds the
    // chrome itself because the `(app)` layout does not wrap it (AGL-625).
    const specifiers = staticValueImportSpecifiers(read(CHROME))
    expect(specifiers).toEqual(
      expect.arrayContaining([
        './layouts/authenticated.layout',
        './layouts/main.layout',
        './not-found-content.component',
      ]),
    )
  })
})
