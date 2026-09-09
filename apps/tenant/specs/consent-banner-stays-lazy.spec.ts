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
 * The consent surfaces must not be in the published page's eager set
 * (AGL-2706), and the module that keeps them out must be a relative one.
 *
 * `SiteAnalytics` renders `ConsentBannerUi` only once `consent.ready` is
 * true, which by construction is neither the server render nor the first
 * client render — that is what keeps the ISR-cached HTML from varying by
 * region or by consent state (AGL-1498). While the module was imported
 * statically, MUI's `Dialog`, `Switch`, `FormControlLabel` and `SwitchBase`
 * were downloaded on every view of every published screen to draw a
 * preferences dialog behind a click most visits never make.
 *
 * A source assertion rather than a render test, for the reason
 * `site-not-found-stays-lazy.spec.ts` gives: the defect is which modules a
 * bundler puts in a chunk group, and no amount of rendering observes that.
 *
 * ## Why the deferred specifier is relative, and asserted to be
 *
 * `site-analytics.tsx` defers `./consent-banner-chunk`, whose only content is
 * a static re-export of the core component. Deferring the CORE specifier
 * directly is equally lazy at runtime and registers a dynamic edge on the
 * `tenant → aglyn` project pair in nx's graph, which makes
 * `@nx/enforce-module-boundaries` forbid every STATIC import of core across
 * the app — 100 errors on files nobody had touched, and a blocked promotion.
 * So both specifiers are pinned: the relative one has to be there, and the
 * core one has to be absent from the route file entirely.
 *
 * The chunk module is read from disk rather than named in a string, so that
 * moving or renaming it fails this file instead of quietly satisfying it.
 *
 * The console is untouched by any of this: it mounts the same component
 * directly under its region simulator and its document preview, and neither
 * goes through this route. `site-analytics-independence.spec.ts` holds that
 * separation.
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROUTE_DIR = resolve(__dirname, '../app/[host]/[scheme]/[[...slug]]')
const SITE_ANALYTICS = readFileSync(join(ROUTE_DIR, 'site-analytics.tsx'), 'utf8')
/**
 * Read, not merely named: if the chunk module is renamed or moved, this read
 * throws and the file goes red. A spec that only matched the specifier string
 * would keep passing against a module that no longer exists.
 */
const CHUNK_SOURCE = readFileSync(
  join(ROUTE_DIR, 'consent-banner-chunk.ts'),
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

const BANNER = '@aglyn/aglyn/app-utils/consent-banner-ui'
const CHUNK = './consent-banner-chunk'

describe('the consent surfaces stay out of first paint', () => {
  it('are reached from the route only through a dynamic import', () => {
    // They still have to be reached, or this passes by the banner having been
    // deleted rather than by its being deferred.
    expect(dynamicImportSpecifiers(SITE_ANALYTICS)).toContain(CHUNK)
    expect(staticValueImportSpecifiers(SITE_ANALYTICS)).not.toContain(CHUNK)
    expect(staticValueImportSpecifiers(SITE_ANALYTICS)).not.toContain(BANNER)
  })

  it('defers a RELATIVE module, so nx records no lazy edge on core', () => {
    // Deferring the core specifier from here is what took `tenant:lint` to
    // 100 `@nx/enforce-module-boundaries` errors, in files that had not
    // changed, and held the promotion.
    for (const specifier of dynamicImportSpecifiers(SITE_ANALYTICS)) {
      expect(specifier.startsWith('.')).toBe(true)
    }
  })

  it('the deferred module still reaches the real banner', () => {
    // A relative hop that re-exported nothing would satisfy every check above
    // while no banner ever rendered.
    expect(staticValueImportSpecifiers(CHUNK_SOURCE)).toContain(BANNER)
    expect(CHUNK_SOURCE).toMatch(/export\s*\{\s*default\s*\}\s*from/)
  })

  it('declares no `use client` of its own, so it is one chunk group', () => {
    // A `'use client'` module is a client entry Next builds a chunk group
    // for. This one is only ever reached from `site-analytics.tsx`, which is
    // already a client module, so the directive would buy a second group and
    // the duplicated bytes AGL-2706 measured on the 404 boundary.
    expect(CHUNK_SOURCE).not.toMatch(/^\s*(['"])use client\1/m)
  })

  it('is mounted with ssr disabled, matching the render condition', () => {
    // `consent.ready` starts false so the server render and the first client
    // render agree that nothing is drawn (AGL-1498). `ssr: false` states in
    // the import what the render condition already guarantees.
    expect(SITE_ANALYTICS).toMatch(
      /dynamic\(\(\)\s*=>\s*import\('\.\/consent-banner-chunk'\),\s*\{\s*ssr:\s*false,?\s*\}/,
    )
  })
})
