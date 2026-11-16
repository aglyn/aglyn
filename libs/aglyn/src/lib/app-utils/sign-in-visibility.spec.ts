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

import {
  markSignedIn,
  nodesUseShowTo,
  resolveShowTo,
  SHOW_TO_ATTRIBUTE,
  SIGN_IN_VISIBILITY_SCRIPT,
  SIGN_IN_VISIBILITY_STYLE,
  SIGNED_IN_ROOT_ATTRIBUTE,
  signedInHintCookieName,
} from './sign-in-visibility'
import { INSTANCE_CARRIED_PROPS, NODE_SHOW_TO_PROP } from './reusable-component-keys'

/** "Show to" signed-in or signed-out visitors (AGL-4231). */
describe('sign-in visibility', () => {
  it('reads only the two audiences; everything else is everyone', () => {
    expect(resolveShowTo('signedIn')).toBe('signedIn')
    expect(resolveShowTo('signedOut')).toBe('signedOut')
    expect(resolveShowTo('everyone')).toBeUndefined()
    expect(resolveShowTo('')).toBeUndefined()
    expect(resolveShowTo('admins')).toBeUndefined()
  })

  it('finds a page that uses it, and only such a page', () => {
    expect(nodesUseShowTo({ a: { props: { showTo: 'everyone' } }, b: { props: {} } })).toBe(false)
    expect(nodesUseShowTo({ a: { props: {} }, b: { props: { showTo: 'signedOut' } } })).toBe(true)
    expect(nodesUseShowTo(undefined)).toBe(false)
  })

  it("names each site's hint the way the session cookie is named", () => {
    expect(signedInHintCookieName('RhISPcOcQd')).toBe('aglyn_signed_in_RhISPcOcQd')
    expect(signedInHintCookieName('a b/c')).toBe('aglyn_signed_in_abc')
  })

  it('hides each audience from the other, overriding the element display', () => {
    expect(SIGN_IN_VISIBILITY_STYLE).toContain(
      `html:not([${SIGNED_IN_ROOT_ATTRIBUTE}]) [${SHOW_TO_ATTRIBUTE}="signedIn"]{display:none!important}`,
    )
    expect(SIGN_IN_VISIBILITY_STYLE).toContain(
      `html[${SIGNED_IN_ROOT_ATTRIBUTE}] [${SHOW_TO_ATTRIBUTE}="signedOut"]{display:none!important}`,
    )
  })

  it('marks <html> only when the hint is set to 1', () => {
    const run = (cookie: string) => {
      const attributes = new Map<string, string>()
      const fakeDocument = {
        cookie,
        documentElement: { setAttribute: (name: string, value: string) => attributes.set(name, value) },
      }
      new Function('document', SIGN_IN_VISIBILITY_SCRIPT)(fakeDocument)
      return attributes.has(SIGNED_IN_ROOT_ATTRIBUTE)
    }
    expect(run('a=b; aglyn_signed_in_RhISPcOcQd=1')).toBe(true)
    expect(run('aglyn_signed_in_RhISPcOcQd=1; other=x')).toBe(true)
    expect(run('aglyn_signed_in_RhISPcOcQd=')).toBe(false)
    expect(run('aglyn_signed_in_RhISPcOcQd=10')).toBe(false)
    expect(run('aglyn_member_RhISPcOcQd=token')).toBe(false)
    expect(run('')).toBe(false)
  })

  it('flips the page without a reload, and does nothing on a server', () => {
    expect(() => markSignedIn(true)).not.toThrow()
    const attributes = new Set<string>()
    ;(globalThis as any).document = {
      documentElement: {
        setAttribute: (name: string) => attributes.add(name),
        removeAttribute: (name: string) => attributes.delete(name),
      },
    }
    try {
      markSignedIn(true)
      expect(attributes.has(SIGNED_IN_ROOT_ATTRIBUTE)).toBe(true)
      markSignedIn(false)
      expect(attributes.has(SIGNED_IN_ROOT_ATTRIBUTE)).toBe(false)
    } finally {
      delete (globalThis as any).document
    }
  })

  it('rides a component instance onto its root, like the other directives', () => {
    expect(INSTANCE_CARRIED_PROPS).toContain(NODE_SHOW_TO_PROP)
  })
})
