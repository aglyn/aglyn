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

/** Loads the shipped worker and returns a driver for its fetch listener. */
function loadWorker() {
  const source = readFileSync(
    join(__dirname, '..', 'public', 'sw.js'),
    'utf8',
  )
  const listeners: Record<string, ((event: unknown) => void)[]> = {}
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
    caches: { keys: async () => [], delete: async () => true, match: async () => undefined, open: async () => ({ put: async () => undefined }) },
    fetch: async () => ({ status: 200, type: 'basic', clone: () => ({}) }),
    URL,
    console,
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)

  /** True when the worker took over the request (i.e. it is cacheable). */
  return (req: ReturnType<typeof request>): boolean => {
    let handled = false
    const event = {
      request: req,
      respondWith: () => {
        handled = true
      },
    }
    for (const fn of listeners['fetch'] ?? []) fn(event)
    return handled
  }
}

describe('service worker cache policy (AGL-1054)', () => {
  const handles = loadWorker()

  it('CONTROL — it really does cache the allowlisted assets', () => {
    // Without this the whole suite would pass against a worker that caches
    // nothing, which is safe but not the change under test.
    expect(handles(request(`${ORIGIN}/_next/static/chunks/main-abc123.js`))).toBe(true)
    expect(handles(request(`${ORIGIN}/_static/brand/logo.svg`))).toBe(true)
  })

  it('never caches a navigation — the console is force-dynamic', () => {
    // The single most important line in the worker. A cached HTML shell would
    // hand one user's org context to the next person on the device.
    //
    // The paths here are deliberately INSIDE the allowlist. Asserting against
    // `/test-org/hosts` looked right and proved nothing: that path is denied
    // by the allowlist anyway, so deleting the navigation guard entirely left
    // the test green. Caught by mutation, and it is the reason this case is
    // written the awkward-looking way — the guard is defence in depth, so it
    // has to be tested where the other layer cannot cover for it.
    //
    // Not hypothetical either: navigating straight to an asset URL produces
    // exactly this request.
    expect(
      handles(
        request(`${ORIGIN}/_static/brand/logo.svg`, {
          mode: 'navigate',
          destination: 'document',
        }),
      ),
    ).toBe(false)
    expect(
      handles(
        request(`${ORIGIN}/_next/static/chunks/main-abc123.js`, {
          destination: 'document',
        }),
      ),
    ).toBe(false)
  })

  it('CONTROL — an ordinary page navigation is denied too', () => {
    // The obvious case, kept for completeness. On its own it is satisfied by
    // the allowlist rather than by the navigation guard — see above.
    expect(
      handles(
        request(`${ORIGIN}/test-org/hosts`, {
          mode: 'navigate',
          destination: 'document',
        }),
      ),
    ).toBe(false)
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
