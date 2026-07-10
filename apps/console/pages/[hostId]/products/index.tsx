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
import { Container, GridItems } from '@aglyn/shared-ui-jsx'
import { NextPageTitle, NextPageWithLayout } from '@aglyn/shared-ui-next'
import HostOrdersCard from '../../../components/commerce/host-orders-card.component'
import HostProductsCard from '../../../components/commerce/host-products-card.component'
import HostDisplayNameComponent from '../../../components/host-display-name.component'
import { useHostId } from '../../../components/host-id-provider'
import AuthenticatedLayout from '../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../components/layouts/dashboard.layout'
import MainLayout from '../../../components/layouts/main.layout'
import hostNavTabItems from '../../../constants/host-nav-tabs'
import { buildRoute, Route } from '../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'

/**
 * Products page (AGL-250): the commerce starter surface moved off the
 * dashboard — products with Stripe checkout links, plus recent orders.
 */
const HostProducts: NextPageWithLayout = () => {
  const hostId = useHostId()

  return (
    <>
      <NextPageTitle screen={'Products'} />
      <DashboardLayout
        navTabItems={hostNavTabItems(hostId)}
        breadcrumbItems={[
          {
            children: <HostDisplayNameComponent hostId={hostId} />,
            href: buildRoute(Route.HOST_DASHBOARD, { hostId }),
          },
          {
            children: 'Products',
            href: buildRoute(Route.HOST_PRODUCTS, { hostId }),
          },
        ]}
        header={{
          children: 'Products',
          icon: { path: ICON_VARIANT_APP_SETTINGS.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <GridItems
            spacing={3}
            items={[
              {
                size: { xs: 12 },
                children: <HostProductsCard hostId={hostId} />,
              },
              {
                size: { xs: 12 },
                children: <HostOrdersCard hostId={hostId} />,
              },
            ]}
          />
        </Container>
      </DashboardLayout>
    </>
  )
}
HostProducts.displayName = 'Page:HostProducts'
HostProducts.layouts = [
  {
    Component: AuthenticatedLayout,
  },
  {
    Component: MainLayout,
    props: {
      title: 'Products',
    },
  },
]

export default HostProducts
