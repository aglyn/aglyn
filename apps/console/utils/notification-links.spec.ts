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
  normalizeNotificationLink,
  resolveNotificationOrgSlug,
} from './notification-links'

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

/**
 * Which workspace a notification's link belongs to (AGL-1773).
 *
 * The bug this pins: host notifications carried no `orgId`, so both surfaces
 * fell straight through to the org the reader had OPEN. Combined with the
 * cross-org subdomain resolution from AGL-672, that produced a link whose
 * host half was right and whose org half was wrong —
 * `/{other-org}/hosts/{subdomain}/inbox` — and `HostGuard` 404s it, because
 * it only resolves subdomains inside the current org.
 */
describe('resolveNotificationOrgSlug (AGL-1773)', () => {
  const slugForOrgId = (orgId: string) =>
    ({ 'org-a': 'acme', 'org-b': 'beta' })[orgId]

  it('prefers the org the emitter stamped', () => {
    expect(
      resolveNotificationOrgSlug(
        { orgId: 'org-b' },
        { slugForOrgId, indexedOrgId: 'org-a', currentOrgSlug: 'acme' },
      ),
    ).toBe('beta')
  })

  /**
   * The load-bearing case, and the one the server-side stamp cannot reach:
   * a notification written before AGL-1773 has no `orgId` of its own, and the
   * reader is standing in a different workspace. Resolving from `hostIndex`
   * repairs the entire stored backlog.
   */
  it('falls back to the host index rather than to the open workspace', () => {
    expect(
      resolveNotificationOrgSlug(
        { orgId: undefined },
        { slugForOrgId, indexedOrgId: 'org-b', currentOrgSlug: 'acme' },
      ),
    ).toBe('beta')
  })

  it('uses the open workspace only when nothing else resolves', () => {
    expect(
      resolveNotificationOrgSlug({}, { slugForOrgId, currentOrgSlug: 'acme' }),
    ).toBe('acme')
  })

  /**
   * An org the reader is not a member of has no slug to offer. Falling
   * through is right; splicing the raw id into the path would build a URL
   * that looks canonical and is not.
   */
  it('falls through an org id it cannot map to a slug', () => {
    expect(
      resolveNotificationOrgSlug(
        { orgId: 'org-unknown' },
        { slugForOrgId, indexedOrgId: 'org-b', currentOrgSlug: 'acme' },
      ),
    ).toBe('beta')
    expect(
      resolveNotificationOrgSlug(
        { orgId: 'org-unknown' },
        { slugForOrgId, currentOrgSlug: 'acme' },
      ),
    ).toBe('acme')
  })

  it('resolves to nothing when there is no workspace at all', () => {
    expect(resolveNotificationOrgSlug({}, { slugForOrgId })).toBeUndefined()
  })
})
