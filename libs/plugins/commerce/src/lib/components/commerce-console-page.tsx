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
import {
  COMMERCE_SETTINGS_PAGE_ZONES,
  type CommerceConsoleSectionId,
  type CommerceSettingsSectionId,
} from './commerce-console-sections'
import CatalogOrganizationCard from './console/catalog-organization-card.component'
import CommerceAnalyticsCard from './console/commerce-analytics-card.component'
import CustomerNotificationsCard from './console/customer-notifications-card.component'
import DiscountsCard from './console/discounts-card.component'
import GiftCardsCard from './console/gift-cards-card.component'
import HostCouponsCard from './console/host-coupons-card.component'
import HostOrdersCard from './console/host-orders-card.component'
import LocationsCard from './console/locations-card.component'
import LocalDeliverySettingsCard from './console/local-delivery-settings-card.component'
import PickupDeliveryQueueCard from './console/pickup-delivery-queue-card.component'
import MemberPostsCard from './console/member-posts-card.component'
import OrderWebhooksCard from './console/order-webhooks-card.component'
import PaymentsSettingsCard from './console/payments-settings-card.component'
import PosCheckInsCard from './console/pos-ops/pos-check-ins-card.component'
import PosDayTotalsCard from './console/pos-ops/pos-day-totals-card.component'
import PosShiftHistoryCard from './console/pos-ops/pos-shift-history-card.component'
import PosStaffPinsCard from './console/pos-ops/pos-staff-pins-card.component'
import PaymentMethodsCard from './console/payment-methods-card.component'
import ProductsHubCard from './console/products-hub-card.component'
import RecoveryQueueCard from './console/recovery-queue-card.component'
import RegistersCard from './console/registers-card.component'
import RegisterHardwareCards from './console/register-hardware-card.component'
import PosDevicesCard from './console/pos-devices-card.component'
import PosHardwareCard from './console/pos-hardware-card.component'
import ReservationsCard from './console/reservations-card.component'
import ReturnSettingsCard from './console/return-settings-card.component'
import ReturnsCard from './console/returns-card.component'
import ReviewsModerationCard from './console/reviews-moderation-card.component'
import ReviewSettingsCard from './console/review-settings-card.component'
import ShippingSettingsCard from './console/shipping-settings-card.component'
import ShipStationCard from './console/shipstation-card.component'
import ShippingEasyCard from './console/shippingeasy-card.component'
import StockMovementsCard from './console/stock-movements-card.component'
import StoreSettingsCard from './console/store-settings-card.component'
import StorefrontTaxSummaryCard from './console/storefront-tax-summary-card.component'
import SuppliersCard from './console/suppliers-card.component'
import TaxSettingsCard from './console/tax-settings-card.component'
import { COMMERCE_PROMOTIONS_ZONE } from './console/store-zones'
import { useConsoleWidgetSlot } from '@aglyn/aglyn/app-utils/console-widget-slot-context'

/**
 * A settings page's zone (AGL-3612, AGL-3713): other plugins' settings for
 * the store — label settings, carrier accounts, a tax service — under the
 * page's own cards. One zone per page, from `COMMERCE_SETTINGS_PAGE_ZONES`;
 * Integrations draws `commerceSettings`, where a widget naming no page lands.
 */
function CommerceSettingsZone(props: {
  hostId: string
  page: CommerceSettingsSectionId
}) {
  const WidgetSlot = useConsoleWidgetSlot()
  return WidgetSlot ? (
    <WidgetSlot
      slot={COMMERCE_SETTINGS_PAGE_ZONES[props.page]}
      hostId={props.hostId}
      orgId={undefined}
    />
  ) : null
}

/** One settings page: its cards in order, then its zone (AGL-3713). */
function settingsPage(
  page: CommerceSettingsSectionId,
  hostId: string,
  cards: readonly ReactNode[],
): ReactNode {
  return (
    <GridItems
      spacing={3}
      items={[
        ...cards.map((children) => ({ size: { xs: 12 }, children })),
        {
          size: { xs: 12 },
          children: <CommerceSettingsZone hostId={hostId} page={page} />,
        },
      ]}
    />
  )
}

/**
 * The `commercePromotions` zone (AGL-3640): other plugins' programs beside
 * the store's own money-off surfaces — a rewards program first.
 */
function CommercePromotionsZone(props: { hostId: string }) {
  const WidgetSlot = useConsoleWidgetSlot()
  return WidgetSlot ? (
    <WidgetSlot slot={COMMERCE_PROMOTIONS_ZONE.id} hostId={props.hostId} orgId={undefined} />
  ) : null
}

/**
 * The body of one commerce section, built only when that section is the one
 * being read (AGL-2501).
 *
 * A function rather than a map of nodes on purpose: a `Record<id, ReactNode>`
 * would CONSTRUCT every section every render, and each card opens its Firestore
 * listens on mount — which is the entire cost this page exists to stop paying.
 * Only the returned branch is ever built.
 */
