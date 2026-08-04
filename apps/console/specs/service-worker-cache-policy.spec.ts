/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
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
 * AGL-1054: what the console's service worker is allowed to cache.
 *
 * The review question for this code is not "is it fast" but **can any bytes
 * belonging to user A be replayed to user B on this device**. A cache is a
 * second storage layer with no security rules in front of it, on an origin
 * that serves one workspace's data to one signed-in user.
 *
 * ## This runs the REAL file
 *
 * `public/sw.js` is not a module and cannot be imported, so the obvious test
 * would re-implement its predicate — and then pass forever while the shipped
 * worker did something else. Instead the file is read from disk and evaluated
 * against a stub `self`, and the assertions drive its actual `fetch` listener.
 * A rule that exists only in this spec cannot make it green.
 *
 * ## What "not cached" means here
 *
 * The worker calls `respondWith` **only** for requests it may cache; everything
 * else falls through to the network as if no worker existed. So "did it call
 * respondWith" is exactly the question, and it is observable.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import vm from 'vm'

const ORIGIN = 'https://app.aglyn.com'

interface FakeRequestInit {
  method?: string
  mode?: string
  destination?: string
  credentials?: string
  authorization?: string
}

/** Minimal stand-in for the parts of `Request` the worker reads. */
const request = (url: string, init: FakeRequestInit = {}) => ({
  url,
  method: init.method ?? 'GET',
  mode: init.mode ?? 'cors',
  destination: init.destination ?? 'script',
  credentials: init.credentials ?? 'same-origin',
  headers: { get: (name: string) => (name.toLowerCase() === 'authorization' ? (init.authorization ?? null) : null) },
})

/** Loads the shipped worker and returns drivers for its fetch listener. */
function loadWorker() {
  const source = readFileSync(join(__dirname, '..', 'public', 'sw.js'), 'utf8')
  const listeners: Record<string, ((event: unknown) => void)[]> = {}
  /** Every URL the worker asked the cache to STORE. */
  const puts: string[] = []
  const self = {
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      ;(listeners[type] ??= []).push(fn)
    },
    location: { origin: ORIGIN },
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined },
  }
  const sandbox = {
    self,
    caches: {
      keys: async () => [],
      delete: async () => true,
      match: async () => undefined,
      open: async () => ({
        put: async (req: { url?: string } | string) => {
          puts.push(typeof req === 'string' ? req : (req?.url ?? '?'))
        },
        add: async () => undefined,
      }),
    },
    fetch: async () => ({ status: 200, type: 'basic', clone: () => ({}) }),
    URL,
    console,
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)

  const fire = (req: ReturnType<typeof request>) => {
    let handled = false
    let settled: Promise<unknown> = Promise.resolve()
    const event = {
      request: req,
      respondWith: (value: Promise<unknown>) => {
        handled = true
        settled = Promise.resolve(value)
      },
    }
    for (const fn of listeners['fetch'] ?? []) fn(event)
    return { handled, settled }
  }

  return {
    /** Did the worker take over the request at all? */
    handles: (req: ReturnType<typeof request>) => fire(req).handled,
    /**
     * Did the worker WRITE this request's response to the cache?
     *
     * The property that actually matters, and the one worth asserting
     * directly: since AGL-1056 the worker DOES take over navigations (to serve
     * an offline fallback when the network fails), so "was it handled" stopped
     * being a proxy for "could it be stored".
     */
    writesToCache: async (req: ReturnType<typeof request>) => {
      const before = puts.length
      const { settled } = fire(req)
      await settled.catch(() => undefined)
      // Let the un-awaited `cache.put(...)` inside the handler run.
      await new Promise((resolve) => setTimeout(resolve, 0))
      return puts.length > before
    },
  }
}

