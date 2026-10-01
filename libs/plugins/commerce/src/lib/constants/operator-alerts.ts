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

import type { OperatorAlertDefinition } from '@aglyn/aglyn/app-utils/operator-alerts'
import { BUNDLE_ID } from './bundle-common'

/**
 * The storefront's operator alerts (AGL-3377): the money faults only this
 * plugin can see, declared in the registry's shape and registered from
 * `declarations.server`, so core lists none of them and an install without
 * commerce shows none of them on Staff → Operator alerts.
 *
 * Each is raised through `raiseOperatorAlert` with its definition, which
 * also registers it in a process whose declarations have not loaded yet.
 */
const DAY = 24 * 60

export const COMMERCE_CHARGEBACK_UNROUTABLE: OperatorAlertDefinition = {
  type: 'commerce.chargebackUnroutable',
  pluginId: BUNDLE_ID,
  label: 'Storefront chargeback could not be routed',
  description:
    'A storefront chargeback matched no order, or more than one, so no order was flagged, no seller share reversed and no merchant told. A missing index means every storefront chargeback is being ignored.',
  tier: 'must',
  category: 'payments',
  title: 'A {{amount}} chargeback could not be routed to an order',
  body: '{{detail}}',
  delivery: 'immediate',
  dedupeWindowMinutes: DAY,
  defaultEnabled: true,
}

export const COMMERCE_TAX_NOT_REVERSED: OperatorAlertDefinition = {
  type: 'commerce.taxNotReversed',
  pluginId: BUNDLE_ID,
  label: 'Subscription sales tax not reversed',
  description:
    'Sales tax collected on a storefront subscription stayed with the merchant instead of coming back to the platform, which files and remits it. The platform may owe tax it does not hold.',
  tier: 'must',
  category: 'payments',
  title: 'Sales tax not reversed on invoice {{invoiceId}}',
  // `{{site}}` is the site's name and id (AGL-3432), so staff need not look
  // it up; the last sentence is the consequence the description states.
  body:
    '{{amount}} of sales tax on invoice {{invoiceId}} for site {{site}} was not pulled back from the merchant: {{reason}}. The platform files and remits that tax, so it may owe tax it does not hold.',
  delivery: 'immediate',
  dedupeWindowMinutes: 7 * DAY,
  defaultEnabled: true,
}

export const COMMERCE_SELLER_SHARE_NOT_REVERSED: OperatorAlertDefinition = {
  type: 'commerce.sellerShareNotReversed',
  pluginId: BUNDLE_ID,
  label: 'Seller share not reversed on a lost dispute',
  description:
    'A storefront dispute was lost and the merchant’s share could not be pulled back, so the platform is out the principal. Recover it by hand in Stripe.',
  tier: 'must',
  category: 'payments',
  title: 'Seller share not reversed on dispute {{disputeId}}',
  body:
    'The lost dispute {{disputeId}} on order {{orderId}} from site {{site}} cost {{amount}}, and the merchant’s share was not reversed: {{reason}}. The platform is out that share until it is recovered by hand in Stripe.',
  delivery: 'immediate',
  dedupeWindowMinutes: 30 * DAY,
  defaultEnabled: true,
}

export const COMMERCE_FEE_REPRICE_REFUSED: OperatorAlertDefinition = {
  type: 'commerce.feeRepriceRefused',
  pluginId: BUNDLE_ID,
  label: 'Platform fee correction refused',
  description:
    'Stripe refused to change a storefront subscription’s platform fee, or to refund the part of a fee charged on the wrong base. The merchant is being charged a fee the plan does not set.',
  tier: 'must',
  category: 'payments',
  title: 'Platform fee not corrected on {{subject}}',
  body:
    'The platform fee on {{subject}} for site {{site}} could not be corrected: {{reason}}. Until it is, the merchant is charged a fee its plan does not set.',
  delivery: 'immediate',
  dedupeWindowMinutes: 7 * DAY,
  defaultEnabled: true,
}

export const COMMERCE_OPERATOR_ALERTS: readonly OperatorAlertDefinition[] = [
  COMMERCE_CHARGEBACK_UNROUTABLE,
  COMMERCE_TAX_NOT_REVERSED,
  COMMERCE_SELLER_SHARE_NOT_REVERSED,
  COMMERCE_FEE_REPRICE_REFUSED,
]