function sectionBody(
  section: CommerceConsoleSectionId,
  hostId: string,
  canManagePos: boolean,
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
            // What to prepare, hand over and drive out (AGL-3624). Renders
            // nothing for a store with no pickup and no local delivery.
            {
              size: { xs: 12 },
              children: <PickupDeliveryQueueCard hostId={hostId} />,
            },
            // The two queues that feed orders rather than record them
            // (AGL-2227): checkouts that stalled and shoppers waiting on
            // stock. Beneath the orders list because both are pre-order.
            {
              size: { xs: 12 },
              children: <RecoveryQueueCard hostId={hostId} />,
            },
            // One day's or one event's totals across every register, shift
            // and cashier (AGL-4037), above the shifts it adds up.
            {
              size: { xs: 12 },
              children: <PosDayTotalsCard hostId={hostId} canManagePos={canManagePos} />,
            },
            // Who is due at the window and who checked in (AGL-4043), beside
            // the day's totals.
            {
              size: { xs: 12 },
              children: <PosCheckInsCard hostId={hostId} canManagePos={canManagePos} />,
            },
            {
              size: { xs: 12 },
              children: <PosShiftHistoryCard hostId={hostId} />,
            },
          ]}
        />
      )
    case 'returns':
      // Returns (AGL-3611); `?return={id}` opens one on arrival.
      return <ReturnsCard hostId={hostId} />
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
            // Who may review, and the review-request email (AGL-3736),
            // beside the queue those reviews land in.
            {
              size: { xs: 12 },
              children: <ReviewSettingsCard hostId={hostId} />,
            },
            {
              size: { xs: 12 },
              children: <CommercePromotionsZone hostId={hostId} />,
            },
          ]}
        />
      )
    case 'reservations':
      return <ReservationsCard hostId={hostId} />
    /*
     * The store's settings, a page each (AGL-3713). They were one `settings`
     * section — every card below in one column — and its old address opens
     * Payments (`COMMERCE_RETIRED_SECTIONS`). Each page is its cards, then
     * the zone where other plugins' cards for that page land.
     */
    case 'payments':
      return settingsPage(section, hostId, [
        <PaymentsSettingsCard key="payments" hostId={hostId} />,
        // What shoppers may pay with (AGL-3629), beside the account the
        // money lands in.
        <PaymentMethodsCard key="methods" hostId={hostId} />,
      ])
    case 'checkout':
      return settingsPage(section, hostId, [
        <StoreSettingsCard key="store" hostId={hostId} />,
        // Whether buyers may ask for a return online (AGL-3611): the store's
        // policy, beside the terms and guest-checkout rules above it.
        <ReturnSettingsCard key="returns" hostId={hostId} />,
      ])
    case 'taxes':
      return settingsPage(section, hostId, [
        <TaxSettingsCard key="tax" hostId={hostId} />,
      ])
    case 'shipping':
      return settingsPage(section, hostId, [
        <ShippingSettingsCard key="shipping" hostId={hostId} />,
        // Where parcels ship from, and pickup, per location.
        <LocationsCard key="locations" hostId={hostId} />,
        // The store's own delivery (AGL-3624); pickup is per location, on
        // the Inventory locations card above.
        <LocalDeliverySettingsCard key="local" hostId={hostId} />,
        <SuppliersCard key="suppliers" hostId={hostId} />,
        <ShipStationCard key="shipstation" hostId={hostId} />,
        // ShippingEasy, with the merchant's own keys (AGL-3633).
        <ShippingEasyCard key="shippingeasy" hostId={hostId} />,
      ])
    case 'notifications':
      return settingsPage(section, hostId, [
        <CustomerNotificationsCard key="customers" hostId={hostId} />,
        // The store's own endpoints for order events (AGL-3611). Renders
        // nothing for a person who may not manage them.
        <OrderWebhooksCard key="webhooks" hostId={hostId} />,
      ])
    case 'pos':
      return settingsPage(section, hostId, [
        <RegistersCard key="registers" hostId={hostId} />,
        <PosStaffPinsCard key="pins" hostId={hostId} />,
        // A register's printers, cash drawer and status (AGL-3619), one card
        // per register, after the list that names them.
        <RegisterHardwareCards key="hardware" hostId={hostId} />,
        <PosDevicesCard
          key="devices"
          hostId={hostId}
          canManagePos={canManagePos}
        />,
        // Card readers bought from the platform (AGL-4038), after the card
        // that registers them. Draws nothing until the deployment opens the
        // shop.
        <PosHardwareCard
          key="hardware-shop"
          hostId={hostId}
          canManagePos={canManagePos}
        />,
      ])
    case 'channels':
    case 'integrations':
      // Other plugins' cards only; the rail leaves either page out while
      // its zone has nothing to draw (`onlyWithZones`).
      return settingsPage(section, hostId, [])
    case 'analytics':
      return (
        // Two cards since AGL-2440. The tax summary lives here rather
        // than on the Taxes settings page because that page CONFIGURES tax and
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
 * ## Sections are ROUTES (AGL-2501)
 *
 * The sections hold thirty-two Firestore listens between them, and a tab
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
  const { hostId, section, sections, basePath, permissions, hostRole } = props
  /*
   * The register's own gate, for the devices card's Pair display (AGL-3712):
   * `managePos` on a site role that may run it — what the server's
   * `mayWorkRegister` asks. The server stays the enforcement point.
   */
  const canManagePos = permissions?.managePos === true && hostRole?.canPublish === true

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
      {sectionBody(section as CommerceConsoleSectionId, hostId, canManagePos)}
    </HubSections>
  )
}
CommerceConsolePage.displayName = 'CommerceConsolePage'

export default CommerceConsolePage
