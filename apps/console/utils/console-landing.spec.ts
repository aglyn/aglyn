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

import { consoleLandingHref } from './console-landing'

describe('a console path asked for from the auth host lands on the console (AGL-3724)', () => {
  /*
   * Three sign-ups on 2026-10-10/11 got a workspace on `auth.aglyn.com` and
   * were then sent to `auth.aglyn.com/{slug}/hosts`, which the auth host
   * refuses with a 404 (AGL-3090). None of them ever made a site.
   */
  it.each([
    ['/judy-shepherd', 'https://app.aglyn.com/judy-shepherd'],
    ['/destiny-ebiteh/hosts', 'https://app.aglyn.com/destiny-ebiteh/hosts'],
    [
      '/acme/settings/billing?plan=pro&interval=year#plans',
      'https://app.aglyn.com/acme/settings/billing?plan=pro&interval=year#plans',
    ],
  ])('sends %s to the console host', (path, expected) => {
    expect(consoleLandingHref(path, 'auth.aglyn.com')).toBe(expected)
  })

  it.each(['/', '/signin', '/signup?plan=pro', '/verify-email', '/auth/handoff/continue'])(
    'keeps %s, which the auth host serves, where it is',
    (path) => {
      expect(consoleLandingHref(path, 'auth.aglyn.com')).toBe(path)
    },
  )

  it('leaves every other host alone', () => {
    expect(consoleLandingHref('/acme/hosts', 'app.aglyn.com')).toBe('/acme/hosts')
    expect(consoleLandingHref('/acme/hosts', 'acme.aglyn.com')).toBe('/acme/hosts')
    expect(consoleLandingHref('/acme/hosts', null)).toBe('/acme/hosts')
  })

  it('leaves absolute and protocol-relative URLs alone', () => {
    const absolute = 'https://checkout.stripe.com/c/pay/x'
    expect(consoleLandingHref(absolute, 'auth.aglyn.com')).toBe(absolute)
    expect(consoleLandingHref('//evil.example/x', 'auth.aglyn.com')).toBe('//evil.example/x')
  })

  it('reads the auth host with a port the same way', () => {
    expect(consoleLandingHref('/acme/hosts', 'auth.aglyn.com:443')).toBe(
      'https://app.aglyn.com/acme/hosts',
    )
  })
})
