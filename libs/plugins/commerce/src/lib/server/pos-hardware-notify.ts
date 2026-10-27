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

import { formatOperatorAlertAmount } from '@aglyn/aglyn/app-utils/operator-alerts'
import {
  isAccountBanLockdownReason,
  normalizeOrgLockdown,
} from '@aglyn/aglyn/app-utils/lockdown'
import { POS_HARDWARE_EMAIL_KEYS, sendEmail } from '@aglyn/shared-util-email'
import {
  firebaseAdmin,
  hostDisplayName,
  meterPlatformEmail,
  raiseOperatorAlert,
} from '@aglyn/tenant-data-admin'
import { filterSuppressedEmails } from '@aglyn/tenant-data-admin/server/email-suppression'
import {
  orgSystemEmailBrand,
  renderSystemEmailContent,
} from '@aglyn/tenant-data-admin/server/render-system-email'
import {
  COMMERCE_POS_HARDWARE_CANCELED_AFTER_ORDERING,
  COMMERCE_POS_HARDWARE_ORDER,
  COMMERCE_POS_HARDWARE_REFUND_FAILED,
} from '../constants/operator-alerts'
import { carrierLabelFor } from '../model/tracking-url'
import {
  formatPosHardwareCents,
  POS_HARDWARE_ANCHOR,
  type PosHardwareCancelReason,
  type PosHardwareOrder,
} from '../model/pos-hardware'
import { posHardwareOrderNumber, posSettingsUrl } from './pos-hardware'

/*==========================================
 * TELLING PEOPLE ABOUT A HARDWARE ORDER (AGL-4038).
 *
 * The buyer gets a system email at each step they wait on: received, shipped
 * (with the carrier and tracking link) and delivered (with the way to set the
 * reader up), and canceled when the workspace is deleted or their account is
 * closed before it ships. Staff get the "New hardware order" operator alert,
 * because in phase 1 a person places every order with Stripe, and an alert
 * when a closure cancels an order already placed with Stripe or Stripe
 * refuses a closure's refund.
 *
 * Never throws. The order is already recorded when any of these run, and a
 * lost email must not undo it or turn a webhook into a redelivery.
 *=========================================*/

export type PosHardwareEmailKind = keyof typeof POS_HARDWARE_EMAIL_KEYS

/** The lines as the emails list them, one per item. */
function itemsText(order: PosHardwareOrder): string {
  return (order.lines ?? []).map((line) => `${line.name} × ${line.quantity}`).join('\n')
}

