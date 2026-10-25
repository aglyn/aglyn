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

import * as Aglyn from '@aglyn/aglyn'
import { mdiWeb } from '@aglyn/shared-data-mdi'
import { lazy } from 'react'
import { BUNDLE_ID } from './constants/bundle-common'

/** Code-split: each card loads only on the page that draws it. */
const BuyDomainCard = lazy(() => import('./components/buy-domain-card.component'))
const ConnectAutomatically = lazy(
  () => import('./components/connect-automatically.component'),
)
const DomainsPage = lazy(() => import('./components/domains-page.component'))

/**
 * Domains' console half (AGL-3962, AGL-3963): widgets on the site's Custom
 * Domain page, gated by core's `customDomain` entitlement (Starter and up).
 *
 * The buy card mounts on every plan with `showWhenNotEntitled`, so a Free
 * site sees what a domain would cost and the plan that includes it rather
 * than nothing at all.
 *
 * And one ORGANIZATION-LEVEL page (AGL-4040), the workspace's Domains page
 * at `/[orgSlug]/domains`, listing every name the workspace holds; each
 * name's own page is `/domains/<name>` beneath it. It carries no
 * `featureFlag`: a workspace on a plan without domains still holds the names
 * it bought, and the page says what the plan stops (buying, connecting)
 * rather than hiding them. Its routes admit workspace owners and admins only.
 */
export function registerDomainsConsole(): void {
  Aglyn.registerConsoleExtension({
    pluginId: BUNDLE_ID,
    displayName: 'Domains',
    widgets: [
      {
        slot: Aglyn.CONSOLE_WIDGET_SLOTS.hostDomain,
        widgetId: 'domains-buy',
        title: 'Get a domain',
        featureFlag: 'customDomain',
        showWhenNotEntitled: true,
        Component: BuyDomainCard,
      },
      {
        slot: Aglyn.CONSOLE_WIDGET_SLOTS.hostDomainConnect,
        widgetId: 'domains-connect-automatically',
        title: 'Connect automatically',
        featureFlag: 'customDomain',
        Component: ConnectAutomatically,
      },
    ],
    orgNavItems: [
      {
        label: 'Domains',
        href: '/domains',
        ownsSubtree: true,
        recordTitle: 'Domain',
        icon: { path: mdiWeb.path },
        header: { title: 'Domains', icon: { path: mdiWeb.path }, docsTopic: 'manageDomains' },
        Component: DomainsPage,
      },
    ],
  })
}
