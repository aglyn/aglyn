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
 * AGL-2083: every caller of a paginated staff list route follows its cursor.
 *
 * This is a CALL-SITE spec on purpose. `/api/admin/hosts` has served
 * `hasMore` and `nextCursor` correctly since it was written — a test
 * exercising the ROUTE passed for the entire period both of its callers
 * threw the cursor away. The endpoint was never the bug; the fetch was.
 *
 * The helper is unit-tested below for the behaviours that make a bounded
 * walk safe (stop on a null cursor, report the ceiling, never spin on a
 * `hasMore` flag with nowhere to go). The call-site half asserts that the
 * screens actually use it.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fetchAllPages, MAX_PAGES } from '../utils/fetch-all-pages'

const ROOT = join(__dirname, '..')

/**
 * Files that fetch a paginated staff list, and the routes they read. Each
 * of these truncated silently before AGL-2083.
 */
const CALLERS: Array<{ file: string; routes: string[] }> = [
  {
    file: 'components/system-email-test-drawer.component.tsx',
    // All THREE, not just hosts: `/api/admin/orgs` serves 25 per page, so
    // the org picker was the worst of them and the issue had not caught it.
    routes: ['/api/admin/orgs', '/api/admin/hosts', '/api/admin/users'],
  },
  {
    file: 'app/(app)/admin/orgs/[orgId]/page.tsx',
    routes: ['/api/admin/hosts'],
  },
]

function source(file: string): string {
  return readFileSync(join(ROOT, file), 'utf8')
}

/**
 * The file with its import lines removed.
 *
 * Every assertion about what a screen DOES must read this rather than
 * {@link source}: an import statement names a symbol without using it, and a
 * guard that cannot tell the two apart passes on code that only imports the
 * fix.
 */
function body(file: string): string {
  return source(file)
    .split('\n')
    .filter((line) => !/^\s*import\b/.test(line) && !/^\s*}\s*from\s/.test(line))
    .join('\n')
}