function shipToText(order: PosHardwareOrder): string {
  const address = order.shipping?.address
  const cityLine = address
    ? [address.city, [address.state, address.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ')
    : ''
  return [order.shipping?.name, address?.line1, address?.line2, cityLine].filter(Boolean).join('\n')
}

async function siteAndOrgNames(order: PosHardwareOrder): Promise<{ site: string; org: string; ban: boolean }> {
  const firestore = firebaseAdmin.app().firestore()
  const [host, org] = await Promise.all([
    firestore.collection('hosts').doc(order.hostId).get().catch(() => null),
    firestore.collection('orgs').doc(order.orgId).get().catch(() => null),
  ])
  const lock = normalizeOrgLockdown(org?.data() as never)
  return {
    site: host?.exists ? hostDisplayName(host.data() as Record<string, unknown>, order.hostId) : 'your site',
    org: String(org?.get('name') ?? '').trim() || UNNAMED_WORKSPACE,
    ban: Boolean(lock && isAccountBanLockdownReason(lock.reason)),
  }
}

/** The fallback subject and first line, when no design renders. */
const FALLBACK: Record<PosHardwareEmailKind, (number: string) => string> = {
  received: (number) => `We have your card reader order ${number}`,
  shipped: (number) => `Your card reader order ${number} has shipped`,
  delivered: (number) => `Your card reader order ${number} was delivered`,
  canceled: (number) => `Your card reader order ${number} was canceled and refunded`,
}

/** The fallback a workspace with no name gets in a sentence. */
const UNNAMED_WORKSPACE = 'your workspace'

/**
 * Why the order was canceled, as the end of the email's sentence ("Your
 * order had not shipped yet when …").
 */
function cancelReasonText(reason: PosHardwareCancelReason | undefined, org: string): string {
  if (reason === 'workspace-closed') {
    return org && org !== UNNAMED_WORKSPACE ? `the ${org} workspace was deleted` : 'your workspace was deleted'
  }
  if (reason === 'account-closed') return 'the account that placed it was closed'
  return 'it was canceled'
}

/** Why, for staff: the closure that canceled it, never who the buyer was. */
function staffReasonText(reason: PosHardwareCancelReason, orgId: string): string {
  if (reason === 'workspace-closed') return `its workspace ${orgId} was deleted`
  if (reason === 'account-closed') return 'the account that placed it was closed'
  return 'staff canceled it'
}

/** The merge values for one order's emails. Exported for the render spec. */
export async function posHardwareEmailMerge(
  orderId: string,
  order: PosHardwareOrder,
  names: { site: string; org: string },
): Promise<Record<string, string>> {
  const base = await posSettingsUrl(order.hostId)
  const [path] = base.split('#')
  const ordersUrl = `${path}#${POS_HARDWARE_ANCHOR}`
  return {
    'org.name': names.org,
    'site.name': names.site,
    'order.number': posHardwareOrderNumber(orderId),
    'order.items': itemsText(order),
    'order.total': formatPosHardwareCents(order.totalCents ?? 0),
    'order.shipTo': shipToText(order),
    'order.shippingMethod': order.shipping?.label ?? '',
    'order.carrier': carrierLabelFor(order.tracking?.carrier) || 'the carrier',
    'order.trackingNumber': order.tracking?.number ?? '',
    // An unknown carrier has no tracker to link; the card shows the number.
    'order.trackingUrl': order.tracking?.url ?? ordersUrl,
    'order.ordersUrl': ordersUrl,
    'order.setupUrl': `${path}#pos-devices`,
    // What Stripe reported refunding, or the whole charge where it has not.
    'order.refunded': formatPosHardwareCents(order.refundedCents ?? order.totalCents ?? 0),
    'order.cancelReason': cancelReasonText(order.cancelReason, names.org),
  }
}

export async function sendPosHardwareEmail(
  kind: PosHardwareEmailKind,
  orderId: string,
  order: PosHardwareOrder,
): Promise<void> {
  try {
    const to = String(order.contactEmail ?? '').trim()
    if (!to) return
    const names = await siteAndOrgNames(order)
    // A ban is a ban (AGL-3420): after its notice the account is sent nothing.
    if (names.ban) return
    const [recipient] = await filterSuppressedEmails([to])
    if (!recipient) return
    const merge = await posHardwareEmailMerge(orderId, order, names)
    const subject = FALLBACK[kind](merge['order.number'])
    const brand = await orgSystemEmailBrand(order.orgId)
    // A canceled order's workspace may be gone, so its fallback names the
    // refund rather than linking a card that no longer opens.
    const last = kind === 'canceled' ? `Refunded: ${merge['order.refunded']}` : merge['order.ordersUrl']
    const content = await renderSystemEmailContent(POS_HARDWARE_EMAIL_KEYS[kind], merge, brand, {
      subject,
      text: `${subject}\n\n${merge['order.items']}\n\n${last}`,
    })
    const result = await sendEmail({
      to: recipient,
      ...content,
      ...(brand.fromName ? { fromName: brand.fromName } : {}),
      context: POS_HARDWARE_EMAIL_KEYS[kind],
    })
    if (result.sent) await meterPlatformEmail(1)
  } catch (error) {
    console.error('[pos-hardware] email failed', kind, orderId, error)
  }
}

/**
 * A closure canceled an order staff had already placed with Stripe: the
 * merchant is refunded, and Stripe will still ship it unless someone cancels
 * it there. Once per order.
 */
export async function raisePosHardwareCanceledAfterOrderingAlert(
  orderId: string,
  order: PosHardwareOrder,
  reason: PosHardwareCancelReason,
): Promise<void> {
  try {
    const stripeOrderId = String(order.stripeHardwareOrderId ?? '').trim()
    await raiseOperatorAlert(COMMERCE_POS_HARDWARE_CANCELED_AFTER_ORDERING, {
      dedupeKey: orderId,
      orgId: order.orgId,
      hostId: order.hostId,
      context: {
        orderNumber: posHardwareOrderNumber(orderId),
        amount: formatOperatorAlertAmount(order.totalCents ?? 0),
        items: (order.lines ?? []).map((line) => `${line.quantity} × ${line.name}`).join(', '),
        reason: staffReasonText(reason, order.orgId),
        stripeOrder: stripeOrderId ? ` (Stripe order ${stripeOrderId})` : '',
      },
    })
  } catch (error) {
    console.error('[pos-hardware] canceled-after-ordering alert failed', orderId, error)
  }
}

/**
 * Stripe refused a closure's refund, and the closure went ahead without it.
 * Carries the payment to refund by hand, never the buyer.
 */
export async function raisePosHardwareRefundFailedAlert(
  orderId: string,
  order: PosHardwareOrder,
  reason: PosHardwareCancelReason,
  error: string,
): Promise<void> {
  try {
    const stripeOrderId = String(order.stripeHardwareOrderId ?? '').trim()
    await raiseOperatorAlert(COMMERCE_POS_HARDWARE_REFUND_FAILED, {
      dedupeKey: orderId,
      orgId: order.orgId,
      hostId: order.hostId,
      context: {
        orderNumber: posHardwareOrderNumber(orderId),
        amount: formatOperatorAlertAmount(order.totalCents ?? 0),
        reason: staffReasonText(reason, order.orgId),
        error: error || 'no reason given',
        paymentIntentId: order.stripePaymentIntentId ?? 'for this order (no payment id is recorded on it)',
        orderedNote:
          order.status === 'ordered'
            ? `. It had already been placed with Stripe${stripeOrderId ? ` as ${stripeOrderId}` : ''}, so cancel it there too before it ships`
            : '',
      },
    })
  } catch (failure) {
    console.error('[pos-hardware] refund-failed alert failed', orderId, failure)
  }
}

/** "New hardware order", once per order. */
export async function raisePosHardwareOrderAlert(orderId: string, order: PosHardwareOrder): Promise<void> {
  try {
    const names = await siteAndOrgNames(order)
    await raiseOperatorAlert(COMMERCE_POS_HARDWARE_ORDER, {
      dedupeKey: orderId,
      orgId: order.orgId,
      hostId: order.hostId,
      context: {
        orderNumber: posHardwareOrderNumber(orderId),
        amount: formatOperatorAlertAmount(order.totalCents ?? 0),
        site: `${names.site} (${order.hostId})`,
        items: (order.lines ?? []).map((line) => `${line.quantity} × ${line.name}`).join(', '),
        shipping: order.shipping?.label ?? 'shipping',
      },
    })
  } catch (error) {
    console.error('[pos-hardware] operator alert failed', orderId, error)
  }
}
