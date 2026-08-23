/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, and this suite needs `Response`.
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
 * Can the render canaries actually go red? (AGL-2486)
 *
 * These two endpoints replace `marketing-home` and `customer-site`, the only
 * external checks that watched a real page. The whole value of the swap is
 * that a broken page produces a 503 — a canary that answers 200 whatever the
 * page does is strictly worse than the dark check it replaced, because it
 * reports a confidence it has not earned.
 *
 * So every case below drives the REAL route handler and asserts the status
 * code, on **GET and HEAD alike**. HEAD is not a formality here: every health
 * endpoint in this repo used to answer HEAD with a hardcoded 200, and several
 * uptime providers use HEAD by default, so a HEAD that cannot go red is the
 * same fifty-one-hour blindness in a different method.
 */
import { HEALTH_NO_STORE, renderHealth } from '@aglyn/aglyn/server'

const LOADER = '../app/[host]/[[...slug]]/load-page-data'

/** A composed page: host resolved, non-empty node tree. */
const RENDERED = {
  props: { data: { host: { id: 'h1' } }, nodes: { a: {}, b: {}, c: {} } },
}

/**
 * Load a route with `loadPageData` stubbed. Modules are reset each time
 * because the probe memoises for five minutes at module scope — without the
 * reset the second case in a file would read the first case's verdict, and
 * every red below would pass for the wrong reason.
 */
async function routeWith(
  which: 'marketing' | 'site',
  loader: () => Promise<unknown>,
) {
  jest.resetModules()
  jest.doMock(LOADER, () => ({ loadPageData: loader }))
  return (await import(`../app/api/health/render/${which}/route`)) as {
    GET: () => Promise<Response>
    HEAD: () => Promise<Response>
  }
}

afterEach(() => {
  jest.resetModules()
  jest.dontMock(LOADER)
})

describe.each(['marketing', 'site'] as const)(
  '/api/health/render/%s',
  (which) => {
    it('answers 200 when the page really renders', async () => {
      const route = await routeWith(which, async () => RENDERED)
      const response = await route.GET()
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.status).toBe('ok')
      expect(body.checks.render.ok).toBe(true)
      expect(body.checks.render.nodeCount).toBe(3)
    })

    /**
     * The control's mirror image, and the reason this file exists. Each of
     * these is a way a page breaks in production.
     */
    it.each([
      [
        'the loader throws',
        async () => {
          throw new Error('firestore down')
        },
      ],
      ['the page 404s', async () => ({ notFound: true })],
      [
        'the page redirects away',
        async () => ({ redirect: { destination: '/x' } }),
      ],
      [
        'the host does not resolve',
        async () => ({ props: { data: {}, nodes: { a: {} } } }),
      ],
      [
        'the page composes an EMPTY node tree',
        async () => ({ props: { data: { host: { id: 'h1' } }, nodes: {} } }),
      ],
      [
        'the node tree is null',
        async () => ({ props: { data: { host: { id: 'h1' } }, nodes: null } }),
      ],
    ])('goes RED on GET when %s', async (_label, loader) => {
      const route = await routeWith(which, loader as () => Promise<unknown>)
      const response = await route.GET()
      expect(response.status).toBe(503)
      const body = await response.json()
      expect(body.status).toBe('degraded')
      expect(body.checks.render.ok).toBe(false)
      expect(typeof body.checks.render.code).toBe('string')
    })

    /**
     * The defect that caused the fifty-one hours, asserted directly: HEAD must
     * carry the SAME status as GET, and the headers must survive the body
     * being dropped. A HEAD that is cacheable while its GET is not is the same
     * lie one layer down.
     */
    it('answers HEAD with the same 503, headers intact and no body', async () => {
      const route = await routeWith(which, async () => ({ notFound: true }))
      const head = await route.HEAD()
      expect(head.status).toBe(503)
      expect(head.headers.get('Cache-Control')).toBe(HEALTH_NO_STORE)
      expect(head.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(head.headers.get('Retry-After')).toBe('30')
      expect(await head.text()).toBe('')
    })

    it('answers HEAD 200 with no Retry-After when the page renders', async () => {
      const route = await routeWith(which, async () => RENDERED)
      const head = await route.HEAD()
      expect(head.status).toBe(200)
      expect(head.headers.get('Cache-Control')).toBe(HEALTH_NO_STORE)
      expect(head.headers.get('Retry-After')).toBeNull()
      expect(await head.text()).toBe('')
    })

    /**
     * Public endpoint: it may say THAT the page is broken and how many nodes
     * it produced, never what the page says.
     */
    it('puts no page content in the body', async () => {
      const route = await routeWith(which, async () => ({
        props: {
          data: { host: { id: 'h1', customDomain: 'acme.example' } },
          nodes: { a: { text: 'Acme Q4 pricing, confidential' } },
        },
      }))
      const raw = await (await route.GET()).text()
      expect(raw).not.toContain('confidential')
      expect(raw).not.toContain('Acme')
      expect(raw).not.toContain('acme.example')
    })
  },
)

describe('renderHealth grading', () => {
  it('passes only a resolved host with a non-empty tree', () => {
    expect(
      renderHealth(
        { kind: 'rendered', hostResolved: true, nodeCount: 2 },
        'demo',
        5,
      ).ok,
    ).toBe(true)
  })

  it.each([
    [
      { kind: 'rendered', hostResolved: false, nodeCount: 2 },
      'host-unresolved',
    ],
    [{ kind: 'rendered', hostResolved: true, nodeCount: 0 }, 'rendered-empty'],
    [{ kind: 'not-found' }, 'not-found'],
    [{ kind: 'redirect' }, 'redirected'],
    [{ kind: 'unavailable' }, 'render-unavailable'],
  ])('grades %j as %s', (outcome, code) => {
    const check = renderHealth(outcome as never, 'demo', 5)
    expect(check.ok).toBe(false)
    expect(check.code).toBe(code)
  })

  it('reports the host it probed and the time it took', () => {
    const check = renderHealth(
      { kind: 'rendered', hostResolved: true, nodeCount: 9 },
      'cname--aglyn.com',
      42,
    )
    expect(check.host).toBe('cname--aglyn.com')
    expect(check.ms).toBe(42)
    expect(check.nodeCount).toBe(9)
  })
})
