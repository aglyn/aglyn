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
 * A signed-out person sent to `/oauth/authorize` comes back from sign-in
 * with the app's request intact (AGL-4225).
 *
 * `AuthenticatedLayout` sends them to `/signin?continue=<encoded path+query>`
 * built by `continuePathFor`, and the sign-in page returns to the value
 * `useContinueUrlDecoded` reads back with `searchParams.get` — only if
 * `isSafeContinueUrl` admits it. This is that chain, on the query a real
 * client sends: an absolute redirect address, a PKCE challenge, a state with
 * reserved characters. A step that dropped or double-decoded any of them
 * would send the person back to a request the client can no longer match.
 */

import { continueParam, continuePathFor, isSafeContinueUrl } from '@aglyn/shared-util-next'

const REQUEST = new URLSearchParams({
  client_id: 'aglyn_client_AAAAAAAAAAAAAAAAAAAAAA',
  redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
  response_type: 'code',
  code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  code_challenge_method: 'S256',
  state: 'a+b/c=d&e%f é',
  scope: 'contacts:read sites:read',
  resource: 'https://app.aglyn.com/api/mcp',
}).toString()

describe('the consent page survives a sign-in round trip (AGL-4225)', () => {
  it('carries path AND query through /signin and back, byte for byte', () => {
    const wanted = continuePathFor('/oauth/authorize', `?${REQUEST}`)
    expect(wanted).toBe(`/oauth/authorize?${REQUEST}`)

    // Out: the layout's push.
    const signin = new URL(`https://app.aglyn.com/signin?${continueParam(encodeURIComponent(wanted))}`)
    // Back: what the sign-in page reads, and whether it will follow it.
    const returned = signin.searchParams.get('continue') as string
    expect(returned).toBe(wanted)
    expect(isSafeContinueUrl(returned)).toBe(true)

    const landed = new URL(returned, 'https://app.aglyn.com')
    expect(landed.pathname).toBe('/oauth/authorize')
    expect(landed.searchParams.toString()).toBe(REQUEST)
    expect(landed.searchParams.get('state')).toBe('a+b/c=d&e%f é')
  })

  it('survives the auth host too, where the return is absolute', () => {
    const absolute = `https://app.aglyn.com/oauth/authorize?${REQUEST}`
    const viaAuthHost = new URL(`https://auth.aglyn.com/signin?${continueParam(encodeURIComponent(absolute))}`)
    const returned = viaAuthHost.searchParams.get('continue') as string
    expect(returned).toBe(absolute)
    expect(isSafeContinueUrl(returned)).toBe(true)
  })

  it('does not become a way off-site: the redirect address inside the query is data, not the destination', () => {
    // The continue value is the console's own path; the client's address
    // rides in its query and is only ever followed by the consent route.
    expect(isSafeContinueUrl(`/oauth/authorize?${REQUEST}`)).toBe(true)
    expect(isSafeContinueUrl('https://claude.ai/api/mcp/auth_callback?code=x')).toBe(false)
    expect(isSafeContinueUrl('//claude.ai/api/mcp/auth_callback')).toBe(false)
  })
})
