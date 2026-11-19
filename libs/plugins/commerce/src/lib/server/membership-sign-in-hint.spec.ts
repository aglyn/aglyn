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

jest.mock('@aglyn/tenant-data-admin', () => ({ firebaseAdmin: {} }))

import { setMemberCookie } from './membership'

/**
 * The readable sign-in hint beside the member session (AGL-4231): a page that
 * shows "Account" to members reads it before its first paint. It carries
 * nothing; the session stays HttpOnly.
 */
describe('member session cookie with its sign-in hint (AGL-4231)', () => {
  const capture = () => {
    const headers: Record<string, unknown> = {}
    return { headers, res: { setHeader: (name: string, value: unknown) => (headers[name] = value) } as never }
  }

  it('sets the HttpOnly session and a readable "1" beside it, for as long', () => {
    const { headers, res } = capture()
    setMemberCookie(res, 'host-1', 'host-1.m1.123.sig')
    const [session, hint] = headers['Set-Cookie'] as string[]
    expect(session).toMatch(/^aglyn_member_host-1=host-1\.m1\.123\.sig; Path=\/; HttpOnly; SameSite=Lax/)
    expect(hint).toMatch(/^aglyn_signed_in_host-1=1; Path=\/; SameSite=Lax/)
    expect(hint).not.toContain('HttpOnly')
    expect(hint).not.toContain('host-1.m1')
    expect(session.match(/Max-Age=(\d+)/)?.[1]).toBe(hint.match(/Max-Age=(\d+)/)?.[1])
  })

  it('clears both on sign-out', () => {
    const { headers, res } = capture()
    setMemberCookie(res, 'host-1', null)
    const [session, hint] = headers['Set-Cookie'] as string[]
    expect(session).toContain('Max-Age=0')
    expect(hint).toMatch(/^aglyn_signed_in_host-1=; .*Max-Age=0$/)
  })
})
