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
 * ## Why the deferred specifier is relative, and asserted to be
 *
 * The component defers `./attribution-guard-chunk`, whose only content is a
 * static re-export of the guard. Deferring the CORE specifier directly is
 * equally lazy at runtime and registers a dynamic edge on the `tenant →
 * aglyn` project pair in nx's graph, which makes
 * `@nx/enforce-module-boundaries` forbid every STATIC import of core across
 * the app — 100 errors on files nobody had touched, and a blocked promotion.
 * So both specifiers are pinned: the relative one has to be there, and the
 * core one has to be absent from the component entirely.
 *
 * The chunk module is read from disk rather than named in a string, so that
 * moving or renaming it fails this file instead of quietly satisfying it.
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
/**
 * Read, not merely named: if the chunk module is renamed or moved, this read
 * throws and the file goes red. A spec that only matched the specifier string
 * would keep passing against a module that no longer exists, which is the way
 * this kind of guard usually dies.
 */
const CHUNK_SOURCE = readFileSync(
  join(__dirname, 'attribution-guard-chunk.ts'),
  'utf8',
)
const RENDERER = readFileSync(
  join(
    __dirname,
    '..',
    'app',
    '[host]',
    '[scheme]',
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
      /^\s*(?:import|export)\s+(?!type\s)[^;]*?from\s*['"]([^'"]+)['"]/gm,
    ),
  ].map((match) => match[1])
}

/** Every `import('…')` specifier, comments stripped for the same reason. */
function dynamicImportSpecifiers(source: string): string[] {
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const withoutLineComments = withoutBlockComments.replace(/^\s*\/\/.*$/gm, '')
  return [
    ...withoutLineComments.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map((match) => match[1])
}

const GUARD = '@aglyn/aglyn/app-utils/attribution-guard'
const ATTRIBUTE = '@aglyn/aglyn/app-utils/attribution-attribute'
const CHUNK = './attribution-guard-chunk'

describe('the attribution guard stays off the published page', () => {
  it('is reached from the component only through a dynamic import', () => {
    // It still has to be reached, or this passes by the guard having been
    // deleted rather than by its being deferred.
    expect(dynamicImportSpecifiers(COMPONENT)).toContain(CHUNK)
    expect(staticValueImportSpecifiers(COMPONENT)).not.toContain(CHUNK)
    expect(staticValueImportSpecifiers(COMPONENT)).not.toContain(GUARD)
  })

  it('defers a RELATIVE module, so nx records no lazy edge on core', () => {
    // Deferring the core specifier from here is what took `tenant:lint` to
    // 100 `@nx/enforce-module-boundaries` errors, in files that had not
    // changed, and held the promotion.
    for (const specifier of dynamicImportSpecifiers(COMPONENT)) {
      expect(specifier.startsWith('.')).toBe(true)
    }
  })

  it('the deferred module still reaches the real installer', () => {
    // A relative hop that re-exported nothing would satisfy every check
    // above while the guard never ran.
    expect(staticValueImportSpecifiers(CHUNK_SOURCE)).toContain(GUARD)
    expect(CHUNK_SOURCE).toMatch(/installAttributionGuard/)
    // And it must stay a leaf: the marker attribute has to be nameable
    // eagerly, so routing it through here would put the guard back on every
    // page that marks an element.
    expect(staticValueImportSpecifiers(CHUNK_SOURCE)).not.toContain(ATTRIBUTE)
  })

  it('names the marker attribute through the leaf module, not the guard', () => {
    for (const source of [COMPONENT, RENDERER]) {
      const specifiers = staticValueImportSpecifiers(source)
      expect(specifiers).toContain(ATTRIBUTE)
      expect(specifiers).not.toContain(GUARD)
      // By basename rather than by path: the renderer sits four directories
      // away, so its specifier for the chunk would not be `CHUNK`.
      expect(
        specifiers.filter((one) => one.includes('attribution-guard-chunk')),
      ).toEqual([])
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
