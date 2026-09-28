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
  planGrantingFeature,
  type ConsoleOrgNavEntry,
  type OrgPermission,
} from '@aglyn/aglyn'
import { buildRoute, Route } from '../constants/route-links'
import {
  resolveExtensionEntitlement,
  resolveUpgradeNoticeAnchor,
} from './extension-entitlement'
import {
  requiredExtensionPermissions,
  resolveExtensionPermission,
} from './extension-permission'

/**
 * The shell's rules for plugin surfaces mounted at the ORGANIZATION level
 * (AGL-2974): the ones an extension declares in `orgNavItems`, served by
 * `app/(app)/[orgSlug]/[...pluginSlug]/page.tsx` and listed on the org strip.
 *
 * Pure, so the tab strip and the page answer from the same functions and a
 * spec can pin both without mounting either.
 */

/** Whether a reader's reach admits an organization-level surface at all. */
export type OrgPluginReach = 'granted' | 'refused' | 'pending'

/**
 * REACH FIRST, and on its own — the rule `resolveOrgCrmAccess` states for
 * the CRM's org hub, applied to every surface mounted with no site.
 *
 * A site collaborator is a real org member whose role can carry any
 * permission, so no permission answers whether they may open a surface that
 * reads across every site. `orgWide` fails OPEN while memberships load, which
 * is why an unready reach is `pending` rather than believed.
 */
export function resolveOrgPluginReach(input: {
  orgWide: boolean
  reachReady: boolean
}): OrgPluginReach {
  if (!input.reachReady) return 'pending'
  return input.orgWide ? 'granted' : 'refused'
}

/** What a site collaborator is told on an organization-level surface. */
export function orgPluginScopedNotice(surfaceTitle: string): string {
  return (
    `${surfaceTitle} covers the whole organization. Your access is limited ` +
    "to the sites you've been added to."
  )
}

/**
 * Whether a refusal for this surface's entitlement has anything to offer.
 *
 * A site tab stays visible on a plan without its feature because the notice
 * behind it is the way to buy the feature. That holds only while something
 * sells it: a plan that includes it, or a billing card the extension names.
 * An entitlement no plan carries and no card sells is granted per
 * organization, and a tab leading to a refusal with nothing to sell is a tab
 * the organization cannot use.
 */
export function orgPluginRefusalSellsSomething(
  extension: ConsoleOrgNavEntry['extension'],
): boolean {
  const { featureFlag, upgradeNotice } = extension
  if (!featureFlag) return true
  return (
    planGrantingFeature(featureFlag) !== undefined ||
    resolveUpgradeNoticeAnchor(upgradeNotice) !== undefined
  )
}

export interface OrgPluginTabAnswers {
  /** `useOrgPermissions().can`. */
  can: (permission: OrgPermission) => boolean
  /** `useOrgPermissions().permissions` — where plugin-declared keys answer. */
  permissions: Record<string, boolean | undefined> | undefined
  /** `useOrgPermissions().loaded`. */
  permissionsLoaded: boolean
  /** `useCurrentOrg().org` and `.ready`. */
  org: unknown
  orgReady: boolean
}

/** One tab of the org strip, the shape `orgNavTabItems` returns. */
export interface OrgPluginNavTab {
  id: string
  label: string
  href: string
  /**
   * The tab is holding its place while the member read settles: drawn, but
   * not yet something to open. Absent on a tab the reader may open.
   */
  disabled?: boolean
}

/**
 * The org strip's plugin tabs: every `orgNavItems` entry the reader may open.
 *
 * A tab is dropped when the member's settled permissions refuse the surface,
 * or when the organization's settled plan refuses it and the refusal would
 * sell nothing (see {@link orgPluginRefusalSellsSomething}).
 *
 * The two unsettled verdicts are NOT treated alike, because they are not
 * alike. A PENDING PLAN drops the tab: most organizations are not entitled
 * to a given plugin, so drawing it early would be a tab that appears and then
 * disappears for most readers. A PENDING PERMISSION, once the plan has
 * answered, keeps the tab in its place as a disabled placeholder: the
 * organization has the surface, the member read is the slower of the two on
 * a cold load, and dropping the tab for the length of that read tells the
 * owner, who is the reader most likely to be holding the link, that the
 * surface is gone. A placeholder promises nothing it cannot keep; it becomes
 * the live tab, or leaves, when the member's role is known.
 *
 * The RELEASE flag is not answered here: the tab carries the nav item's
 * `navTabId` as its id, and the secondary nav bar hides it by that id (or
 * badges it for staff), exactly as it does every flagged tab.
 *
 * Linked at the landing section, as the site strip links its plugin tabs,
 * so the common path skips the bare-href redirect.
 */
export function orgPluginNavTabItems(
  orgSlug: string,
  entries: readonly ConsoleOrgNavEntry[],
  answers: OrgPluginTabAnswers,
): OrgPluginNavTab[] {
  return entries.flatMap(({ extension, navItem }) => {
    const permission = resolveExtensionPermission(
      requiredExtensionPermissions(extension, navItem),
      {
        can: answers.can,
        permissions: answers.permissions,
        loaded: answers.permissionsLoaded,
      },
    )
    if (permission === 'refused') return []
    const entitlement = resolveExtensionEntitlement(
      extension.featureFlag,
      answers.org,
      answers.orgReady,
    )
    if (entitlement === 'pending') return []
    if (
      entitlement === 'blocked' &&
      !orgPluginRefusalSellsSomething(extension)
    ) {
      return []
    }
    const slug = navItem.href.replace(/^\//, '')
    const tab: OrgPluginNavTab = {
      id:
        navItem.navTabId ??
        `nav-org-plugin-${navItem.href.replace(/[^\w]+/g, '-')}`,
      label: navItem.label,
      href: buildRoute(Route.ORG_PLUGIN, {
        orgSlug,
        pluginSlug: [
          slug,
          ...(navItem.sections?.length ? [navItem.sections[0].id] : []),
        ].join('/'),
      }),
    }
    return [permission === 'pending' ? { ...tab, disabled: true } : tab]
  })
}
