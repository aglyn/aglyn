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

const beat = (host: string, proto?: string) =>
  POST(
    new Request(`http${proto === 'https' ? 's' : ''}://${host}/api/auth/activity`, {
      method: 'POST',
      headers: {
        host,
        ...(proto ? { 'x-forwarded-proto': proto } : {}),
      },
    }),
  )

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
