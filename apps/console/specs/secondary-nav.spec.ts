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

import adminNavTabItems from '../constants/admin-nav-tabs'
import hostNavTabItems from '../constants/host-nav-tabs'
import manageNavTabItems from '../constants/manage-nav-tabs'
import orgNavTabItems from '../constants/org-nav-tabs'
import { buildRoute, Route } from '../constants/route-links'
import {
  isAddressableSection,
  resolveActiveTab,
  resolveNavSection,
} from '../hooks/use-secondary-nav'

/**
 * The secondary app bar is mounted once in the `(app)` layout and derives its
 * strip from the URL (AGL-754), so these two functions are the whole contract
 * that used to be 41 hand-written `navTabItems=` / `activeTab=` props.
 */

const ORG = 'e2e-bakery'
const HOST = 'demo'

describe('resolveNavSection', () => {
  it('reads a site from the third segment, not just `hosts`', () => {
    expect(resolveNavSection(`/${ORG}/hosts/${HOST}`)).toEqual({
      kind: 'host',
      base: `/${ORG}/hosts/${HOST}`,
      orgSlug: ORG,
      host: HOST,
    })
  })

  it('keeps the site list on the org strip', () => {
    // `/[orgSlug]/hosts` is the org "Sites" tab; only a further segment is
    // a site.
    expect(resolveNavSection(`/${ORG}/hosts`).kind).toBe('org')
  })

  it.each([
    ['/admin/orgs', 'admin'],
    ['/manage/notifications', 'manage'],
    [`/${ORG}/team`, 'org'],
    ['/', 'none'],
  ])('classifies %s as %s', (pathname, kind) => {
    expect(resolveNavSection(pathname).kind).toBe(kind)
  })

  it('treats a null pathname as no section', () => {
    expect(resolveNavSection(null)).toEqual({ kind: 'none', base: '' })
  })
})

describe('resolveActiveTab', () => {
  const hostBase = `/${ORG}/hosts/${HOST}`
  const hostTabs = hostNavTabItems(ORG, HOST)

  it('selects the Dashboard tab only at the section root', () => {
    expect(resolveActiveTab(hostBase, hostBase, hostTabs)).toBe(
      buildRoute(Route.HOST_DASHBOARD, { orgSlug: ORG, host: HOST }),
    )
  })

  it('selects Screens from a screen detail path', () => {
    // The regression this function exists for: the tab href is
    // `…/screens/list`, so a longest-prefix match picks Dashboard — the only
    // href still a prefix of a versions URL.
    const pathname = `${hostBase}/screens/seed-home/versions/seed-home-v1/view`
    expect(resolveActiveTab(pathname, hostBase, hostTabs)).toBe(
      buildRoute(Route.SCREEN_LIST, { orgSlug: ORG, host: HOST }),
    )
  })

  it('selects Components from a component detail path', () => {
    expect(
      resolveActiveTab(`${hostBase}/components/abc123`, hostBase, hostTabs),
    ).toBe(buildRoute(Route.HOST_COMPONENTS, { orgSlug: ORG, host: HOST }))
  })

  it('selects the org Sites tab on the site list', () => {
    expect(
      resolveActiveTab(`/${ORG}/hosts`, `/${ORG}`, orgNavTabItems(ORG)),
    ).toBe(buildRoute(Route.HOST_LIST, { orgSlug: ORG }))
  })

  it('selects an org tab from a nested path', () => {
    expect(
      resolveActiveTab(`/${ORG}/team/uid-123`, `/${ORG}`, orgNavTabItems(ORG)),
    ).toBe(buildRoute(Route.MANAGE_TEAM, { orgSlug: ORG }))
  })

  it('selects an admin tab from a nested staff path', () => {
    expect(
      resolveActiveTab(
        '/admin/orgs/org-1/host/host-1',
        '/admin',
        adminNavTabItems(),
      ),
    ).toBe(buildRoute(Route.ADMIN_ORGS))
  })

  it('selects a manage tab', () => {
    expect(
      resolveActiveTab('/manage/user', '/manage', manageNavTabItems()),
    ).toBe(buildRoute(Route.MANAGE_USER_SETTINGS))
  })

  it('returns nothing when the path is outside the base', () => {
    expect(resolveActiveTab('/other/thing', `/${ORG}`, orgNavTabItems(ORG)))
      .toBeUndefined()
  })

  it('returns nothing for a segment no tab owns', () => {
    // An unknown sub-section must leave the strip unselected rather than
    // fall back to whichever tab happens to be a prefix.
    expect(
      resolveActiveTab(`${hostBase}/not-a-tab`, hostBase, hostTabs),
    ).toBeUndefined()
  })
})

describe('isAddressableSection', () => {
  const resolved = {
    orgsLoaded: true,
    knownOrgSlugs: [ORG],
    hostResolved: true,
    hostFound: true,
  }

  it('rejects an org slug the user does not belong to', () => {
    // `/login` while signed in matches `[orgSlug]` and renders the (app)
    // not-found; without this the bar builds a strip of `/login/…` tabs.
    expect(
      isAddressableSection(resolveNavSection('/login'), resolved),
    ).toBe(false)
  })

  it('accepts a real org slug', () => {
    expect(isAddressableSection(resolveNavSection(`/${ORG}/team`), resolved))
      .toBe(true)
  })

  it('holds the strip while the org list is still loading', () => {
    // Hiding it here would reintroduce the blink the hoist exists to remove.
    expect(
      isAddressableSection(resolveNavSection('/login'), {
        ...resolved,
        orgsLoaded: false,
        knownOrgSlugs: [],
      }),
    ).toBe(true)
  })

  it('rejects a subdomain that resolved to no site', () => {
    expect(
      isAddressableSection(resolveNavSection(`/${ORG}/hosts/nope`), {
        ...resolved,
        hostFound: false,
      }),
    ).toBe(false)
  })

  it('holds the strip while the subdomain is still resolving', () => {
    expect(
      isAddressableSection(resolveNavSection(`/${ORG}/hosts/${HOST}`), {
        ...resolved,
        hostResolved: false,
        hostFound: false,
      }),
    ).toBe(true)
  })

  it.each(['/admin/orgs', '/manage/user'])(
    'never gates the staff or personal strips (%s)',
    (pathname) => {
      expect(
        isAddressableSection(resolveNavSection(pathname), {
          orgsLoaded: true,
          knownOrgSlugs: [],
          hostResolved: true,
          hostFound: false,
        }),
      ).toBe(true)
    },
  )
})
