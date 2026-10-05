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
 * A tenant page render never awaits outbound network I/O without a deadline
 * (AGL-3569, after AGL-3565).
 *
 * ## The incident
 *
 * beta.222's site layout awaited `selfHostedThemeFonts`, which fetched
 * Google's font stylesheet with `AbortSignal.timeout(2500)`. On Vercel, Next's
 * patched fetch handed back a promise that never settled and the signal never
 * bounded it; the module had cached that promise for a day, so every later
 * render on the instance awaited it too. Every uncached page of every site
 * sat until the 60 s function limit, for ~28 minutes, with each render phase
 * finished in a second.
 *
 * The fix is one helper — `boundedAwait` in
 * `@aglyn/shared-util-http/bounded-await`, a timer the render owns — and this
 * guard, which sweeps what a render can reach for network calls that are not
 * behind it. How the sweep works, and what it can and cannot see, is the note
 * on `render-path-io-scan.ts`.
 *
 * ## Red, both directions
 *
 * An unbounded call with no row below is red: put it behind `boundedAwait`
 * (or detach it with `void` when nothing needs its answer). A row nothing
 * matches any more is red too, so the list cannot outlive what it excuses.
 * The list is FROZEN at {@link ALLOWLIST_CEILING} rows: it may shrink, and the
 * ceiling comes down with it; a new row is refused rather than recorded.
 *
 * FORCED RED before commit, against 91fb65f85d's `self-hosted-fonts.ts` — the
 * incident's own code — both as the fixture below and by sweeping a checkout
 * with that file restored. See AGL-3569.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import {
  type NetworkCall,
  type SourceTree,
  scanRenderPath,
} from './render-path-io-scan'

const REPO_ROOT = resolve(__dirname, '../../..')

const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nx',
  'coverage',
  '.claude',
])

function repoTree(root: string): SourceTree {
  const texts = new Map<string, string | null>()
  return {
    read(path) {
      if (texts.has(path)) return texts.get(path) ?? null
      let text: string | null = null
      try {
        if (statSync(join(root, path)).isFile())
          text = readFileSync(join(root, path), 'utf8')
      } catch {
        text = null
      }
      texts.set(path, text)
      return text
    },
    list(dir) {
      const out: string[] = []
      const walk = (absolute: string) => {
        for (const entry of readdirSync(absolute, { withFileTypes: true })) {
          if (SKIPPED_DIRECTORIES.has(entry.name)) continue
          const path = join(absolute, entry.name)
          if (entry.isDirectory()) walk(path)
          else if (/\.tsx?$/.test(entry.name)) out.push(relative(root, path))
        }
      }
      walk(join(root, dir))
      return out
    },
  }
}

function fixtureTree(files: Record<string, string>): SourceTree {
  return {
    read: (path) => files[path] ?? null,
    list: (dir) =>
      Object.keys(files).filter((path) => path.startsWith(`${dir}/`)),
  }
}

/**
 * Where a page render starts: every page, layout and boundary under the site
 * route, the root layout, and the middleware, which every request to a site
 * passes through first.
 */
function renderEntries(tree: SourceTree): string[] {
  const routeFiles = tree
    .list('apps/tenant/app/[host]')
    .filter((path) =>
      /\/(page|layout|not-found|error|template|default|loading)\.tsx?$/.test(
        path,
      ),
    )
  return [
    ...routeFiles,
    'apps/tenant/app/layout.tsx',
    'apps/tenant/app/not-found.tsx',
    'apps/tenant/middleware.ts',
  ]
}

/**
 * The unbounded network calls a render reaches and is allowed to, keyed
 * `file#symbol` with the number of calls in that symbol. Each reason says why
 * a render never actually waits on it — "it is usually fast" is not one.
 */
const ALLOWED_UNBOUNDED: Record<string, { calls: number; reason: string }> = {
  'libs/shared/util/first-touch/src/lib/first-touch.ts#createFirstTouchKit': {
    calls: 2,
    reason:
      "The kit's `post` is the BROWSER's handoff to /api/first-touch and runs only " +
      'where `document` exists; the server reaches this factory for ' +
      '`isFirstPartyHost`, a pure host comparison. Reachability is by declaration, ' +
      'so the whole factory body is counted.',
  },
}

/** Lower it with every row removed. Never raise it. */
const ALLOWLIST_CEILING = 1

function countBySymbol(calls: NetworkCall[]): Map<string, NetworkCall[]> {
  const out = new Map<string, NetworkCall[]>()
  for (const call of calls) {
    const key = `${call.file}#${call.symbol}`
    out.set(key, [...(out.get(key) ?? []), call])
  }
  return out
}

