/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves the
 * suite on jsdom.
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
 * The tenant runtime resolves hosts on a SELF-HOST container (AGL-2177).
 *
 * ## The check nobody had run
 *
 * Self-hosting with Docker and bring-your-own-Firebase is a headline
 * open-source selling point, and the half that serves websites did not work at
 * all. Every branch of the host-resolution switch was gated on `IS_VERCEL`,
 * including the branch built for an operator's own apex, while
 * `docker/tenant.Dockerfile` sets `AGLYN_STANDALONE=1` and never sets
 * `VERCEL`. Nothing matched, control fell to the `default:` fallback, and
 * every visitor to every published site got `307 → https://app.aglyn.com/`.
 *
 * What makes this worth a spec of its own rather than a line in another: the
 * behaviour was already WRITTEN DOWN. `platform-fingerprint-headers.spec.ts`
 * explains that "the production-shaped branch is gated on `IS_VERCEL`, so
 * under jest it falls through to a 307 at the console" — and jest's
 * environment, with `VERCEL` unset, IS a self-host container's environment.
 * It was read as a quirk of the harness for as long as it existed. The
 * distance between "our test runner takes this branch" and "our advertised
 * deployment shape takes this branch" was one env var nobody compared.
 *
 * So this suite drives the middleware under the CONTAINER's environment
 * specifically. Every case sets `VERCEL` deleted and `AGLYN_STANDALONE=1`,
 * because that pair is the thing under test — a case that passed with `VERCEL`
 * set would prove nothing about the shape this issue is about.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

import { NextRequest } from 'next/server'

const APEX = 'sites.example.com'
const CONSOLE = 'https://console.example.com'

/**
 * One request through the real middleware, under a self-host container's env.
 *
 * A FRESH module registry per call: the middleware memoizes lockdown verdicts
 * per isolate keyed on host, so a second case would otherwise read the first
 * case's answer and pass regardless of the gate.
 */
async function driveSelfHost(host: string): Promise<Response> {
  jest.resetModules()
  global.fetch = jest.fn(
    async () => ({ ok: true, json: async () => ({}) }) as never,
  ) as never
  const { middleware } = await import('../middleware')
  return (await middleware(
    new NextRequest(new URL('/', `https://${host}`), { headers: { host } }),
    {} as never,
  )) as Response
}

