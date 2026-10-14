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

import { checkRedirectDraftContent, readRedirectDraftContent } from './redirect-draft-content'

/**
 * The `redirect` writer's content (AGL-3745), read without the site: one
 * change per item, only the rule's own fields, and the page's validation of
 * what the content gives.
 */
describe('the redirect change content', () => {
  it('reads a create with only what it gives, the status code as a number', () => {
    expect(readRedirectDraftContent({ action: 'create', source: '/old-menu', destination: '/menu' })).toEqual({
      ok: true,
      value: { action: 'create', source: '/old-menu', destination: '/menu' },
    })
    expect(
      readRedirectDraftContent({ action: 'create', source: '/shop', destination: '/store', statusCode: '301', kind: 'prefix' }),
    ).toEqual({ ok: true, value: { action: 'create', source: '/shop', destination: '/store', statusCode: 301, kind: 'prefix' } })
  })

  it('reads an update that changes something and a remove that names only the rule', () => {
    expect(readRedirectDraftContent({ action: 'update', source: '/shop', destination: '/store' }).ok).toBe(true)
    expect(readRedirectDraftContent({ action: 'update', source: '/shop', enabled: false }).ok).toBe(true)
    expect(readRedirectDraftContent({ action: 'remove', source: '/promo', kind: 'exact' }).ok).toBe(true)
  })

  it('refuses a field the rule does not have, and an action it does not know', () => {
    expect(readRedirectDraftContent({ action: 'create', source: '/a', destination: '/b', note: 'x' })).toEqual({
      ok: false,
      problems: ['"note" is not a redirect field'],
    })
    expect(readRedirectDraftContent({ action: 'rename', source: '/a' })).toMatchObject({
      ok: false,
      problems: ['Say whether the redirect is created, updated or removed'],
    })
    expect(readRedirectDraftContent({ action: 'create', source: '/a', destination: '/b', externalDestinationApprovedBy: 'u' }).ok).toBe(false)
  })

  it('asks a create for a destination, an update for a change, and a remove for nothing more', () => {
    expect(readRedirectDraftContent({ action: 'create', source: '/a' })).toMatchObject({
      ok: false,
      problems: ['Destinations are internal paths or https:// URLs'],
    })
    expect(readRedirectDraftContent({ action: 'update', source: '/a' })).toMatchObject({ ok: false })
    expect(readRedirectDraftContent({ action: 'remove', source: '/a', destination: '/b' })).toMatchObject({
      ok: false,
      problems: ['Removing a redirect names only its from-path and, where needed, its match mode'],
    })
    expect(readRedirectDraftContent({ action: 'create', source: '/a', destination: '/b', newSource: '/c' }).ok).toBe(false)
  })

  it('holds what it gives to the page’s validation', () => {
    expect(readRedirectDraftContent({ action: 'create', source: 'https://x.example/a', destination: '/b' })).toMatchObject({
      ok: false,
      problems: ['Enter a site path like /old-page'],
    })
    expect(readRedirectDraftContent({ action: 'create', source: '/a', destination: 'http://insecure.example' })).toMatchObject({
      ok: false,
      problems: ['Destinations are internal paths or https:// URLs'],
    })
    expect(readRedirectDraftContent({ action: 'create', source: '/a', destination: 'https://paypa1.com/' })).toMatchObject({
      ok: false,
      problems: [expect.stringContaining("looks like another company's website")],
    })
    expect(readRedirectDraftContent({ action: 'create', source: '(a', kind: 'regex', destination: '/b' }).ok).toBe(false)
    expect(readRedirectDraftContent({ action: 'create', source: '/a', destination: '/b', statusCode: 303 })).toMatchObject({
      ok: false,
      problems: ['Status codes are 301, 302, 307 or 308'],
    })
    expect(readRedirectDraftContent({ action: 'create', source: '/a', destination: '/b', priority: 1.5 }).ok).toBe(false)
  })

  it('checks with what it says about the change, live', () => {
    expect(checkRedirectDraftContent({ action: 'create', source: '/a', destination: '/b' })).toEqual({
      ok: true,
      facts: { action: 'create', source: '/a', destination: '/b', kind: 'exact', live: true },
    })
    expect(checkRedirectDraftContent({ action: 'remove' }).ok).toBe(false)
  })
})
