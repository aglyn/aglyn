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

/**
 * A merchant paid for card readers in the POS hardware shop (AGL-4038). In
 * phase 1 a person places the order in Stripe's Terminal hardware shop, so
 * every paid order is work waiting on staff until it is marked ordered.
 */
export const COMMERCE_POS_HARDWARE_ORDER: OperatorAlertDefinition = {
  type: 'commerce.posHardwareOrder',
  pluginId: BUNDLE_ID,
  label: 'New hardware order',
  description:
    'A workspace paid for card readers or accessories in the POS hardware shop. Place the order in the Stripe Dashboard’s Terminal hardware shop, shipping to the merchant’s address, then record the Stripe order id on Staff → Hardware orders.',
  tier: 'should',
  category: 'payments',
  title: 'New hardware order {{orderNumber}} for {{amount}}',
  body:
    'Site {{site}} ordered {{items}} ({{amount}}, {{shipping}}). Place it in the Stripe Dashboard’s Terminal hardware shop, shipping to the address on the order, and record the Stripe order id on Staff → Hardware orders.',
  link: '/admin/hardware-orders',
  delivery: 'immediate',
  dedupeWindowMinutes: 30 * DAY,
  defaultEnabled: true,
}

/**
 * A card taken offline on the Aglyn POS app's reader reached Stripe, but the
 * sale it belongs to never synced (AGL-4039). Raised by the hourly sweep once
 * the intent has waited past `POS_OFFLINE_CARD_UNSYNCED_ALERT_MS`, while there
 * is still time to sync it before Stripe's authorization lapses.
 */
export const COMMERCE_POS_OFFLINE_CARD_UNSYNCED: OperatorAlertDefinition = {
  type: 'commerce.posOfflineCardUnsynced',
  pluginId: BUNDLE_ID,
  label: 'Offline card sale never synced',
  description:
    'A card taken offline on a register reached Stripe, but its sale never reached the store. An authorized card is never captured and lapses after about two days; a charged one has no order. The site’s managers are told too.',
  tier: 'should',
  category: 'payments',
  title: 'A {{amount}} card taken offline has no sale',
  body:
    'Payment {{paymentIntentId}} ({{status}}) for site {{site}} was taken offline on register {{registerId}} {{age}} ago, and its sale never synced. Ask the store to open that register signed in as the member who rang it so the sale syncs. An authorized card that is not captured lapses about two days after it was taken.',
  delivery: 'immediate',
  dedupeWindowMinutes: 30 * DAY,
  defaultEnabled: true,
}

/**
 * A card taken offline was made out to a Stripe account that is not the
 * store's (AGL-4039): a stale offline kit, or a register that was tampered
 * with. The sync never captures it and records the order unpaid.
 */
export const COMMERCE_POS_OFFLINE_CARD_WRONG_ACCOUNT: OperatorAlertDefinition = {
  type: 'commerce.posOfflineCardWrongAccount',
  pluginId: BUNDLE_ID,
  label: 'Offline card made out to another Stripe account',
  description:
    'A card taken offline on a register was set to pay a Stripe account that is not the store’s. The sale was recorded unpaid and the card was not captured. Check whether the account is the store’s own previous one before capturing it in Stripe, or let the authorization lapse.',
  tier: 'must',
  category: 'payments',
  title: 'A {{amount}} offline card was made out to another Stripe account',
  body:
    'Payment {{paymentIntentId}} ({{status}}) on order {{orderId}} for site {{site}} pays account {{destination}}, but the store’s account is {{expected}}. The order is recorded unpaid and nothing was captured. If the payment already succeeded, the money is in that other account: recover or refund it in Stripe.',
  delivery: 'immediate',
  dedupeWindowMinutes: 30 * DAY,
  defaultEnabled: true,
}

/**
 * A hardware order already placed with Stripe was canceled and refunded
 * because its workspace was deleted or the account that placed it closed
 * (AGL-4038). The merchant has their money back; the platform has paid Stripe
 * for hardware that is still on its way unless someone cancels it there.
 */
export const COMMERCE_POS_HARDWARE_CANCELED_AFTER_ORDERING: OperatorAlertDefinition = {
  type: 'commerce.posHardwareCanceledAfterOrdering',
  pluginId: BUNDLE_ID,
  label: 'Hardware order canceled after it was placed with Stripe',
  description:
    'A workspace was deleted, or the account that placed a hardware order was closed, after staff had placed the order with Stripe. The merchant was refunded in full. Cancel the order in the Stripe Dashboard’s Terminal hardware shop before it ships, or arrange its return with Stripe.',
  tier: 'must',
  category: 'payments',
  title: 'Cancel hardware order {{orderNumber}} with Stripe',
  // `{{stripeOrder}}` is ` (Stripe order …)` or blank, so the sentence reads
  // either way.
  body:
    'Hardware order {{orderNumber}} ({{amount}}: {{items}}) was canceled and refunded in full to the merchant because {{reason}}, but it had already been placed with Stripe{{stripeOrder}}. Cancel it in the Stripe Dashboard’s Terminal hardware shop before it ships; if it has shipped, arrange its return with Stripe.',
  link: '/admin/hardware-orders',
  delivery: 'immediate',
  dedupeWindowMinutes: 30 * DAY,
  defaultEnabled: true,
}

/**
 * Stripe refused the refund of an unshipped hardware order while its
 * workspace or its buyer's account was closing (AGL-4038). The closure went
 * ahead, as decided, so the order may be gone from the staff page with the
 * merchant's money still held.
 */