describe('a self-host container serves published sites (AGL-2177)', () => {
  const ORIGINAL = { ...process.env }

  beforeEach(() => {
    // Exactly what docker/tenant.Dockerfile and .env.selfhost produce.
    delete process.env.VERCEL
    delete process.env.VERCEL_ENV
    process.env.AGLYN_STANDALONE = '1'
    // `NODE_ENV` is typed readonly; a container really does run production, and
    // the branch under test does not read it — but the surrounding code does,
    // so it is set the way the runtime sets it rather than left as 'test'.
    Object.assign(process.env, { NODE_ENV: 'production' })
    process.env.AGLYN_TENANT_HOST_CNAME = APEX
    process.env.NEXT_PUBLIC_CONSOLE_URL = CONSOLE
  })

  afterEach(() => {
    process.env = { ...ORIGINAL }
    jest.resetModules()
  })

  it('a site on the operator apex is SERVED, not redirected away', async () => {
    const response = await driveSelfHost(`acme.${APEX}`)
    // The assertion that matters. Before this issue it was 307, Location
    // https://app.aglyn.com/ — the operator's visitor handed to us.
    expect(response.status).not.toBe(307)
    expect(response.headers.get('location')).toBeNull()
  })

  /**
   * WHICH site, not merely "a site" (AGL-2217).
   *
   * Every case in this suite asserted the visitor is not redirected away, and
   * all of them passed while the operator's whole apex collapsed onto ONE
   * tenant host: `acme.sites.example.com` and `bravo.sites.example.com` both
   * rewrote to `/sites.example.com/`, because the `.${AGLYN_TENANT_HOST_CNAME}`
   * branch ASSIGNS the apex instead of stripping it. Serving the wrong site is
   * not a redirect, so nothing here could see it.
   *
   * So these read the rewrite target. `x-middleware-rewrite` is the only
   * observable: the resolved host travels as the first path segment.
   */
  const rewrittenHostOf = (response: Response): string | undefined => {
    const rewrite = response.headers.get('x-middleware-rewrite')
    if (!rewrite) return undefined
    return new URL(rewrite).pathname.split('/').filter(Boolean)[0]
  }

  describe('the operator apex resolves each subdomain to its OWN site', () => {
    beforeEach(() => {
      // The runbook variable. `AGLYN_TENANT_HOST_CNAME` alone is not enough
      // and must not be: it names the CNAME target, not the subdomain apex.
      process.env.NEXT_PUBLIC_TENANT_DOMAIN = APEX
    })

    it('gives two sites two different tenant hosts', async () => {
      const acme = rewrittenHostOf(await driveSelfHost(`acme.${APEX}`))
      const bravo = rewrittenHostOf(await driveSelfHost(`bravo.${APEX}`))
      expect(acme).toBe('acme')
      expect(bravo).toBe('bravo')
      // The failure this exists for: one host for every name.
      expect(acme).not.toBe(bravo)
    })

    it('survives a non-standard port behind the operator proxy', async () => {
      expect(rewrittenHostOf(await driveSelfHost(`acme.${APEX}:8443`))).toBe(
        'acme',
      )
    })

    it('does not invent a site name from a multi-label prefix', async () => {
      // `a.b.sites.example.com` is not `{site}.{apex}`. Treating it as the
      // site `a.b` would hand a wildcard-DNS visitor an arbitrary lookup.
      expect(rewrittenHostOf(await driveSelfHost(`a.b.${APEX}`))).toBe(
        `cname--a.b.${APEX}`,
      )
    })

    it('leaves the bare apex to the apex branch', async () => {
      expect(rewrittenHostOf(await driveSelfHost(APEX))).toBe(APEX)
    })

    it("is inert when the variable is unset, which is how Aglyn runs", async () => {
      delete process.env.NEXT_PUBLIC_TENANT_DOMAIN
      // Back to the pre-existing behaviour exactly: the apex branch wins and
      // assigns the CNAME host. Pinned so the new branch cannot start firing
      // on our own deployment through a default nobody intended.
      expect(rewrittenHostOf(await driveSelfHost(`acme.${APEX}`))).toBe(APEX)
    })
  })

  it('the bare operator apex resolves too', async () => {
    const response = await driveSelfHost(APEX)
    expect(response.status).not.toBe(307)
  })

  it("a customer's custom domain resolves on a container", async () => {
    // The `default:` branch was gated on IS_VERCEL as well, so a connected
    // custom domain took the same fallback as an unknown host.
    const response = await driveSelfHost('shop.acme-customer.com')
    expect(response.status).not.toBe(307)
  })

  it('an unresolvable host goes to the OPERATOR console, never ours', async () => {
    // A hostname that is not host-shaped cannot be a customer domain, so the
    // fallback is correct here — what was wrong is where it pointed (AGL-2176).
    const response = await driveSelfHost('not_a_hostname')
    expect(response.status).toBe(307)
    const location = response.headers.get('location') ?? ''
    expect(location).toContain('console.example.com')
    expect(location).not.toContain('aglyn.com')
  })

  it("keeps Aglyn's own hostnames gated on Vercel, not on deployment", async () => {
    // The other direction, and the reason `IS_VERCEL` was not simply widened
    // everywhere. `.aglyn.app` and `.vercel.app` are OUR infrastructure: the
    // first branch STRIPS the apex to recover a subdomain, so widening it
    // would have a container treat `acme.aglyn.app` as its own site `acme`
    // and serve whatever that name means in the operator's Firestore.
    //
    // A source assertion, because the difference is not observable from a
    // response: on a container neither path finds a host document, so both
    // 404 and a behavioural test would pass whichever branch ran. Asserting
    // the predicate is what actually pins the split.
    const source = readFileSync(resolve(__dirname, '../middleware.ts'), 'utf8')
    expect(source).toContain('case IS_VERCEL && reqHost.endsWith(`.aglyn.app`)')
    expect(source).toContain(
      "case IS_VERCEL && reqHost.endsWith('.vercel.app')",
    )
    // And the operator's own apex is gated on deployment, not on Vercel —
    // the half that was broken.
    expect(source).toContain(
      'case IS_DEPLOYED && reqHost === AGLYN_TENANT_HOST_CNAME',
    )
  })
})
