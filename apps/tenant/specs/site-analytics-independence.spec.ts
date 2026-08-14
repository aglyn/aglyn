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
 * The SHAPE that keeps analytics alive (AGL-1550), asserted on the tree and
 * the import graph rather than on behavior.
 *
 * `analytics-survive-plugin-stall.spec.tsx` proves the mounts survive a broken
 * plugin gate. This file proves the thing that makes that true and is easy to
 * undo by accident: the measurement/consent mounts are a SIBLING of
 * `CatchAllClient`, not a descendant, and nothing they import can reach the
 * site-plugin gate. A behavioral spec passes for as long as someone keeps
 * writing the wedged-gate scenario into it; this one fails the moment the
 * structure regresses, which is how AGL-1541 got in — the coupling was never
 * decided, it was inherited from where the code happened to be written.
 *
 * Planted red (verified): put `<SiteAnalytics/>` back inside
 * `catch-all-client.tsx`, or swap the deep `@aglyn/aglyn/app-utils/...`
 * imports for the `@aglyn/aglyn` barrel, and this file goes red.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const ROUTE_DIR = resolve(__dirname, '../app/[host]/[[...slug]]')
const SITE_ANALYTICS = join(ROUTE_DIR, 'site-analytics.tsx')
const PAGE = join(ROUTE_DIR, 'page.tsx')
const CATCH_ALL_CLIENT = join(ROUTE_DIR, 'catch-all-client.tsx')

const read = (file: string) => readFileSync(file, 'utf8')

/**
 * Source with comments removed. These files explain the coupling they avoid,
 * so they QUOTE `use(sitePluginLoader.ensure(...))` in prose — a check for the
 * real thing has to look at code only, or it fires on its own documentation.
 */
const readCode = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

/** Every `from '...'` specifier in a source file. */
function importsOf(file: string): string[] {
  const source = read(file)
  const specifiers: string[] = []
  const pattern = /from\s+['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) specifiers.push(match[1])
  return specifiers
}

/** Resolve a relative specifier to a real file, or null for a package. */
function resolveLocal(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const base = resolve(dirname(fromFile), specifier)
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    try {
      readFileSync(candidate)
      return candidate
    } catch {
      // Next candidate.
    }
  }
  return null
}

/**
 * Every first-party file reachable from `entry`. Package imports are recorded
 * as specifiers (they are the interesting bans) but not walked into.
 */
function importClosure(entry: string): {
  files: string[]
  packages: Set<string>
} {
  const files: string[] = []
  const packages = new Set<string>()
  const queue = [entry]
  const seen = new Set<string>()
  while (queue.length) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    files.push(file)
    for (const specifier of importsOf(file)) {
      const local = resolveLocal(file, specifier)
      if (local) queue.push(local)
      else packages.add(specifier)
    }
  }
  return { files, packages }
}

