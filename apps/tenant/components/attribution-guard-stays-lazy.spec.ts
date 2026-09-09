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
 * The published page must not reach the attribution guard statically, and
 * must not reach the guard's module to name its attribute (AGL-2706).
 *
 * The two halves are one defect. The renderer mounts `AttributionGuard` only
 * where there is something to guard — both marked elements hang off
 * `showBranding`, so a paid site renders neither — but a static import ships
 * the guard's bytes anyway, because what a module weighs is decided by the
 * import graph and not by whether a component renders. Splitting only the
 * attribute out was tried on its own and measured HEAVIER: two modules in
 * the eager set instead of one.
 *
 * A source assertion rather than a render test, for the reason
 * `site-not-found-stays-lazy.spec.ts` gives: the defect is which modules a
 * bundler puts in a chunk group, and no amount of rendering observes that. A
 * render test passes happily while the guard ships to every site on the
 * platform.
 *
 * What the guard DOES is asserted in `attribution-guard.spec.ts`, including
 * the property this arrangement is built around — that the element copies
 * the repair rebuilds from are taken before the chunk is asked for.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const COMPONENT = readFileSync(
  join(__dirname, 'attribution-guard.component.tsx'),
  'utf8',
)
const RENDERER = readFileSync(
  join(
    __dirname,
    '..',
    'app',
    '[host]',
    '[[...slug]]',
    'catch-all-client.tsx',
  ),
  'utf8',
)

/** Static VALUE imports only — a type-only import emits nothing. */
function staticValueImportSpecifiers(source: string): string[] {
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const withoutLineComments = withoutBlockComments.replace(/^\s*\/\/.*$/gm, '')
  return [
    ...withoutLineComments.matchAll(
      /^\s*import\s+(?!type\s)[^;]*?from\s*['"]([^'"]+)['"]/gm,
    ),
  ].map((match) => match[1])
}

const GUARD = '@aglyn/aglyn/app-utils/attribution-guard'
const ATTRIBUTE = '@aglyn/aglyn/app-utils/attribution-attribute'

describe('the attribution guard stays off the published page', () => {
  it('is reached from the component only through a dynamic import', () => {
    // It still has to be reached, or this passes by the guard having been
    // deleted rather than by its being deferred.
    expect(COMPONENT).toMatch(
      new RegExp(`import\\(\\s*'${GUARD.replace(/[/.]/g, '\\$&')}'\\s*\\)`),
    )
    expect(staticValueImportSpecifiers(COMPONENT)).not.toContain(GUARD)
  })

  it('names the marker attribute through the leaf module, not the guard', () => {
    for (const source of [COMPONENT, RENDERER]) {
      const specifiers = staticValueImportSpecifiers(source)
      expect(specifiers).toContain(ATTRIBUTE)
      expect(specifiers).not.toContain(GUARD)
    }
  })

  it('captures the page copies itself rather than waiting for the chunk', () => {
    // The whole reason the component may defer the guard: the repair rebuilds
    // from a copy of the original, so the copies must be taken while the
    // originals are still there.
    expect(COMPONENT).toMatch(/cloneNode\(true\)/)
    expect(COMPONENT).toMatch(/installAttributionGuard\(\{[^}]*shipped/)
  })
})
