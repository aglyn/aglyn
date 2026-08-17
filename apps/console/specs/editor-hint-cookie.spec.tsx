/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://app.aglyn.com/"}
 *
 * Pragmas must stay in the FIRST block comment — behind the license header
 * they are silently ignored, and this suite needs the document to live on
 * `app.aglyn.com` or a `Domain=.aglyn.com` cookie write is rejected outright.
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
 * Editor-presence hint cookie (AGL-1829): the console keeps a registrable-
 * domain `aglyn_editor=1` cookie in step with the session so first-party
 * tenant sites can auto-arm the admin bar. Pinned here:
 *
 * - signed in  → the cookie exists;
 * - signed out → the cookie is cleared, including one set earlier;
 * - auth still resolving → NOTHING is written either way (a transient
 *   undefined must not strip a returning editor's hint);
 * - hostname policy: only `aglyn.com` / `aglyn.io` registrable domains ever
 *   carry the hint — localhost and customer domains get null.
 */

import { render } from '@testing-library/react'
import EditorHintCookie, {
  EDITOR_HINT_COOKIE,
  editorHintCookieDomain,
} from '../components/editor-hint-cookie.component'

let mockUser: unknown

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
}))

function clearHintCookie(): void {
  document.cookie = `${EDITOR_HINT_COOKIE}=; Domain=.aglyn.com; Path=/; Max-Age=0`
}

describe('EditorHintCookie (AGL-1829)', () => {
  beforeEach(() => {
    mockUser = undefined
    clearHintCookie()
  })

  it('sets the hint while signed in', () => {
    mockUser = { uid: 'user-1' }
    render(<EditorHintCookie />)
    expect(document.cookie).toContain(`${EDITOR_HINT_COOKIE}=1`)
  })

  it('clears an existing hint when signed out', () => {
    document.cookie = `${EDITOR_HINT_COOKIE}=1; Domain=.aglyn.com; Path=/`
    mockUser = null
    render(<EditorHintCookie />)
    expect(document.cookie).not.toContain(`${EDITOR_HINT_COOKIE}=`)
  })

  it('writes nothing while auth is still resolving', () => {
    document.cookie = `${EDITOR_HINT_COOKIE}=1; Domain=.aglyn.com; Path=/`
    mockUser = undefined
    render(<EditorHintCookie />)
    // The pre-existing hint survives: an unknown verdict must not strip it.
    expect(document.cookie).toContain(`${EDITOR_HINT_COOKIE}=1`)
  })

  it('confines the hint to first-party registrable domains', () => {
    expect(editorHintCookieDomain('app.aglyn.com')).toBe('.aglyn.com')
    expect(editorHintCookieDomain('APP.AGLYN.COM')).toBe('.aglyn.com')
    expect(editorHintCookieDomain('aglyn.com')).toBe('.aglyn.com')
    expect(editorHintCookieDomain('app.aglyn.io')).toBe('.aglyn.io')
    expect(editorHintCookieDomain('localhost')).toBeNull()
    // A customer console domain is customer-DNS territory — never hinted.
    expect(editorHintCookieDomain('console.customer.com')).toBeNull()
    // Lookalike suffixes must not match the endsWith checks.
    expect(editorHintCookieDomain('evilaglyn.com')).toBeNull()
    expect(editorHintCookieDomain('aglyn.com.attacker.net')).toBeNull()
  })
})
