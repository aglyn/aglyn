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
'use client'

import { usePathname } from 'next/navigation'
import { useMemo } from 'react'
import { useEnabledPluginIds } from '../components/console-plugins-gate.component'
import { useHostId, useHostReady } from '../components/host-id-provider'
import adminNavTabItems from '../constants/admin-nav-tabs'
import hostNavTabItems from '../constants/host-nav-tabs'
import manageNavTabItems from '../constants/manage-nav-tabs'
import useIsStaff from './use-is-staff'
import useOrgNavTabItems from './use-org-nav-tabs'
import { useOrgReach } from './use-org-reach'
import { useOrgScope } from './use-org-scope'

export interface NavTabItem {
  id?: string
  label?: string
  href?: string
}

export type NavSectionKind = 'host' | 'org' | 'admin' | 'manage' | 'none'

export interface NavSection {
  kind: NavSectionKind
  /** The path the section's tab hrefs are relative to ('' when none). */
  base: string
  orgSlug?: string
  host?: string
}

const segmentsOf = (path: string) => path.split('/').filter(Boolean)

/**
 * Which tab strip a path belongs to (AGL-754). Every `navTabItems=` variant
 * the pages used to pass corresponds to exactly one route subtree, so the
 * secondary app bar can derive its own strip from the URL instead of being
 * fed by whichever page happens to be mounted.
 *
 * `/[orgSlug]/hosts` is the org "Sites" tab, but `/[orgSlug]/hosts/[host]` is
 * a site — the host branch needs the third segment, not just `hosts`.
 */
export function resolveNavSection(pathname: string | null): NavSection {
  const segments = segmentsOf(pathname ?? '')
  const [first, second, third] = segments
  if (!first) return { kind: 'none', base: '' }
  if (first === 'admin') return { kind: 'admin', base: '/admin' }
  if (first === 'manage') return { kind: 'manage', base: '/manage' }
  if (second === 'hosts' && third) {
    return {
      kind: 'host',
      base: `/${first}/hosts/${third}`,
      orgSlug: first,
      host: third,
    }
  }
  return { kind: 'org', base: `/${first}`, orgSlug: first }
}

/**
 * The tab a path selects, as the matching item's `href` (what
 * `AppLinkTabsComponent` compares against).
 *
 * Matches on the first route SEGMENT below the section base, not by longest
 * prefix: the Screens tab is `…/screens/list` while a screen detail page is
 * `…/screens/[screenId]/versions/[versionId]/view`, so a prefix test selects
 * the Dashboard tab (the only href that is still a prefix) or nothing at all.
 * A tab with no segment below the base — the host Dashboard — is the match
 * only when the path has none either.
 */
export function resolveActiveTab(
  pathname: string | null,
  base: string,
  items: NavTabItem[],
): string | undefined {
  if (!pathname) return undefined
  const relative = (path: string) =>
    path === base || path.startsWith(`${base}/`)
      ? segmentsOf(path.slice(base.length))[0]
      : undefined

  if (!(pathname === base || pathname.startsWith(`${base}/`))) return undefined
  const segment = relative(pathname)
  return items.find((item) => item.href && relative(item.href) === segment)
    ?.href
}

/** What the route's org/site segments have resolved to, so far. */
export interface SectionScope {
  /** True once the user's org list has loaded. */
  orgsLoaded: boolean
  /** Slugs of the orgs the user belongs to. */
  knownOrgSlugs: string[]
  /** True once subdomain→doc-id resolution has settled (true off sites). */
  hostResolved: boolean
  /** True when the URL's subdomain resolved to a site. */
  hostFound: boolean
}

/**
 * Whether a section names something the user can actually open.
 *
 * `/[orgSlug]` is the only top-level dynamic segment in the `(app)` group, so
 * ANY unrecognised path — `/login` while signed in, a dead bookmark — matches
 * it and renders the not-found page. Without this check the bar happily builds
 * an org strip for it, with every tab pointing at `/login/hosts` and friends.
 *
 * Unresolved counts as addressable: the strip must not blink out while the org
 * list or the subdomain lookup is still in flight, which is the whole point of
 * hoisting the bar in the first place (AGL-755).
 */
export function isAddressableSection(
  section: NavSection,
  scope: SectionScope,
): boolean {
  if (section.kind === 'org') {
    return (
      !scope.orgsLoaded || scope.knownOrgSlugs.includes(section.orgSlug ?? '')
    )
  }
  if (section.kind === 'host') {
    return !scope.hostResolved || scope.hostFound
  }
  return true
}

/**
 * The secondary app bar's strip for the current route. Mounted once in the
 * `(app)` layout, so it must not depend on anything a page provides.
 */
export function useSecondaryNav(): {
  navTabItems: NavTabItem[]
  activeTab: string | undefined
  section: NavSection
} {
  const pathname = usePathname()
  const section = useMemo(() => resolveNavSection(pathname), [pathname])
  // Hooks can't be called conditionally, so the org strip is always built;
  // it is only handed out on org routes.
  const orgNavTabItems = useOrgNavTabItems()
  const { orgs, loading: orgsLoading } = useOrgScope()
  const hostResolved = useHostReady()
  const hostId = useHostId()
  // Scopes the plugin-contributed tabs to this workspace (AGL-758).
  const enabledPluginIds = useEnabledPluginIds()
  const isStaff = useIsStaff()
  // A site collaborator gets no org strip at all (AGL-1032) — the tab set is
  // the one place to do this, since the bar mounts once for every route.
  const { orgWide, ready: reachReady } = useOrgReach()

  const addressable = useMemo(
    () =>
      isAddressableSection(section, {
        orgsLoaded: !orgsLoading,
        knownOrgSlugs: orgs
          .map((org) => org.slug)
          .filter((slug): slug is string => Boolean(slug)),
        hostResolved,
        hostFound: Boolean(hostId),
      }),
    [section, orgs, orgsLoading, hostResolved, hostId],
  )

  const navTabItems = useMemo(() => {
    if (!addressable) return []
    switch (section.kind) {
      case 'host':
        return hostNavTabItems(
          section.orgSlug ?? '',
          section.host ?? '',
          enabledPluginIds,
        )
      case 'org':
        // Sites, Team, Media, Data, Billing, Settings — none of which a
        // scoped collaborator may open (AGL-1032). They are being redirected
        // into their site anyway; publishing the tabs on the way out just
        // advertises pages that answer with nothing. Unresolved reach keeps
        // the strip, like every other check here: the bar must not blink out
        // while memberships load (AGL-755).
        return reachReady && !orgWide ? [] : orgNavTabItems
      case 'admin':
        // Staff-claim gated (AGL-953). StaffGuard/StaffOnly 404 the PAGES,
        // but the strip rendered for anyone who typed an /admin URL, which
        // published the name of every internal tool and made the 404 read
        // as a broken link rather than a refusal. `null` (claim still
        // resolving) yields nothing, so neither audience gets a flash of
        // the wrong strip.
        return isStaff === true ? adminNavTabItems() : []
      case 'manage':
        return manageNavTabItems()
      default:
        return []
    }
  }, [
    addressable,
    section,
    orgNavTabItems,
    enabledPluginIds,
    isStaff,
    orgWide,
    reachReady,
  ])

  const activeTab = useMemo(
    () => resolveActiveTab(pathname, section.base, navTabItems),
    [pathname, section.base, navTabItems],
  )

  return { navTabItems, activeTab, section }
}

export default useSecondaryNav
