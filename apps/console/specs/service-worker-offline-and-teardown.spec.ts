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
 * AGL-1056: the offline fallback, and what sign-out takes with it.
 *
 * The fallback is the one place the worker is allowed to answer a navigation
 * with something other than the network's answer, so the interesting cases are
 * all about when it must NOT:
 *
 * * a **500 must stay a 500** — `fetch` resolves for an HTTP error, so only a
 *   network-level rejection may reach the fallback;
 * * `/api/*` must never receive HTML.
 *
 * Driven against the shipped `public/sw.js`, like the cache-policy suite.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import vm from 'vm'

const ORIGIN = 'https://app.aglyn.com'
const OFFLINE_BODY = '<<offline-page>>'

const request = (
  url: string,
  init: { mode?: string; destination?: string; method?: string } = {},
) => ({
  url,
  method: init.method ?? 'GET',
  mode: init.mode ?? 'cors',
  destination: init.destination ?? 'script',
  credentials: 'same-origin',
  headers: { get: () => null },
})

/** Loads the shipped worker with a controllable network. */
function loadWorker(opts: { networkFails?: boolean; status?: number } = {}) {
  const source = readFileSync(join(__dirname, '..', 'public', 'sw.js'), 'utf8')
  const listeners: Record<string, ((event: unknown) => void)[]> = {}
  const added: string[] = []
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
      // Stands in for the precached offline page.
      match: async (url: string) =>
        String(url).includes('offline') ? { body: OFFLINE_BODY } : undefined,
      open: async () => ({
        put: async () => undefined,
        add: async (url: string) => {
          added.push(String(url))
        },
      }),
    },
    fetch: async () => {
      if (opts.networkFails) throw new TypeError('Failed to fetch')
      return { status: opts.status ?? 200, type: 'basic', clone: () => ({}) }
    },
    URL,
    console,
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)

  return {
    added,
    /** Run the install handler and wait for whatever it promised. */
    install: async () => {
      let waited: Promise<unknown> = Promise.resolve()
      const event = { waitUntil: (p: Promise<unknown>) => (waited = p) }
      for (const fn of listeners['install'] ?? []) fn(event)
      await waited
    },
    /** The response the worker produced, or `undefined` if it passed through. */
    respond: async (req: ReturnType<typeof request>) => {
      let settled: Promise<unknown> | undefined
      const event = {
        request: req,
        respondWith: (value: Promise<unknown>) => {
          settled = Promise.resolve(value)
        },
      }
      for (const fn of listeners['fetch'] ?? []) fn(event)
      return settled ? await settled : undefined
    },
  }
}

const isOfflinePage = (response: unknown) =>
  !!response && (response as { body?: string }).body === OFFLINE_BODY

describe('offline fallback (AGL-1056)', () => {
  it('precaches the offline page at install', async () => {
    // It cannot be fetched at the moment it is needed, so it has to already
    // be there. This is the one precached URL.
    const worker = loadWorker()
    await worker.install()
    expect(worker.added).toEqual(['/_static/offline.html'])
  })

  it('serves the fallback when a navigation fails on the network', async () => {
    const worker = loadWorker({ networkFails: true })
    const response = await worker.respond(
      request(`${ORIGIN}/test-org/hosts`, {
        mode: 'navigate',
        destination: 'document',
      }),
    )
    expect(isOfflinePage(response)).toBe(true)
  })

  it('a 500 stays a 500 — the fallback never masks a server error', async () => {
    // The case most likely to be got wrong. `fetch` RESOLVES for a 500, so a
    // handler that keyed on "not ok" instead of "rejected" would replace a
    // real server error with a cheerful offline page and hide the outage.
    const worker = loadWorker({ status: 500 })
    const response = await worker.respond(
      request(`${ORIGIN}/test-org/hosts`, {
        mode: 'navigate',
        destination: 'document',
      }),
    )
    expect(isOfflinePage(response)).toBe(false)
    expect((response as { status?: number })?.status).toBe(500)
  })

  it('a successful navigation is passed through untouched', async () => {
    const worker = loadWorker({ status: 200 })
    const response = await worker.respond(
      request(`${ORIGIN}/test-org/hosts`, {
        mode: 'navigate',
        destination: 'document',
      }),
    )
    expect(isOfflinePage(response)).toBe(false)
    expect((response as { status?: number })?.status).toBe(200)
  })

  it('never answers /api/* with the fallback, even offline', async () => {
    // An API caller must get a real network error it can handle, not HTML.
    const worker = loadWorker({ networkFails: true })
    const response = await worker.respond(
      request(`${ORIGIN}/api/orgs/members?orgId=o1`),
    )
    // Not handled at all → the request goes to the network and fails there.
    expect(response).toBeUndefined()
  })

  it('never answers a non-navigation asset request with the fallback', async () => {
    // An uncached asset whose network fetch fails REJECTS, exactly as it would
    // with no service worker at all. That is the right outcome — a script tag
    // that received an HTML offline page would fail in a far more confusing
    // way than a failed request. Asserted as a rejection rather than a value,
    // because assuming it resolved is what made this test fail first time.
    const worker = loadWorker({ networkFails: true })
    await expect(
      worker.respond(request(`${ORIGIN}/_next/static/chunks/x.js`)),
    ).rejects.toThrow(/Failed to fetch/)
  })
})

describe('cache teardown on sign-out (AGL-1056)', () => {
  const realCaches = (global as Record<string, unknown>)['caches']

  afterEach(() => {
    ;(global as Record<string, unknown>)['caches'] = realCaches
  })

  /** Loaded lazily so each case can install its own `caches`. */
  const load = async () => {
    jest.resetModules()
    return (await import('../utils/clear-service-worker-caches')).default
  }

  it('deletes every cache for the origin', async () => {
    const deleted: string[] = []
    ;(global as Record<string, unknown>)['caches'] = {
      keys: async () => ['aglyn-console-static-v1', 'something-older'],
      delete: async (name: string) => {
        deleted.push(name)
        return true
      },
    }
    const clear = await load()
    await expect(clear()).resolves.toBe(2)
    // Not just the current one: a cache written under an older rule-set is
    // exactly the invisible layer this is meant to remove.
    expect(deleted).toEqual(['aglyn-console-static-v1', 'something-older'])
  })

  it('CONTROL — reports zero when there is nothing to clear', async () => {
    // Without this, "it cleared" is satisfied by a function that always
    // claims success.
    ;(global as Record<string, unknown>)['caches'] = {
      keys: async () => [],
      delete: async () => true,
    }
    const clear = await load()
    await expect(clear()).resolves.toBe(0)
  })

  it('never throws when storage is unavailable', async () => {
    // A private window or a strict storage policy must not break sign-out —
    // the session cookie and the Firebase sign-out are what actually end it.
    ;(global as Record<string, unknown>)['caches'] = {
      keys: async () => {
        throw new Error('storage blocked')
      },
      delete: async () => true,
    }
    const clear = await load()
    await expect(clear()).resolves.toBe(0)
  })

  it('never throws when one cache refuses to delete', async () => {
    ;(global as Record<string, unknown>)['caches'] = {
      keys: async () => ['a', 'b'],
      delete: async (name: string) => {
        if (name === 'a') throw new Error('locked')
        return true
      },
    }
    const clear = await load()
    // The one that could be removed still is; the failure does not abort it.
    await expect(clear()).resolves.toBe(1)
  })
})
