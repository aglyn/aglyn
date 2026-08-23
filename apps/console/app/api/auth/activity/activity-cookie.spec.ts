/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
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
 * `Secure` on the AGL-697 activity cookie is a SEPARATE question from
 * `Domain` (AGL-1881).
 *
 * Both used to ride one ternary keyed on "is this a workspace host", so a
 * white-label console on a customer's own domain (AGL-1099) took neither
 * branch and the cookie went out over HTTPS unmarked. It carries no
 * credential, but it is the only input to idle-logout and `POST` here is
 * deliberately authless, so an unmarked cookie is one a network attacker can
 * plant over plaintext to hold a victim's idle window open — or slam it shut.
 *
 * The session route fixed exactly this for `__session` (AGL-1353 D6) and this
 * file trailed it, for the second time. These tests are the thing that stops
 * a third.
 */

import { POST } from './route'
import { ACTIVITY_COOKIE } from './session-activity'

/**
 * A heartbeat as the console actually sends one: a same-origin `fetch`, which
 * always carries `Origin` on a POST.
 *
 * `origin` was absent from this helper until AGL-1881 added the same-origin
 * gate, and its absence is worth recording rather than quietly fixing: every
 * test in this file was driving the route in a shape no browser produces, and
 * all six passed. The attribute assertions below were real; the request they
 * asserted them against was not.
 */
const beat = (host: string, proto?: string, origin?: string | null) => {
  // The FIRST leg, matching what the route itself reads — a `https,http`
  // fixture is testing multi-hop parsing and still describes a browser that
  // arrived over https, so its `Origin` has to say so too.
  const scheme =
    (proto ?? '').split(',')[0].trim() === 'https' ? 'https' : 'http'
  const headers: Record<string, string> = {
    host,
    ...(proto ? { 'x-forwarded-proto': proto } : {}),
  }
  if (origin !== null) headers.origin = origin ?? `${scheme}://${host}`
  return POST(
    new Request(`${scheme}://${host}/api/auth/activity`, {
      method: 'POST',
      headers,
    }),
  )
}

const cookieOf = async (response: Response) =>
  String(response.headers.get('set-cookie') ?? '')

describe('activity cookie attributes (AGL-1881)', () => {
  it('THE BUG — a custom console domain over HTTPS gets Secure', async () => {
    const cookie = await cookieOf(await beat('console.acme-agency.com', 'https'))
    expect(cookie).toContain(`${ACTIVITY_COOKIE}=`)
    expect(cookie).toContain('Secure')
    // Still host-only: a customer's domain must not take a parent-domain
    // cookie, which is the half that was always right.
    expect(cookie).not.toContain('Domain=')
  })

  it('a workspace host over HTTPS gets BOTH Secure and the parent Domain', async () => {
    const cookie = await cookieOf(await beat('app.aglyn.com', 'https'))
    expect(cookie).toContain('Domain=.aglyn.com')
    expect(cookie).toContain('Secure')
  })

  it('the apex workspace host is treated as one too', async () => {
    const cookie = await cookieOf(await beat('aglyn.com', 'https'))
    expect(cookie).toContain('Domain=.aglyn.com')
    expect(cookie).toContain('Secure')
  })

  it('POSITIVE CONTROL — plain-http localhost gets no Secure, so dev still works', async () => {
    // Without this, hardcoding `Secure` would pass every test above and break
    // every local sign-in, which is how the flag came to be conditional.
    const cookie = await cookieOf(await beat('localhost:4200'))
    expect(cookie).toContain(`${ACTIVITY_COOKIE}=`)
    expect(cookie).not.toContain('Secure')
  })

  it('reads the FIRST forwarded-proto leg, which is the client hop', async () => {
    const cookie = await cookieOf(
      await beat('console.acme-agency.com', 'https,http'),
    )
    expect(cookie).toContain('Secure')
  })

  it('always carries HttpOnly and SameSite regardless of host', async () => {
    for (const host of ['console.acme-agency.com', 'app.aglyn.com']) {
      const cookie = await cookieOf(await beat(host, 'https'))
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('SameSite=Lax')
    }
  })
})

/**
 * AGL-1881 — the heartbeat is refused cross-site.
 *
 * This POST sets `aglyn_session_activity` for the whole parent domain, and
 * that cookie is the ONLY input to the AGL-697 idle-logout decision. It stayed
 * authless on the reasoning that "an unauthenticated beat sets a cookie that
 * governs nothing" — true of the CALLER's session, false of the VICTIM's. A
 * cross-site auto-submitting form POST is a top-level navigation to our
 * origin, so the cookie lands first-party in the victim's browser and holds a
 * signed-in user's idle window open: exactly the unattended-machine threat the
 * control exists for.
 *
 * Auth is still the wrong gate (dev never mints the cross-subdomain
 * `__session`). `sameOriginRefusal` is the right one, and it already existed —
 * wired, until now, to exactly one route.
 */
describe('the heartbeat is same-origin only (AGL-1881)', () => {
  const noCookie = async (response: Response) => {
    expect(response.status).toBe(403)
    expect(response.headers.get('set-cookie')).toBeNull()
  }

  it('refuses a POST with no Origin at all', async () => {
    // Fail-closed on absence: every browser sends `Origin` on a `fetch` POST,
    // so a request without one is not the caller this route expects.
    await noCookie(await beat('app.aglyn.com', 'https', null))
  })

  it('refuses a POST from a foreign origin', async () => {
    await noCookie(
      await beat('app.aglyn.com', 'https', 'https://attacker.example'),
    )
  })

  it('refuses a lookalike suffix origin', async () => {
    await noCookie(
      await beat('app.aglyn.com', 'https', 'https://evilaglyn.com'),
    )
  })

  it('refuses a plaintext origin on an https host', async () => {
    // A network attacker on a plaintext sibling must not drive a request that
    // is HTTPS-only.
    await noCookie(
      await beat('app.aglyn.com', 'https', 'http://app.aglyn.com'),
    )
  })

  it('still accepts the console own-origin heartbeat', async () => {
    // The control. Without it every assertion above passes against a route
    // that refuses everything, and idle-logout would be broken instead.
    const response = await beat('app.aglyn.com', 'https')
    expect(response.status).toBe(200)
    expect(await cookieOf(response)).toContain(`${ACTIVITY_COOKIE}=`)
  })

  it('still accepts a white-label console on its own domain', async () => {
    const response = await beat('console.acme-agency.com', 'https')
    expect(response.status).toBe(200)
    expect(await cookieOf(response)).toContain(`${ACTIVITY_COOKIE}=`)
  })
})
