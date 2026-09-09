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
 * The page renderer must not reach the 404 boundary's chunk group (AGL-2706).
 *
 * `site-not-found.component.tsx` is a `'use client'` module that Next treats
 * as a client entry of its own, so Turbopack builds it a chunk group separate
 * from the page's. While it imported `catch-all-client` statically, the whole
 * renderer subtree was in BOTH groups, and every module the chunker declined
 * to hoist into a shared chunk was emitted twice: `media-ref`, `author-css`,
 * `host-naming`, `platform-brand`, `attribution-guard` and the style enums,
 * next to private copies of `mobx-react-lite` and `lodash-es`.
 *
 * That is not a cold-path cost. A `not-found` boundary is rendered into every
 * SUCCESSFUL response as well, so those chunks are fetched on ordinary page
 * views of every site on the platform — the page views this app is billed
 * for. Measured across the route, moving to a lazy import took the tenant
 * page from 389.8 KB to 377.3 KB gzipped and cut its redundant bytes from
 * 95.7 KB to 65.5 KB.
 *
 * A source assertion rather than a render test, for the same reason
 * `stripe-stays-lazy.spec.ts` is one: the defect is which modules a bundler
 * puts in a chunk group, and no amount of rendering observes that. A render
 * test passes happily while the renderer ships twice.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SOURCE = readFileSync(
  join(__dirname, 'site-not-found.component.tsx'),
  'utf8',
)

const RENDERER = '../app/[host]/[[...slug]]/catch-all-client'

/**
 * Static VALUE imports, and deliberately not `import type { … } from '…'`.
 *
 * A type-only import is erased by the compiler and emits nothing at all, so
 * it cannot pull a module into a chunk group. This file legitimately takes
 * `Props` as a type from the renderer's sibling `types` module, and a check
 * that only matched on specifier strings would wrongly flag it. Comments are
 * stripped first so the prose above — which names the renderer's path — is
 * not read as code.
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

describe('the page renderer stays out of the 404 boundary chunk group', () => {
  it('reaches the renderer only through a dynamic import', () => {
    // It still has to reach it, or this passes by the designed-screen feature
    // having been deleted rather than by the boundary being honest.
    expect(SOURCE).toMatch(
      /dynamic\(\s*\(\)\s*=>\s*import\(\s*'\.\.\/app\/\[host\]\/\[\[\.\.\.slug\]\]\/catch-all-client'\s*\)/,
    )
    expect(staticValueImportSpecifiers(SOURCE)).not.toContain(RENDERER)
  })

  it('keeps the fallback screen in a module the renderer does not own', () => {
    /**
     * The fallback is rendered while the lazy chunk loads and whenever there
     * is no designed screen, so it must not live behind the same boundary —
     * a fallback imported from the lazily-loaded module cancels the laziness.
     *
     * What matters is the SEPARATION, not that the fallback is eager. It is
     * itself dynamic (AGL-2706): reaching it statically pulled the
     * `TextField` → `Select` → `Menu` → `Popover` → `Modal` cluster onto
     * first paint of every page, to draw a screen most visitors never see.
     * Two lazy modules are still two chunk groups.
     */
    expect(SOURCE).toMatch(
      /import\(\s*'\.\/site-status-screen\.component'\s*\)/,
    )
    expect(
      staticValueImportSpecifiers(SOURCE).filter((one) =>
        one.includes('catch-all-client'),
      ),
    ).toEqual([])
  })

  it('suspends around the lazy renderer', () => {
    // `lazy` without a boundary throws the promise to whatever is above it,
    // which here is the root of a client-mounted tree.
    expect(staticValueImportSpecifiers(SOURCE)).toContain('react')
    expect(SOURCE).toMatch(/<Suspense fallback=\{null\}>/)
  })
})