describe('the tenant render path awaits no unbounded network I/O (AGL-3569)', () => {
  const tree = repoTree(REPO_ROOT)
  const entries = renderEntries(tree)
  const scan = scanRenderPath(tree, { entries, pluginRoot: 'libs/plugins' })
  const found = countBySymbol(scan.unbounded)

  it('sweeps a real render path — the floor that catches a scanner gone blind', () => {
    expect(entries).toEqual(
      expect.arrayContaining([
        'apps/tenant/app/[host]/layout.tsx',
        'apps/tenant/app/[host]/[scheme]/layout.tsx',
        'apps/tenant/app/[host]/[scheme]/[[...slug]]/page.tsx',
        'apps/tenant/middleware.ts',
      ]),
    )
    for (const file of [
      'libs/tenant/runtime/src/lib/self-hosted-fonts.ts',
      'apps/tenant/app/[host]/[scheme]/[[...slug]]/load-page-data.ts',
      'libs/tenant/runtime/src/lib/compose-screen-nodes.ts',
      'libs/aglyn/src/lib/plugin-manager/site-page-hooks.ts',
      'libs/plugins/marketing/src/lib/server/site-page-enricher.ts',
      'libs/plugins/redirects/src/lib/server/resolve-redirect.ts',
    ]) {
      expect(scan.reachedFiles).toContain(file)
    }
    expect(scan.reachedFiles.size).toBeGreaterThan(150)
    expect(scan.registrars).toEqual(
      expect.arrayContaining([
        'registerSitePageEnricher',
        'registerSitePageResolver',
        'registerSiteRedirectResolver',
        'registerRepeatRowReader',
      ]),
    )
    // The bounded calls are seen too: the incident's own fetch among them.
    expect(scan.bounded.map((call) => call.file)).toContain(
      'libs/tenant/runtime/src/lib/self-hosted-fonts.ts',
    )
  })

  it('⛔ every network call a render can await is behind boundedAwait, or allowed with a reason', () => {
    const refused = [...found.entries()]
      .filter(([key, calls]) => ALLOWED_UNBOUNDED[key]?.calls !== calls.length)
      .flatMap(([, calls]) =>
        calls.map(
          (call) =>
            `${call.file}:${call.line} [${call.symbol}] ${call.marker}: ${call.text}\n` +
            `    reached from ${call.via.slice(1).join(' <- ')}`,
        ),
      )
    expect(refused).toEqual([])
  })

  it('has no allowlist row that nothing matches any more', () => {
    const stale = Object.keys(ALLOWED_UNBOUNDED).filter(
      (key) => !found.has(key),
    )
    expect(stale).toEqual([])
  })

  it('keeps the allowlist frozen: it may only shrink', () => {
    expect(Object.keys(ALLOWED_UNBOUNDED).length).toBeLessThanOrEqual(
      ALLOWLIST_CEILING,
    )
    for (const row of Object.values(ALLOWED_UNBOUNDED))
      expect(row.reason.length).toBeGreaterThan(40)
  })
})

