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
import { HubTabs } from '@aglyn/shared-ui-next'
import CatalogOrganizationCard from './console/catalog-organization-card.component'
import CommerceAnalyticsCard from './console/commerce-analytics-card.component'
import DiscountsCard from './console/discounts-card.component'
import HostCouponsCard from './console/host-coupons-card.component'
import HostOrdersCard from './console/host-orders-card.component'
import LocationsCard from './console/locations-card.component'
import MemberPostsCard from './console/member-posts-card.component'
import PaymentsSettingsCard from './console/payments-settings-card.component'
import ProductsHubCard from './console/products-hub-card.component'
import ReservationsCard from './console/reservations-card.component'
import ReviewsModerationCard from './console/reviews-moderation-card.component'
import ShippingSettingsCard from './console/shipping-settings-card.component'
import StoreSettingsCard from './console/store-settings-card.component'
import SuppliersCard from './console/suppliers-card.component'
import TaxSettingsCard from './console/tax-settings-card.component'

/**
 * Commerce console page (AGL-395): the Products management surface, owned by
 * the commerce plugin and rendered by the shell's generic plugin route. The
 * product editor's media browser is supplied by the shell's
 * ConsoleMediaPickerProvider (the media library is org/session coupled and
 * stays in the app). Mirrors the former `/[hostId]/products` tab layout.
 */
export function CommerceConsolePage(props: ConsolePluginPageProps) {
  const { hostId } = props
  return (
    <HubTabs
      tabs={[
        {
          id: 'catalog',
          label: 'Catalog',
          content: (
            <GridItems
              spacing={3}
              items={[
                { size: { xs: 12 }, children: <ProductsHubCard hostId={hostId} /> },
                {
                  size: { xs: 12 },
                  children: <CatalogOrganizationCard hostId={hostId} />,
                },
                { size: { xs: 12 }, children: <MemberPostsCard hostId={hostId} /> },
              ]}
            />
          ),
        },
        {
          id: 'orders',
          label: 'Orders',
          content: <HostOrdersCard hostId={hostId} />,
        },
        {
          id: 'promotions',
          label: 'Promotions',
          content: (
            <GridItems
              spacing={3}
              items={[
                { size: { xs: 12 }, children: <DiscountsCard hostId={hostId} /> },
                { size: { xs: 12 }, children: <HostCouponsCard hostId={hostId} /> },
                {
                  size: { xs: 12 },
                  children: <ReviewsModerationCard hostId={hostId} />,
                },
              ]}
            />
          ),
        },
        {
          id: 'reservations',
          label: 'Reservations',
          content: <ReservationsCard hostId={hostId} />,
        },
        {
          id: 'settings',
          label: 'Settings',
          content: (
            <GridItems
              spacing={3}
              items={[
                {
                  size: { xs: 12 },
                  children: <PaymentsSettingsCard hostId={hostId} />,
                },
                { size: { xs: 12 }, children: <StoreSettingsCard hostId={hostId} /> },
                { size: { xs: 12 }, children: <TaxSettingsCard hostId={hostId} /> },
                { size: { xs: 12 }, children: <LocationsCard hostId={hostId} /> },
                {
                  size: { xs: 12 },
                  children: <ShippingSettingsCard hostId={hostId} />,
                },
                { size: { xs: 12 }, children: <SuppliersCard hostId={hostId} /> },
              ]}
            />
          ),
        },
        {
          id: 'analytics',
          label: 'Analytics',
          content: <CommerceAnalyticsCard hostId={hostId} />,
        },
      ]}
    />
  )
}
CommerceConsolePage.displayName = 'CommerceConsolePage'

export default CommerceConsolePage
