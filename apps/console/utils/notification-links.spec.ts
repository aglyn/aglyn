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

import { normalizeNotificationLink } from './notification-links'

const ctx = {
  orgSlug: 'acme',
  hostId: 'host-abc123',
  hostSubdomain: 'shop',
}

describe('normalizeNotificationLink', () => {
  it('rewrites legacy /org paths onto the org slug', () => {
    expect(normalizeNotificationLink('/org/billing', ctx)).toBe('/acme/billing')
    expect(normalizeNotificationLink('/org/data', ctx)).toBe('/acme/data')
    expect(normalizeNotificationLink('/org', ctx)).toBe('/acme')
  })

  it('keeps query strings and hashes attached', () => {
    expect(normalizeNotificationLink('/org/billing#addons', ctx)).toBe(
      '/acme/billing#addons',
    )
    expect(normalizeNotificationLink('/org/billing?status=success', ctx)).toBe(
      '/acme/billing?status=success',
    )
  })

  it('rewrites the bare hosts list', () => {
    expect(normalizeNotificationLink('/hosts', ctx)).toBe('/acme/hosts')
  })

  it('rewrites a host doc-id path to the org + subdomain route', () => {
    expect(normalizeNotificationLink('/host-abc123/products', ctx)).toBe(
      '/acme/hosts/shop/products',
    )
    expect(normalizeNotificationLink('/host-abc123', ctx)).toBe(
      '/acme/hosts/shop',
    )
    expect(normalizeNotificationLink('/host-abc123/inbox', ctx)).toBe(
      '/acme/hosts/shop/inbox',
    )
  })

  it('only rewrites the host prefix on an exact doc-id segment match', () => {
    // A different host's id must not be rewritten with this host's subdomain.
    expect(normalizeNotificationLink('/host-other/products', ctx)).toBe(
      '/host-other/products',
    )
    // ...nor a path that merely starts with the same characters.
    expect(normalizeNotificationLink('/host-abc123456/x', ctx)).toBe(
      '/host-abc123456/x',
    )
  })

  it('leaves already-canonical, user-scoped, staff and absolute links alone', () => {
    expect(normalizeNotificationLink('/acme/hosts/shop/inbox', ctx)).toBe(
      '/acme/hosts/shop/inbox',
    )
    expect(normalizeNotificationLink('/manage/marketplace', ctx)).toBe(
      '/manage/marketplace',
    )
    expect(normalizeNotificationLink('/admin/overview', ctx)).toBe(
      '/admin/overview',
    )
    expect(normalizeNotificationLink('https://example.com/x', ctx)).toBe(
      'https://example.com/x',
    )
  })

  it('degrades to the stored link when context is missing', () => {
    expect(normalizeNotificationLink('/org/billing', {})).toBe('/org/billing')
    // hostId known but no subdomain resolved yet — better the stored value
    // than a wrong destination.
    expect(
      normalizeNotificationLink('/host-abc123/products', {
        orgSlug: 'acme',
        hostId: 'host-abc123',
      }),
    ).toBe('/host-abc123/products')
  })

  it('handles empty input', () => {
    expect(normalizeNotificationLink(undefined, ctx)).toBeUndefined()
    expect(normalizeNotificationLink('', ctx)).toBeUndefined()
    expect(normalizeNotificationLink(null, ctx)).toBeUndefined()
  })
})