export const COMMERCE_POS_HARDWARE_REFUND_FAILED: OperatorAlertDefinition = {
  type: 'commerce.posHardwareRefundFailed',
  pluginId: BUNDLE_ID,
  label: 'Hardware refund failed when a workspace or account closed',
  description:
    'A hardware order had not shipped when its workspace was deleted or the account that placed it was closed, and Stripe refused its refund. The closure went ahead without it. Refund the payment in full in the Stripe Dashboard.',
  tier: 'must',
  category: 'payments',
  title: 'Refund hardware order {{orderNumber}} by hand: {{amount}}',
  body:
    'Hardware order {{orderNumber}} ({{amount}}) had not shipped when {{reason}}, and Stripe refused its refund: {{error}}. The closure went ahead. Refund payment {{paymentIntentId}} in full in the Stripe Dashboard{{orderedNote}}.',
  delivery: 'immediate',
  dedupeWindowMinutes: 30 * DAY,
  defaultEnabled: true,
}

/**
 * A buyer asked to return a card reader they bought in person at the
 * platform's own store (AGL-4038), from their own purchase history. Staff
 * refund it from Staff → Hardware orders, or decline it there.
 */
export const COMMERCE_POS_HARDWARE_RETURN_REQUESTED: OperatorAlertDefinition = {
  type: 'commerce.posHardwareReturnRequested',
  pluginId: BUNDLE_ID,
  label: 'Card reader return requested',
  description:
    'A workspace asked to return card reader hardware it bought in person. Arrange the return under Stripe’s hardware terms, then refund it or decline it on Staff → Hardware orders, under Return requested.',
  tier: 'should',
  category: 'payments',
  title: 'Return requested for hardware order {{orderNumber}} ({{amount}})',
  body:
    'Workspace {{orgId}} asked to return {{items}} from hardware order {{orderNumber}} ({{amount}}), bought in person: “{{reason}}”. Refund it or decline it on Staff → Hardware orders, under Return requested.',
  link: '/admin/hardware-orders',
  delivery: 'immediate',
  dedupeWindowMinutes: 30 * DAY,
  defaultEnabled: true,
}

/**
 * A workspace's monthly 4G charge for its Stripe Reader S710s did not
 * collect (AGL-4038): the card declined or asked for authentication (the
 * invoice is left open on their Billing page, which nothing retries), or
 * the workspace has no Stripe customer to bill. Stripe still bills the
 * platform for those readers' cellular service.
 */
export const COMMERCE_POS_CELLULAR_CHARGE_FAILED: OperatorAlertDefinition = {
  type: 'commerce.posCellularChargeFailed',
  pluginId: BUNDLE_ID,
  label: '4G charge for card readers not collected',
  description:
    'A workspace’s monthly charge for 4G on its Stripe Reader S710s did not collect. Stripe still bills the platform for those readers. Follow up with the workspace, or turn 4G off for its stores.',
  tier: 'should',
  category: 'payments',
  title: '4G charge for {{month}} not collected: {{amount}}',
  body:
    'Workspace {{orgId}} had 4G on {{readers}} card reader(s) in {{month}}, and its charge of {{amount}} was not collected: {{reason}}. Stripe still bills the platform for those readers.',
  delivery: 'immediate',
  dedupeWindowMinutes: 30 * DAY,
  defaultEnabled: true,
}

/**
 * 4G could not be turned off at Stripe for a store that is gone (AGL-4038):
 * its workspace was deleted, or the store was, while its S710s had 4G. The
 * readers stay on the platform's Stripe account with cellular on, which
 * Stripe keeps billing the platform for, and nobody is charged for it.
 */
export const COMMERCE_POS_CELLULAR_TURN_OFF_FAILED: OperatorAlertDefinition = {
  type: 'commerce.posCellularTurnOffFailed',
  pluginId: BUNDLE_ID,
  label: '4G not turned off for a deleted store',
  description:
    'A store with 4G on its Stripe Reader S710s was deleted, with its workspace or on its own, and Stripe refused to turn cellular off on its Terminal configuration. Turn it off in the Stripe Dashboard, or Stripe keeps billing the platform for it.',
  tier: 'must',
  category: 'payments',
  title: 'Turn off 4G on Terminal configuration {{configurationId}}',
  body:
    'Store {{hostId}} of workspace {{orgId}} was deleted while its card readers had 4G, and Stripe refused to turn cellular off on Terminal configuration {{configurationId}}. Turn it off in the Stripe Dashboard (Terminal → Locations), or Stripe keeps billing the platform for those readers.',
  delivery: 'immediate',
  dedupeWindowMinutes: 30 * DAY,
  defaultEnabled: true,
}

export const COMMERCE_OPERATOR_ALERTS: readonly OperatorAlertDefinition[] = [
  COMMERCE_CHARGEBACK_UNROUTABLE,
  COMMERCE_TAX_NOT_REVERSED,
  COMMERCE_SELLER_SHARE_NOT_REVERSED,
  COMMERCE_FEE_REPRICE_REFUSED,
  COMMERCE_POS_HARDWARE_ORDER,
  COMMERCE_POS_OFFLINE_CARD_UNSYNCED,
  COMMERCE_POS_OFFLINE_CARD_WRONG_ACCOUNT,
  COMMERCE_POS_HARDWARE_CANCELED_AFTER_ORDERING,
  COMMERCE_POS_HARDWARE_REFUND_FAILED,
  COMMERCE_POS_HARDWARE_RETURN_REQUESTED,
  COMMERCE_POS_CELLULAR_CHARGE_FAILED,
  COMMERCE_POS_CELLULAR_TURN_OFF_FAILED,
]