describe('service worker cache policy (AGL-1054)', () => {
  const { handles, writesToCache } = loadWorker()

  it('CONTROL — it really does cache the allowlisted assets', () => {
    // Without this the whole suite would pass against a worker that caches
    // nothing, which is safe but not the change under test.
    expect(handles(request(`${ORIGIN}/_next/static/chunks/main-abc123.js`))).toBe(true)
    expect(handles(request(`${ORIGIN}/_static/brand/logo.svg`))).toBe(true)
  })

  it('never STORES a navigation — the console is force-dynamic', async () => {
    // The single most important property in the worker. A cached HTML shell
    // would hand one user's org context to the next person on the device.
    //
    // Asserted as "was it written to the cache", not "was it handled". Since
    // AGL-1056 the worker deliberately handles navigations, to serve an
    // offline fallback when the network fails — so the old proxy assertion
    // would now fail while the security property still held, and (worse) a
    // future change that started CACHING those responses would not be caught
    // by it at all.
    await expect(
      writesToCache(
        request(`${ORIGIN}/test-org/hosts`, {
          mode: 'navigate',
          destination: 'document',
        }),
      ),
    ).resolves.toBe(false)
    // Inside the allowlist, where only the `navigate`/`document` guard can
    // save it — a real request shape, since navigating straight to an asset
    // URL produces exactly this.
    await expect(
      writesToCache(
        request(`${ORIGIN}/_static/brand/logo.svg`, {
          mode: 'navigate',
          destination: 'document',
        }),
      ),
    ).resolves.toBe(false)
    await expect(
      writesToCache(
        request(`${ORIGIN}/_next/static/chunks/main-abc123.js`, {
          destination: 'document',
        }),
      ),
    ).resolves.toBe(false)
  })

  it('CONTROL — an allowlisted asset IS stored', async () => {
    // Without this, "never stores a navigation" is satisfied by a worker that
    // stores nothing at all.
    await expect(
      writesToCache(request(`${ORIGIN}/_next/static/chunks/main-abc123.js`)),
    ).resolves.toBe(true)
  })

  it('never caches /api/*', () => {
    expect(handles(request(`${ORIGIN}/api/orgs/members?orgId=o1`))).toBe(false)
    expect(handles(request(`${ORIGIN}/api/auth/session`))).toBe(false)
  })

  it('never touches the Firebase hosts', () => {
    // These run their own offline persistence and streaming transports.
    for (const host of [
      'firestore.googleapis.com',
      'firebasestorage.googleapis.com',
      'identitytoolkit.googleapis.com',
      'securetoken.googleapis.com',
      'firebaseappcheck.googleapis.com',
    ]) {
      expect(handles(request(`https://${host}/v1/projects/x/databases/(default)`))).toBe(false)
    }
  })

  it('never caches a credentialed or authorized request', () => {
    expect(
      handles(request(`${ORIGIN}/_static/brand/logo.svg`, { credentials: 'include' })),
    ).toBe(false)
    expect(
      handles(request(`${ORIGIN}/_static/brand/logo.svg`, { authorization: 'Bearer tok' })),
    ).toBe(false)
  })

  it('never caches a non-GET request', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(handles(request(`${ORIGIN}/_next/static/chunks/x.js`, { method }))).toBe(false)
    }
  })

  it('never caches another origin, even for an asset-shaped path', () => {
    expect(handles(request('https://evil.test/_next/static/chunks/x.js'))).toBe(false)
    expect(handles(request('https://cdn.aglyn.app/_static/logo.svg'))).toBe(false)
  })

  it('is not fooled by an allowlisted prefix appearing later in the path', () => {
    // `/api/_next/static/...` must be denied by the API rule, and a path that
    // merely CONTAINS the prefix must not match it.
    expect(handles(request(`${ORIGIN}/api/_next/static/x.js`))).toBe(false)
    expect(handles(request(`${ORIGIN}/org/_next/static/x.js`))).toBe(false)
    expect(handles(request(`${ORIGIN}/media/_static/x.svg`))).toBe(false)
  })

  it('caches nothing else on the origin', () => {
    // Everything outside the two prefixes, including plausible near-misses.
    expect(handles(request(`${ORIGIN}/sw.js`))).toBe(false)
    expect(handles(request(`${ORIGIN}/favicon.ico`))).toBe(false)
    expect(handles(request(`${ORIGIN}/_next/image?url=x`))).toBe(false)
    expect(handles(request(`${ORIGIN}/_next/data/build/page.json`))).toBe(false)
  })
})
