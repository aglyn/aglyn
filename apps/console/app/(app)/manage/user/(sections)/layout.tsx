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

import { ICON_VARIANT_APP_SETTINGS } from '@aglyn/shared-data-enums'
import { Container } from '@aglyn/shared-ui-jsx'
import {
  HubSections,
  useActiveSection,
} from '@aglyn/shared-ui-next/components/hub-tabs'
import type { ReactNode } from 'react'
import DashboardLayout from '../../../../../components/layouts/dashboard.layout'
import { ACCOUNT_SECTIONS } from '../../../../../constants/account-sections'
import { buildRoute, Route } from '../../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../../constants/shared'
import useAccountSignInMethods from '../../../../../hooks/use-account-sign-in-methods'

/**
 * Manage Account, section by section (AGL-693).
 *
 * The six areas were `HubTabs` panels on one route, and `HubTabs` mounts every
 * panel it is given — `keepMounted`, with `lazy` off by default and passed by
 * nobody. So opening Account also mounted the email-addresses card, the
 * passkeys card, the recent-sign-ins card, the data-export card and the
 * close-account card, and ran every read inside them. As routes, Next mounts
 * one page and code-splits per route: an unopened section costs neither a read
 * nor a byte.
 */
export default function AccountSectionsLayout({
  children,
}: {
  children: ReactNode
}) {
  const { securityApplies } = useAccountSignInMethods()
  /*
   * One list, read twice — by the rail and by the breadcrumb. Hoisted so
   * `useActiveSection` resolves against the same array the rail highlights: a
   * section added here is named in the trail by construction, rather than by
   * somebody remembering a second copy.
   */
  const sections = ACCOUNT_SECTIONS.map((section) => ({
    href: section.href,
    label: section.label,
    /*
     * Security is conditional (AGL-662), and only Security is.
     *
     * It needs a password to change or passkeys to manage, and an
     * SSO-governed account with no password has neither — passkeys are
     * project-pool only and the customer's IdP owns the credentials.
     * Offering a section that will immediately redirect is the same
     * dead end the old tab had, moved into the URL bar.
     *
     * The route guards itself on the same answer rather than trusting
     * this, so typing the URL is refused as well as unlisted.
     */
    visible: section.id === 'security' ? securityApplies : undefined,
  }))
  const active = useActiveSection(sections)

  return (
    <DashboardLayout
      breadcrumbItems={[
        {
          children: 'Manage Account',
          href: buildRoute(Route.MANAGE_USER_SETTINGS),
        },
        // The section the reader is actually on. Without it the trail names
        // every level except theirs — the one that says where they are.
        ...(active ? [{ children: active.label, href: active.href }] : []),
      ]}
      help="account"
      header={{
        children: 'Manage Account',
        icon: { path: ICON_VARIANT_APP_SETTINGS.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <HubSections sections={sections}>{children}</HubSections>
      </Container>
    </DashboardLayout>
  )
}