describe('the scanner (AGL-3569)', () => {
  const TSCONFIG = JSON.stringify({
    compilerOptions: {
      paths: {
        '@aglyn/tenant-runtime/*': ['./libs/tenant/runtime/src/lib/*'],
        '@aglyn/shared-util-http/bounded-await': [
          './libs/shared/util/http/src/lib/bounded-await.ts',
        ],
        '@aglyn/aglyn/server': ['./libs/aglyn/src/server.ts'],
      },
    },
  })
  const LAYOUT = `
    import { selfHostedThemeFonts } from '@aglyn/tenant-runtime/self-hosted-fonts'
    export default async function HostLayout() {
      const fonts = await selfHostedThemeFonts(undefined)
      return fonts
    }
  `
  const scanFixture = (files: Record<string, string>) =>
    scanRenderPath(
      fixtureTree({
        'tsconfig.base.json': TSCONFIG,
        'apps/tenant/app/layout.tsx': LAYOUT,
        ...files,
      }),
      { entries: ['apps/tenant/app/layout.tsx'], pluginRoot: 'libs/plugins' },
    )

  it("⛔ refuses 91fb65f85d's self-hosted-fonts.ts — the incident, as it shipped", () => {
    // `facesFor` as beta.222 shipped it (AGL-3485), verbatim but for the
    // imports and the constants it names.
    const scan = scanFixture({
      'libs/tenant/runtime/src/lib/self-hosted-fonts.ts': `
        const stylesheets = new Map<string, { expires: number; faces: Promise<unknown[] | null> }>()
        function facesFor(url: string): Promise<unknown[] | null> {
          const now = Date.now()
          const held = stylesheets.get(url)
          if (held && held.expires > now) return held.faces
          const faces = fetch(url, {
            headers: { 'User-Agent': WOFF2_USER_AGENT },
            signal: AbortSignal.timeout(STYLESHEET_TIMEOUT_MS),
            next: { revalidate: STYLESHEET_TTL_MS / 1000 },
          } as RequestInit)
            .then(async (response) => {
              if (!response.ok) return null
              const parsed = parseGoogleFontFaces(await response.text())
              return parsed.length ? parsed : null
            })
            .catch(() => null)
          stylesheets.set(url, { expires: now + STYLESHEET_TTL_MS, faces })
          void faces.then((found) => {
            if (!found) stylesheets.set(url, { expires: now + FAILURE_TTL_MS, faces })
          })
          return faces
        }
        export async function selfHostedThemeFonts(theme: unknown) {
          const url = getGoogleFontsUrl(theme)
          if (!url) return null
          const faces = await facesFor(url)
          return faces
        }
      `,
    })
    expect(scan.unbounded).toEqual([
      expect.objectContaining({
        file: 'libs/tenant/runtime/src/lib/self-hosted-fonts.ts',
        symbol: 'facesFor',
        marker: 'fetch',
      }),
    ])
  })

  it('passes the same fetch behind boundedAwait', () => {
    const scan = scanFixture({
      'libs/tenant/runtime/src/lib/self-hosted-fonts.ts': `
        import { boundedAwait } from '@aglyn/shared-util-http/bounded-await'
        function fetchFaces(url: string, ms: number) {
          return boundedAwait((signal) => fetch(url, { signal }).catch(() => null), ms, null, 'fonts')
        }
        export async function selfHostedThemeFonts(theme: unknown) {
          return fetchFaces(String(theme), 2500)
        }
      `,
    })
    expect(scan.unbounded).toEqual([])
    expect(scan.bounded).toEqual([
      expect.objectContaining({ symbol: 'fetchFaces', marker: 'fetch' }),
    ])
  })

  it('bounds everything reached only through a boundedAwait call, however deep', () => {
    const scan = scanFixture({
      'libs/tenant/runtime/src/lib/self-hosted-fonts.ts': `
        import { boundedAwait } from '@aglyn/shared-util-http/bounded-await'
        import { review } from './review'
        export async function selfHostedThemeFonts() {
          return boundedAwait(review(), 5000, null, 'review')
        }
      `,
      'libs/tenant/runtime/src/lib/review.ts': `
        async function token(credential: { getAccessToken(): Promise<unknown> }) {
          return credential.getAccessToken()
        }
        export async function review() {
          const request = fetch
          return request('https://example.test', { headers: { a: String(await token(c)) } })
        }
      `,
    })
    expect(scan.unbounded).toEqual([])
    expect(scan.bounded.map((call) => call.marker).sort()).toEqual([
      'access-token',
      'fetch-ref',
    ])
  })

  it('treats a detached `void` call as nothing the render waits on', () => {
    const scan = scanFixture({
      'libs/tenant/runtime/src/lib/self-hosted-fonts.ts': `
        export async function selfHostedThemeFonts() {
          void fetch('https://example.test/beacon', { method: 'POST' }).catch(() => undefined)
          return null
        }
      `,
    })
    expect(scan.unbounded).toEqual([])
  })

  it('follows a barrel by name, and does not enter a client module', () => {
    const scan = scanFixture({
      'libs/tenant/runtime/src/lib/self-hosted-fonts.ts': `
        import * as Aglyn from '@aglyn/aglyn/server'
        import { useThing } from './client-thing'
        export async function selfHostedThemeFonts() {
          useThing()
          return Aglyn.wanted()
        }
      `,
      'libs/tenant/runtime/src/lib/client-thing.ts': `'use client'
        export function useThing() { return fetch('/api/thing') }
      `,
      'libs/aglyn/src/server.ts': `export * from './lib/a'\nexport * from './lib/b'`,
      'libs/aglyn/src/lib/a.ts': `export async function wanted() { return fetch('https://example.test/a') }`,
      'libs/aglyn/src/lib/b.ts': `export async function unrelated() { return fetch('https://example.test/b') }`,
    })
    expect(scan.unbounded.map((call) => `${call.file}#${call.symbol}`)).toEqual(
      ['libs/aglyn/src/lib/a.ts#wanted'],
    )
  })

  it('walks what plugins register into a registry the render reaches', () => {
    const scan = scanFixture({
      'libs/tenant/runtime/src/lib/self-hosted-fonts.ts': `
        import { runEnrichers } from '../../../../aglyn/src/lib/plugin-manager/hooks'
        export async function selfHostedThemeFonts() { return runEnrichers() }
      `,
      'libs/aglyn/src/lib/plugin-manager/hooks.ts': `
        const enrichers: Array<() => Promise<unknown>> = []
        export function registerEnricher(fn: () => Promise<unknown>) { enrichers.push(fn) }
        export async function runEnrichers() { return Promise.all(enrichers.map((fn) => fn())) }
      `,
      'libs/plugins/demo/src/lib/server.ts': `
        import { enrich } from './enrich'
        export function registerDemo() { registerEnricher(enrich) }
        export function registerDemoApi() { registerRoute(() => fetch('https://example.test/api-only')) }
      `,
      'libs/plugins/demo/src/lib/enrich.ts': `export async function enrich() { return fetch('https://example.test/page') }`,
    })
    expect(scan.registrars).toEqual(['registerEnricher'])
    expect(scan.unbounded.map((call) => `${call.file}#${call.symbol}`)).toEqual(
      ['libs/plugins/demo/src/lib/enrich.ts#enrich'],
    )
  })
})
