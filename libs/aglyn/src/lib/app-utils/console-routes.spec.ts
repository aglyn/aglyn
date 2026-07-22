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

import { buildRoute, Route, routeReplacePattern } from './console-routes'

/**
 * These assert the PRODUCED STRINGS, not that `buildRoute` was called
 * (AGL-685). The outbound sweep repointed ~30 hand-built paths at this
 * table; if the table itself emits the wrong shape, every one of them goes
 * wrong at once and nothing else in the suite would notice.
 */
describe('buildRoute', () => {
  it('builds the org-scoped host routes the console actually serves', () => {
    expect(buildRoute(Route.ORG_HOME, { orgSlug: 'acme' })).toBe('/acme')
    expect(buildRoute(Route.HOST_LIST, { orgSlug: 'acme' })).toBe('/acme/hosts')
    expect(
      buildRoute(Route.HOST_DASHBOARD, { orgSlug: 'acme', host: 'shop' }),
    ).toBe('/acme/hosts/shop')
    expect(
      buildRoute(Route.HOST_SETUP, { orgSlug: 'acme', host: 'shop' }),
    ).toBe('/acme/hosts/shop/setup')
    expect(buildRoute(Route.MANAGE_BILLING, { orgSlug: 'acme' })).toBe(
      '/acme/billing',
    )
    expect(buildRoute(Route.ORG_DATA, { orgSlug: 'acme' })).toBe('/acme/data')
  })

  it('builds the plugin catch-all route both the nav and the page use', () => {
    // hostNavTabItems and the [pluginSlug] page's activeTab must agree
    // character for character or the tab bar loses its selection (AGL-649).
    expect(
      buildRoute(Route.HOST_PLUGIN, {
        orgSlug: 'acme',
        host: 'shop',
        pluginSlug: 'products',
      }),
    ).toBe('/acme/hosts/shop/products')
    expect(
      buildRoute(Route.HOST_PLUGIN, {
        orgSlug: 'acme',
        host: 'shop',
        pluginSlug: 'pos',
      }),
    ).toBe('/acme/hosts/shop/pos')
  })

  it('builds the community routes plugin components link to', () => {
    expect(
      buildRoute(Route.HOST_COMMUNITY, { orgSlug: 'acme', host: 'shop' }),
    ).toBe('/acme/hosts/shop/community')
    expect(
      buildRoute(Route.HOST_COMMUNITY_LISTING, {
        orgSlug: 'acme',
        host: 'shop',
        listingId: 'listing-1',
      }),
    ).toBe('/acme/hosts/shop/community/listing-1')
    expect(
      buildRoute(Route.HOST_COMMUNITY_PUBLISHER, {
        orgSlug: 'acme',
        host: 'shop',
        profileId: 'org-9',
      }),
    ).toBe('/acme/hosts/shop/community/publisher/org-9')
  })

  it('builds the besigner deep link the email plugin jumps to', () => {
    expect(
      buildRoute(Route.SCREEN_BESIGNER, {
        orgSlug: 'acme',
        host: 'shop',
        screenId: 'screen-1',
        versionId: 'v2',
      }),
    ).toBe('/acme/hosts/shop/screens/screen-1/versions/v2/besigner')
  })

  it('leaves param-less routes alone', () => {
    expect(buildRoute(Route.AUTH_SIGN_IN)).toBe('/signin')
    expect(buildRoute(Route.ADMIN_ORGS)).toBe('/admin/orgs')
    expect(buildRoute(Route.MANAGE_MY_COMMUNITY)).toBe('/manage/community')
  })

  it('marks a missing param instead of emitting a plausible-looking path', () => {
    // The `<param?>` marker is deliberate: a silently-dropped segment would
    // produce `/hosts/shop/setup`, which LOOKS like a route and 404s. This
    // is only reachable at runtime — the payload types make it a compile
    // error at every call site.
    expect(
      buildRoute(Route.HOST_SETUP, { orgSlug: 'acme' } as any),
    ).toBe('/acme/hosts/<host?>/setup')
  })

  it('has no route template with an unreplaced parameter left over', () => {
    for (const template of Object.values(Route)) {
      const params = [...template.matchAll(routeReplacePattern)].map(
        (match) => match[1],
      )
      const payload = Object.fromEntries(params.map((key) => [key, 'x']))
      expect(buildRoute(template as any, payload as any)).not.toContain('[')
      expect(buildRoute(template as any, payload as any)).not.toContain('?>')
    }
  })

  it('every Route is org-scoped unless it is an account, staff or auth route', () => {
    // The AGL-621 invariant, asserted rather than assumed: any console route
    // that is not explicitly apex-level must carry `[orgSlug]` as its first
    // segment. A new route that forgets it is the exact regression this
    // sweep was cleaning up after.
    const apexPrefixes = ['/manage', '/admin', '/signin', '/signout', '/signup', '/verify-email']
    for (const template of Object.values(Route)) {
      if (apexPrefixes.some((prefix) => template.startsWith(prefix))) continue
      expect(template.startsWith('/[orgSlug]')).toBe(true)
    }
  })
})
