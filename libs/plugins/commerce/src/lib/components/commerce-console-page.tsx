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

import type { ConsolePluginPageProps } from '@aglyn/aglyn'
import { GridItems } from '@aglyn/shared-ui-jsx'
import { HubSections } from '@aglyn/shared-ui-next'
import type { ReactNode } from 'react'
import type { CommerceConsoleSectionId } from './commerce-console-sections'
import CatalogOrganizationCard from './console/catalog-organization-card.component'
import CommerceAnalyticsCard from './console/commerce-analytics-card.component'
import DiscountsCard from './console/discounts-card.component'
import GiftCardsCard from './console/gift-cards-card.component'
import HostCouponsCard from './console/host-coupons-card.component'
import HostOrdersCard from './console/host-orders-card.component'
import LocationsCard from './console/locations-card.component'
import MemberPostsCard from './console/member-posts-card.component'
import PaymentsSettingsCard from './console/payments-settings-card.component'
import ProductsHubCard from './console/products-hub-card.component'
import RecoveryQueueCard from './console/recovery-queue-card.component'
import RegistersCard from './console/registers-card.component'
import ReservationsCard from './console/reservations-card.component'
import ReviewsModerationCard from './console/reviews-moderation-card.component'
import ShippingSettingsCard from './console/shipping-settings-card.component'
import StockMovementsCard from './console/stock-movements-card.component'
import StoreSettingsCard from './console/store-settings-card.component'
import StorefrontTaxSummaryCard from './console/storefront-tax-summary-card.component'
import SuppliersCard from './console/suppliers-card.component'
import TaxSettingsCard from './console/tax-settings-card.component'

/**
 * The body of one commerce section, built only when that section is the one
 * being read (AGL-693).
 *
 * A function rather than a map of nodes on purpose: a `Record<id, ReactNode>`
 * would CONSTRUCT all six every render, and each card opens its Firestore
 * listens on mount — which is the entire cost this page exists to stop paying.
 * Only the returned branch is ever built.
 */
function sectionBody(
  section: CommerceConsoleSectionId,
  hostId: string,
): ReactNode {
  switch (section) {
    case 'catalog':
      return (
        <GridItems
          spacing={3}
          items={[
            { size: { xs: 12 }, children: <ProductsHubCard hostId={hostId} /> },
            {
              size: { xs: 12 },
              children: <CatalogOrganizationCard hostId={hostId} />,
            },
            // The ledger every stock writer fills and nothing displayed
            // (AGL-2341). Directly under the catalog, because the question
            // it answers — "why does this count disagree with the shelf" —
            // is asked while looking at the count.
            {
              size: { xs: 12 },
              children: <StockMovementsCard hostId={hostId} />,
            },
            { size: { xs: 12 }, children: <MemberPostsCard hostId={hostId} /> },
          ]}
        />
      )
    case 'orders':
      return (
        <GridItems
          spacing={3}
          items={[
            { size: { xs: 12 }, children: <HostOrdersCard hostId={hostId} /> },
            // The two queues that feed orders rather than record them
            // (AGL-2227): checkouts that stalled and shoppers waiting on
            // stock. Beneath the orders list because both are pre-order.
            {
              size: { xs: 12 },
              children: <RecoveryQueueCard hostId={hostId} />,
            },
          ]}
        />
      )
    case 'promotions':
      return (
        <GridItems
          spacing={3}
          items={[
            { size: { xs: 12 }, children: <DiscountsCard hostId={hostId} /> },
            { size: { xs: 12 }, children: <HostCouponsCard hostId={hostId} /> },
            // Store credit lives with the other money-off surfaces
            // (AGL-2226) — it had no console anywhere before this.
            { size: { xs: 12 }, children: <GiftCardsCard hostId={hostId} /> },
            {
              size: { xs: 12 },
              children: <ReviewsModerationCard hostId={hostId} />,
            },
          ]}
        />
      )
    case 'reservations':
      return <ReservationsCard hostId={hostId} />
    case 'settings':
      return (
        <GridItems
          spacing={3}
          items={[
            {
              size: { xs: 12 },
              children: <PaymentsSettingsCard hostId={hostId} />,
            },
            {
              size: { xs: 12 },
              children: <StoreSettingsCard hostId={hostId} />,
            },
            { size: { xs: 12 }, children: <TaxSettingsCard hostId={hostId} /> },
            { size: { xs: 12 }, children: <LocationsCard hostId={hostId} /> },
            { size: { xs: 12 }, children: <RegistersCard hostId={hostId} /> },
            {
              size: { xs: 12 },
              children: <ShippingSettingsCard hostId={hostId} />,
            },
            { size: { xs: 12 }, children: <SuppliersCard hostId={hostId} /> },
          ]}
        />
      )
    case 'analytics':
      return (
        // Two cards since AGL-2440. The tax summary lives here rather
        // than under Settings → Tax because that tab CONFIGURES tax and
        // this REPORTS what was collected — a merchant reading a figure
        // they may file from should not be one field away from changing
        // the rate that produced it.
        <GridItems
          spacing={3}
          items={[
            {
              size: { xs: 12 },
              children: <CommerceAnalyticsCard hostId={hostId} />,
            },
            {
              size: { xs: 12 },
              children: <StorefrontTaxSummaryCard hostId={hostId} />,
            },
          ]}
        />
      )
    default:
      return null
  }
}

/**
 * Commerce console page (AGL-395): the Products management surface, owned by
 * the commerce plugin and rendered by the shell's generic plugin route. The
 * product editor's media browser is supplied by the shell's
 * ConsoleMediaPickerProvider (the media library is org/session coupled and
 * stays in the app).
 *
 * ## Sections are ROUTES (AGL-693)
 *
 * The six sections hold thirty-two Firestore listens between them, and a tab
 * strip mounts every panel: opening Catalog also subscribed the orders,
 * promotions, reservations, settings and analytics cards. The `limit()` on
 * those queries is the bill — several ask for 500, and one load reached a
 * ceiling of ~4,460 documents to render one tab.
 *
 * `HubTabs lazy` bought that back as a flag somebody has to remember. A URL
 * per section makes it structural instead: the page builds one section's body
 * and the others do not exist to subscribe. Three things come with it that the
 * tab version faked — a section is linkable, the back button walks sections,
 * and which one is open is a fact about the URL rather than state kept in sync
 * with it. `commerce-console-read-cost.spec.tsx` meters it at the Firestore
 * boundary and refuses a section that listens before it is opened.
 *
 * The shell resolves the section, gates it and hands back the rail's hrefs;
 * this page only has to say what each section contains.
 */
export function CommerceConsolePage(props: ConsolePluginPageProps) {
  const { hostId, section, sections, basePath } = props

  /*
   * Nothing, deliberately, while the redirect is in flight.
   *
   * Rendering the default section here instead would issue that section's
   * listens on a URL that is about to be replaced — paying for Catalog on
   * every arrival at `/products`, which is every click of the nav tab.
   */
  if (!section || !sections?.length || !basePath) return null

  return (
    <HubSections sections={sections}>
      {sectionBody(section as CommerceConsoleSectionId, hostId)}
    </HubSections>
  )
}
CommerceConsolePage.displayName = 'CommerceConsolePage'

export default CommerceConsolePage