describe('the analytics mounts are independent of the plugin gate (AGL-1550)', () => {
  describe('tree position', () => {
    it('page.tsx renders SiteAnalytics as a SIBLING of CatchAllClient', () => {
      const source = read(PAGE)
      expect(source).toMatch(/from '\.\/site-analytics'/)
      expect(source).toMatch(/<SiteAnalytics/)
      // Both are children of the same returned fragment. If SiteAnalytics
      // were nested inside the page body, it would not appear here at all —
      // `CatchAllClient` is self-closing, so a descendant is impossible to
      // express in this file.
      expect(source).toMatch(/<CatchAllClient[^>]*\/>/)
    })

    it('catch-all-client.tsx — BELOW the gate — mounts none of them', () => {
      const source = read(CATCH_ALL_CLIENT)
      // The gate itself is still there; that is not what changed.
      expect(source).toMatch(/use\(sitePluginLoader\.ensure\(/)
      // …and nothing measurable lives under it any more.
      expect(source).not.toMatch(/SiteAnalytics/)
      expect(source).not.toMatch(/ConsentBannerUi/)
      expect(source).not.toMatch(/useVisitorConsent/)
      expect(source).not.toMatch(/next\/script/)
      expect(source).not.toMatch(/api\/analytics\/collect/)
      expect(source).not.toMatch(/googletagmanager/)
    })
  })

  describe('import graph', () => {
    it('nothing reachable from site-analytics.tsx can touch the plugin loader', () => {
      const { files, packages } = importClosure(SITE_ANALYTICS)
      // Sanity: the walk actually found the subtree it is meant to police.
      expect(files.some((file) => file.endsWith('use-visitor-consent.ts'))).toBe(
        true,
      )
      for (const file of files) {
        expect(readCode(file)).not.toMatch(/site-plugin-loader|realm-plugins/)
      }
      for (const specifier of packages) {
        expect(specifier).not.toMatch(/plugin/)
      }
    })

    it('and none of them import the @aglyn/aglyn barrel', () => {
      // Not a style rule. `@aglyn/aglyn` re-exports `./lib/aglyn`, which
      // imports `./plugin-manager` and constructs a PluginManager and the
      // canvas singleton at module scope — so the barrel is the plugin system,
      // wearing a shorter import path. The deep `@aglyn/aglyn/app-utils/...`
      // modules are pure functions over a host document.
      const { files, packages } = importClosure(SITE_ANALYTICS)
      expect([...packages]).not.toContain('@aglyn/aglyn')
      for (const file of files) {
        expect(readCode(file)).not.toMatch(/from '@aglyn\/aglyn'/)
      }
    })

    it('the barrel really does drag the plugin manager in (the rule above is not folklore)', () => {
      const barrel = resolve(__dirname, '../../../libs/aglyn/src/index.ts')
      expect(read(barrel)).toMatch(/from '\.\/lib\/aglyn'/)
      const core = resolve(__dirname, '../../../libs/aglyn/src/lib/aglyn.ts')
      expect(read(core)).toMatch(/from '\.\/plugin-manager'/)
    })
  })

  describe('nothing in the subtree can suspend', () => {
    it('site-analytics.tsx uses no `use()` and no lazy boundary', () => {
      const { files } = importClosure(SITE_ANALYTICS)
      for (const file of files) {
        const source = readCode(file)
        // A `use(promise)` here would recreate the exact AGL-1541 coupling in
        // a new place: a render that cannot commit until something else
        // resolves.
        expect(source).not.toMatch(/\buse\(/)
        expect(source).not.toMatch(/\blazy\(/)
        expect(source).not.toMatch(/<Suspense/)
      }
    })

    it('the beacon and the consent kick are NOT scheduled from an effect', () => {
      // The load-bearing detail behind the wedged-gate proof: an effect only
      // runs if React commits, and the failure mode is a page that renders
      // and never commits. Both calls are made during render, guarded to run
      // once per pageview — the ErrorBeacon shape (AGL-1538).
      const source = read(SITE_ANALYTICS)
      expect(source).toMatch(/^\s*sendPageviewBeacon\(/m)
      expect(source).toMatch(/^\s*primeVisitorConsent\(/m)
      // If either moved into a `useEffect`, it would appear inside one.
      expect(source).not.toMatch(/useEffect\([\s\S]*sendPageviewBeacon/)
      expect(source).not.toMatch(/useEffect\([\s\S]*primeVisitorConsent/)
    })
  })

  describe('the surfaces stay separate', () => {
    it('the editor canvas and the console preview do not go through this route', () => {
      // The consent banner must never appear on the editor canvas, and the
      // console preview mounts `ConsentBannerUi` itself under its own region
      // simulator. Neither imports this route, so hoisting inside it cannot
      // leak a banner into either.
      const preview = resolve(
        __dirname,
        '../../console/components/document-preview.component.tsx',
      )
      const source = read(preview)
      expect(source).toMatch(/consent-banner-ui/)
      expect(source).not.toMatch(/site-analytics/)
    })
  })
})
