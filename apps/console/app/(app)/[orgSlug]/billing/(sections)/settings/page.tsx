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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'

import CardColumns from '../../../../../../components/card-columns.component'
import BillingAddressCardComponent from '../../../../../../components/billing/billing-address-card.component'
import BillingEmailCardComponent from '../../../../../../components/billing/billing-email-card.component'
import BillingPaymentMethodsCardComponent from '../../../../../../components/billing/billing-payment-methods-card.component'
import BillingTaxIdCardComponent from '../../../../../../components/billing/billing-tax-id-card.component'
import { useBillingProfile } from '../../../../../../components/billing/use-billing-profile'
import { docsHelp } from '../../../../../../constants/docs-links'
import useCurrentOrg from '../../../../../../hooks/use-current-org'
import useOrgPermissions from '../../../../../../hooks/use-org-permissions'

/**
 * The org's commercial identity: where invoices go, what pays for them, the
 * address they are issued to, and the tax IDs printed on them.
 *
 * Its own route because these four cards are the ones a customer opens
 * Billing to EDIT, and they used to be at the bottom of a page that priced
 * plans and pulled a year of usage rollups on the way past. Nothing here needs
 * any of that.
 *
 * ONE read of the Stripe customer feeds all four (`useBillingProfile`), and a
 * save in any of them refreshes the rest — four independent fetches would
 * drift the moment one of them wrote.
 */
const BillingSettingsSection: NextPageWithLayout<Record<string, never>> = () => {
  const { orgId } = useCurrentOrg()
  const { can } = useOrgPermissions()
  const profile = useBillingProfile(orgId, true)
  const canManage = can('billing.manage')

  /*
   * `CardColumns`, not a `Stack` and not masonry.
   *
   * All four are the same width by nature — they are forms — so masonry would
   * bucket them into ONE column by size and leave the other half of the page
   * empty, which is the trap the billing band's own comment records. Stacked,
   * they were four full-width cards on a 1110px column: `Billing email` is a
   * single field and took the whole row.
   *
   * `CardColumns` lets the browser place the breaks, which is the mechanism
   * that balances same-width cards.
   */
  return (
    <CardColumns
      spacing={3}
      items={[
        {
          key: 'billing-email',
          children: (
          <CardDisplay
            header={'Billing email'}
            subheader={'Invoices will be sent to the following email address.'}
            help={docsHelp('billing', {
              anchor: '#billing-email',
              excerpt:
                'Where invoices, receipts and the notices about a failed card are sent — and why it is not your organization’s contact email.',
            })}
            contentGutterX
            contentGutterY
          >
            <BillingEmailCardComponent profile={profile} canManage={canManage} />
          </CardDisplay>
          ),
        },
        {
          key: 'payment-methods',
          children: (
          <CardDisplay
            header={'Payment methods'}
            subheader={'The cards your subscription and usage are charged to.'}
            help={docsHelp('billing', {
              anchor: '#payment-methods',
              excerpt:
                'The cards on file, how a new one is added through Stripe’s own form, and why the last card cannot be removed under a live subscription.',
            })}
            contentGutterX
            contentGutterY
          >
            <BillingPaymentMethodsCardComponent
              profile={profile}
              canManage={canManage}
            />
          </CardDisplay>
          ),
        },
        {
          key: 'billing-address',
          children: (
          <CardDisplay
            header={'Billing address'}
            subheader={
              'The address your invoices are issued to, and the one sales tax is calculated from.'
            }
            help={docsHelp('billing', {
              anchor: '#billing-address',
              excerpt:
                'The address invoices are issued to and sales tax is computed from, and why it can be replaced but not emptied.',
            })}
            contentGutterX
            contentGutterY
          >
            <BillingAddressCardComponent profile={profile} canManage={canManage} />
          </CardDisplay>
          ),
        },
        {
          key: 'tax-id',
          children: (
          <CardDisplay
            header={'Tax ID'}
            subheader={'Specify a tax ID to have it appear on your invoices.'}
            help={docsHelp('billing', {
              anchor: '#tax-ids',
              excerpt:
                'Put a VAT, ABN, GST or EIN number on your invoices, and what Stripe checks before accepting one.',
            })}
            contentGutterX
            contentGutterY
          >
            <BillingTaxIdCardComponent profile={profile} canManage={canManage} />
          </CardDisplay>
          ),
        },
      ]}
    />
  )
}
BillingSettingsSection.displayName = 'Page:BillingSettings'

export default BillingSettingsSection
