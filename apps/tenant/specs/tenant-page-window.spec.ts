/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock.
 *
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
 * THE PAGE'S REAL WINDOW IS THE SHORTEST CACHED READ IN ITS RENDER (AGL-4121).
 *
 * Next lowers an ISR regeneration's `revalidate` to the smallest TTL any
 * `unstable_cache` (so any `withRenderCache`) or `fetch` with
 * `next.revalidate` used during that render. #2459 raised the catch-all's
 * `export const revalidate` to a day and saved nothing, because a 300s plugin
 * read, a 600s pointer and the 3600s published-data reads sat under it; the
 * page went on regenerating every five minutes while its own line said a day.
 *
 * So this sweeps every cached read in the code the tenant render reaches —
 * the tenant app outside its API routes, and the tenant and plugin libs — and
 * resolves each TTL to a number. Any TTL below the page window fails, unless
 * it is a NAMED exception below that never runs inside the page render or
 * that deliberately holds one page short. A new short read anywhere in the
 * path therefore reds here, not in the bill a month later.
 *
 * A TTL this sweep cannot resolve to a number fails too: an unreadable TTL is
 * exactly the one nobody checked.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = join(__dirname, '..', '..', '..')
const CATCH_ALL_PAGE = join(
  ROOT,
  'apps',
  'tenant',
  'app',
  '[host]',
  '[scheme]',
  '[[...slug]]',
  'page.tsx',
)
const RENDER_CACHE = join(
  ROOT,
  'libs',
  'tenant',
  'data',
  'admin',
  'src',
  'lib',
  'render-cache.ts',
)

/** Where the page render's code lives. */
const SWEPT_ROOTS = [
  join(ROOT, 'apps', 'tenant', 'app'),
  join(ROOT, 'apps', 'tenant', 'utils'),
  join(ROOT, 'libs', 'tenant'),
  join(ROOT, 'libs', 'plugins'),
]

/**
 * Never in the page render: route handlers answer their own requests, and
 * `search` is `force-dynamic`. Matched against repo-relative paths.
 */
const OUTSIDE_THE_RENDER = [
  /^apps\/tenant\/app\/api\//,
  /^apps\/tenant\/app\/\[host\]\/\[scheme\]\/search\//,
  // The wrapper itself: its `revalidate` is the caller's, and
  // `capRenderWindow` is held to its call sites below.
  /^libs\/tenant\/data\/admin\/src\/lib\/render-cache\.ts$/,
]

/**
 * Short TTLs that are allowed, each with why it cannot shorten the page.
 * Keyed `file::expression`.
 */
const EXCEPTIONS: Record<string, string> = {
  'apps/tenant/utils/get-org-billing.ts::ORG_BILLING_TTL_SECONDS':
    'The REQUEST-time org read (lockdown verdict, dynamic routes). The page ' +
    "and its layout pass `scope: 'render'`, which takes the backstop — " +
    'asserted below.',
  'apps/tenant/utils/get-host.ts::HOST_DOC_REQUEST_TTL_SECONDS':
    "The REQUEST-time host read (the lockdown verdict and its notice). " +
    "The render never passes `scope: 'request'` — asserted below.",
  'libs/plugins/sales-channels/src/lib/server/catalog-source.ts::FEED_CACHE_TTL_SECONDS':
    'The sales-channel product feed, read only by its own feed route.',
}

/** The only files allowed to hold a page on a short window on purpose. */
const RENDER_WINDOW_CAPS = ['libs/tenant/runtime/src/lib/get-layout-version.ts']

function repoPath(file: string): string {
  return relative(ROOT, file).split(sep).join('/')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (
      /\.(ts|tsx)$/.test(name) &&
      !/\.(spec|test)\.tsx?$/.test(name) &&
      !name.endsWith('.d.ts')
    ) {
      out.push(full)
    }
  }
  return out
}

