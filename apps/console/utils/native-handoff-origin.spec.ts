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
 * AGL-3836 — the native sign-in hand-off runs on the Firebase auth origin.
 *
 * The page hard-navigates the answer, so the cases that matter are the ones
 * that must come back null: already there (a loop otherwise), an auth domain
 * this deployment does not serve as a console host, and anything not https.
 */

import { nativeHandoffAuthOrigin } from './native-handoff-origin'

// The shared predicate reads the workspace domain from the environment at
// module load, so derive the hosts rather than hard-coding a domain.
const domain = process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN ?? 'aglyn.com'
const authHost = `auth.${domain}`
const consoleHost = `app.${domain}`
const query = '?start=sso&challenge=abc&redirect_uri=aglyn%3A%2F%2Fauth%2Fhandoff&state=s1'

const at = (host: string, protocol = 'https:') => ({
  protocol,
  host,
  pathname: '/auth/native',
  search: query,
})

describe('nativeHandoffAuthOrigin', () => {
  it('moves the hand-off from the console host to the auth origin, query intact', () => {
    expect(nativeHandoffAuthOrigin(at(consoleHost), authHost)).toBe(
      `https://${authHost}/auth/native${query}`,
    )
  })

  it('stays put once it is on the auth origin', () => {
    expect(nativeHandoffAuthOrigin(at(authHost), authHost)).toBeNull()
    expect(nativeHandoffAuthOrigin(at(authHost.toUpperCase()), authHost)).toBeNull()
  })

  it('stays put when the auth domain is not a console host of this deployment', () => {
    expect(nativeHandoffAuthOrigin(at(consoleHost), 'aglyn-main.firebaseapp.com')).toBeNull()
    expect(nativeHandoffAuthOrigin(at(consoleHost), 'auth.evil.example.com')).toBeNull()
  })

  it('stays put with no auth domain, or off https (localhost, the emulator)', () => {
    expect(nativeHandoffAuthOrigin(at(consoleHost), undefined)).toBeNull()
    expect(nativeHandoffAuthOrigin(at(consoleHost), '  ')).toBeNull()
    expect(nativeHandoffAuthOrigin(at('localhost:4200', 'http:'), authHost)).toBeNull()
  })
})
