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

import { mdiBellOutline } from '@aglyn/shared-data-mdi'
import { Container } from '@aglyn/shared-ui-jsx'
import {
  HubSections,
  useActiveSection,
} from '@aglyn/shared-ui-next/components/hub-tabs'
import type { ReactNode } from 'react'
import DashboardLayout from '../../../../../components/layouts/dashboard.layout'
import {
  NOTIFICATION_SECTIONS,
  type NotificationSection,
} from '../../../../../constants/notification-sections'
import { buildRoute, Route } from '../../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../../constants/shared'

/**
 * Notifications, section by section (AGL-3230).
 *
 * The preferences were a third tab in the app bar's Manage strip, beside
 * Notifications and Manage Account. That strip names the console's personal
 * AREAS, and the settings for one area are not a third area — listed there,
 * a thing and its own settings sat side by side at the same rank, which is
 * the one relationship the strip cannot express.
 *
 * The rail is what the console uses everywhere this shape occurs: Manage
 * Account's six sections, a site's Admin hub, an organization's Settings. It
 * says the two pages belong to one area and which of them you are on, and it
 * costs the feed nothing — `HubSections` routes rather than mounting panels,
 * so the settings page's reads do not run for a reader who came for the feed.
 */
export default function NotificationSectionsLayout({
  children,
}: {
  children: ReactNode
}) {
  // One list, read three times — by the rail, by the breadcrumb and by the
  // help icon — so a section added to it is named by all three rather than by
  // somebody remembering three copies.
  // Typed back to the richer row `useActiveSection` was handed: it resolves
  // over `HubSection`, which knows nothing of `id` or `anchor`, and returns
  // the very object it was given.
  const active = useActiveSection(
    NOTIFICATION_SECTIONS,
  ) as NotificationSection | null

  return (
    <DashboardLayout
      breadcrumbItems={[
        {
          children: 'Notifications',
          href: buildRoute(Route.MANAGE_NOTIFICATIONS),
        },
        // The section the reader is actually on. Without it the trail names
        // every level except theirs — the one that says where they are. The
        // feed IS the area's own route, so it would repeat itself.
        ...(active && active.id !== 'feed'
          ? [{ children: active.label, href: active.href }]
          : []),
      ]}
      header={{
        children: 'Notifications',
        icon: { path: mdiBellOutline.path },
      }}
      help={{
        topic: 'consoleTour',
        anchor: (active ?? NOTIFICATION_SECTIONS[0]).anchor,
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <HubSections sections={NOTIFICATION_SECTIONS}>{children}</HubSections>
      </Container>
    </DashboardLayout>
  )
}