/** `export const NAME = <number>` from render-cache.ts, resolved by name. */
function renderCacheConstants(): Record<string, number> {
  const source = readFileSync(RENDER_CACHE, 'utf8')
  const backstop = source.match(
    /^export const TENANT_CACHE_BACKSTOP_SECONDS = (\d+)$/m,
  )
  if (!backstop) throw new Error('no TENANT_CACHE_BACKSTOP_SECONDS')
  const constants: Record<string, number> = {
    TENANT_CACHE_BACKSTOP_SECONDS: Number(backstop[1]),
  }
  for (const name of [
    'PUBLISHED_SITE_DATA_TTL_SECONDS',
    'PUBLISH_POINTER_TTL_SECONDS',
  ]) {
    const match = source.match(new RegExp(`^export const ${name} = (\\w+)$`, 'm'))
    if (!match) throw new Error(`no ${name} in render-cache.ts`)
    constants[name] = /^\d+$/.test(match[1])
      ? Number(match[1])
      : constants[match[1]]
  }
  return constants
}

/**
 * Resolves a TTL expression to the numbers it can take: a literal, simple
 * arithmetic, a `const` in the same file, a render-cache export, or a
 * ternary of those (both branches). `null` when it cannot be read.
 */
function resolveTtl(
  expression: string,
  source: string,
  shared: Record<string, number>,
  depth = 0,
): number[] | null {
  const expr = expression.trim().replace(/,$/, '').trim()
  if (depth > 6 || !expr) return null
  const ternary = expr.match(/^[^?]+\?\s*([^:]+):\s*(.+)$/s)
  if (ternary) {
    const a = resolveTtl(ternary[1], source, shared, depth + 1)
    const b = resolveTtl(ternary[2], source, shared, depth + 1)
    return a && b ? [...a, ...b] : null
  }
  if (/^[\d\s*+/().-]+$/.test(expr)) {
    // Digits and operators only, so this evaluates arithmetic and nothing else.
    // eslint-disable-next-line no-new-func
    return [Number(new Function(`return (${expr})`)())]
  }
  let substituted = expr
  for (const name of expr.match(/[A-Za-z_]\w*/g) ?? []) {
    const local = source.match(
      new RegExp(`^(?:export )?const ${name} = ([^\\n]+)$`, 'm'),
    )
    const value =
      shared[name] ??
      (local ? resolveTtl(local[1], source, shared, depth + 1)?.[0] : undefined)
    if (value === undefined) return null
    substituted = substituted.replace(new RegExp(`\\b${name}\\b`), String(value))
  }
  return substituted === expr ? null : resolveTtl(substituted, source, shared, depth + 1)
}

