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

import { formatOrderNumber, type HostOrder } from '../model/commerce-orders'
import { escapeHtml } from './escape-html'

/**
 * The packing slip (the order dialog's "Packing slip"): the order's number,
 * where it ships and each line with its quantity and SKU, as markup for the
 * print dialog. The console writes it into a print popup; the apps print the
 * same markup, which `commerce/order-print` sends them.
 *
 * ESCAPED (AGL-2283). The console's popup is an `about:blank` document that
 * INHERITS the console's origin, and `order.shippingAddress` is copied
 * verbatim from Stripe's `shipping_details`, i.e. typed by the SHOPPER. A
 * name of `<img src=x onerror=…>` ran script against the merchant's own
 * authenticated session. Line names and SKUs are merchant-authored and lower
 * severity, but they are the same construction and get the same treatment.
 */
export function buildPackingSlipHtml(
  order: Pick<HostOrder, 'number' | 'lineItems' | 'shippingAddress'>,
  orderId: string,
): string {
  const rows = (order.lineItems ?? [])
    .map(
      (line) =>
        `<tr><td>${escapeHtml(line.quantity)}×</td><td>${escapeHtml(line.name)}${
          line.variantLabel ? ` — ${escapeHtml(line.variantLabel)}` : ''
        }</td><td>${escapeHtml(line.sku ?? '')}</td></tr>`,
    )
    .join('')
  const address = order.shippingAddress
  return (
    `<h2>Packing slip ${escapeHtml(formatOrderNumber(order, orderId))}</h2>` +
    (address
      ? `<p>${[
          address.name,
          address.line1,
          address.line2,
          `${address.city ?? ''} ${address.state ?? ''} ${address.postalCode ?? ''}`,
          address.country,
        ]
          .filter(Boolean)
          .map((part) => escapeHtml(part))
          .join('<br/>')}</p>`
      : '') +
    `<table border="0" cellpadding="6">${rows}</table>`
  )
}