describe('AGL-2083 · paginated staff lists are walked, not sampled', () => {
  it('asserts over a real caller table', () => {
    // Guard the guard: an empty table would make every check below vacuous.
    expect(CALLERS.length).toBeGreaterThanOrEqual(2)
    expect(CALLERS.flatMap((caller) => caller.routes).length).toBeGreaterThanOrEqual(4)
    // And the stripper must actually leave a body behind — a `body()` that
    // returned '' would make every `not.toMatch` below pass trivially.
    for (const { file } of CALLERS) {
      expect(body(file).length).toBeGreaterThan(1000)
      expect(body(file)).not.toMatch(/^\s*import\b/m)
    }
  })

  it.each(CALLERS)('$file walks every page', ({ file, routes }) => {
    // Body only. An `import { fetchAllPages }` line satisfies a bare
    // `toContain('fetchAllPages')` while every call site below it is a
    // single-page `fetch` — which is exactly what this guard did on its
    // first fail-on-purpose run: the caller was reverted to the original
    // bug and all fifteen tests still passed. Asserting on the presence of
    // a token near the code is not asserting on the code.
    const text = body(file)
    const calls = text.match(/fetchAllPages\s*[<(]/g) ?? []
    // One walk per route this screen reads, counted — not "at least one",
    // which a screen that walks hosts and still single-page-fetches orgs
    // would satisfy.
    expect(calls.length).toBe(routes.length)
    for (const route of routes) expect(text).toContain(route)
  })

  it('the drawer reports the SSO-tenant truncation too', () => {
    // The cursor walk cannot see it, so a drawer that only reported
    // `truncated` would look complete again for exactly the users an SSO
    // org cares about.
    const text = body('components/system-email-test-drawer.component.tsx')
    expect(text).toContain('tenantTruncated')
    expect(text).toContain('SSO tenant')
  })

  it.each(CALLERS)('$file reports a short list instead of hiding it', ({ file }) => {
    // The defect was never an error — it was a list that LOOKED complete.
    // A caller that walks the pages but swallows the ceiling reintroduces
    // exactly that, one page-count later.
    const text = source(file)
    expect(text).toMatch(/truncated/i)
    expect(text).toMatch(/<Alert/)
  })

  it.each(CALLERS)('$file has no bare single-page fetch left', ({ file, routes }) => {
    // The specific regression shape: `fetch('/api/admin/hosts')` with the
    // response read straight into state. If one survives beside the walked
    // one, the screen is still truncating.
    //
    // The quote class must allow the path to CONTINUE after the route —
    // the org detail page calls
    // `fetch(\`/api/admin/hosts?orgId=${'${orgId}'}\`)`, and an anchored
    // `['"\`]` right after the route name matched none of it. That hole
    // is why the first version of this file passed against the unfixed
    // code.
    const text = body(file)
    for (const route of routes) {
      expect(text).not.toMatch(
        new RegExp(`\\bfetch\\(\\s*[\`'"][^\`'"]*${route.replace(/\//g, '\\/')}`),
      )
    }
  })
})

/** Fake fetch returning `pages` pages, then stopping. */
function stubFetch(pages: string[][], key = 'hosts') {
  const calls: string[] = []
  const impl = jest.fn(async (url: string) => {
    calls.push(url)
    const index = /after=([^&]*)/.exec(url)
      ? Number(/after=p(\d+)/.exec(url)?.[1] ?? 0)
      : 0
    const batch = pages[index] ?? []
    const more = index + 1 < pages.length
    return {
      ok: true,
      json: async () => ({
        [key]: batch,
        hasMore: more,
        nextCursor: more ? `p${index + 1}` : null,
      }),
    }
  })
  return { impl, calls }
}

describe('fetchAllPages', () => {
  afterEach(() => {
    delete (globalThis as { fetch?: unknown }).fetch
  })

  it('concatenates every page and stops on a null cursor', async () => {
    const { impl, calls } = stubFetch([['a', 'b'], ['c'], ['d']])
    ;(globalThis as { fetch?: unknown }).fetch = impl
    const result = await fetchAllPages<string>({
      path: '/api/admin/hosts',
      key: 'hosts',
    })
    expect(result.items).toEqual(['a', 'b', 'c', 'd'])
    expect(result.truncated).toBe(false)
    expect(result.pages).toBe(3)
    // The second request must actually carry the cursor — a walk that
    // refetches page one forever also "returns everything on page one".
    expect(calls[1]).toContain('after=p1')
  })

  it('reports truncation when the ceiling stops it', async () => {
    const pages = Array.from({ length: 10 }, (_page, index) => [String(index)])
    const { impl } = stubFetch(pages)
    ;(globalThis as { fetch?: unknown }).fetch = impl
    const result = await fetchAllPages<string>({
      path: '/api/admin/hosts',
      key: 'hosts',
      maxPages: 3,
    })
    expect(result.pages).toBe(3)
    expect(result.truncated).toBe(true)
    expect(result.items).toEqual(['0', '1', '2'])
  })

  it('never loops on hasMore when the cursor is null', async () => {
    // A route reporting `hasMore: true` with no cursor has nowhere to send
    // us. Looping on the flag would spin to the ceiling refetching page one
    // and report a truncation that is not real.
    const impl = jest.fn(async () => ({
      ok: true,
      json: async () => ({ hosts: ['only'], hasMore: true, nextCursor: null }),
    }))
    ;(globalThis as { fetch?: unknown }).fetch = impl
    const result = await fetchAllPages<string>({
      path: '/api/admin/hosts',
      key: 'hosts',
    })
    expect(impl).toHaveBeenCalledTimes(1)
    expect(result.truncated).toBe(false)
    expect(result.items).toEqual(['only'])
  })

  it('keeps the pages it got when one fails mid-walk', async () => {
    let call = 0
    const impl = jest.fn(async () => {
      call += 1
      if (call === 1) {
        return {
          ok: true,
          json: async () => ({ hosts: ['a'], hasMore: true, nextCursor: 'p1' }),
        }
      }
      return { ok: false, json: async () => ({}) }
    })
    ;(globalThis as { fetch?: unknown }).fetch = impl
    const result = await fetchAllPages<string>({
      path: '/api/admin/hosts',
      key: 'hosts',
    })
    // A partial list the caller KNOWS is partial beats both an empty list
    // and a silently short one.
    expect(result.items).toEqual(['a'])
    expect(result.truncated).toBe(true)
  })

  it('appends the cursor with & when the path already has a query', async () => {
    // `/api/admin/hosts?orgId=…` is the org detail page's call. A helper
    // that always used `?` would produce a second query separator and the
    // route would ignore the cursor — truncating exactly as before, while
    // looking wired.
    const { impl, calls } = stubFetch([['a'], ['b']])
    ;(globalThis as { fetch?: unknown }).fetch = impl
    await fetchAllPages<string>({
      path: '/api/admin/hosts?orgId=abc',
      key: 'hosts',
    })
    expect(calls[1]).toContain('?orgId=abc&after=')
    expect(calls[1]).not.toContain('?after=')
  })

  it('supports the GCIP token shape used by /api/admin/users', async () => {
    let call = 0
    const impl = jest.fn(async () => {
      call += 1
      return {
        ok: true,
        json: async () => ({
          users: [`u${call}`],
          nextPageToken: call < 2 ? 'tok' : null,
        }),
      }
    })
    ;(globalThis as { fetch?: unknown }).fetch = impl
    const result = await fetchAllPages<string>({
      path: '/api/admin/users',
      key: 'users',
      cursorParam: 'nextPageToken',
      cursorField: 'nextPageToken',
    })
    expect(result.items).toEqual(['u1', 'u2'])
    expect(result.truncated).toBe(false)
  })

  it('stops when the caller has unmounted', async () => {
    const { impl } = stubFetch([['a'], ['b'], ['c']])
    ;(globalThis as { fetch?: unknown }).fetch = impl
    let alive = true
    const result = await fetchAllPages<string>({
      path: '/api/admin/hosts',
      key: 'hosts',
      active: () => {
        const was = alive
        alive = false
        return was
      },
    })
    expect(result.truncated).toBe(true)
    expect(impl).toHaveBeenCalledTimes(1)
  })

  it('accumulates an extra array field across every page', async () => {
    // `/api/admin/users` reports `tenantTruncated` — an SSO tenant pool that
    // outgrew its cap INSIDE a page, which the cursor walk cannot detect.
    // It can appear on any page, so it is concatenated rather than read off
    // the last one.
    let call = 0
    const impl = jest.fn(async () => {
      call += 1
      return {
        ok: true,
        json: async () => ({
          users: [`u${call}`],
          tenantTruncated: call === 1 ? ['tenant-a'] : ['tenant-b'],
          nextPageToken: call < 2 ? 'tok' : null,
        }),
      }
    })
    ;(globalThis as { fetch?: unknown }).fetch = impl
    const result = await fetchAllPages<string>({
      path: '/api/admin/users',
      key: 'users',
      cursorParam: 'nextPageToken',
      cursorField: 'nextPageToken',
      accumulate: ['tenantTruncated'],
    })
    expect(result.extras.tenantTruncated).toEqual(['tenant-a', 'tenant-b'])
  })

  it('always returns extras, even on an early failure', async () => {
    // Callers read `result.extras.x ?? []`; an undefined `extras` on the
    // error paths would throw inside the very handler meant to report a
    // short list.
    const impl = jest.fn(async () => ({ ok: false, json: async () => ({}) }))
    ;(globalThis as { fetch?: unknown }).fetch = impl
    const result = await fetchAllPages<string>({
      path: '/api/admin/users',
      key: 'users',
      accumulate: ['tenantTruncated'],
    })
    expect(result.extras).toBeDefined()
    expect(result.extras.tenantTruncated).toEqual([])
  })

  it('has a ceiling that is a real bound', () => {
    expect(MAX_PAGES).toBeGreaterThan(1)
    expect(Number.isFinite(MAX_PAGES)).toBe(true)
  })
})