/** The `revalidate:` expression inside each cached-read call in a file. */
function cachedReadTtls(source: string): string[] {
  const found: string[] = []
  const openers = /withRenderCache\(|unstable_cache\(|next:\s*\{/g
  let match: RegExpExecArray | null
  while ((match = openers.exec(source))) {
    // The call's own argument span: balanced brackets from the opener.
    let depth = 0
    let end = match.index + match[0].length - 1
    for (let i = end; i < source.length; i += 1) {
      const ch = source[i]
      if (ch === '(' || ch === '{' || ch === '[') depth += 1
      else if (ch === ')' || ch === '}' || ch === ']') {
        depth -= 1
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    const span = source.slice(match.index, end)
    const ttl = span.match(/\brevalidate:\s*([^\n]+?)\s*(?:,\s*(?:\/\/.*)?$|$)/m)
    if (ttl) {
      // A multi-line ternary: take the expression up to the next key.
      const start = span.indexOf(ttl[0]) + ttl[0].indexOf(':') + 1
      const rest = span.slice(start)
      const stop = rest.search(/,\s*\n\s*(?:tags|read|store|key)\b|\n\s*\}/)
      found.push((stop === -1 ? rest : rest.slice(0, stop)).trim())
    }
  }
  return found
}

function pageWindow(): number {
  const match = readFileSync(CATCH_ALL_PAGE, 'utf8').match(
    /^export const revalidate = (\d+)$/m,
  )
  if (!match) throw new Error('no `export const revalidate` in the catch-all page')
  return Number(match[1])
}

describe('the tenant page window is the long one (AGL-4121)', () => {
  const shared = renderCacheConstants()
  const window = pageWindow()
  const files = SWEPT_ROOTS.flatMap((root) => walk(root))
    .map((file) => ({ file, path: repoPath(file) }))
    .filter(({ path }) => !OUTSIDE_THE_RENDER.some((rule) => rule.test(path)))
    .map(({ file, path }) => ({ path, source: readFileSync(file, 'utf8') }))

  it('declares the shared backstop as the page window', () => {
    expect(window).toBe(shared['TENANT_CACHE_BACKSTOP_SECONDS'])
    expect(window).toBe(604800)
    expect(shared['PUBLISHED_SITE_DATA_TTL_SECONDS']).toBe(window)
    expect(shared['PUBLISH_POINTER_TTL_SECONDS']).toBe(window)
  })

  it('finds the cached reads it is meant to police (premise)', () => {
    const swept = files.filter(({ source }) => cachedReadTtls(source).length)
    const paths = swept.map(({ path }) => path)
    // The reads that held #2459 under its own window must be in the sweep.
    expect(paths).toEqual(
      expect.arrayContaining([
        'libs/tenant/data/admin/src/lib/server/realm-plugins.ts',
        'libs/tenant/runtime/src/lib/get-screen.ts',
        'apps/tenant/utils/get-host.ts',
        'libs/tenant/runtime/src/lib/self-hosted-fonts.ts',
        'libs/plugins/marketplace/src/lib/server/connections/site-records-platform.ts',
      ]),
    )
    expect(swept.length).toBeGreaterThan(20)
  })

  it('leaves no cached read in the render path below the page window', () => {
    const offenders: string[] = []
    for (const { path, source } of files) {
      for (const expression of cachedReadTtls(source)) {
        if (EXCEPTIONS[`${path}::${expression}`]) continue
        const values = resolveTtl(expression, source, shared)
        if (!values) {
          offenders.push(`${path}: cannot resolve \`revalidate: ${expression}\``)
          continue
        }
        // A ternary branch that is an exception on its own is excused alone.
        const branches = expression.split(/[?:]/).map((part) => part.trim())
        values.forEach((value, index) => {
          const branch = branches[branches.length - values.length + index]
          if (branch && EXCEPTIONS[`${path}::${branch}`]) return
          if (value < window) {
            offenders.push(`${path}: \`revalidate: ${expression}\` is ${value}s`)
          }
        })
      }
    }
    expect(offenders).toEqual([])
  })

  it("reads the org in the render on the backstop scope ('render')", () => {
    for (const path of [
      'apps/tenant/app/[host]/[scheme]/[[...slug]]/load-page-data.ts',
      'apps/tenant/app/[host]/[scheme]/layout.tsx',
    ]) {
      const source = readFileSync(join(ROOT, path), 'utf8')
      const calls = source.match(/getOrgBilling\(\{[^}]*\}\)/g) ?? []
      expect(calls.length).toBeGreaterThan(0)
      for (const call of calls) expect(call).toContain("scope: 'render'")
    }
  })

  it("reads the host on the request scope only outside the render (AGL-4121)", () => {
    const requestScope = /getHost\(\{[^}]*scope: 'request'/
    // Premise: the verdict reads it, so the pattern matches real code.
    const verdict = readFileSync(
      join(ROOT, 'apps/tenant/app/api/lockdown-verdict/route.ts'),
      'utf8',
    )
    expect(verdict).toMatch(requestScope)
    const inRender = files
      .filter(({ source }) => requestScope.test(source))
      .map(({ path }) => path)
    expect(inRender).toEqual([])
  })

  it('holds a page on a short window only where a schedule is pending', () => {
    const capping = files
      .filter(({ source }) => /\bcapRenderWindow\(/.test(source))
      .map(({ path }) => path)
    expect(capping.sort()).toEqual([...RENDER_WINDOW_CAPS].sort())
  })
})
